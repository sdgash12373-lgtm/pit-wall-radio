import { element, button } from './dom.js';

// 轉播風格窄版計時塔：標誌、圈數、旗號橫幅與逐列名次。
export function timingTower(teams) {
  const node = element('aside', 'timing-tower');
  const head = element('div', 'tt-head');
  const lap = element('div', 'tt-lap');
  head.append(element('div', 'tt-logo', 'PWR'), lap);
  const flag = element('div', 'tt-flag');
  const list = element('div', 'timing-list');
  const toggle = button('▾', () => {
    const closed = node.classList.toggle('collapsed');
    toggle.textContent = closed ? '▸' : '▾';
    toggle.setAttribute('aria-expanded', String(!closed));
  }, 'tt-toggle');
  toggle.setAttribute('aria-label', '收合或展開計時塔');
  toggle.setAttribute('aria-expanded', 'true');
  head.append(toggle);
  node.append(head, flag, list);
  const rows = new Map();
  const color = id => teams.find(t => t.id === id)?.color ?? '#fff';
  return {
    node,
    update(sim, flagInfo) {
      const { lap: current, totalLaps } = sim.state;
      lap.innerHTML = `<small>LAP</small> <b>${Math.max(1, Math.min(current + 1, totalLaps))}</b><small>/${totalLaps}</small>`;
      flag.textContent = flagInfo.text;
      flag.dataset.kind = flagInfo.kind;
      const order = sim.getOrder();
      const player = order.find(c => c.isPlayer);
      for (const car of order) {
        let row = rows.get(car.carId);
        if (!row) {
          row = element('div', `timing-row${car.isPlayer ? ' player' : ''}`);
          row.append(element('b', 'tt-pos'), element('i', 'tt-team'), element('span', 'tt-name'), element('small', 'tt-gap'));
          row.style.setProperty('--team', color(car.teamId));
          rows.set(car.carId, row);
        }
        row.children[0].textContent = car.position;
        row.children[2].textContent = car.name;
        row.children[3].textContent = car.status === 'dnf' ? '退賽' : car.status === 'pit' ? 'PIT' : car.position === 1 ? 'Interval' : `+${car.interval.toFixed(1)}`;
        row.classList.toggle('out', car.status === 'dnf');
        row.classList.toggle('pit', car.status === 'pit');
        // 手機版只顯示領先者與玩家前後三名。
        row.classList.toggle('far', !!player && car.position !== 1 && Math.abs(car.position - player.position) > 3);
        list.append(row);
      }
    },
  };
}
