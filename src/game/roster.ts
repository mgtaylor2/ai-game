import { DEFAULT_TUNING, type KartTuning } from '../kart/controller';

export type CharacterId = 'star' | 'dash' | 'bloom';
export type VehicleId = 'kart' | 'bike';

/** Speed/acceleration/handling, each normalised to [0, 1]. */
export interface StatTriad {
  speed: number;
  accel: number;
  handling: number;
}

export interface CharacterDef {
  id: CharacterId;
  name: string;
  icon: string;
  tagline: string;
  paint: { suit: number; helmet: number };
  stats: StatTriad;
}

export interface VehicleDef {
  id: VehicleId;
  name: string;
  icon: string;
  tagline: string;
  paint: { color: number; accent: number };
  stats: StatTriad;
}

export const CHARACTERS: CharacterDef[] = [
  { id: 'star', name: 'Star', icon: '★', tagline: 'All-rounder', paint: { suit: 0x2d7dd2, helmet: 0xf9c74f }, stats: { speed: 0.55, accel: 0.55, handling: 0.55 } },
  { id: 'dash', name: 'Dash', icon: '⚡', tagline: 'Speedster', paint: { suit: 0xe63946, helmet: 0xf1faee }, stats: { speed: 0.85, accel: 0.55, handling: 0.3 } },
  { id: 'bloom', name: 'Bloom', icon: '✿', tagline: 'Drifter', paint: { suit: 0x9b5de5, helmet: 0xffafcc }, stats: { speed: 0.35, accel: 0.5, handling: 0.85 } },
];

export const VEHICLES: VehicleDef[] = [
  { id: 'kart', name: 'Turbo Kart', icon: '🏎', tagline: 'Balanced handling', paint: { color: 0xe63946, accent: 0xffb703 }, stats: { speed: 0.55, accel: 0.6, handling: 0.5 } },
  { id: 'bike', name: 'Comet Bike', icon: '🏍', tagline: 'Sharp turns', paint: { color: 0x3a86ff, accent: 0x8ecae6 }, stats: { speed: 0.45, accel: 0.4, handling: 0.85 } },
];

export function getCharacter(id: string): CharacterDef {
  return CHARACTERS.find((character) => character.id === id) ?? CHARACTERS[0];
}

export function getVehicle(id: string): VehicleDef {
  return VEHICLES.find((vehicle) => vehicle.id === id) ?? VEHICLES[0];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function combineStats(character: CharacterDef, vehicle: VehicleDef): StatTriad {
  return {
    speed: clamp01((character.stats.speed + vehicle.stats.speed) / 2),
    accel: clamp01((character.stats.accel + vehicle.stats.accel) / 2),
    handling: clamp01((character.stats.handling + vehicle.stats.handling) / 2),
  };
}

/** Maps a [0,1] stat triad onto physics tuning, ±25% around the default feel. */
export function statsToTuning(stats: StatTriad): KartTuning {
  const scale = (stat: number) => 0.75 + 0.5 * stat;
  return {
    maxSpeed: DEFAULT_TUNING.maxSpeed * scale(stats.speed),
    acceleration: DEFAULT_TUNING.acceleration * scale(stats.accel),
    turnRateMax: DEFAULT_TUNING.turnRateMax * scale(stats.handling),
  };
}
