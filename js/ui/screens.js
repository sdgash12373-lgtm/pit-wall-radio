import { element, button, confirmPanel } from './dom.js';
import { escapeHTML as e, lapTime, gap, stats, roles, decisionTypes, choiceLabels } from './format.js';
import { TRACKS } from '../data/tracks.js';
import { getStandings, getRoster } from '../career/career.js';

export function shell(root, title, subtitle, back) {
  root.className = 'app-shell'; root.replaceChildren();
  const header = element('header', 'page-header');
  header.innerHTML = `<div><div class="eyebrow">維修站無線電 · 生涯模式</div><h1>${e(title)}</h1><p>${e(subtitle)}</p></div>`;
  if (back) header.append(button('返回', back));
  const content = element('div', 'page-content'); root.append(header, content);
  document.title = `${title}｜維修站無線電`;
  return content;
}
export function titleScreen(root, saves, actions) {
  const content = shell(root, '每個決定，都在賽道上留下痕跡。', '第一人稱座艙 × 限時攻防 × 完整車手生涯');
  const hero = element('section', 'hero');
  hero.innerHTML = '<div class="eyebrow">你的席位，已經準備好了</div><h2>戴上頭盔。<br>讓無線電帶你上場。</h2><p>不需操作方向盤。觀察車距、掌握輪胎，在關鍵幾秒內做出決定，從新秀席位出發，爭取自己的冠軍。</p><div class="hero-track" aria-hidden="true"><i></i><i></i><i></i></div>';
  hero.append(button('開始新生涯 →', actions.create, 'primary'));
  content.append(hero, element('h2', '', '讀取存檔'));
  if (!saves.length) content.append(element('p', 'muted', '尚無存檔。每站賽後會自動儲存。'));
  for (const save of saves) {
    const row = element('article', 'save-row panel');
    row.append(element('div', '', `${save.slot === 'auto' ? '自動存檔' : '存檔槽 '+save.slot} · 第 ${save.summary.year} 季 / 第 ${save.summary.round} 站 · ${save.summary.team} · ${new Date(save.timestamp).toLocaleString('zh-TW')}`), button('讀取', () => actions.load(save.slot), 'primary'), button('刪除存檔', () => confirmPanel(row, '確定永久刪除這個存檔？', '刪除', () => actions.delete(save.slot)), 'danger'));
    content.append(row);
  }
}
export function createScreen(root, submit, back) {
  const content = shell(root, '建立車手', '從名字到號碼，開始你的圍場故事。', back);
  const form = element('form', 'panel driver-form');
  form.innerHTML = '<label>車手姓名<input name="playerName" maxlength="24" required value="新秀車手" autocomplete="off"></label><label>國籍<select name="nationality"><option>霽嶼聯邦</option><option>璃原共和國</option><option>星灣公國</option><option>嵐川王國</option><option>青穹聯盟</option></select></label><label>賽車號碼<input name="number" type="number" min="1" max="99" step="1" value="7" required></label><button class="primary" type="submit">尋找新秀合約 →</button>';
  form.addEventListener('submit', event => { event.preventDefault(); if (!form.reportValidity()) return; const data = new FormData(form); if (!String(data.get('playerName')).trim()) return; submit({ playerName: String(data.get('playerName')).trim(), nationality: data.get('nationality'), number: Number(data.get('number')) }); });
  content.append(form);
}
export function offerCards(state, select) {
  const grid = element('div', 'card-grid');
  for (const offer of state.offers) {
    const team = state.teams.find(t => t.id === offer.teamId);
    const node = element('article', 'panel offer'); node.style.setProperty('--team', team.color);
    node.innerHTML = `<div class="eyebrow">${offer.renewal ? '續約邀請' : offer.initial ? '新秀席位' : '轉隊邀請'}</div><h2>${e(offer.teamName)}</h2><p>${e(roles[offer.role])} · ${offer.yearsLeft} 年合約</p><p>年薪 ${offer.salary.toLocaleString('zh-TW')} · 性能 ${team.carPerformance}</p><p class="muted">領隊 ${e(team.principal)} / 工程師 ${e(team.engineer)}</p>`;
    node.append(button('簽下合約', () => select(offer.id), 'primary')); grid.append(node);
  }
  return grid;
}

export function rosterScreen(root, state, actions) {
  const content = shell(root, '車隊與車手設定', '可略過此步驟。有效修改會立即套用並自動存檔。');
  appendRosterEditor(content, state, actions);
}

function appendRosterEditor(content, state, actions) {
  const editor = element('section', 'roster-editor');
  const toolbar = element('div', 'roster-toolbar');
  const status = element('div', 'roster-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const grid = element('div', 'roster-grid');
  editor.append(element('p', 'muted', '名稱最多 12 字、簡稱 4 字、車手名字 10 字。名稱不可空白或重複；相近代表色會提醒，但仍可使用。'), toolbar, status, grid);
  content.append(editor);
  let draft;
  function payload() {
    return { teams: draft.teams.map(({ id, name, shortName, color }) => ({ id, name, shortName, color })),
      drivers: draft.teams.flatMap(team => team.drivers.filter(d => !d.isPlayer).map(({ id, name }) => ({ id, name }))) };
  }
  function refreshTitle() {
    if (!state.contract) return;
    const team = state.teams.find(t => t.id === state.contract.teamId);
    const title = `${state.player.name} · ${team.name}`;
    content.parentNode.querySelector('h1').textContent = title;
    document.title = `${title}｜維修站無線電`;
  }
  function apply() {
    const result = actions.updateRoster(payload());
    status.replaceChildren();
    if (!result.ok) status.append(element('p', 'roster-error', '修改尚未套用，請修正以下問題：'));
    else status.append(element('p', 'muted', result.saveStatus ?? '已套用'));
    for (const error of result.errors) status.append(element('p', 'roster-error', error));
    for (const warning of result.warnings) status.append(element('p', 'roster-warning', warning));
    if (result.ok) refreshTitle();
    return result.ok;
  }
  function field(parent, label, object, key, max) {
    const wrapper = element('label', 'roster-field', label);
    const input = element('input'); input.type = 'text'; input.value = object[key];
    input.maxLength = max; input.required = true; input.autocomplete = 'off';
    input.addEventListener('input', () => { object[key] = input.value; apply(); });
    wrapper.append(input); parent.append(wrapper);
  }
  function renderCards() {
    draft = getRoster(state); grid.replaceChildren();
    for (const team of draft.teams) {
      const card = element('article', 'panel roster-card'); card.style.setProperty('--team', team.color);
      const heading = element('h3', '', team.name);
      card.append(heading);
      if (state.contract?.teamId === team.id) card.append(element('span', 'roster-badge', '你的車隊'));
      field(card, '車隊名稱（最多 12 字）', team, 'name', 12);
      field(card, '簡稱（最多 4 字）', team, 'shortName', 4);
      const label = element('label', 'roster-field', '代表色');
      const color = element('input'); color.type = 'color'; color.value = team.color;
      label.append(color); card.append(label);
      function chooseColor(value) { team.color = value; color.value = value; card.style.setProperty('--team', value); apply(); }
      color.addEventListener('input', () => chooseColor(color.value));
      const swatches = element('div', 'roster-swatches'); swatches.setAttribute('aria-label', '代表色快速選擇');
      for (const [name, value] of [['青綠','#63e6d8'],['橘紅','#ff684b'],['紫','#9d8cff'],['藍','#479dff'],['綠','#56bd74'],['銅','#d59665'],['粉','#e6badf'],['黃','#e9c855']]) {
        const swatch = button('', () => chooseColor(value), 'roster-swatch');
        swatch.style.setProperty('--swatch', value); swatch.setAttribute('aria-label', `${name}色 ${value}`); swatch.title = `${name}色`;
        swatches.append(swatch);
      }
      card.append(swatches);
      for (const driver of team.drivers) {
        if (driver.isPlayer) card.append(element('p', 'roster-player', `${driver.name} · 你（於建立車手時設定）`));
        else field(card, '車手名字（最多 10 字）', driver, 'name', 10);
      }
      card.addEventListener('input', () => { heading.textContent = team.name || '未命名車隊'; });
      grid.append(card);
    }
  }
  toolbar.append(button('全部恢復預設', () => {
    if (toolbar.querySelector('.confirm-panel')) return;
    confirmPanel(toolbar, '確定將所有車隊名稱、簡稱、代表色與 AI 車手名字恢復預設？席位與成績不變。', '確定恢復', () => {
      const saveStatus = actions.resetRoster(); renderCards(); refreshTitle();
      status.replaceChildren(element('p', 'muted', `已恢復預設。${saveStatus ?? ''}`));
    });
  }, 'danger'));
  if (actions.done) toolbar.append(button('使用預設', () => { actions.resetRoster(); actions.done(); }), button('繼續選新秀合約 →', () => { if (apply()) actions.done(); }, 'primary'));
  renderCards();
}
function standingsTable(rows, state, kind = 'drivers') {
  const box = element('div', 'table-wrap');
  box.tabIndex = 0;
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', kind === 'drivers' ? '車手積分榜，可橫向捲動' : '車隊積分榜，可橫向捲動');
  box.innerHTML = `<table><thead><tr><th scope="col">名次</th><th scope="col">名次變化</th><th scope="col">${kind === 'drivers' ? '車手' : '車隊'}</th><th scope="col">積分</th><th scope="col">勝場</th><th scope="col">頒獎台</th></tr></thead><tbody>${rows.map(r => {
    const team = state.teams.find(t => t.id === r.teamId);
    const player = kind === 'drivers' ? r.carId === state.player.id : r.teamId === state.contract.teamId;
    const change = r.change ?? 0;
    return `<tr class="${player ? 'player' : ''}"><td>${r.position}</td><td class="standing-change ${change > 0 ? 'up' : change < 0 ? 'down' : 'unchanged'}" aria-label="${change > 0 ? `上升 ${change} 名` : change < 0 ? `下降 ${-change} 名` : '名次不變'}">${change > 0 ? `▲${change}` : change < 0 ? `▼${-change}` : '—'}</td><td class="competitor"><span class="team-stripe" style="--team:${e(team?.color ?? 'var(--muted)')}" aria-hidden="true"></span>${e(r.name)}${kind === 'drivers' ? `<small class="team-name">${e(r.teamName ?? team?.name)}</small>` : ''}</td><td>${r.points}</td><td>${r.wins}</td><td>${r.podiums ?? 0}</td></tr>`;
  }).join('')}</tbody></table>`;
  return box;
}
function appendStandings(content, state, compact = false) {
  const standings = getStandings(state);
  const drivers = compact ? standings.drivers.filter((r, i) => i < 10 || r.carId === state.player.id) : standings.drivers;
  content.append(element('h3', '', compact ? '車手榜 · 前 10 名與你的排名' : '車手榜'), standingsTable(drivers, state),
    element('h3', '', '車隊榜'), standingsTable(standings.teams, state, 'teams'));
}
export function hubScreen(root, state, active, actions) {
  const team = state.teams.find(t => t.id === state.contract.teamId);
  const content = shell(root, `${state.player.name} · ${team.name}`, `第 ${state.year} 季 · 第 ${state.season.round} / ${state.season.calendar.length} 站`, actions.title);
  const nav = element('nav', 'tabs'); nav.setAttribute('aria-label', '生涯分頁');
  const unread = state.inbox.filter(m => !m.read).length;
  for (const [id,label] of [['overview','總覽'],['standings','積分榜'],['calendar','賽曆'],['inbox',`信箱（${unread}）`],['contract','合約與屬性'],['roster','車隊與車手']]) {
    const tab = button(label, () => actions.tab(id), active === id ? 'active' : ''); tab.setAttribute('aria-current', String(active === id)); nav.append(tab);
  }
  content.append(nav);
  if (active === 'overview') {
    const track = TRACKS.find(t => t.id === state.season.calendar[state.season.round-1]);
    const standing = state.season.driverStandings.find(s => s.carId === state.player.id);
    const panel = element('section','panel next-race');
    panel.innerHTML = `<div class="eyebrow">下一個比賽週末 · 第 ${state.season.round} 站</div><h2>${e(track.name)}</h2><p class="track-name-en" lang="en">${e(track.nameEn)}</p><p>${e(track.country)} · ${e(track.city)}</p><p>單圈 ${track.lengthKm.toFixed(3)} km · ${track.corners} 個彎道<br>正賽 ${track.laps} 圈（真實 ${track.realLaps} 圈的 25%）</p><p class="muted">${e(track.description)}</p><div class="metrics"><div><strong>${standing.position}</strong>車手排名</div><div><strong>${standing.points}</strong>賽季積分</div><div><strong>${state.teamTrust.toFixed(0)}</strong>車隊信任</div><div><strong>${state.player.reputation.toFixed(0)}</strong>聲望</div></div>`;
    panel.append(button(state.weekend.qualifying.length ? '繼續週末 →' : '前往比賽週末 →', actions.weekend,'primary')); content.append(panel);
    content.append(element('p','muted', actions.saveStatus));
  } else if (active === 'standings') {
    appendStandings(content, state);
  } else if (active === 'roster') {
    appendRosterEditor(content, state, actions);
  } else if (active === 'calendar') {
    const list = element('div','calendar');
    state.season.calendar.forEach((id,i) => {
      const track = TRACKS.find(t => t.id === id), result = state.season.results.find(r => r.round === i+1)?.classification.find(r => r.carId === state.player.id);
      const row = element('article',`panel ${i+1 === state.season.round ? 'current' : ''}`);
      row.append(element('span','eyebrow',`第 ${i+1} 站`),element('h3','',track.name),element('p','',`${track.lengthKm.toFixed(3)} km · 正賽 ${track.laps} 圈`),element('p','muted',result ? result.status === 'dnf' ? '退賽' : `第 ${result.position} 名 · ${result.points} 分` : i+1 === state.season.round ? '本週賽事' : '尚未舉行')); list.append(row);
    }); content.append(list);
  } else if (active === 'inbox') {
    for (const mail of [...state.inbox].reverse()) {
      const details = element('details','panel mail'); details.innerHTML = `<summary>${mail.read ? '' : '● '}${e(mail.subject)} <small>第 ${mail.round} 站 · ${e(mail.from)}</small></summary><p>${e(mail.body)}</p>`;
      details.addEventListener('toggle', () => { if (details.open && !mail.read) { mail.read = true; actions.read(); nav.querySelectorAll('button')[3].textContent = `信箱（${state.inbox.filter(m => !m.read).length}）`; } }); content.append(details);
    }
  } else {
    const panel = element('section','panel');
    panel.innerHTML = `<h2>${e(team.name)} · ${e(roles[state.contract.role])}</h2><p>剩餘 ${state.contract.yearsLeft} 年 · 年薪 ${state.contract.salary.toLocaleString('zh-TW')}</p><p>號碼 ${state.player.number} · ${e(state.player.nationality)} · ${state.player.age} 歲</p><p>車隊信任 ${state.teamTrust.toFixed(0)} / 聲望 ${state.player.reputation.toFixed(0)} / 士氣 ${state.player.morale.toFixed(0)}</p><div class="stat-grid">${Object.entries(stats).map(([key,label]) => `<label>${label} <b>${state.player.stats[key]}</b><meter min="0" max="100" value="${state.player.stats[key]}"></meter><small>經驗 ${state.player.xp[key]}</small></label>`).join('')}</div>`; content.append(panel);
  }
}
export function practiceScreen(root,state,options,select,back) {
  const track = TRACKS.find(t => t.id === state.season.calendar[state.season.round-1]);
  const content = shell(root,'練習 · 選擇調校',`${track.name} · ${track.description}`,back);
  const grid = element('div','card-grid');
  for(const option of options) {
    const node = element('article','panel'); node.innerHTML = `<h2>${e(option.label)}</h2><p>${e(option.description)}</p><p class="muted">排位 ${option.effects.qualiDelta>0?'+':''}${option.effects.qualiDelta.toFixed(2)} 秒 · 正賽 ${option.effects.raceLapDelta>0?'+':''}${option.effects.raceLapDelta.toFixed(2)} 秒<br>磨耗倍率 ${option.effects.wearMultiplier.toFixed(2)}</p>`;
    node.append(button('採用並開始排位',()=>select(option.id),'primary')); grid.append(node);
  } content.append(grid);
}
function qualifyingTime(row) {
  return row?.invalid ? '圈速作廢' : Number.isFinite(row?.time) && row.time > 0 ? lapTime(row.time) : '無有效圈速';
}
function qualifyingSessionTable(state, session) {
  const wrap = element('div', 'table-wrap');
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', `${session.session} 成績，可橫向捲動`);
  wrap.innerHTML = `<table><caption>${e(session.session)} 成績</caption><thead><tr>${['名次', '車手', '車隊', '最佳圈速', '第一區段', '第二區段', '第三區段', '晉級狀態'].map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${session.results.map(r => {
    const driver = state.drivers.find(d => d.id === r.carId), team = state.teams.find(t => t.id === driver?.teamId);
    return `<tr class="${r.carId === state.player.id ? 'player ' : ''}${r.eliminated ? 'eliminated' : ''}"><td>${r.position}</td><td class="competitor"><span class="team-stripe" style="--team:${e(team?.color ?? 'var(--muted)')}" aria-hidden="true"></span>${e(driver?.name ?? r.carId)}</td><td>${e(team?.name)}</td><td>${qualifyingTime(r)}</td>${[0, 1, 2].map(i => `<td>${Number.isFinite(r.sectors?.[i]) ? `${r.sectors[i].toFixed(3)} 秒` : '—'}</td>`).join('')}<td class="${r.eliminated ? 'elimination-label' : ''}">${r.eliminated ? '淘汰' : session.session === 'Q3' ? '完成 Q3' : '晉級'}</td></tr>`;
  }).join('')}</tbody></table>`;
  return wrap;
}
export function qualifyingScreen(root,state,start) {
  const content = shell(root,'排位賽 · 成績揭曉','單圈計時已完成，起跑順位逐一確認。');
  content.append(element('h2', '', '最終發車順位'));
  const list = element('div','quali-list');
  list.setAttribute('aria-label', '最終發車順位');
  const launch = button('進入正賽座艙 →',start,'primary'); launch.disabled = true;
  const progress = element('p', 'muted');
  progress.setAttribute('role', 'status');
  content.append(list,progress,launch);
  const sessions = state.weekend.qualifyingSessions ?? [];
  if (sessions.length) {
    content.append(element('h2', '', '各節排位成績'), element('p', 'muted', 'Q1 第 16–20 名、Q2 第 11–15 名淘汰。表格可左右捲動查看區段時間。'));
    for (const name of ['Q1', 'Q2', 'Q3']) {
      const session = sessions.find(s => s.session === name);
      if (session) content.append(qualifyingSessionTable(state, session));
    }
  }
  const grid = state.weekend.qualifying; let index = 0, timer;
  function reveal() {
    if (index >= grid.length) { clearInterval(timer); launch.disabled = false; progress.textContent = '發車順位已全部揭曉，可以進入正賽。'; return; }
    const row = grid[index++], driver = state.drivers.find(d => d.id === row.carId), team = state.teams.find(t => t.id === driver?.teamId);
    const lastSession = [...sessions].reverse().find(s => s.results.some(r => r.carId === row.carId));
    const result = lastSession?.results.find(r => r.carId === row.carId);
    const node = element('div',`quali-row ${row.carId === state.player.id ? 'player' : ''}`); node.style.setProperty('--team',team?.color ?? 'var(--muted)');
    node.append(element('b','quali-position',`P${row.position}`),element('span','quali-driver',driver?.name ?? row.carId),element('small','quali-team',team?.name),element('strong','quali-time',qualifyingTime(result ?? row)));
    if (sessions.length) node.append(element('span','quali-stage',lastSession?.session === 'Q3' ? '進入 Q3' : lastSession ? `${lastSession.session} 淘汰` : '—'));
    list.append(node);
    progress.textContent = `已揭曉 ${index} / ${grid.length} 位車手`;
    if (index === grid.length) { clearInterval(timer); launch.disabled = false; progress.textContent = '發車順位已全部揭曉，可以進入正賽。'; }
  }
  timer = setInterval(reveal,160); reveal();
  return () => clearInterval(timer);
}
export function classificationTable(rows, playerId, teams) {
  const wrap = element('div','table-wrap');
  wrap.innerHTML = `<table><thead><tr><th>名次</th><th>車手</th><th>車隊</th><th>差距</th><th>最快圈</th><th>進站</th><th>罰時</th><th>積分</th></tr></thead><tbody>${rows.map(r=>`<tr class="${r.carId===playerId?'player':''}"><td>${r.position}</td><td>${e(r.name)}</td><td>${e(teams.find(t=>t.id===r.teamId)?.name)}</td><td>${r.status==='dnf'?'退賽':r.position===1?'冠軍':gap(r.gap)}</td><td>${lapTime(r.bestLap)}</td><td>${r.pitStops}</td><td>${r.penalties > 0 ? `${r.penalties} 秒` : '—'}</td><td>${r.points??'—'}</td></tr>`).join('')}</tbody></table>`; return wrap;
}
export function postraceScreen(root,state,questions,answer,done,saveStatus) {
  const content = shell(root,'賽後 · 方格旗之後',`第 ${state.season.round} 站 · ${saveStatus}`);
  content.append(classificationTable(state.weekend.classification,state.player.id,state.teams),element('h2','','本場決策回顧'));
  const review = element('div','panel');
  if (!state.weekend.decisions?.length) review.append(element('p','','本場沒有觸發關鍵決策。'));
  for (const d of state.weekend.decisions??[]) review.append(element('p','',`第 ${d.lap} 圈 · ${decisionTypes[d.type]??'策略決策'} · ${choiceLabels[d.choiceId]??'策略選項'} · ${d.timedOut?'猶豫了…採用預設選項': '已下達指令'} · ${d.success===true?'成功':d.success===false?'未成功':'策略已執行'}`));
  content.append(review,element('h2','','積分榜'));
  appendStandings(content, state, true);
  content.append(element('h2','','媒體採訪'));
  if (questions.length) {
    const q = questions[0], panel = element('section','panel'); panel.append(element('h3','',q.question));
    for(const choice of q.choices) panel.append(button(choice.label,()=>answer(q.id,choice.id),'choice')); content.append(panel);
  } else content.append(element('p','muted','採訪已完成。'),button(state.season.round===state.season.calendar.length?'查看季末結算 →':'返回生涯主頁 →',done,'primary'));
}
export function seasonEndScreen(root,state,select,next,saveStatus) {
  const content = shell(root,`第 ${state.year} 季 · 賽季落幕`,saveStatus);
  const history = state.history.at(-1), panel = element('section','panel champion');
  panel.innerHTML = `<div class="eyebrow">年度冠軍</div><h2>${e(history.driverChampion.name)}</h2><p>${history.driverChampion.points} 分 · 車隊冠軍：${e(history.teamChampion.name)}</p><p>你的最終排名：第 ${history.playerPosition} 名</p>`; content.append(panel,standingsTable(getStandings(state).drivers,state),element('h2','','下季合約邀約'),offerCards(state,select));
  if (state.contract.yearsLeft>0) content.append(button('以目前合約開始新賽季 →',next,'primary'));
  else if (!state.offers.length) content.append(element('p','panel','目前合約已到期，且沒有收到邀約。你的生涯止步於本季，可回到標題建立新生涯。'));
}
