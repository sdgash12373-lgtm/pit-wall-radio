import { COMPOUNDS } from '../data/tyres.js';

export const clamp = (n, lo = 0.05, hi = 0.95) => Math.max(lo, Math.min(hi, n));
export const suitableCompound = wetness => wetness >= 0.65 ? 'wet' : wetness >= 0.2 ? 'inter' : 'medium';

// Positive advantage means the player is faster. Defence reverses the attacker's Overtake Mode benefit.
export function battleChance({ stats, situation, track, defending = false, bonus = 0 }) {
  const other = defending ? situation.carBehind : situation.carAhead;
  if (!other) return 0.05;
  const stat = key => clamp(stats?.[key] ?? 50, 0, 100) / 100;
  const tyre = t => COMPOUNDS[t.compound].gripDelta + t.wear * 0.008
    + Math.max(0, t.wear - COMPOUNDS[t.compound].cliff) ** 2 * 0.018;
  const tyreAdvantage = clamp(tyre(other.tyre) - tyre(situation.tyre), -2, 2);
  const overtakeMode = other.gap < 1 && situation.lap >= 2 && situation.safetyCar === 'none'
    && situation.wetness < 0.2 ? Math.min(3, track.overtakeZones ?? track.drsZones) * 0.035 : 0;
  return clamp(0.12 + stat('racecraft') * 0.22 + stat('composure') * 0.14
    + stat('tyreMgmt') * 0.08 + situation.wetness * (stat('wet') - 0.5) * 0.3
    + clamp(other.paceDelta, -2, 2) * 0.18 + tyreAdvantage * 0.06
    + (defending ? -overtakeMode + track.overtakeDifficulty * 0.25 : overtakeMode - track.overtakeDifficulty * 0.25)
    + bonus);
}
