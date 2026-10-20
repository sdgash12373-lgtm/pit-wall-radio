import { COMPOUNDS } from '../data/tyres.js';
import { suitableCompound } from './probability.js';

const TOPICS = {
  tyres: '輪胎狀況', gaps: '前後車速度', strategy: '甲方案：進站窗口', plan_b: '乙方案：延長這段',
  undercut: '提早停或晚停？', weather: '天氣預報', rivals: '對手策略', push: '要求加速',
  conserve: '要求保胎', pit: '要求本圈進站', cancel_pit: '取消進站', extend: '我想多撐幾圈',
  safety_car: '安全車下的策略', damage: '車損狀況',
};
const engineer = text => ({ speaker: 'engineer', text });

export class StrategyRadio {
  constructor({ sim, director, rng, player, engineerName = '策略組' }) {
    this.sim = sim; this.director = director; this.rng = rng; this.player = player; this.engineerName = engineerName;
  }

  getTopics() {
    const car = this.sim.getCar(this.player.carId);
    const active = car && car.status !== 'dnf' && !this.sim.state.finished;
    const ids = ['tyres', 'gaps', 'strategy', 'plan_b', 'undercut', 'weather', 'rivals'];
    if (active) {
      ids.push('push', 'conserve', 'extend');
      if (this.sim.state.totalLaps - this.sim.state.lap > 1) ids.push('pit');
      if (car.pitRequest) ids.push('cancel_pit');
      if (this.sim.state.safetyCar !== 'none') ids.push('safety_car');
      if (car.damage > 0) ids.push('damage');
    }
    return ids.map(id => ({ id, label: TOPICS[id] }));
  }

  ask(topicId) {
    if (!this.getTopics().some(t => t.id === topicId)) throw new Error('目前沒有這個無線電話題。');
    const sim = this.sim, car = sim.getCar(this.player.carId), s = sim.getPlayerSituation();
    const f = sim.getStrategyForecast(car.carId), compound = f.recommendedCompound;
    const rejoin = sim.estimatePitRejoin(car.carId, compound);
    const window = `第 ${f.pitWindow[0]}–${f.pitWindow[1]} 圈`;
    const wear = `${s.tyre.wear.toFixed(1)}%`;
    const neighbour = (v, direction) => v
      ? `${direction}${v.name}差 ${v.gap.toFixed(2)} 秒，每圈${v.paceDelta >= 0 ? '慢' : '快'} ${Math.abs(v.paceDelta).toFixed(2)} 秒，${COMPOUNDS[v.tyre.compound].name}磨耗 ${v.tyre.wear.toFixed(1)}%`
      : `${direction}沒有仍在比賽的車`;
    const stop = `換${COMPOUNDS[compound].name}，預估回到第 ${rejoin.rejoinPosition} 名${rejoin.gapAhead === null ? '' : `，距前車 ${rejoin.gapAhead.toFixed(2)} 秒`}`;
    const next = (sim.weather?.forecast ?? []).filter(p => p.lap > s.lap).sort((a, b) => a.lap - b.lap)[0];
    const messages = {
      tyres: `目前${COMPOUNDS[s.tyre.compound].name}已跑 ${s.tyre.age} 圈，磨耗 ${wear}，到衰退點預估還有 ${f.tyreLifeLaps} 圈。剩 ${s.lapsRemaining} 圈，別讓方向盤替你磨胎。`,
      gaps: `${neighbour(s.carAhead, '前車')}；${neighbour(s.carBehind, '後車')}。`,
      strategy: `甲方案窗口是${window}，預計再停 ${f.stopsPlanned} 次。${stop}。`,
      plan_b: `乙方案先保胎 ${Math.min(2, s.lapsRemaining)} 圈，現有磨耗 ${wear}、預估壽命 ${f.tyreLifeLaps} 圈。原窗口${window}；現在停則${stop}，延長後會重新估算。`,
      undercut: `${f.undercutThreat ? '後車已進入提早停威脅範圍' : '目前沒有明顯提早停威脅'}。${neighbour(s.carBehind, '後車')}。我們磨耗 ${wear}，窗口${window}；${f.tyreLifeLaps > 3 ? '可用晚停爭取乾淨空氣' : '不建議再拖'}。現在停${stop}。`,
      weather: `目前賽道濕度 ${(s.wetness * 100).toFixed(0)}%。${next ? `預報第 ${next.lap} 圈濕度 ${(next.wetness * 100).toFixed(0)}%，屆時適用${COMPOUNDS[suitableCompound(next.wetness)].name}` : `剩餘 ${s.lapsRemaining} 圈沒有新的天氣變化預報`}。`,
      rivals: `${neighbour(s.carAhead, '前方對手')}；${neighbour(s.carBehind, '後方對手')}。這是目前輪胎數據，對手的進站計畫尚未確認。`,
      push: `剩 ${s.lapsRemaining} 圈，磨耗 ${wear}。加速模式基準每圈快約 0.3 秒，磨耗倍率 1.4；${f.tyreLifeLaps < 3 ? '輪胎已接近極限，請謹慎使用' : '可以施壓，留意胎溫'}。`,
      conserve: `磨耗 ${wear}，預估還有 ${f.tyreLifeLaps} 圈。保胎模式基準每圈慢約 0.3 秒、磨耗倍率 0.7，先把輪胎留住。`,
      pit: `窗口${window}，磨耗 ${wear}。本圈進站${stop}，確認後我會通知技師。`,
      cancel_pit: `已安排${car.pitRequest ? COMPOUNDS[car.pitRequest].name : COMPOUNDS[compound].name}，磨耗 ${wear}、壽命 ${f.tyreLifeLaps} 圈。取消後車隊仍可能在輪胎極限召回。`,
      extend: `剩 ${s.lapsRemaining} 圈，輪胎預估可撐 ${f.tyreLifeLaps} 圈，磨耗 ${wear}。${f.tyreLifeLaps >= 2 ? '可以先保胎多跑 2 圈，再評估' : '不建議多撐，已到輪胎底線'}；原窗口${window}。`,
      safety_car: `管制預估還有 ${sim.state.scLapsLeft} 圈，進站損失約為平時的 50%。現在停${stop}；磨耗 ${wear}，請保持車距。`,
      damage: `目前車損 ${(car.damage * 100).toFixed(0)}%，圈速模型損失約 ${(car.damage * 5).toFixed(2)} 秒，剩 ${s.lapsRemaining} 圈。需要維修時請在決策中確認。`,
    };
    const openings = [
      `${this.engineerName}：收到，第 ${Math.min(s.lap + 1, sim.state.totalLaps)} 圈的數據是這樣。`,
      `${this.engineerName}：看過即時計時了，目前完成 ${s.lap} 圈。`,
      `${this.engineerName}：明白，目前第 ${s.position} 名，給你最新判斷。`,
    ];
    const actions = {
      push: { type: 'pushMode', value: 'push', label: '切換加速模式' },
      conserve: { type: 'pushMode', value: 'conserve', label: '切換保胎模式' },
      extend: { type: 'extend', value: 'conserve', label: '先保胎延長這段' },
      pit: { type: 'pit', value: compound, label: `本圈換${COMPOUNDS[compound].name}` },
      cancel_pit: { type: 'cancelPit', label: '取消本圈進站' },
    };
    const follows = topicId === 'pit' ? ['strategy', 'extend'] : ['tyres', 'strategy', 'pit'];
    return { lines: [{ speaker: 'player', text: TOPICS[topicId] },
      engineer(`${openings[Math.floor(this.rng.next() * openings.length)]}${messages[topicId]}`)],
      followUps: this.getTopics().filter(t => follows.includes(t.id) && t.id !== topicId),
      ...(actions[topicId] ? { action: actions[topicId] } : {}) };
  }

  applyAction(action) {
    const sim = this.sim, car = sim.getCar(this.player.carId);
    if (!car || car.status === 'dnf' || sim.state.finished) return { lines: [engineer('比賽已結束，停止執行策略指令。')] };
    let text;
    if (action?.type === 'pushMode' && ['push', 'normal', 'conserve'].includes(action.value)) {
      sim.setInstruction(car.carId, { pushMode: action.value });
      text = `收到，切換${{ push: '加速', normal: '正常', conserve: '保胎' }[action.value]}模式，剩 ${sim.state.totalLaps - sim.state.lap} 圈。`;
    } else if (action?.type === 'pit' && Object.hasOwn(COMPOUNDS, action.value)) {
      sim.requestPit(car.carId, action.value);
      text = `收到，本圈進站換${COMPOUNDS[action.value].name}，預估回到第 ${sim.estimatePitRejoin(car.carId, action.value).rejoinPosition} 名。`;
    } else if (action?.type === 'extend') {
      sim.setInstruction(car.carId, { pushMode: 'conserve' }); sim.holdPit(car.carId, 2);
      text = `收到，保胎延長兩圈，磨耗 ${car.tyre.wear.toFixed(1)}%，之後重新評估。`;
    } else if (action?.type === 'cancelPit') {
      sim.cancelPit(car.carId); text = `收到，取消進站。輪胎磨耗 ${car.tyre.wear.toFixed(1)}%，繼續監控。`;
    } else throw new Error('無效的策略指令。');
    return { lines: [engineer(text)] };
  }
}
