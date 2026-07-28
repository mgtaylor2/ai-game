const PENTATONIC = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 784.0, 880.0];

/** Procedural WebAudio, no files: one context created on first user gesture, feeding a scrape/wind/ambient bed plus oscillator one-shots. */
export class SkiAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private scrapeGain: GainNode | null = null;
  private scrapeFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private time = 0;
  private started = false;

  constructor() {
    const start = () => this.start();
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
    window.addEventListener('touchstart', start, { once: true });
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextClass();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    const noiseBuffer = this.createNoiseBuffer(ctx, 2);

    const scrapeSource = ctx.createBufferSource();
    scrapeSource.buffer = noiseBuffer;
    scrapeSource.loop = true;
    const scrapeBandpass = ctx.createBiquadFilter();
    scrapeBandpass.type = 'bandpass';
    scrapeBandpass.frequency.value = 900;
    scrapeBandpass.Q.value = 0.7;
    const scrapeLowpass = ctx.createBiquadFilter();
    scrapeLowpass.type = 'lowpass';
    scrapeLowpass.frequency.value = 1400;
    this.scrapeFilter = scrapeLowpass;
    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    scrapeSource.connect(scrapeBandpass).connect(scrapeLowpass).connect(this.scrapeGain).connect(this.master);
    scrapeSource.start();

    const windSource = ctx.createBufferSource();
    windSource.buffer = noiseBuffer;
    windSource.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 2200;
    windFilter.Q.value = 0.4;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    windSource.connect(windFilter).connect(this.windGain).connect(this.master);
    windSource.start();

    const ambientSource = ctx.createBufferSource();
    ambientSource.buffer = noiseBuffer;
    ambientSource.loop = true;
    const ambientFilter = ctx.createBiquadFilter();
    ambientFilter.type = 'lowpass';
    ambientFilter.frequency.value = 220;
    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = 0.05;
    ambientSource.connect(ambientFilter).connect(this.ambientGain).connect(this.master);
    ambientSource.start();
  }

  private createNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Continuous layers: called every frame once audio has started. */
  update(dt: number, speed: number, lateralSlip: number, tuck: boolean): void {
    if (!this.ctx || !this.scrapeGain || !this.scrapeFilter || !this.windGain || !this.ambientGain) return;
    this.time += dt;
    const t = this.ctx.currentTime;

    const slip01 = Math.min(1, Math.abs(lateralSlip) / 4);
    const speed01 = Math.min(1, speed / 42);
    this.scrapeGain.gain.setTargetAtTime((tuck ? 0.02 : 0.05) + slip01 * 0.35 + speed01 * 0.05, t, 0.08);
    this.scrapeFilter.frequency.setTargetAtTime(600 + slip01 * 2600 + speed01 * 400, t, 0.1);

    this.windGain.gain.setTargetAtTime(Math.min(0.4, speed01 * speed01 * 0.4), t, 0.15);
    this.ambientGain.gain.setTargetAtTime(0.04 + Math.sin(this.time * 0.15) * 0.015, t, 0.5);
  }

  private blip(freqStart: number, freqEnd: number, duration: number, type: OscillatorType, peakGain: number, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peakGain, t0 + duration * 0.15);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  private noiseBurst(duration: number, filterFreqStart: number, filterFreqEnd: number, peakGain: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.createNoiseBuffer(ctx, duration);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.9;
    filter.frequency.setValueAtTime(filterFreqStart, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(1, filterFreqEnd), t0 + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peakGain, t0 + duration * 0.2);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(t0);
    source.stop(t0 + duration + 0.05);
  }

  playPickupChime(chainIndex: number): void {
    const freq = PENTATONIC[Math.min(PENTATONIC.length - 1, chainIndex)];
    this.blip(freq * 0.6, freq, 0.1, 'sine', 0.3);
    this.noiseBurst(0.06, freq * 0.8, freq * 1.4, 0.08);
  }

  playTakeoffWhoosh(): void {
    this.noiseBurst(0.3, 300, 2400, 0.18);
  }

  playBoostSweep(): void {
    this.blip(140, 900, 0.5, 'sawtooth', 0.22);
  }

  playShieldJingle(): void {
    this.blip(523.25, 523.25, 0.12, 'sine', 0.22, 0);
    this.blip(659.25, 659.25, 0.12, 'sine', 0.22, 0.09);
    this.blip(783.99, 783.99, 0.16, 'sine', 0.24, 0.18);
  }

  playShieldBreak(): void {
    this.blip(700, 120, 0.35, 'sawtooth', 0.22);
  }

  playGatePass(): void {
    this.blip(660, 880, 0.09, 'triangle', 0.18);
  }

  playGateMiss(): void {
    this.blip(300, 160, 0.2, 'square', 0.14);
  }

  playWipeout(): void {
    this.noiseBurst(0.6, 900, 80, 0.3);
  }
}
