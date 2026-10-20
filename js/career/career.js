import { TRACKS } from '../data/tracks.js';
import { TEAMS } from '../data/teams.js';
import { DRIVERS } from '../data/drivers.js';
import { createRng } from '../engine/rng.js';
import { makeMediaQuestions } from './media.js';

export const CAREER_VERSION = 1;
const STATS = ['pace', 'racecraft', 'tyreMgmt', 'wet', 'consistency', 'composure'];
const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const copy = value => JSON.parse(JSON.stringify(value));
const clamp = (value, max = 100) => Math.max(0, Math.min(max, value));
const numeric = value => Number.isFinite(value) ? value : 0;
const random = (state, label) => createRng(JSON.stringify([state.seed, state.year, label]));
const requireCondition = (condition, message) => { if (!condition) throw new Error(message); };

function calendar(state) {
  return TRACKS.map(t => t.id);
}

function resetSeason(state) {
  state.season = { round: 1, calendar: calendar(state), results: [], driverStandings: [], teamStandings: [], ended: false };
  state.weekend = { round: 1, practice: null, qualifying: [], qualifyingSessions: [], classification: null, mediaQuestions: [], mediaAnswers: [] };
  resetStandings(state);
}

function resetStandings(state) {
  state.season.driverStandings = state.drivers.map(d => ({
    driverId: d.id, carId: d.id, name: d.name, teamId: d.teamId, points: 0, wins: 0, podiums: 0, change: 0, bestPosition: null, position: 0,
  }));
  state.season.teamStandings = state.teams.map(t => ({
    teamId: t.id, name: t.name, points: 0, wins: 0, podiums: 0, change: 0, bestPosition: null, position: 0,
  }));
  sortStandings(state);
}

function sortStandings(state) {
  for (const rows of [state.season.driverStandings, state.season.teamStandings]) {
    rows.sort((a, b) => b.points - a.points || b.wins - a.wins
      || (a.bestPosition ?? 999) - (b.bestPosition ?? 999)
      || String(a.carId ?? a.teamId).localeCompare(String(b.carId ?? b.teamId)));
    rows.forEach((row, i) => { row.position = i + 1; });
  }
}

function syncPlayer(state) {
  const driver = state.drivers.find(d => d.id === state.player.id);
  if (driver) Object.assign(driver, { name: state.player.name, age: state.player.age,
    stats: { ...state.player.stats }, teamId: state.contract.teamId });
}

function effects(state, changes) {
  state.teamTrust = clamp(state.teamTrust + numeric(changes?.teamTrust));
  state.player.reputation = clamp(state.player.reputation + numeric(changes?.reputation));
  state.player.morale = clamp(state.player.morale + numeric(changes?.morale));
}

function mail(state, from, subject, body) {
  state.inbox.push({ id: `mail-${state.year}-${state.inbox.length + 1}`, year: state.year,
    round: state.season.round, from, subject, body, read: false });
}

function offer(state, team, index, { initial = false, renewal = false } = {}) {
  const rng = random(state, `offer-${team.id}`);
  return { id: `offer-${state.year}-${team.id}`, teamId: team.id, teamName: team.name,
    role: initial ? ['second', 'equal', 'lead'][index % 3] : renewal && state.teamTrust >= 75 ? 'lead' : 'equal',
    yearsLeft: initial ? [1, 2, 3][index % 3] : rng.int(1, 3),
    salary: initial ? [300000, 450000, 600000][index % 3]
      : Math.round((team.carPerformance * 10000 + state.player.reputation * 30000) / 10000) * 10000,
    initial, renewal, poaching: !initial && !renewal && state.contract.yearsLeft > 0,
  };
}

export function createCareer({ playerName = '新秀車手', nationality = '霽嶼聯邦', number = 7, seed = 1 } = {}) {
  const state = { version: CAREER_VERSION, seed: String(seed), year: 1,
    player: { id: 'player', carId: 'player', name: playerName, nationality, number, age: 20,
      stats: {}, xp: {}, reputation: 25, morale: 65 }, contract: null, teamTrust: 60,
    drivers: copy(DRIVERS), reserveDrivers: [], retiredDrivers: [], teams: copy(TEAMS), inbox: [], offers: [], history: [] };
  const rng = random(state, 'rookie');
  for (const key of STATS) { state.player.stats[key] = rng.int(56, 66); state.player.xp[key] = 0; }
  resetSeason(state);
  const candidates = state.teams.filter(t => t.tier !== 'top').slice(-4);
  // 一支中段與兩支後段車隊，角色、年限及薪資各有差異。
  state.offers = [candidates[0], candidates[1], candidates[2]].map((t, i) => offer(state, t, i, { initial: true }));
  mail(state, '經紀人', '你的新秀合約已送達', '三支車隊願意提供正式席位，請選擇最適合自己的發展道路。');
  return state;
}

// Return detached display data so an unfinished edit never mutates the career.
export function getRoster(state) {
  return { teams: state.teams.map(team => ({
    id: team.id, name: team.name, shortName: team.shortName, color: team.color,
    drivers: state.drivers.filter(driver => driver.teamId === team.id).map(driver => ({
      id: driver.id, name: driver.id === state.player.id ? state.player.name : driver.name,
      isPlayer: driver.id === state.player.id,
    })),
  })) };
}

function syncRosterNames(state) {
  for (const row of state.season.driverStandings) {
    const driver = state.drivers.find(d => d.id === (row.driverId ?? row.carId));
    if (driver) row.name = driver.name;
    if ('teamName' in row) row.teamName = state.teams.find(t => t.id === row.teamId)?.name ?? row.teamName;
  }
  for (const row of state.season.teamStandings) {
    row.name = state.teams.find(t => t.id === row.teamId)?.name ?? row.name;
  }
  for (const item of state.offers ?? []) {
    item.teamName = state.teams.find(t => t.id === item.teamId)?.name ?? item.teamName;
  }
}

export function updateRoster(state, changes = {}) {
  const errors = [], warnings = [];
  const teams = state.teams.map(t => ({ ...t }));
  const drivers = state.drivers.map(d => ({ ...d }));
  const text = (value, limit, label) => {
    if (typeof value !== 'string' || !value.trim()) { errors.push(`${label}不可空白。`); return ''; }
    const name = value.trim();
    if (Array.from(name).length > limit) errors.push(`${label}最多 ${limit} 字。`);
    return name;
  };
  for (const [key, pool] of [['teams', teams], ['drivers', drivers]]) {
    const updates = changes?.[key] ?? [];
    if (!Array.isArray(updates)) { errors.push('名單格式錯誤。'); continue; }
    const seen = new Set();
    for (const item of updates) {
      const target = pool.find(row => row.id === item?.id);
      if (!target || seen.has(item.id)) { errors.push('名單識別碼無效或重複。'); continue; }
      seen.add(item.id);
      if (key === 'drivers' && item.id === state.player.id) { errors.push('請勿在此修改玩家姓名。'); continue; }
      target.name = text(item.name, key === 'teams' ? 12 : 10, key === 'teams' ? '車隊名稱' : '車手名字');
      if (key === 'teams') {
        target.shortName = text(item.shortName, 4, '車隊簡稱');
        if (typeof item.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.color)) errors.push('代表色須為有效的六位十六進位色碼。');
        else target.color = item.color.toLowerCase();
      }
    }
  }
  const namedDrivers = drivers.some(d => d.id === state.player.id) ? drivers : [...drivers, state.player];
  for (const [pool, label] of [[teams, '車隊名稱'], [namedDrivers, '車手名字']]) {
    const names = pool.map(row => row.name.trim().normalize('NFKC').toLocaleLowerCase());
    if (new Set(names).size !== names.length) errors.push(`${label}不可重複。`);
  }
  const rgb = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  teams.forEach((team, i) => {
    for (const other of teams.slice(i + 1)) {
      const a = rgb(team.color), b = rgb(other.color);
      if (Math.hypot(...a.map((v, j) => v - b[j])) < 60) warnings.push(`${team.name}與${other.name}的代表色太接近，賽事中可能不易辨識。`);
    }
  });
  if (errors.length) return { ok: false, errors, warnings };
  teams.forEach((team, i) => Object.assign(state.teams[i], { name: team.name, shortName: team.shortName, color: team.color }));
  drivers.forEach((driver, i) => {
    if (driver.id === state.player.id) return;
    // Generated rookies have no entry in DRIVERS; retain their original name for reset.
    if (!DRIVERS.some(d => d.id === driver.id) && driver.name !== state.drivers[i].name) {
      state.drivers[i].rosterDefaultName ??= state.drivers[i].name;
    }
    state.drivers[i].name = driver.name;
  });
  syncRosterNames(state);
  return { ok: true, errors, warnings };
}

export function resetRoster(state) {
  for (const team of state.teams) {
    const original = TEAMS.find(t => t.id === team.id);
    if (original) Object.assign(team, { name: original.name, shortName: original.shortName, color: original.color });
  }
  for (const driver of [...state.drivers, ...(state.reserveDrivers ?? [])]) {
    if (driver.id === state.player.id) continue;
    driver.name = DRIVERS.find(d => d.id === driver.id)?.name ?? driver.rosterDefaultName ?? driver.name;
  }
  syncRosterNames(state);
  return state;
}

export function acceptInitialContract(state, offerId) {
  requireCondition(!state.contract, '已簽訂新秀合約。');
  const selected = state.offers.find(o => o.id === offerId && o.initial);
  requireCondition(selected, '找不到這份新秀合約。');
  const replaced = state.drivers.filter(d => d.teamId === selected.teamId).at(-1);
  state.drivers = state.drivers.filter(d => d.id !== replaced.id);
  state.reserveDrivers.push({ ...replaced, teamId: null });
  state.contract = { teamId: selected.teamId, yearsLeft: selected.yearsLeft, salary: selected.salary, role: selected.role };
  state.player.teamId = selected.teamId;
  state.drivers.push({ id: state.player.id, name: state.player.name, nationality: state.player.nationality,
    number: state.player.number, age: state.player.age, teamId: selected.teamId, stats: { ...state.player.stats } });
  state.offers = [];
  resetStandings(state);
  mail(state, '經紀人', '正式加入車隊', '合約已生效，現在可以準備第一個比賽週末。');
  return state;
}

export function getCurrentWeekend(state) {
  const track = TRACKS.find(t => t.id === state.season.calendar[state.season.round - 1]);
  return { round: state.season.round, track: track ? copy(track) : null,
    isLastRound: state.season.round === state.season.calendar.length };
}

export function getPracticeOptions(state) {
  const technical = ['technical', 'street'].includes(getCurrentWeekend(state).track?.character);
  return [
    { id: 'balanced', label: '平衡調校', description: '兼顧排位速度與正賽穩定性。', effects: { qualiDelta: -0.08, raceLapDelta: -0.04, wearMultiplier: 1 } },
    { id: 'downforce', label: '高下壓力', description: '提升彎道抓地力，適合街道與技術賽道。', effects: { qualiDelta: technical ? -0.28 : 0.08, raceLapDelta: technical ? -0.12 : 0.06, wearMultiplier: 1.04 } },
    { id: 'low-drag', label: '低阻力', description: '發揮直線速度，彎道則需要更謹慎。', effects: { qualiDelta: technical ? 0.12 : -0.25, raceLapDelta: technical ? 0.08 : -0.1, wearMultiplier: 1.06 } },
    { id: 'long-run', label: '長距離保胎', description: '犧牲單圈速度，降低長距離輪胎磨耗。', effects: { qualiDelta: 0.18, raceLapDelta: 0.04, wearMultiplier: 0.85 } },
  ];
}

export function applyPractice(state, optionId) {
  requireCondition(state.contract && !state.season.ended && !state.weekend.classification
    && state.weekend.qualifying.length === 0, '目前不能進行練習調校。');
  const selected = getPracticeOptions(state).find(o => o.id === optionId);
  requireCondition(selected, '找不到這個調校選項。');
  state.weekend.practice = copy(selected);
  return state;
}

export function buildEntries(state) {
  requireCondition(state.contract, '請先簽訂合約。');
  syncPlayer(state);
  const entries = state.drivers.map(driver => ({ carId: driver.id, driver: copy(driver),
    team: copy(state.teams.find(t => t.id === driver.teamId)), isPlayer: driver.id === state.player.id }));
  const modifiers = { [state.player.id]: { ...(state.weekend.practice?.effects
    ?? { qualiDelta: 0, raceLapDelta: 0, wearMultiplier: 1 }) } };
  return { entries, modifiers };
}

export function recordQualifying(state, grid, sessions = []) {
  requireCondition(state.contract && !state.season.ended && !state.weekend.classification, '目前不能記錄排位賽。');
  const ids = grid.map(row => typeof row === 'string' ? row : row.carId);
  requireCondition(ids.length === state.drivers.length && new Set(ids).size === ids.length
    && ids.every(id => state.drivers.some(d => d.id === id)), '排位結果必須包含所有車手且不可重複。');
  state.weekend.qualifyingSessions = copy(sessions);
  state.weekend.qualifying = grid.map((row, i) => typeof row === 'string'
    ? { position: i + 1, carId: row } : copy(row));
  return state;
}

function addResult(row, result, points) {
  row.points += points;
  if (result.status === 'finished') {
    row.wins += result.position === 1 ? 1 : 0;
    row.podiums = (row.podiums ?? 0) + (result.position <= 3 ? 1 : 0);
    row.bestPosition = Math.min(row.bestPosition ?? 999, result.position);
  }
}

function growPlayer(state, result, careerEffects) {
  effects(state, careerEffects);
  effects(state, { teamTrust: result.status === 'dnf' ? -1 : result.position <= 10 ? 2 : 1,
    reputation: result.status === 'dnf' ? -1 : result.position <= 3 ? 3 : result.position <= 10 ? 2 : 0.5,
    morale: result.status === 'dnf' ? -4 : result.position <= 10 ? 3 : -1 });
  for (const key of STATS) {
    const earned = (result.status === 'dnf' ? 4 : 8 + (result.position <= 10 ? 3 : 0))
      + Math.max(0, numeric(careerEffects?.xp?.[key]));
    state.player.xp[key] += earned;
    const cost = 60 + state.player.stats[key];
    // 每站每項最多成長一點，過量經驗保留到後續比賽。
    if (state.player.xp[key] >= cost && state.player.stats[key] < 99) {
      state.player.xp[key] -= cost;
      state.player.stats[key]++;
    }
    state.player.stats[key] = clamp(state.player.stats[key], 99);
    if (state.player.stats[key] === 99) state.player.xp[key] = 0;
  }
  syncPlayer(state);
}

export function recordRace(state, classification, decisionSummary = null) {
  requireCondition(state.contract && !state.season.ended && !state.weekend.classification
    && state.season.results.length < state.season.round, '這一站已記分或目前不能記錄正賽。');
  const rows = copy(classification).sort((a, b) => a.position - b.position);
  requireCondition(rows.length === state.drivers.length && new Set(rows.map(r => r.carId)).size === rows.length
    && new Set(rows.map(r => r.position)).size === rows.length
    && rows.every(r => state.drivers.some(d => d.id === r.carId && d.teamId === r.teamId)
      && Number.isInteger(r.position) && r.position >= 1 && r.position <= rows.length
      && ['finished', 'dnf'].includes(r.status)), '正賽結果必須包含所有車手與有效名次。');
  const decisions = Array.isArray(decisionSummary?.decisions) ? copy(decisionSummary.decisions) : [];
  for (const standings of [state.season.driverStandings, state.season.teamStandings]) {
    for (const row of standings) row.previousPosition = row.position;
  }
  for (const row of rows) {
    const points = row.status === 'finished' ? POINTS[row.position - 1] ?? 0 : 0;
    row.points = points;
    addResult(state.season.driverStandings.find(d => d.carId === row.carId), row, points);
    addResult(state.season.teamStandings.find(t => t.teamId === row.teamId), row, points);
  }
  sortStandings(state);
  for (const standings of [state.season.driverStandings, state.season.teamStandings]) {
    for (const row of standings) row.change = state.season.results.length ? row.previousPosition - row.position : 0;
  }
  const result = rows.find(r => r.carId === state.player.id);
  const teammate = rows.find(r => r.teamId === state.contract.teamId && r.carId !== state.player.id);
  growPlayer(state, result, decisionSummary?.careerEffects);
  state.weekend.classification = rows;
  state.weekend.decisions = decisions;
  state.weekend.mediaQuestions = makeMediaQuestions({ year: state.year, round: state.season.round, result, teammate, decisions });
  state.season.results.push({ round: state.season.round, trackId: state.season.calendar[state.season.round - 1],
    qualifying: copy(state.weekend.qualifying), qualifyingSessions: copy(state.weekend.qualifyingSessions ?? []), classification: copy(rows), decisions,
    careerEffects: copy(decisionSummary?.careerEffects ?? {}), mediaAnswers: [] });
  const team = state.teams.find(t => t.id === state.contract.teamId);
  mail(state, team.principal, '領隊賽後評語', result.status === 'dnf' ? '先整理退賽原因，我們會一起面對下一站。'
    : `以第 ${result.position} 名完賽，團隊已記下你的努力。請繼續建立穩定的節奏。`);
  mail(state, team.engineer, '工程師賽後報告', `本場進站 ${result.pitStops ?? 0} 次，下一站將依數據改善調校與輪胎管理。`);
  mail(state, '圍場新聞室', '賽後採訪邀請', '媒體已準備好問題，請分享今天的比賽心得。');
  mail(state, teammate?.name ?? '圍場車手', '下一站再較量', teammate && teammate.position < result.position
    ? '今天我先拿下隊內的優勢，下次繼續一起把速度推上去。' : '今天你的表現值得研究，下次賽道上見。');
  return state;
}

export function getMediaQuestions(state) {
  const answered = state.weekend.mediaAnswers.map(a => a.questionId);
  return copy(state.weekend.mediaQuestions.filter(q => !answered.includes(q.id)));
}

export function answerMedia(state, questionId, choiceId) {
  const question = getMediaQuestions(state).find(q => q.id === questionId);
  const choice = question?.choices.find(c => c.id === choiceId);
  requireCondition(choice, '找不到尚未回答的採訪題目或選項。');
  effects(state, choice.effects);
  const answer = { questionId, choiceId };
  state.weekend.mediaAnswers.push(answer);
  state.season.results.at(-1).mediaAnswers.push({ ...answer });
  return state;
}

export function advanceRound(state) {
  requireCondition(!state.season.ended && state.weekend.classification && getMediaQuestions(state).length === 0,
    '請先完成正賽與媒體採訪。');
  // 最後一站維持第 24 站，由 endSeason 進入季末，避免產生不存在的賽道。
  if (state.season.round === state.season.calendar.length) return state;
  state.season.round++;
  state.weekend = { round: state.season.round, practice: null, qualifying: [], qualifyingSessions: [], classification: null, mediaQuestions: [], mediaAnswers: [] };
  return state;
}

function ageDrivers(state, rng) {
  state.player.age++;
  for (const driver of [...state.drivers, ...state.reserveDrivers]) {
    if (driver.id === state.player.id) continue;
    driver.age++;
    for (const key of STATS) driver.stats[key] = clamp(driver.stats[key]
      + (driver.age <= 25 ? rng.int(0, 2) : driver.age >= 33 ? -rng.int(0, 2) : rng.int(-1, 1)), 99);
    if (driver.age <= 35 || !rng.chance(Math.min(0.85, (driver.age - 34) * 0.1))) continue;
    state.retiredDrivers.push({ ...copy(driver), retiredYear: state.year });
    const pool = driver.teamId ? state.drivers : state.reserveDrivers;
    const index = pool.indexOf(driver);
    if (!driver.teamId) { pool.splice(index, 1); continue; }
    const rookie = { id: `rookie-${state.year}-${driver.id}`, name: `新秀${['星禾', '沐川', '映嵐', '知霽'][rng.int(0, 3)]}`,
      nationality: '青穹聯盟', number: 100 + state.year * 20 + index, age: rng.int(18, 21), teamId: driver.teamId,
      stats: Object.fromEntries(STATS.map(k => [k, rng.int(58, 74)])) };
    pool[index] = rookie;
    mail(state, '圍場新聞室', '車手退休消息', `${driver.name} 宣布退休，${rookie.name} 將接替正式席位。`);
  }
  syncPlayer(state);
}

export function endSeason(state) {
  if (state.season.ended) return state;
  requireCondition(state.contract && state.season.results.length === state.season.calendar.length
    && getMediaQuestions(state).length === 0, '請完成整季賽事與採訪後再結算。');
  state.history.push({ year: state.year, driverChampion: copy(state.season.driverStandings[0]),
    teamChampion: copy(state.season.teamStandings[0]), driverStandings: copy(state.season.driverStandings),
    teamStandings: copy(state.season.teamStandings), playerTeamId: state.contract.teamId,
    playerPosition: state.season.driverStandings.find(d => d.carId === state.player.id).position });
  const rng = random(state, 'offseason');
  ageDrivers(state, rng);
  for (const team of state.teams) {
    const rank = state.season.teamStandings.find(t => t.teamId === team.id).position;
    team.carPerformance = clamp(team.carPerformance + rng.int(-3, 3) + (rank >= 7 ? rng.int(0, 3) : 0), 99);
  }
  state.contract.yearsLeft = Math.max(0, state.contract.yearsLeft - 1);
  state.offers = [];
  const current = state.teams.find(t => t.id === state.contract.teamId);
  if (state.teamTrust >= 50) state.offers.push(offer(state, current, 0, { renewal: true }));
  const standing = state.season.driverStandings.find(d => d.carId === state.player.id);
  const performance = standing.points / state.season.calendar.length;
  const eligible = state.teams.filter(t => t.id !== current.id && (t.tier === 'top'
    ? state.player.reputation >= 75 && (standing.position <= 6 || performance >= 8)
    : t.tier === 'mid' ? state.player.reputation >= 40 || performance >= 2 : state.player.reputation >= 15));
  // 洗牌避免固定邀約車隊；合約尚未到期仍可獲得挖角邀約。
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = rng.int(0, i); [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  for (const team of eligible) {
    if (state.offers.length >= 4) break;
    if (rng.chance(0.35 + state.player.reputation / 200)) state.offers.push(offer(state, team, state.offers.length));
  }
  state.season.ended = true;
  mail(state, '經紀人', '賽季結算與合約市場', `本季車手排名第 ${standing.position} 名，目前收到 ${state.offers.length} 份合約。`);
  return state;
}

export function acceptOffer(state, offerId) {
  requireCondition(state.season.ended, '請先完成賽季結算。');
  const selected = state.offers.find(o => o.id === offerId);
  requireCondition(selected && !selected.initial, '找不到這份合約邀約。');
  const oldTeam = state.contract.teamId;
  if (selected.teamId !== oldTeam) {
    const displaced = state.drivers.filter(d => d.teamId === selected.teamId && d.id !== state.player.id).at(-1);
    requireCondition(displaced, '新車隊沒有可交換的席位。');
    displaced.teamId = oldTeam;
    state.teamTrust = 55;
  }
  state.contract = { teamId: selected.teamId, yearsLeft: selected.yearsLeft, salary: selected.salary, role: selected.role };
  state.player.teamId = selected.teamId;
  syncPlayer(state);
  state.offers = [];
  mail(state, '經紀人', '合約簽署完成', `下季將效力${selected.teamName}，合約為期 ${selected.yearsLeft} 年。`);
  return state;
}

export function declineOffers(state) {
  requireCondition(state.season.ended, '目前沒有季末邀約可婉拒。');
  state.offers = [];
  return state;
}

export function startNextSeason(state) {
  requireCondition(state.season.ended && state.contract?.yearsLeft > 0, '請先完成季末結算並確保下季合約有效。');
  state.year++;
  state.offers = [];
  resetSeason(state);
  mail(state, '賽事管理處', '新賽季開始', '積分已歸零，新賽曆已公布。祝你在新賽季一切順利。');
  return state;
}

export function getStandings(state) {
  return {
    drivers: state.season.driverStandings.map(row => ({ position: row.position, carId: row.carId,
      name: row.name, teamId: row.teamId, teamName: state.teams.find(t => t.id === row.teamId)?.name ?? '',
      points: row.points, wins: row.wins, podiums: row.podiums ?? 0, change: row.change ?? 0 })),
    teams: state.season.teamStandings.map(row => ({ position: row.position, teamId: row.teamId,
      name: row.name, points: row.points, wins: row.wins, podiums: row.podiums ?? 0, change: row.change ?? 0 })),
  };
}
