import { element, button } from './dom.js';

// 轉播風格無線電卡：上方「車手 RADIO」標頭、車號色帶、繁中字幕對話；展開後可選題詢問策略組。
export function radioPanel(radio, { name, number, team, onExchange = () => {} }) {
  const node = element('section', 'radio-card');
  node.style.setProperty('--team', team.color);
  const title = element('header', 'rc-title');
  title.append(element('b', '', name), element('span', '', 'RADIO · 無線電'));
  const strip = element('div', 'rc-strip');
  strip.append(element('strong', '', String(number ?? '')), element('small', '', team.shortName ?? team.name));
  const feed = element('div', 'rc-feed'); feed.setAttribute('aria-live', 'polite');
  const drawer = element('div', 'rc-drawer'); drawer.hidden = true;
  const actions = element('div', 'rc-actions');
  const topics = element('div', 'rc-topics');
  drawer.append(actions, topics);
  node.append(title, strip, feed, drawer);
  let timer, disposed = false, idle;

  function push(lines) {
    if (!lines?.length) return;
    node.classList.add('live');
    clearTimeout(idle); idle = setTimeout(() => node.classList.remove('live'), 9000);
    for (const line of lines) {
      const quote = element('p', `rc-quote ${line.speaker === 'player' ? 'player' : 'engineer'}`);
      // 台詞常以「工程師名：」開頭，標頭已表明身分，字幕只留內容。
      quote.dataset.full = line.text.replace(/^[^：「」]{1,8}：/, '');
      feed.append(quote);
    }
    while (feed.children.length > 4) feed.firstElementChild.remove();
    typeOut();
  }
  // 逐字打出最新的字幕，舊字幕直接顯示全文。
  function typeOut() {
    clearInterval(timer);
    const pending = [...feed.children].filter(q => q.textContent !== `「${q.dataset.full}」`);
    pending.slice(0, -1).forEach(q => { q.textContent = `「${q.dataset.full}」`; });
    const last = pending.at(-1); if (!last) return;
    let i = 0;
    timer = setInterval(() => {
      if (disposed) return clearInterval(timer);
      i += 2; last.textContent = `「${last.dataset.full.slice(0, i)}${i >= last.dataset.full.length ? '」' : ''}`;
      if (i >= last.dataset.full.length) clearInterval(timer);
    }, 24);
  }
  function refresh() {
    topics.replaceChildren(...radio.getTopics().map(t => button(t.label, () => ask(t.id))));
  }
  function ask(id) {
    try {
      const response = radio.ask(id);
      push(response.lines); onExchange({ kind: 'ask', topicId: id, response });
      actions.replaceChildren();
      if (response.action) {
        actions.append(
          button(`照做：${response.action.label}`, () => {
            const result = radio.applyAction(response.action);
            push(result.lines); onExchange({ kind: 'action', action: response.action, response: result });
            actions.replaceChildren(); refresh();
          }, 'primary'),
          button('不用', () => { actions.replaceChildren(); push([{ speaker: 'player', text: '維持目前安排。' }]); }),
        );
      }
    } catch (error) { push([{ speaker: 'engineer', text: error.message }]); refresh(); }
  }
  return {
    node, push, refresh,
    get open() { return !drawer.hidden; },
    toggle(force) {
      drawer.hidden = force === undefined ? !drawer.hidden : !force;
      node.classList.toggle('open', !drawer.hidden);
      if (!drawer.hidden) refresh();
      return !drawer.hidden;
    },
    dispose() { disposed = true; clearInterval(timer); clearTimeout(idle); },
  };
}
