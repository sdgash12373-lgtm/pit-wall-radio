import { element, button } from './dom.js';
import { Cockpit3D, webglAvailable } from './cockpit3d/index.js';
import { fractionAtDistance } from './cockpit3d/trackPath.js';
import { pitLayout } from './cockpit3d/trackside.js';
import { gauge, fallbackTelemetry } from './hud.js';
import { RaceAudio } from './audio.js';
import { lapTime } from './format.js';

const MODES = [
  { id: 'safe', label: '保守', hint: '留餘裕，幾乎不會越線，圈速較慢。' },
  { id: 'normal', label: '標準', hint: '平衡速度與風險。' },
  { id: 'attack', label: '全力', hint: '壓榨每個彎角，越線會讓圈速作廢。' },
];
const SESSION_INFO = { Q1: '20 台車 · 淘汰後 5 名', Q2: '15 台車 · 淘汰後 5 名', Q3: '前 10 名爭奪桿位' };
const SOUND_KEY = 'pit-wall-radio:sound';
const readSound = () => { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; } };

// 座艙排位：每節 P 房 → 暖胎圈 → 飛馳圈（計時）→ 冷卻圈回 P 房；Q1/Q2/Q3 淘汰制。
export function mountQualifying(root, { qualifying, entries, teams, track, player, onFinish }) {
  root.className = 'race-screen'; root.replaceChildren(); document.title = `排位賽 · ${track.name}｜維修站無線電`;
  document.body.classList.add('racing');
  const entry = entries.find(e => e.isPlayer);
  const name = id => entries.find(e => e.carId === id)?.driver.name ?? id;
  const teamOf = id => teams.find(t => t.id === entries.find(e => e.carId === id)?.team.id);

  // 給座艙用的簡化「模擬器」：排位時賽道上只有自己。
  const car = { carId: entry.carId, teamId: entry.team.id, isPlayer: true, position: 0, status: 'running', pushMode: 'normal',
    tyre: { compound: 'soft', wear: 0, age: 0, temp: 'cold' }, lastLap: 0, totalTime: 0, compoundsUsed: ['soft'] };
  const adapter = {
    playerId: entry.carId, state: { lap: 0, totalLaps: 1, safetyCar: 'none', wetness: 0, finished: false },
    getCar: () => car, getOrder: () => [car],
    getPlayerSituation: () => ({ position: car.position, lap: 0, lapsRemaining: 1, tyre: car.tyre, carAhead: null, carBehind: null, wetness: 0, safetyCar: 'none' }),
    overtakeModeAvailable: () => false,
  };

  const canvas = element('canvas', 'cockpit');
  let cockpit = null;
  try { if (webglAvailable()) cockpit = new Cockpit3D(canvas, teams, track); } catch (error) { console.warn('3D 座艙初始化失敗', error); }
  const hud = element('div', 'race-hud qualifying-hud');
  const header = element('div', 'q-header');
  const sessionLabel = element('b', 'q-session'), phaseLabel = element('span', 'q-phase');
  header.append(element('div', 'tt-logo', 'PWR'), sessionLabel, phaseLabel);
  const timer = element('div', 'q-timer');
  const sectors = element('div', 'q-sectors');
  const sectorCells = [0, 1, 2].map(i => { const c = element('div', 'q-sector'); c.append(element('small', '', `S${i + 1}`), element('b', '', '—')); sectors.append(c); return c; });
  const board = element('aside', 'q-board');
  const panel = element('section', 'q-panel');
  const dial = gauge();
  hud.append(header, timer, sectors, board, panel, dial.node);
  root.append(canvas, hud);
  cockpit?.resize();
  const audio = new RaceAudio({ enabled: readSound(), volume: 0.8, voice: false });
  audio.start(); root.addEventListener('pointerdown', () => audio.start(), { once: true });

  const results = [];
  let frame, disposed = false, previous = performance.now();
  let phase = 'garage', motion = 0, phaseStart = 0, phaseEnd = 0, phaseSeconds = 1, mode = 'normal', lap = null, sessionResult = null;
  const pitExit = cockpit ? fractionAtDistance(cockpit.path, pitLayout(cockpit.path).to) : 0.05;
  const pitEntry = cockpit ? fractionAtDistance(cockpit.path, cockpit.path.L + pitLayout(cockpit.path).from + 2) : 0.95; // 抵達維修區入口

  function showBoard(rows, title) {
    board.replaceChildren(element('h3', '', title));
    for (const r of rows) {
      const row = element('div', `q-row${r.carId === entry.carId ? ' player' : ''}${r.eliminated ? ' out' : ''}`);
      row.style.setProperty('--team', teamOf(r.carId)?.color ?? '#fff');
      row.append(element('b', '', r.position), element('i'), element('span', '', name(r.carId)), element('small', '', r.time ? lapTime(r.time) : '無成績'));
      board.append(row);
    }
  }
  function garage() {
    phase = 'garage'; cockpit?.setGarage();
    const session = qualifying.current;
    sessionLabel.textContent = session; phaseLabel.textContent = 'P 房待命';
    timer.textContent = SESSION_INFO[session] ?? '';
    sectorCells.forEach(c => { c.className = 'q-sector'; c.lastChild.textContent = '—'; });
    panel.replaceChildren(element('h2', '', `${session} · 選擇攻擊程度`), element('p', '', '換上新的軟胎。出場後先跑暖胎圈，接著一圈飛馳圈計時，最後冷卻圈回 P 房。'));
    const choices = element('div', 'q-modes');
    for (const m of MODES) {
      const b = button('', () => { mode = m.id; [...choices.children].forEach(x => x.classList.toggle('active', x === b)); }, `q-mode${m.id === mode ? ' active' : ''}`);
      b.append(element('strong', '', m.label), element('small', '', m.hint));
      choices.append(b);
    }
    panel.append(choices, button('出場 →', outLap, 'primary q-go'));
    panel.hidden = false;
  }
  function setPhase(name, from, to, seconds) { phase = name; motion = from; phaseStart = from; phaseEnd = to; phaseSeconds = seconds; }
  function outLap() {
    panel.hidden = true; car.tyre = { compound: 'soft', wear: 0, age: 0, temp: 'cold' }; car.pushMode = 'conserve';
    cockpit?.leaveGarage();
    phaseLabel.textContent = '暖胎圈'; timer.textContent = '把輪胎溫度帶上來';
    setPhase('out', pitExit, 1, 15);
  }
  function flyingLap() {
    car.pushMode = mode === 'attack' ? 'push' : mode === 'safe' ? 'conserve' : 'normal';
    lap = qualifying.simulatePlayerLap(entry.carId, { mode });
    sessionResult = qualifying.runSession({ playerLap: lap });
    car.lastLap = lap.time ?? lap.sectors.reduce((a, b) => a + b, 0);
    phaseLabel.textContent = '飛馳圈'; timer.textContent = '0:00.000';
    setPhase('flying', 1, 2, 27);
  }
  function inLap() {
    car.pushMode = 'conserve';
    phaseLabel.textContent = '冷卻圈'; timer.textContent = lap.invalid ? `圈速作廢 · ${lap.reason ?? '超出賽道界線'}` : `本節圈速 ${lapTime(lap.time)}`;
    setPhase('in', 2, 2 + pitEntry, 12);
  }
  function sessionEnd() {
    phase = 'result';
    const r = sessionResult; results.push(r);
    const mine = r.results.find(x => x.carId === entry.carId);
    showBoard(r.results, `${r.session} 成績`);
    const out = r.eliminated.includes(entry.carId);
    panel.replaceChildren(element('h2', '', `${r.session} 結束 · 第 ${mine.position} 名`),
      element('p', '', out ? `止步 ${r.session}，將從第 ${mine.position} 位發車。` : qualifying.current ? `晉級 ${qualifying.current}。` : '排位賽結束。'));
    const done = out || !qualifying.current;
    panel.append(button(done ? '查看發車順位 →' : `準備 ${qualifying.current} →`, () => done ? finish() : garage(), 'primary q-go'));
    panel.hidden = false;
  }
  // 玩家被淘汰後，剩餘節次由 AI 跑完，才能產生完整發車順位。
  function finish() { while (qualifying.current) results.push(qualifying.runSession()); onFinish(qualifying.getGrid(), results); }

  // 飛馳圈分段：與本節最快分段比較，紫＝全場最快、綠＝個人最佳、黃＝較慢
  function revealSector(i) {
    const cell = sectorCells[i];
    const time = lap.sectors[i];
    const best = Math.min(...sessionResult.results.filter(x => x.sectors && !x.invalid).map(x => x.sectors[i]));
    cell.lastChild.textContent = time.toFixed(3);
    cell.className = `q-sector ${time <= best + 1e-6 ? 'purple' : time - best < 0.15 ? 'green' : 'yellow'}`;
  }

  function animate(now) {
    if (disposed) return;
    const dt = Math.min(0.1, Math.max(0, (now - previous) / 1000)); previous = now;
    if (['out', 'flying', 'in'].includes(phase)) {
      motion += (phaseEnd - phaseStart) * dt / phaseSeconds;
      const progress = Math.min(1, (motion - phaseStart) / (phaseEnd - phaseStart));
      if (phase === 'out') car.tyre.temp = progress > 0.6 ? 'ok' : 'cold';
      if (phase === 'flying') {
        const total = lap.sectors.reduce((a, b) => a + b, 0);
        timer.textContent = lapTime(Math.max(0.001, progress * total)).replace(/^0:/, '0:');
        let acc = 0;
        lap.sectors.forEach((t, i) => { acc += t / total; if (progress >= acc - 1e-6 && sectorCells[i].lastChild.textContent === '—') revealSector(i); });
      }
      if (progress >= 1) {
        if (phase === 'out') flyingLap();
        else if (phase === 'flying') inLap();
        else { phase = 'pitting'; cockpit?.transition('pit', null, { stationarySeconds: 99 }); setTimeout(() => !disposed && sessionEnd(), 10000); }
      }
    }
    cockpit?.draw(adapter, motion, dt);
    const t = cockpit?.getTelemetry() ?? fallbackTelemetry(motion, 'none');
    dial.update(t, car, false);
    audio.update(t, { inPit: phase === 'garage' || phase === 'pitting' || phase === 'result', wet: false, timeScale: 1 });
    frame = requestAnimationFrame(animate);
  }
  garage();
  showBoard(entries.map((e, i) => ({ position: i + 1, carId: e.carId, time: null })).slice(0, 0), `${qualifying.current} · ${SESSION_INFO[qualifying.current]}`);
  frame = requestAnimationFrame(animate);
  return () => { document.body.classList.remove('racing'); disposed = true; cancelAnimationFrame(frame); cockpit?.dispose(); audio.dispose(); };
}
