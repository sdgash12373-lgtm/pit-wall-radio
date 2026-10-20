import { COMPOUNDS } from '../data/tyres.js';

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const isDry = compound => ['soft', 'medium', 'hard'].includes(compound);
export const weatherCompound = wetness => wetness >= 0.65 ? 'wet' : wetness >= 0.2 ? 'inter' : 'medium';
export function wearPerLap(track, driver, car, permanent = {}) {
  return COMPOUNDS[car.tyre.compound].wearRate * track.tyreWear * (1.15 - driver.stats.tyreMgmt * 0.003)
    * ({ push: 1.4, normal: 1, conserve: 0.7 }[car.pushMode]) * (permanent.wearMultiplier ?? 1)
    * car.modifiers.reduce((v, m) => v * (m.wearMultiplier ?? 1), 1);
}
export function lapTime({ track, driver, team, car, lap, totalLaps, wetness, permanent = {} }) {
  const tyre = COMPOUNDS[car.tyre.compound];
  const [lo, hi] = tyre.wetnessRange;
  const mismatch = wetness < lo ? (lo - wetness) * 9 : wetness > hi ? (wetness - hi) * 24 : 0;
  return track.baseLapTime + (100 - team.carPerformance) * 0.027 + (100 - driver.stats.pace) * 0.018
    + tyre.gripDelta + car.tyre.wear * 0.008 + Math.max(0, car.tyre.wear - tyre.cliff) ** 2 * 0.018
    + 1.6 * (1 - lap / totalLaps) + wetness * (4 + (100 - driver.stats.wet) * 0.035) + mismatch
    + ({ push: -0.3, normal: 0, conserve: 0.3 }[car.pushMode]) + car.damage * 5
    + (permanent.raceLapDelta ?? 0) + car.modifiers.reduce((v, m) => v + (m.lapTimeDelta ?? 0), 0);
}
