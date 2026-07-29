import './style.css';
import * as THREE from 'three';
import { CONFIG } from './config';
import { Mountain } from './terrain';
import { Rider } from './rider';
import { ChaseCamera } from './camera';
import { SkiInputController } from './input';
import { SkiPhysics } from './physics';
import { ChunkManager } from './chunks';
import { PickupManager } from './pickups';
import { GateManager } from './gates';
import { SkiEffects } from './effects';
import { Scenery } from './scenery';
import { PostProcessing } from './postprocessing';
import { SkiAudio } from './audio';
import { SkiHud } from './hud';
import { ScoreTracker } from './scoring';
import { updateSnowShaderUniforms } from './snowShader';

type GameState = 'menu' | 'playing' | 'ended';

/** Half-width of the rider's collision footprint, added to each obstacle's radius. */
const RIDER_COLLISION_RADIUS = 0.55;
/** How far along the sun direction the sun billboard sits; only its screen projection matters. */
const SUN_DISTANCE = 1900;

// Scratch objects reused every frame. Nothing in the render loop may allocate.
const scratchRiderPos = new THREE.Vector3();
const scratchNormal = new THREE.Vector3();
const scratchForward = new THREE.Vector3();
const scratchLateral = new THREE.Vector3();
const scratchSunWorld = new THREE.Vector3();
const scratchPreviewPos = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function trickLabel(spinDeg: number, direction: 'FS' | 'BS', grabbed: boolean, bigAir: boolean, switchLanding: boolean): string | null {
  const parts: string[] = [];
  if (spinDeg >= 45) parts.push(`${Math.round(spinDeg / 45) * 45}° ${direction}`);
  if (bigAir) parts.push('BIG AIR');
  if (grabbed) parts.push('GRAB');
  if (switchLanding) parts.push('SWITCH');
  return parts.length > 0 ? parts.join(' ') : null;
}

function bootstrap(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('Missing #app root element');

  const canvas = document.createElement('canvas');
  canvas.id = 'ski-canvas';
  app.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(CONFIG.visual.fogColor, CONFIG.visual.fogDensity);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const input = new SkiInputController(app);
  const basePixelRatio = input.isTouch ? CONFIG.mobile.pixelRatio : Math.min(window.devicePixelRatio, CONFIG.visual.maxPixelRatio);
  renderer.setPixelRatio(basePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const mountain = new Mountain(CONFIG.seed);
  const chunkManager = new ChunkManager(mountain);
  const pickupManager = new PickupManager(mountain);
  const gateManager = new GateManager(mountain);
  const scenery = new Scenery();
  const effects = new SkiEffects();
  const rider = new Rider();

  scene.add(chunkManager.group, pickupManager.group, gateManager.group, scenery.group, effects.group, rider.root);
  scene.add(scenery.sunLight, scenery.hemiLight);

  const chaseCam = new ChaseCamera(window.innerWidth / window.innerHeight);
  const audio = new SkiAudio();
  const hud = new SkiHud(app, input.isTouch);
  const scoring = new ScoreTracker();
  const postFx = new PostProcessing(renderer, scene, chaseCam.camera, window.innerWidth, window.innerHeight);
  if (input.isTouch) postFx.setDofEnabled(false);

  let physics = new SkiPhysics(mountain, 0);
  let gameState: GameState = 'menu';
  const clock = new THREE.Clock();
  let elapsed = 0;

  let frameTimeEma = CONFIG.adaptive.frameTimeTargetMs;
  let qualityStage = 0;
  let lastDowngradeAt = 0;
  let fpsAccumulatorTime = 0;
  let fpsAccumulatorFrames = 0;
  let currentFps = 60;

  /** Current rider position in a shared scratch vector -- valid until the next call. */
  function riderVector(): THREE.Vector3 {
    return scratchRiderPos.set(physics.x, physics.y, physics.z);
  }

  function startRun(): void {
    physics = new SkiPhysics(mountain, 0);
    scoring.reset();
    // Chunks 0..8 are already streamed in and never get unloaded/rebuilt when the rider warps back to
    // z=0, so pickups and gates must be told to respawn explicitly -- otherwise a replay runs the first
    // 800 m with every orb already collected and every gate already marked passed.
    pickupManager.reset();
    gateManager.reset(mountain.centerXAt(0), 0);
    chaseCam.snapTo({ position: riderVector(), z: 0, yaw: physics.yaw, edgeAngle: 0, speed01: 0, boosting: false });
    effects.reset();
    gameState = 'playing';
    hud.hideOverlays();
    // Space is also the jump key; leaving the start button focused makes the first jump re-press it.
    (document.activeElement as HTMLElement | null)?.blur();
  }

  hud.onStart(startRun);
  hud.onRestart(startRun);

  if (new URLSearchParams(window.location.search).has('autostart')) {
    startRun();
  } else {
    hud.showStartOverlay(scoring.best);
  }

  function handleTrick(spinDeg: number, direction: 'FS' | 'BS', grabbed: boolean, bigAir: boolean, switchLanding: boolean): void {
    const spinScore = (spinDeg / 180) * CONFIG.scoring.spinPer180;
    const grabScore = grabbed ? CONFIG.scoring.grabScore : 0;
    const bigAirScore = bigAir ? CONFIG.scoring.bigAirScore : 0;
    const switchScore = switchLanding ? CONFIG.scoring.switchScore : 0;
    const total = spinScore + grabScore + bigAirScore + switchScore;
    if (total <= 0) return;
    scoring.addPoints(total);
    const label = trickLabel(spinDeg, direction, grabbed, bigAir, switchLanding);
    if (label) hud.showPopup(label, 'trick');
  }

  function tick(): void {
    const dt = Math.max(0.001, Math.min(0.05, clock.getDelta()));
    elapsed += dt;

    const frameMs = dt * 1000;
    frameTimeEma += (frameMs - frameTimeEma) * CONFIG.adaptive.emaAlpha;
    fpsAccumulatorTime += dt;
    fpsAccumulatorFrames += 1;
    if (fpsAccumulatorTime >= 0.5) {
      currentFps = fpsAccumulatorFrames / fpsAccumulatorTime;
      fpsAccumulatorTime = 0;
      fpsAccumulatorFrames = 0;
    }
    if (frameTimeEma > CONFIG.adaptive.frameTimeStepDownMs && elapsed - lastDowngradeAt > 2) {
      lastDowngradeAt = elapsed;
      if (qualityStage === 0) {
        renderer.setPixelRatio(CONFIG.adaptive.pixelRatioStep1);
        // The composer sizes its targets from the renderer's pixel ratio, so it has to be told too --
        // otherwise the passes keep rendering at the old resolution and the step-down saves nothing.
        postFx.setSize(window.innerWidth, window.innerHeight);
        qualityStage = 1;
      } else if (qualityStage === 1) {
        postFx.setDofEnabled(false);
        qualityStage = 2;
      } else if (qualityStage === 2) {
        postFx.setGodraysEnabled(false);
        qualityStage = 3;
      }
    }

    if (gameState === 'menu') {
      const previewZ = 8;
      const previewCenterX = mountain.centerXAt(previewZ);
      const previewPos = scratchPreviewPos.set(previewCenterX, mountain.heightAt(previewCenterX, previewZ), previewZ);
      const dir = mountain.dirAt(previewZ);
      rider.update(previewPos, WORLD_UP, Math.atan2(dir.x, dir.z), 0, 0, false, 0, dt);
      chaseCam.updateMenuOrbit(dt, previewPos);
      chunkManager.update(previewZ, chaseCam.camera.position);
      scenery.update(dt, chaseCam.camera.position, previewPos);
      effects.snowfall.update(dt, chaseCam.camera.position);
      updateSnowShaderUniforms(scenery.sunDirection, elapsed);
      const sunWorldPosition = scratchSunWorld.copy(chaseCam.camera.position).addScaledVector(scenery.sunDirection, SUN_DISTANCE);
      postFx.render({ sunWorldPosition, sunHalo: scenery.sunHalo, speed01: 0, boosting: false, boundaryWarning: 0, elapsed });
      requestAnimationFrame(tick);
      return;
    }

    if (gameState === 'playing') {
      const inputState = input.getState();
      if (input.consumeJump()) physics.manualJump();
      if (input.consumeRespawn()) physics.respawn();

      physics.update(dt, inputState, mountain);

      for (const event of physics.drainEvents()) {
        if (event.type === 'takeoff') {
          audio.playTakeoffWhoosh();
        } else if (event.type === 'landing' && event.clean) {
          handleTrick(event.spinDeg, event.direction, event.grabbed, event.bigAir, event.switchLanding);
          effects.burst(riderVector(), 20, false);
          effects.triggerShockwave(riderVector(), 0xffffff, 1);
          chaseCam.triggerShake(0.35);
        } else if (event.type === 'wipeout') {
          audio.playWipeout();
          effects.burst(riderVector(), 45, true);
          effects.triggerShockwave(riderVector(), 0xff4444, 1.6);
          chaseCam.triggerShake(1.1);
          postFx.triggerImpact(0.03);
          hud.showPopup('WIPEOUT', 'miss');
          scoring.resetCombo();
        } else if (event.type === 'shieldSaved') {
          audio.playShieldBreak();
          postFx.triggerImpact(0.02);
          hud.showPopup('SHIELD SAVED YOU', 'shield');
        }
      }

      const riderPos = riderVector();

      for (const event of pickupManager.update(dt, physics.z, riderPos)) {
        if (event.kind === 'orb') {
          scoring.addPoints(CONFIG.pickups.orbPoints);
          audio.playPickupChime(Math.min(9, scoring.chain - 1));
          effects.triggerShockwave(event.position, CONFIG.pickups.orbColor, 0.5);
        } else if (event.kind === 'boost') {
          physics.activateBoost();
          audio.playBoostSweep();
          hud.showPopup('BOOST!', 'boost');
          effects.triggerShockwave(event.position, 0xffcc33, 0.9);
        } else if (event.kind === 'shield') {
          physics.grantShield();
          audio.playShieldJingle();
          hud.showPopup('SHIELD', 'shield');
          effects.triggerShockwave(event.position, 0xbfe6ff, 0.9);
        }
      }

      for (const event of gateManager.update(physics.x, physics.z)) {
        if (event.type === 'pass') {
          scoring.addPoints(CONFIG.gates.scorePass);
          audio.playGatePass();
          hud.showPopup('GATE', 'gate');
        } else {
          scoring.resetCombo();
          audio.playGateMiss();
          hud.showPopup('GATE MISSED', 'miss');
        }
      }

      // Always test while grounded and let `crash()` decide the outcome -- gating on any
      // invulnerability here would mean a shielded hit never registers, so the shield is never spent.
      if (physics.grounded && !physics.inCollisionGrace && chunkManager.hitsObstacle(physics.x, physics.z, RIDER_COLLISION_RADIUS)) {
        physics.crash();
      }

      chunkManager.update(physics.z, chaseCam.camera.position);

      const airEase = Math.min(1, physics.airTime * 3);
      const displayNormal = scratchNormal.copy(physics.surfaceNormal);
      if (!physics.grounded) displayNormal.lerp(WORLD_UP, airEase);
      const edgeFactor = Math.abs(physics.edgeAngle) / CONFIG.physics.maxEdgeAngle;
      const crouch = (physics.tucking ? 1 : 0) * 0.6 + edgeFactor * 0.4;
      rider.update(riderPos, displayNormal, physics.yaw, physics.grounded ? physics.edgeAngle : physics.edgeAngle * 0.3, Math.min(1, crouch), physics.airborne, physics.grabAmount, dt);

      const tumbleQuat = physics.getTumbleRotation();
      if (tumbleQuat) rider.root.quaternion.premultiply(tumbleQuat);

      chaseCam.update(
        dt,
        { position: riderPos, z: physics.z, yaw: physics.yaw, edgeAngle: physics.edgeAngle, speed01: Math.min(1, physics.speed / CONFIG.physics.maxSpeed), boosting: physics.boostTimer > 0 },
        mountain,
      );

      const boardForward = scratchForward.set(Math.sin(physics.yaw), 0, Math.cos(physics.yaw));
      const boardLateral = scratchLateral.set(boardForward.z, 0, -boardForward.x);
      effects.update(dt, riderPos, boardLateral, boardForward, physics.edgeAngle, Math.min(1, physics.lateralSlipSpeed / 3), physics.speed, physics.grounded, chaseCam.camera.position);

      scenery.update(dt, chaseCam.camera.position, riderPos);
      updateSnowShaderUniforms(scenery.sunDirection, elapsed);
      audio.update(dt, physics.speed, physics.lateralSlipSpeed, physics.tucking);
      scoring.update(dt);

      hud.update({
        speedKmh: physics.speed * CONFIG.hud.speedDisplayScale,
        score: scoring.score,
        best: scoring.best,
        comboMultiplier: scoring.comboMultiplier,
        comboActive: scoring.comboActive,
        distanceM: physics.z,
        boostFraction: physics.boostTimer > 0 ? physics.boostTimer / CONFIG.pickups.boostDuration : null,
        shielded: physics.shielded,
        fps: currentFps,
      });

      const sunWorldPosition = scratchSunWorld.copy(chaseCam.camera.position).addScaledVector(scenery.sunDirection, SUN_DISTANCE);
      postFx.render({
        sunWorldPosition,
        sunHalo: scenery.sunHalo,
        speed01: Math.min(1, physics.speed / CONFIG.physics.maxSpeed),
        boosting: physics.boostTimer > 0,
        boundaryWarning: physics.boundaryWarning,
        elapsed,
      });

      if (physics.runEnded) {
        // Capture the old best before finalizing, so the end screen can call out a new record.
        const previousBest = scoring.best;
        scoring.finalizeBest();
        hud.showEndOverlay({
          score: scoring.score,
          best: scoring.best,
          distanceM: physics.z,
          isNewBest: scoring.score > previousBest && scoring.score > 0,
          cause: 'wipeout',
        });
        gameState = 'ended';
      }
    } else {
      hud.update({
        speedKmh: 0,
        score: scoring.score,
        best: scoring.best,
        comboMultiplier: 1,
        comboActive: false,
        distanceM: physics.z,
        boostFraction: null,
        shielded: false,
        fps: currentFps,
      });
      const sunWorldPosition = scratchSunWorld.copy(chaseCam.camera.position).addScaledVector(scenery.sunDirection, SUN_DISTANCE);
      postFx.render({ sunWorldPosition, sunHalo: scenery.sunHalo, speed01: 0, boosting: false, boundaryWarning: 0, elapsed });
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);

  window.addEventListener('resize', () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height);
    chaseCam.setAspect(width / height);
    postFx.setSize(width, height);
  });
}

bootstrap();
