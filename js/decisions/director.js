import { COMPOUNDS } from '../data/tyres.js';
import { battleChance, suitableCompound } from './probability.js';

const LIMITS = { overtake: 5, defend: 4, pit_window: 8, team_order: 10, safety_car: 6, weather: 7, damage: 6 };
const COOLDOWN = { overtake: 5, defend: 5, pit_window: 8, team_order: 12, safety_car: 6, weather: 4, damage: 10 };
const XP = { overtake: 'racecraft', defend: 'composure', pit_window: 'tyreMgmt', team_order: 'composure', safety_car: 'consistency', weather: 'wet', damage: 'tyreMgmt' };
const choice = (id, label, hint, risk = 'low', successChance) => ({ id, label, hint, risk,
  ...(successChance === undefined ? {} : { successChance }) });
const engineer = text => ({ speaker: 'engineer', text });

export class DecisionDirector {
  constructor({ sim, rng, player, teammateId, engineerName = '策略組' }) {
    this.sim = sim; this.rng = rng; this.player = player; this.teammateId = teammateId;
    this.engineerName = engineerName;
    this.pending = null; this.serial = 0; this.lastEventLap = -Infinity; this.lastByType = {};
    this.checkedLap = -1; this.scHandled = false; this.repair = null; this.retry = null;
    this.decisions = [];
    this.careerEffects = { teamTrust: 0, reputation: 0,
      xp: { pace: 0, racecraft: 0, tyreMgmt: 0, wet: 0, consistency: 0, composure: 0 } };
  }

  check() {
    const { sim } = this, car = sim.getCar(this.player.carId);
    if (this.repair && car && car.pitStops > this.repair.pitStops) {
      // Repair only after an actual stop; never mutate the engine's CarState.
      sim.addDamage(car.carId, -this.repair.amount); this.repair = null;
    }
    if (sim.state.finished || !car || car.status === 'dnf') { this.pending = null; return null; }
    if (this.pending) return structuredClone(this.pending.event);
    const s = sim.getPlayerSituation(), lap = s.lap;
    if (s.safetyCar === 'none') this.scHandled = false;
    if (this.checkedLap === lap) return null;
    this.checkedLap = lap;
    const forecast = sim.getStrategyForecast(car.carId);
    const nextWeather = (sim.weather?.forecast ?? []).find(p => p.lap === lap + 1);
    const wetness = nextWeather?.wetness ?? s.wetness;
    const target = suitableCompound(wetness);
    const mismatch = wetness >= 0.2 ? car.tyre.compound !== target : ['inter', 'wet'].includes(car.tyre.compound);
    const mate = [s.carAhead, s.carBehind].find(c => c && c.carId === (this.teammateId ?? s.teammate?.carId));
    const teamRequest = mate && mate.gap < 1.5 && (mate === s.carAhead ? mate.paceDelta > 0.08 : mate.paceDelta < -0.08);
    const canPit = s.lapsRemaining > 1 && !car.pitRequest;
    const conditions = [
      ['damage', car.damage >= 0.15 && !this.repair],
      ['weather', canPit && mismatch],
      ['safety_car', canPit && s.safetyCar !== 'none' && !this.scHandled],
      ['pit_window', canPit && lap > 0 && forecast.stopsPlanned > 0 &&
        (lap + 1 >= forecast.pitWindow[0] || forecast.undercutThreat || car.tyre.wear >= COMPOUNDS[car.tyre.compound].cliff - 10)],
      ['team_order', lap > 0 && s.safetyCar === 'none' && teamRequest],
      ['defend', lap > 0 && s.safetyCar === 'none' && s.carBehind?.gap < 1 && s.paceDeltaBehind < 0],
      ['overtake', lap > 0 && s.safetyCar === 'none' && s.carAhead?.gap < 1 && s.paceDeltaAhead > 0],
    ];
    const isRetry = t => this.retry?.type === t && this.retry.lap === lap;
    // Weather transitions and a short SC period must not disappear behind a battle cooldown.
    const type = conditions.find(([t, active]) => active && (isRetry(t)
      || lap - this.lastEventLap >= (['weather', 'safety_car', 'damage'].includes(t) ? 1 : 4)
        && lap - (this.lastByType[t] ?? -Infinity) >= COOLDOWN[t]))?.[0];
    if (!type) return null;
    const context = { s, forecast, mate,
      // The engine's forecast recommends a compound for *current* conditions.
      // A drying transition needs the next lap's dry compound instead.
      target: type === 'weather' ? target : wetness >= 0.2 ? target : forecast.recommendedCompound,
      wetness, isRetry: isRetry(type) };
    this.retry = null;
    const event = this.makeEvent(type, context);
    this.lastEventLap = lap; this.lastByType[type] = lap;
    if (type === 'safety_car') this.scHandled = true;
    this.pending = { event, context };
    return structuredClone(event);
  }

  makeEvent(type, c) {
    const { s, forecast: f, mate } = c;
    const final = s.lapsRemaining === 1;
    const chance = bonus => battleChance({ stats: this.player.stats, situation: s,
      track: this.sim.track, defending: type === 'defend', bonus });
    const content = {
      overtake: ['超車機會', `前車${s.carAhead?.name}差 ${s.carAhead?.gap.toFixed(2)} 秒，我們每圈快 ${s.paceDeltaAhead?.toFixed(2)} 秒。`, 'hold', [
        choice('bold', '內線晚煞車', '搶下位置；失手可能鎖死或碰撞。', 'high', chance(0.14)),
        choice('outside', '外線交叉', '留出空間，用出彎速度完成超越。', 'mid', chance(0)),
        choice('hold', final ? '保住目前名次' : '留在尾流，下一圈再攻', final ? '穩定帶回終點。' : '等超車模式機會，下一圈重新評估。'),
      ]],
      defend: ['後車正在逼近', `後車差 ${s.carBehind?.gap.toFixed(2)} 秒，每圈比我們快 ${Math.abs(s.paceDeltaBehind ?? 0).toFixed(2)} 秒。`, 'normal', [
        choice('hard', '強硬守內線', '守住位置，但有碰撞與越線風險。', 'high', chance(0.12)),
        choice('normal', '正常防守', '一次變線，保護出彎。', 'mid', chance(0)),
        choice('yield', '放行保胎', '交出位置，減少纏鬥磨耗。'),
      ]],
      pit_window: ['進站窗口已開', `磨耗 ${s.tyre.wear.toFixed(1)}%，窗口第 ${f.pitWindow[0]}–${f.pitWindow[1]} 圈，預估還能跑 ${f.tyreLifeLaps} 圈。`, 'extend', [
        choice('pit', '本圈進站', `換上${COMPOUNDS[c.target].name}，預估回到第 ${this.sim.estimatePitRejoin(this.player.carId, c.target).rejoinPosition} 名。`),
        choice('push', '加速一圈再決定', '爭取晚停優勢，增加磨耗。', 'mid'),
        choice('extend', '保胎延長', '放慢節奏，窗口末端仍可能由車隊召回。'),
      ]],
      team_order: ['車隊交換順位', `隊友${mate?.name}相差 ${mate?.gap.toFixed(2)} 秒，${mate === s.carBehind ? '隊友較快，請讓出位置' : '我們較快，可以要求交換位置'}。`, 'negotiate', [
        choice('obey', '接受車隊安排', '配合交換位置，提升車隊信任。'),
        choice('refuse', '拒絕交換', '維持目前位置，降低車隊信任。', 'mid'),
        choice('negotiate', final ? '維持順位帶回終點' : '要求再給一圈', final ? '先確保兩車完賽。' : '爭取一圈時間，用圈速證明。'),
      ]],
      safety_car: ['安全車管制', `目前第 ${s.lap + 1} 圈，進站時間損失約減半，磨耗 ${s.tyre.wear.toFixed(1)}%。`, 'stay', [
        choice('pit', '趁管制進站', `換上${COMPOUNDS[c.target].name}。`),
        choice('stay', '留在場上保位置', '維持順位，等待重啟。'),
        choice('conserve', '保胎並暖胎', '降低磨耗，為重啟留餘裕。'),
      ]],
      weather: ['天氣策略調整', `目前濕度 ${(s.wetness * 100).toFixed(0)}%，下一圈預報 ${(c.wetness * 100).toFixed(0)}%，建議${COMPOUNDS[c.target].name}。`, 'wait', [
        choice('pit', '立刻換合適輪胎', `本圈進站換${COMPOUNDS[c.target].name}。`),
        choice('wait', '慢一圈觀察', '降低速度，承受輪胎不適合路面的風險。'),
        choice('gamble', '維持速度賭天氣', '留在場上，抓地不足可能失誤。', 'high'),
      ]],
      damage: ['車損處置', `車損 ${(this.sim.getCar(this.player.carId).damage * 100).toFixed(0)}%，剩 ${s.lapsRemaining} 圈。`, 'manage', [
        choice('repair', '進站處理車損', '換胎並修復目前損傷，須承擔進站與維修時間。', 'low'),
        choice('manage', '降低速度帶回', '保守駕駛，降低輪胎負荷。'),
        choice('risk', '繼續全力推進', '不修車；繼續施壓可能擴大損傷。', 'high'),
      ]],
    }[type];
    return { id: `decision-${++this.serial}`, type, lap: s.lap + 1, title: content[0], description: content[1],
      urgency: ['overtake', 'defend', 'damage', 'weather'].includes(type) ? 'high' : 'mid',
      timeLimit: LIMITS[type], defaultChoiceId: content[2], choices: content[3],
      radio: [engineer(`${this.engineerName}：${content[1]}`)] };
  }

  resolve(eventId, choiceId) {
    if (!this.pending || this.pending.event.id !== eventId) throw new Error('此決策已結束或識別碼無效。');
    const { event: e, context: c } = this.pending;
    const timedOut = choiceId === null;
    const id = timedOut ? e.defaultChoiceId : choiceId;
    const selected = e.choices.find(v => v.id === id);
    if (!selected) throw new Error('無效的決策選項。');
    const sim = this.sim, carId = this.player.carId, car = sim.getCar(carId);
    let success = null, text;
    if (sim.state.finished || car.status === 'dnf') {
      text = '賽事已結束，這項指令不再執行。';
    } else {
      const s = sim.getPlayerSituation();
      const mod = (laps, lapTimeDelta, wearMultiplier, label) => sim.addModifier(carId, { laps, lapTimeDelta, wearMultiplier, label });
      const mode = pushMode => sim.setInstruction(carId, { pushMode });
      const pit = () => {
        sim.requestPit(carId, c.target);
        return `收到，本圈進站，換上${COMPOUNDS[c.target].name}，預估回到第 ${sim.estimatePitRejoin(carId, c.target).rejoinPosition} 名。`;
      };
      if (e.type === 'overtake' || e.type === 'defend') {
        const defending = e.type === 'defend';
        const other = defending ? s.carBehind : s.carAhead;
        const expected = defending ? c.s.carBehind : c.s.carAhead;
        if (s.safetyCar !== 'none' || !other || other.carId !== expected?.carId || other.gap >= 1) {
          text = '攻防條件已改變，取消這次交鋒，保持節奏。';
        } else if (id === 'hold') {
          mod(1, 0.12, 0.85, '準備下一次進攻'); text = '收到，先保胎，保持在前車尾流。';
          if (s.lapsRemaining > 1 && !c.isRetry) this.retry = { type: e.type, lap: s.lap + 1 };
        } else if (id === 'yield') {
          sim.swapPositions(carId, other.carId); mod(1, 0, 0.8, '放行保胎'); success = true;
          text = '已放行，照顧輪胎，後面還有比賽。';
        } else {
          const bonus = ['bold', 'hard'].includes(id) ? (defending ? 0.12 : 0.14) : 0;
          success = this.rng.next() < battleChance({ stats: this.player.stats, situation: s, track: sim.track, defending, bonus });
          if (success) {
            if (!defending) sim.swapPositions(carId, other.carId);
            mod(1, 0, id === 'bold' || id === 'hard' ? 1.25 : 1.08, '攻防輪胎負荷');
            if (id === 'bold') this.careerEffects.reputation += 2;
            text = defending ? '守住了，漂亮。專心下一個煞車點。' : `超車完成，目前第 ${car.position} 名。保持專注。`;
          } else {
            if (defending) sim.swapPositions(carId, other.carId);
            // No penalty time here: a failed attack must not accidentally gain a place.
            mod(1, 0.35, 1.2, '攻防失利');
            if (['bold', 'hard'].includes(id) && this.rng.next() < 0.2) {
              sim.addDamage(carId, 0.08);
              sim.addTime(carId, defending ? 10 : 5, defending ? '強硬防守造成碰撞' : '強硬進攻造成碰撞');
            }
            text = defending ? '位置丟了，先穩住車，還有機會。' : '這次沒過，輪胎有些滑動。重新整理節奏。';
          }
        }
      } else if (e.type === 'team_order') {
        const mate = sim.getCar(c.mate.carId);
        if (!mate || mate.status === 'dnf' || Math.abs(car.position - mate.position) !== 1 || s.safetyCar !== 'none') {
          text = '隊友的相對位置已改變，取消交換指令。';
        } else if (id === 'obey') {
          sim.swapPositions(carId, mate.carId); this.careerEffects.teamTrust += 3; success = true;
          text = '收到，交換完成。車隊感謝你的配合。';
        } else if (id === 'refuse') {
          this.careerEffects.teamTrust -= 4; success = false; text = '收到，你拒絕交換。我會向領隊回報。';
        } else {
          mod(1, -0.1, 1.05, '隊內圈速比較'); text = s.lapsRemaining > 1 ? '給你一圈，請用圈速證明。' : '收到，維持順位帶回終點。';
        }
      } else if (id === 'pit' && ['pit_window', 'weather', 'safety_car'].includes(e.type)) {
        text = pit(); success = true;
      } else if (e.type === 'pit_window') {
        mod(1, id === 'push' ? -0.25 : 0.2, id === 'push' ? 1.35 : 0.7, '進站前節奏');
        sim.holdPit(carId, id === 'push' ? 1 : 3);
        text = id === 'push' ? '收到，這圈加速，注意前胎。' : '收到，延長這段，車隊仍會監控進站底線。';
      } else if (e.type === 'safety_car') {
        if (id === 'conserve') mode('conserve');
        text = '收到，留在場上。保持安全車規定車距，照顧胎溫。';
      } else if (e.type === 'weather') {
        const chance = Math.min(0.95, 0.35 + (this.player.stats?.wet ?? 50) * 0.006);
        if (id === 'wait') { mod(1, 0.6, 0.8, '觀察天氣'); text = '收到，慢一圈觀察，煞車點提早。'; }
        else {
          success = this.rng.next() < chance;
          if (!success) sim.addTime(carId, 3, '濕滑路面失誤', { penalty: false });
          text = success ? '這圈撐住了，抓地隨時會變，保持回報。' : '滑出了一點，損失 3 秒。先穩住。';
        }
      } else if (e.type === 'damage') {
        if (id === 'repair') {
          sim.requestPit(carId, c.target);
          this.repair = { pitStops: car.pitStops, amount: car.damage };
          // Maintenance cost is charged now; the repair itself awaits a completed stop.
          sim.addTime(carId, 4, '預約車損維修', { penalty: false }); text = '收到，維修增加 4 秒，進站完成後修復目前損傷。'; success = true;
        } else if (id === 'manage') { mode('conserve'); text = '收到，降低速度帶回，避開路肩。'; }
        else {
          mode('push'); success = this.rng.next() < 0.35 + (this.player.stats?.composure ?? 50) * 0.005;
          if (!success) sim.addDamage(carId, 0.1);
          text = success ? '收到，保持推進，持續監控車損。' : '損傷擴大了，別再壓路肩。';
        }
      }
      this.careerEffects.xp[XP[e.type]] += success === true ? 3 : 1;
    }
    if (timedOut) text = `猶豫了，已採用「${selected.label}」。${text}`;
    const outcome = { success, text, radio: [{ speaker: 'player', text: timedOut ? '我剛才猶豫了，照預設方案。' : selected.label }, engineer(text)], timedOut };
    this.decisions.push({ lap: e.lap, type: e.type, choiceId: id, timedOut, success });
    this.pending = null;
    return outcome;
  }

  getSummary() { return structuredClone({ decisions: this.decisions, careerEffects: this.careerEffects }); }
}
