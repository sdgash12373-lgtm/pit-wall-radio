import { COMPOUNDS } from '../data/tyres.js';
import { clamp, isDry, weatherCompound, lapTime, wearPerLap } from './laptime.js';

export class RaceSim {
  constructor({ track, entries, grid, weather, rng, playerId, playerControlledBattles = true, modifiers = {} }) {
    this.track = track;
    this.rng = rng;
    this.playerId = playerId ?? entries.find(e => e.isPlayer)?.carId;
    this.playerControlledBattles = playerControlledBattles;
    this.modifiers = modifiers;
    this.entries = new Map(entries.map(e => [e.carId, e]));
    if (this.entries.size !== entries.length) throw new Error('車輛識別碼不可重複。');
    const ids = grid ?? entries.map(e => e.carId);
    if (ids.length !== entries.length || new Set(ids).size !== ids.length || ids.some(id => !this.entries.has(id))) {
      throw new Error('起跑順位必須包含每輛賽車且不可重複。');
    }
    this.weather = weather ?? this.generateWeather();
    this.completed = new Map(ids.map(id => [id, 0]));
    this.pendingEvents = [];
    this.fastestLap = Infinity;
    this.hadWet = this.weather.initial === 'wet';
    const wetness = this.hadWet ? 0.7 : 0;
    this.state = {
      lap: 0, totalLaps: track.laps, wetness, safetyCar: 'none', scLapsLeft: 0, finished: false,
      cars: ids.map((carId, i) => {
        const entry = this.entries.get(carId);
        const compound = weatherCompound(wetness);
        return {
          carId, name: entry.driver.name, teamId: entry.team.id, isPlayer: carId === this.playerId || !!entry.isPlayer,
          position: i + 1, totalTime: i * 0.45, gapToLeader: i * 0.45, interval: i ? 0.45 : 0,
          lastLap: 0, bestLap: null, tyre: { compound, age: 0, wear: 0, temp: 'cold' },
          compoundsUsed: [compound], pitStops: 0, pushMode: 'normal', pitRequest: null,
          overtakeMode: false, penalties: 0, trackLimits: 0, startReaction: null,
          damage: 0, status: 'running', dnfReason: null, modifiers: [],
        };
      }),
    };
    this.refresh();
  }

  setStartReaction(carId, seconds) {
    if (this.state.lap !== 0) throw new Error('起跑反應只能在第一圈之前設定。');
    if (seconds !== 'jump' && (!Number.isFinite(seconds) || seconds < 0)) throw new Error('無效的起跑反應。');
    this.requireCar(carId).startReaction = seconds;
  }

  overtakeModeAvailable(carId) {
    const car = this.requireCar(carId);
    if (this.state.finished || this.state.lap < 2 || this.state.wetness >= 0.2
      || this.state.safetyCar !== 'none' || car.status !== 'running') return false;
    const order = this.getOrder().filter(c => c.status !== 'dnf');
    const ahead = order[order.indexOf(car) - 1];
    return !!ahead && car.totalTime - ahead.totalTime < 1;
  }

  recordTrackLimit(carId) {
    const car = this.requireCar(carId);
    car.trackLimits++;
    if (car.trackLimits === 3) this.pendingEvents.push({ type: 'penalty_warning', carId,
      text: `${car.name} 第三次超出賽道界線，出示黑白旗警告。` });
    if (car.trackLimits >= 4) this.addTime(carId, 5, '超出賽道界線');
  }

  pitLaneSeconds() {
    // Track pitLoss includes the normal stop at its published lane speed.
    const speed = this.track.pitLaneSpeed ?? 80;
    const effectiveLength = this.track.pitLaneLength ?? (this.track.pitLoss - 2.5) * 80 / 3.6;
    return effectiveLength / (speed / 3.6);
  }

  generateWeather() {
    if (!this.rng.chance(this.track.rainChance)) return { initial: 'dry', forecast: [] };
    const start = this.rng.int(2, Math.max(2, Math.floor(this.track.laps * 0.55)));
    return { initial: 'dry', forecast: [
      { lap: start, wetness: this.rng.range(0.35, 0.9) },
      { lap: Math.min(this.track.laps - 1, start + this.rng.int(2, Math.max(2, Math.round(this.track.laps * 0.3)))), wetness: 0 },
    ] };
  }

  getCar(carId) { return this.state.cars.find(c => c.carId === carId); }
  requireCar(carId) {
    const car = this.getCar(carId);
    if (!car) throw new Error('找不到指定賽車。');
    return car;
  }
  getOrder() { return [...this.state.cars].sort((a, b) => a.position - b.position); }
  refresh() {
    const ordered = [...this.state.cars].sort((a, b) => {
      if ((a.status === 'dnf') !== (b.status === 'dnf')) return a.status === 'dnf' ? 1 : -1;
      if (a.status === 'dnf') return this.completed.get(b.carId) - this.completed.get(a.carId) || a.totalTime - b.totalTime;
      return a.totalTime - b.totalTime;
    });
    const leader = ordered[0]?.totalTime ?? 0;
    ordered.forEach((car, i) => {
      car.position = i + 1;
      car.gapToLeader = Math.max(0, car.totalTime - leader);
      car.interval = i ? Math.max(0, car.totalTime - ordered[i - 1].totalTime) : 0;
    });
  }
  pace(car) {
    const { driver, team } = this.entries.get(car.carId);
    return lapTime({ track: this.track, driver, team, car, lap: this.state.lap,
      totalLaps: this.state.totalLaps, wetness: this.state.wetness, permanent: this.modifiers[car.carId] });
  }
  setInstruction(carId, { pushMode }) {
    if (!['conserve', 'normal', 'push'].includes(pushMode)) throw new Error('無效的駕駛模式。');
    this.requireCar(carId).pushMode = pushMode;
  }
  requestPit(carId, compound) {
    if (!Object.hasOwn(COMPOUNDS, compound)) throw new Error('無效的輪胎配方。');
    const car = this.requireCar(carId);
    if (car.status !== 'dnf' && !this.state.finished) car.pitRequest = compound;
  }
  cancelPit(carId) { const car = this.requireCar(carId); car.pitRequest = null; car.pitHoldUntil = this.state.lap + 1; }
  // 玩家延長這段：期間不自動進站（輪胎嚴重超過懸崖或天氣不符時仍會強制進站）。
  holdPit(carId, laps = 2) {
    const car = this.requireCar(carId);
    car.pitRequest = null; car.pitHoldUntil = this.state.lap + Math.max(1, Math.round(laps));
  }
  pitLoss(car) {
    return this.pitLaneSeconds() * (this.state.safetyCar === 'none' ? 1 : 0.5)
      + 2 + (100 - this.entries.get(car.carId).team.pitCrew) * 0.015;
  }
  estimatePitRejoin(carId, compound) {
    const car = this.requireCar(carId);
    if (!Object.hasOwn(COMPOUNDS, compound)) throw new Error('無效的輪胎配方。');
    const time = car.totalTime + this.pitLoss(car);
    const others = this.getOrder().filter(c => c.status !== 'dnf' && c !== car);
    const ahead = others.filter(c => c.totalTime <= time).at(-1);
    const behind = others.find(c => c.totalTime > time);
    return { rejoinPosition: others.filter(c => c.totalTime <= time).length + 1,
      gapAhead: ahead ? time - ahead.totalTime : null, gapBehind: behind ? behind.totalTime - time : null,
      carAheadName: ahead?.name ?? null, carBehindName: behind?.name ?? null };
  }
  getStrategyForecast(carId) {
    const car = this.requireCar(carId);
    const { driver } = this.entries.get(carId);
    const rate = wearPerLap(this.track, driver, car, this.modifiers[carId]);
    const tyreLifeLaps = Math.max(0, Math.floor((COMPOUNDS[car.tyre.compound].cliff - car.tyre.wear) / Math.max(0.01, rate)));
    const remaining = this.state.totalLaps - this.state.lap;
    const needsDry = !this.hadWet && new Set(car.compoundsUsed.filter(isDry)).size < 2;
    const target = Math.min(this.state.totalLaps - 1,
      this.state.lap + tyreLifeLaps, car.pitStops === 0 ? Math.round(this.state.totalLaps * 0.5) : this.state.totalLaps - 1);
    const recommendedCompound = this.state.wetness >= 0.2 ? weatherCompound(this.state.wetness)
      : car.tyre.compound === 'hard' ? 'medium' : 'hard';
    const behind = this.getOrder().find(c => c.position === car.position + 1 && c.status !== 'dnf');
    return { tyreLifeLaps, pitWindow: [Math.max(this.state.lap, target - 3), Math.max(this.state.lap, target)],
      recommendedCompound, undercutThreat: !!behind && behind.interval < 3 && car.tyre.wear > 35,
      stopsPlanned: remaining > 0 && (needsDry || tyreLifeLaps < remaining || !isDry(car.tyre.compound) && this.state.wetness < 0.2) ? 1 : 0 };
  }
  getPlayerSituation() {
    const player = this.getCar(this.playerId);
    if (!player) return null;
    const order = this.getOrder().filter(c => c.status !== 'dnf');
    const index = order.indexOf(player);
    const neighbour = car => car ? {
      carId: car.carId, name: car.name, teamId: car.teamId, gap: Math.abs(car.totalTime - player.totalTime),
      tyre: { ...car.tyre }, paceDelta: this.pace(car) - this.pace(player),
    } : null;
    const ahead = neighbour(index >= 0 ? order[index - 1] : null);
    const behind = neighbour(index >= 0 ? order[index + 1] : null);
    return { position: player.position, lap: this.state.lap, lapsRemaining: this.state.totalLaps - this.state.lap,
      tyre: { ...player.tyre }, carAhead: ahead, carBehind: behind,
      teammate: neighbour(this.state.cars.find(c => c !== player && c.teamId === player.teamId)),
      wetness: this.state.wetness, safetyCar: this.state.safetyCar,
      paceDeltaAhead: ahead?.paceDelta ?? null, paceDeltaBehind: behind?.paceDelta ?? null };
  }
  swapPositions(carIdA, carIdB) {
    const a = this.requireCar(carIdA), b = this.requireCar(carIdB);
    if (a === b || a.status === 'dnf' || b.status === 'dnf') return;
    const order = this.getOrder().filter(c => c.status !== 'dnf');
    const times = order.map(c => c.totalTime);
    const ai = order.indexOf(a), bi = order.indexOf(b);
    [order[ai], order[bi]] = [order[bi], order[ai]];
    order.forEach((c, i) => { c.totalTime = i ? Math.max(times[i], order[i - 1].totalTime + 0.2) : times[i]; });
    this.refresh();
  }
  addTime(carId, seconds, reason = '賽會加時', { penalty = true } = {}) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('加時必須為非負秒數。');
    const car = this.requireCar(carId);
    car.totalTime += seconds;
    if (penalty) car.penalties += seconds;
    this.pendingEvents.push({ type: penalty ? 'penalty' : 'mistake', carId, seconds, reason, text: `${car.name} 因${reason}增加 ${seconds} 秒。` });
    this.refresh();
  }
  addModifier(carId, modifier) {
    if (!Number.isInteger(modifier.laps) || modifier.laps < 1) throw new Error('效果圈數必須為正整數。');
    this.requireCar(carId).modifiers.push({ ...modifier });
  }
  addDamage(carId, amount) {
    const car = this.requireCar(carId);
    car.damage = clamp(car.damage + amount, 0, 1);
  }
  retire(carId, reason = '車輛故障') {
    const car = this.requireCar(carId);
    if (car.status === 'dnf') return;
    car.status = 'dnf'; car.dnfReason = reason; car.pitRequest = null; car.overtakeMode = false;
    this.pendingEvents.push({ type: 'dnf', carId, reason, text: `${car.name} 因${reason}退賽。` });
    this.refresh();
  }

  choosePit(car) {
    if (car.pitRequest) return car.pitRequest;
    if (this.state.lap >= this.state.totalLaps) return null;
    const suitable = weatherCompound(this.state.wetness);
    if (isDry(car.tyre.compound) !== isDry(suitable) || !isDry(suitable) && car.tyre.compound !== suitable) return suitable;
    const forecast = this.getStrategyForecast(car.carId);
    // 預設策略在窗口末端執行；玩家可先透過決策指定配方與進站圈。
    if ((car.pitHoldUntil ?? 0) >= this.state.lap && car.tyre.wear < COMPOUNDS[car.tyre.compound].cliff + 10) return null;
    if (car.tyre.wear >= COMPOUNDS[car.tyre.compound].cliff - 4
      || car.pitStops === 0 && this.state.lap >= forecast.pitWindow[1]
      || this.state.safetyCar !== 'none' && car.pitStops === 0 && car.tyre.age >= this.state.totalLaps * 0.3
      || !this.hadWet && this.state.lap === this.state.totalLaps - 1 && new Set(car.compoundsUsed.filter(isDry)).size < 2) {
      return forecast.recommendedCompound;
    }
    return null;
  }

  stepLap() {
    if (this.state.finished) return { lap: this.state.lap, events: [] };
    const events = this.pendingEvents.splice(0);
    this.state.lap++;
    const lap = this.state.lap;
    for (const point of this.weather.forecast ?? []) {
      if (point.lap !== lap) continue;
      const old = this.state.wetness;
      this.state.wetness = clamp(point.wetness, 0, 1);
      if (this.state.wetness >= 0.2) this.hadWet = true;
      if (old < 0.2 && this.state.wetness >= 0.2) events.push({ type: 'rain_start', text: '雨勢開始影響賽道，請留意輪胎選擇。' });
      if (old >= 0.2 && this.state.wetness < 0.2) events.push({ type: 'rain_stop', text: '賽道已逐漸乾燥，雨勢影響解除。' });
    }
    if (this.state.safetyCar === 'none' && lap > 2 && lap < this.state.totalLaps - 3
      && this.rng.chance(this.track.scChance / this.state.totalLaps)) {
      this.state.safetyCar = this.rng.chance(0.65) ? 'sc' : 'vsc';
      this.state.scLapsLeft = this.state.safetyCar === 'sc' ? 3 : 2;
      events.push({ type: this.state.safetyCar === 'sc' ? 'sc_deploy' : 'vsc_deploy', text: '賽道需要清理，賽會啟動安全車管制。' });
    }
    const neutralized = this.state.safetyCar !== 'none';
    const order = this.getOrder().filter(c => c.status !== 'dnf');
    const available = new Map(order.map(c => [c.carId, this.overtakeModeAvailable(c.carId)]));
    if (lap === 1) events.push({ type: 'start', text: '五盞紅燈熄滅，比賽起跑！' });
    const pitted = new Set();
    const oldTimes = new Map(order.map(c => [c.carId, c.totalTime]));
    for (const car of order) {
      if (car.status === 'pit') car.status = 'running';
      const { driver, team } = this.entries.get(car.carId);
      if (this.rng.chance(0.00025 + (100 - team.reliability) * 0.000035 + car.damage * 0.001)) {
        this.retire(car.carId, '動力系統故障');
        continue;
      }
      car.overtakeMode = available.get(car.carId);
      let startDelta = 0;
      if (lap === 1) {
        const skill = (driver.stats.composure + driver.stats.consistency) / 200;
        const reaction = car.startReaction ?? clamp(this.rng.normal(0.32 - skill * 0.12, 0.018), 0.18, 0.32);
        car.startReaction = reaction;
        if (reaction === 'jump') this.addTime(car.carId, 5, '偷跑');
        startDelta = (reaction === 'jump' ? 0 : reaction) * 4
          + this.rng.normal(0, 0.38 + (1 - skill) * 0.35) + Math.floor((car.position - 1) / 2) * 0.025;
      }
      if (!neutralized && this.rng.chance(({ conserve: 0.003, normal: 0.008, push: 0.025 }[car.pushMode])
        * (1.5 - driver.stats.composure / 100))) this.recordTrackLimit(car.carId);
      let time = startDelta + (car.overtakeMode ? -0.25 : 0) + this.pace(car)
        + this.rng.normal(0, 0.035 + (100 - driver.stats.consistency) * 0.003);
      if (neutralized) time += this.state.safetyCar === 'sc' ? 20 : 10;
      if (!neutralized && this.rng.chance((100 - driver.stats.composure) * 0.00014)) {
        const loss = this.rng.range(1, 4);
        time += loss;
        events.push({ type: 'mistake', carId: car.carId, text: `${car.name} 煞車鎖死，損失了時間。` });
      }
      const rate = wearPerLap(this.track, driver, car, this.modifiers[car.carId]);
      car.tyre.age++;
      car.tyre.wear = clamp(car.tyre.wear + rate * (neutralized ? 0.55 : 1), 0, 100);
      car.tyre.temp = neutralized ? 'cold' : car.pushMode === 'push' && car.tyre.wear > 50 ? 'hot' : 'ok';
      const compound = this.choosePit(car);
      if (compound) {
        const laneSeconds = this.pitLaneSeconds() * (neutralized ? 0.5 : 1);
        const stationarySeconds = this.rng.chance(0.005 + (100 - team.pitCrew) * 0.001)
          ? this.rng.range(4, 8) : clamp(2 + (100 - team.pitCrew) * 0.015 + this.rng.range(0, 0.2), 2, 3.5);
        const duration = laneSeconds + stationarySeconds;
        if (this.rng.chance(0.0005)) this.addTime(car.carId, 5, '維修區超速');
        time += duration;
        car.tyre = { compound, age: 0, wear: 0, temp: 'cold' };
        if (!car.compoundsUsed.includes(compound)) car.compoundsUsed.push(compound);
        car.pitStops++; car.pitRequest = null; car.status = 'pit';
        pitted.add(car.carId);
        events.push({ type: 'pit', carId: car.carId, compound, duration, laneSeconds, stationarySeconds, text: `${car.name} 進站換上${COMPOUNDS[compound].name}。` });
      }
      car.totalTime += time;
      this.completed.set(car.carId, lap);
    }

    // 僅由相鄰交換形成順位，確保任何車都無法跳過玩家的攻防屏障。
    const active = order.filter(c => c.status !== 'dnf');
    for (let i = 1; i < active.length; i++) {
      let j = i;
      while (j > 0) {
        const behind = active[j], ahead = active[j - 1];
        const gap = oldTimes.get(behind.carId) - oldTimes.get(ahead.carId);
        const pitCrossing = pitted.has(behind.carId) || pitted.has(ahead.carId);
        const catching = behind.totalTime < ahead.totalTime + 0.3;
        if (!catching) break;
        if (pitCrossing) {
          if (behind.totalTime >= ahead.totalTime) break;
        } else {
          const blocked = neutralized || lap > 1 && this.playerControlledBattles && (behind.carId === this.playerId || ahead.carId === this.playerId);
          const delta = this.pace(ahead) - this.pace(behind);
          const racecraft = this.entries.get(behind.carId).driver.stats.racecraft;
          const tyreDelta = (ahead.tyre.wear - behind.tyre.wear) * 0.002;
          const probability = clamp(0.12 + racecraft * 0.002 + Math.max(0, delta) * 0.22
            + (this.track.overtakeZones ?? this.track.drsZones) * (behind.overtakeMode ? 0.035 : 0) + tyreDelta - this.track.overtakeDifficulty * 0.32, 0.03, 0.9);
          if (blocked || lap > 1 && (gap > Math.max(1, delta + 1) || delta <= 0 || !this.rng.chance(probability))) {
            behind.totalTime = Math.max(behind.totalTime, ahead.totalTime + 0.3);
            if (!neutralized) behind.tyre.wear = clamp(behind.tyre.wear + 0.18, 0, 100);
            break;
          }
          behind.totalTime = Math.min(behind.totalTime, ahead.totalTime - 0.3);
          events.push({ type: 'overtake', by: behind.carId, on: ahead.carId, text: `${behind.name} 超越了${ahead.name}。` });
        }
        [active[j], active[j - 1]] = [active[j - 1], active[j]];
        j--;
      }
    }
    if (neutralized) {
      // 管制下漸進收攏車距，保留進站造成的順位變動。
      const times = active.map(c => c.totalTime);
      for (let i = 1; i < active.length; i++) {
        const ahead = active[i - 1], car = active[i];
        const gap = Math.max(0.3, times[i] - times[i - 1]);
        car.totalTime = ahead.totalTime + Math.max(0.3, gap * (this.state.safetyCar === 'sc' ? 0.6 : 0.9));
      }
    }
    for (const car of active) {
      car.lastLap = car.totalTime - oldTimes.get(car.carId);
      // 跟車與超車造成的實際時間也必須納入個人最快圈。
      if (!neutralized && !pitted.has(car.carId)) {
        car.bestLap = car.bestLap === null ? car.lastLap : Math.min(car.bestLap, car.lastLap);
        if (car.lastLap < this.fastestLap) {
          this.fastestLap = car.lastLap;
          events.push({ type: 'fastest_lap', carId: car.carId, text: `${car.name} 刷新全場最快圈。` });
        }
      }
      car.modifiers = car.modifiers.map(m => ({ ...m, laps: m.laps - 1 })).filter(m => m.laps > 0);
    }
    if (neutralized && --this.state.scLapsLeft === 0) {
      this.state.safetyCar = 'none';
      events.push({ type: 'sc_end', text: '安全車管制解除，比賽恢復。' });
    }
    this.state.finished = lap >= this.state.totalLaps;
    this.refresh();
    events.push(...this.pendingEvents.splice(0));
    return { lap, events: events.map(event => ({ ...event, lap,
      ...((event.by || event.carId) ? { position: this.getCar(event.by ?? event.carId)?.position } : {}) })) };
  }

  getClassification() {
    const order = this.getOrder();
    const leaderTime = order.find(c => c.status !== 'dnf')?.totalTime ?? 0;
    return order.map(car => ({ position: car.position, carId: car.carId, name: car.name, teamId: car.teamId,
      status: car.status === 'dnf' ? 'dnf' : 'finished', laps: this.completed.get(car.carId),
      totalTime: car.totalTime, gap: car.status === 'dnf' ? null : Math.max(0, car.totalTime - leaderTime),
      bestLap: car.bestLap, pitStops: car.pitStops, penalties: car.penalties }));
  }
}
