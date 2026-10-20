export function createQualifying({ track, entries, weather, rng, modifiers = {} }) {
  if (new Set(entries.map(e => e.carId)).size !== entries.length) throw new Error('排位車輛不可重複。');
  const sessions = ['Q1', 'Q2', 'Q3'];
  const wetness = weather?.wetness ?? (weather?.initial === 'wet' ? 0.7 : 0);
  let index = 0, active = entries.map(e => e.carId), grid = [];
  const best = new Map();
  const lookup = new Map(entries.map(e => [e.carId, e]));
  const clone = value => structuredClone(value);
  function simulatePlayerLap(carId, { mode = 'normal' } = {}) {
    if (index >= 3 || !active.includes(carId)) throw new Error('車輛目前未參加排位節次。');
    if (!['safe', 'normal', 'attack'].includes(mode)) throw new Error('無效的排位模式。');
    const { driver, team } = lookup.get(carId);
    const time = track.baseLapTime + (100 - team.carPerformance) * 0.035 + (100 - driver.stats.pace) * 0.022
      + wetness * (6 + (100 - driver.stats.wet) * 0.05) - index * 0.2
      + ({ safe: 0.4, normal: 0, attack: -0.22 }[mode])
      + rng.normal(0, 0.08 + (100 - driver.stats.consistency) * 0.006) + (modifiers[carId]?.qualiDelta ?? 0);
    const invalid = rng.chance(({ safe: 0.001, normal: 0.015, attack: 0.12 }[mode])
      * (1.5 - driver.stats.composure / 100));
    const s1 = time * rng.range(0.29, 0.34), s2 = time * rng.range(0.31, 0.36);
    const result = { time, sectors: [s1, s2, time - s1 - s2], invalid,
      ...(invalid ? { reason: '超出賽道界線，圈速作廢。' } : {}) };
    const previous = best.get(carId);
    if (!previous || previous.invalid || !invalid && time < previous.time) best.set(carId, clone(result));
    return result;
  }
  function runSession({ playerLap } = {}) {
    if (index >= 3) throw new Error('排位賽已結束。');
    const session = sessions[index];
    const player = entries.find(e => e.isPlayer && active.includes(e.carId));
    if (playerLap && player) {
      if (!Number.isFinite(playerLap.time) || playerLap.sectors?.length !== 3
        || !playerLap.sectors.every(Number.isFinite)) throw new Error('無效的玩家圈速。');
      const previous = best.get(player.carId);
      if (!previous || previous.invalid || !playerLap.invalid && playerLap.time < previous.time)
        best.set(player.carId, clone(playerLap));
    }
    const rows = active.map(carId => {
      if (!(player?.carId === carId && playerLap)) {
        simulatePlayerLap(carId, { mode: 'normal' });
        simulatePlayerLap(carId, { mode: 'normal' });
      }
      const lap = best.get(carId);
      return { carId, time: lap.invalid ? null : lap.time, sectors: [...lap.sectors], invalid: lap.invalid };
    }).sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || active.indexOf(a.carId) - active.indexOf(b.carId));
    const cutoff = index === 0 ? Math.min(15, Math.max(0, rows.length - 5))
      : index === 1 ? Math.min(10, Math.max(0, rows.length - 5)) : rows.length;
    const results = rows.map((row, i) => ({ position: i + 1, ...row, eliminated: index < 2 && i >= cutoff }));
    const advancing = index < 2 ? results.slice(0, cutoff).map(r => r.carId) : [];
    const eliminated = results.filter(r => r.eliminated).map(r => r.carId);
    grid.push(...results.filter(r => index === 2 || r.eliminated).map(r => ({
      position: r.position, carId: r.carId, time: r.time, session,
    })));
    active = advancing;
    best.clear();
    index++;
    return { session, results, advancing: [...advancing], eliminated };
  }
  return {
    get sessions() { return [...sessions]; },
    get current() { return sessions[index] ?? null; },
    participants: () => [...active], simulatePlayerLap, runSession,
    getGrid() {
      if (index < 3) return [];
      return clone(grid.sort((a, b) => a.position - b.position));
    },
  };
}

export function simulateQualifying(options) {
  const q = createQualifying(options);
  while (q.current) q.runSession();
  return q.getGrid().map(({ position, carId, time }) => ({ position, carId, time }));
}
