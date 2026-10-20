export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function lapTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const ms = Math.round(seconds * 1000);
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
export const gap = value => Number.isFinite(value) ? `+${value.toFixed(2)} 秒` : '—';
export const roles = { lead: '主力車手', second: '二號車手', equal: '平等競爭' };
export const stats = { pace: '速度', racecraft: '攻防', tyreMgmt: '輪胎管理', wet: '雨戰', consistency: '穩定性', composure: '冷靜' };
export const modes = { normal: '正常', push: '加速', conserve: '保胎' };
export const decisionTypes = { overtake: '超車', defend: '防守', pit_window: '進站窗口', weather: '天氣', safety_car: '安全車', damage: '車損', team_order: '車隊指令' };
export const choiceLabels = { bold: '內線晚煞車', outside: '外線交叉', hold: '留在尾流／保住名次', hard: '強硬守內線', normal: '正常防守', yield: '放行保胎', pit: '本圈進站', push: '加速一圈', extend: '保胎延長', obey: '接受車隊安排', refuse: '拒絕交換', negotiate: '爭取一圈／維持順位', stay: '留在場上', conserve: '保胎並暖胎', wait: '慢一圈觀察', gamble: '維持速度賭天氣', repair: '進站處理車損', manage: '降低速度帶回', risk: '全力推進' };
