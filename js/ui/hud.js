import { element } from './dom.js';
import { COMPOUNDS } from '../data/tyres.js';
import { modes } from './format.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};

// 旗號狀態：依安全車、天氣與賽事進度決定橫幅文字與色調。
export function flagState(sim) {
  const { safetyCar, lap, totalLaps, finished, wetness } = sim.state;
  if (finished) return { kind: 'chequered', text: '方格旗' };
  if (safetyCar === 'sc') return { kind: 'yellow', text: '安全車 SC' };
  if (safetyCar === 'vsc') return { kind: 'yellow', text: '虛擬安全車 VSC' };
  if (lap === 0) return { kind: 'start', text: '起跑準備' };
  if (lap >= totalLaps - 1) return { kind: 'white', text: '最後一圈' };
  if (wetness >= 0.2) return { kind: 'wet', text: '濕地賽道' };
  return { kind: 'green', text: '綠旗' };
}

export function nameplate({ name, number, team }) {
  const node = element('div', 'nameplate');
  node.style.setProperty('--team', team.color);
  const position = element('b', 'np-pos', '–');
  const who = element('div', 'np-who');
  who.append(element('span', 'np-name', name), element('small', 'np-team', team.name));
  node.append(position, who, element('strong', 'np-number', String(number ?? '')));
  return { node, update(car) { position.textContent = car.status === 'dnf' ? '退' : car.position; } };
}

// 右下角圓形儀表：速度弧、轉速、檔位、輪胎與能量模式。
export function gauge() {
  const node = element('div', 'gauge');
  const r = 52, arc = 2 * Math.PI * r * 0.75;
  const dial = svg('svg', { viewBox: '0 0 140 140', 'aria-hidden': 'true' });
  const ring = { cx: 70, cy: 70, r, fill: 'none', transform: 'rotate(135 70 70)', 'stroke-linecap': 'round' };
  dial.append(
    svg('circle', { ...ring, class: 'g-track', 'stroke-dasharray': `${arc} 999` }),
    svg('circle', { ...ring, r: r - 9, class: 'g-rpm-track', 'stroke-dasharray': `${2 * Math.PI * (r - 9) * 0.75} 999` }),
  );
  const speedArc = svg('circle', { ...ring, class: 'g-speed', 'stroke-dasharray': `0 999` });
  const rpmArc = svg('circle', { ...ring, r: r - 9, class: 'g-rpm', 'stroke-dasharray': `0 999` });
  dial.append(speedArc, rpmArc);
  for (const [value, angle] of [[0, 135], [100, 214], [200, 294], [300, 373]]) {
    const rad = angle * Math.PI / 180;
    const label = svg('text', { x: 70 + Math.cos(rad) * 66, y: 70 + Math.sin(rad) * 66 + 3, class: 'g-scale' });
    label.textContent = value; dial.append(label);
  }
  const readout = element('div', 'g-readout');
  const speed = element('strong', 'g-speed-num', '0'), rpm = element('span', 'g-rpm-num', '0 RPM');
  const gear = element('b', 'g-gear', 'N'), drs = element('span', 'g-chip g-drs', '超車模式');
  readout.append(speed, element('small', '', 'KM/H'), rpm, gear);
  const chips = element('div', 'g-chips');
  const tyre = element('span', 'g-chip g-tyre'), mode = element('span', 'g-chip g-mode');
  chips.append(tyre, mode, drs);
  node.append(dial, readout, chips);
  return {
    node,
    update(t, car, drsOpen) {
      speed.textContent = Math.round(t.speed);
      rpm.textContent = `${Math.round(t.rpm / 10) * 10} RPM`;
      gear.textContent = car.status === 'pit' ? 'P' : t.gear;
      speedArc.setAttribute('stroke-dasharray', `${Math.min(1, t.speed / 340) * arc} 999`);
      rpmArc.setAttribute('stroke-dasharray', `${Math.min(1, Math.max(0, (t.rpm - 4000) / 8500)) * 2 * Math.PI * (r - 9) * 0.75} 999`);
      node.classList.toggle('redline', t.rpm > 11800);
      const compound = COMPOUNDS[car.tyre.compound];
      tyre.textContent = `${compound.name} ${Math.round(car.tyre.wear)}%`;
      tyre.style.setProperty('--tyre', compound.color);
      mode.textContent = `ERS ${modes[car.pushMode]}`;
      mode.dataset.mode = car.pushMode;
      drs.classList.toggle('on', !!drsOpen);
    },
  };
}

// Cockpit 尚未提供遙測時的備援：依圈內進度估算速度與檔位。
export function fallbackTelemetry(motion, safetyCar) {
  const phase = (motion % 1) * 6, local = phase % 1;
  const corner = Math.floor(phase) % 2 === 1;
  let speed = corner ? 120 + local * 60 : 140 + local * 175;
  if (safetyCar !== 'none') speed *= 0.5;
  const gear = Math.max(1, Math.min(8, Math.ceil(speed / 42)));
  const rpm = 4000 + ((speed - (gear - 1) * 42) / 42) * 8500;
  return { speed, rpm: Math.min(12500, Math.max(4000, rpm)), gear, steer: corner ? Math.sin(local * Math.PI) * 0.6 : 0, throttle: corner ? 0.4 : 1, brake: 0, shifting: false, drs: false };
}
