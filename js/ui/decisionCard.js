import { element, button } from './dom.js';
import { decisionTypes } from './format.js';

const RISK = { low: '低風險', mid: '中風險', high: '高風險' };

// 精簡限時決策卡：情境一行、倒數條、選項（數字鍵可選）。工程師台詞改由無線電卡顯示。
export function decisionCard(event, choose) {
  const node = element('section', `decision-card urgency-${event.urgency ?? 'mid'}`);
  node.setAttribute('aria-label', `限時決策：${event.title}`);
  const head = element('div', 'dc-head');
  const timer = element('b', 'dc-time');
  head.append(element('span', 'dc-tag', decisionTypes[event.type] ?? '決策'), element('span', 'dc-lap', `第 ${event.lap} 圈`), timer);
  const bar = element('div', 'dc-bar');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', '決策剩餘秒數');
  bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', event.timeLimit);
  const fill = element('div'); bar.append(fill);
  const choices = element('div', 'dc-choices');
  event.choices.forEach((choice, i) => {
    const b = button('', () => choose(choice.id), `dc-choice risk-${choice.risk}`);
    b.title = choice.hint;
    const chance = choice.successChance === undefined ? '' : ` · ${Math.round(choice.successChance * 20) * 5}%`;
    b.append(element('kbd', '', String(i + 1)), element('strong', '', choice.label), element('small', '', `${RISK[choice.risk]}${chance}`));
    if (choice.id === event.defaultChoiceId) b.classList.add('default');
    choices.append(b);
  });
  node.append(head, element('h2', '', event.title), element('p', '', event.description), bar, choices);
  return {
    node,
    update(seconds) {
      const ratio = Math.max(0, seconds / event.timeLimit);
      fill.style.transform = `scaleX(${ratio})`;
      timer.textContent = seconds.toFixed(1);
      node.classList.toggle('hurry', ratio < 0.35);
      bar.setAttribute('aria-valuenow', seconds.toFixed(1));
    },
  };
}
