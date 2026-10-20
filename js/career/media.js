const choices = () => [
  { id: 'team', label: '感謝車隊，我們會一起把細節做好。', effects: { reputation: 1, teamTrust: 3, morale: 1 } },
  { id: 'ambition', label: '我有能力爭取更好的成績，也會繼續證明自己。', effects: { reputation: 3, teamTrust: -1, morale: 3 } },
  { id: 'criticism', label: '今天的合作還不夠好，我希望車隊拿出改善。', effects: { reputation: -2, teamTrust: -5, morale: -1 } },
];

// 優先採訪爭議，再依賽果與隊友比較補足題目。
export function makeMediaQuestions({ year, round, result, teammate, decisions }) {
  const topics = [];
  const refused = decisions.some(d => d.type === 'team_order'
    && /refuse|reject|ignore|disobey|拒絕/.test(d.choiceId ?? ''));
  if (refused) topics.push(['orders', '你在比賽中沒有服從車隊指令，會如何向車隊解釋？']);
  if (result.status === 'dnf') topics.push(['dnf', '這次退賽對你的信心有什麼影響？']);
  else if (result.position === 1) topics.push(['win', '恭喜奪冠！今天獲勝的關鍵是什麼？']);
  if (teammate && teammate.position < result.position) topics.push(['teammate', '隊友今天排在你前面，你認為差距在哪裡？']);
  if (topics.length < 2) topics.push(['review', result.position <= 10 && result.status !== 'dnf'
    ? '今天拿到積分，下一站的目標是什麼？' : '這場比賽讓你學到什麼，接下來會如何調整？']);
  return topics.slice(0, 2).map(([topic, question]) => ({
    id: `media-${year}-${round}-${topic}`, question, choices: choices(),
  }));
}
