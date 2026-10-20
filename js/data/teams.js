// 性能落差對應約每圈一秒，保留策略與車手發揮空間。
const roster = [
  ['aurora', '極光競速', '極光', '#63e6d8', 94, 94, 95, 'top', '林霽川', '陳以澄'],
  ['ember', '燼火車隊', '燼火', '#ff684b', 92, 92, 93, 'top', '岳承熙', '葉晴嵐'],
  ['astral', '星弧動力', '星弧', '#9d8cff', 89, 93, 91, 'top', '許望舒', '方知遠'],
  ['tide', '潮汐競技', '潮汐', '#479dff', 85, 91, 88, 'mid', '沈若海', '江映荷'],
  ['cedar', '青杉車隊', '青杉', '#56bd74', 82, 94, 86, 'mid', '梁青禾', '宋允辰'],
  ['copper', '銅羽賽車', '銅羽', '#d59665', 79, 90, 85, 'mid', '馮岱岳', '魏書寧'],
  ['quartz', '晶脈動力', '晶脈', '#e6badf', 76, 92, 83, 'mid', '紀詠棠', '唐見秋'],
  ['dune', '沙嶺競速', '沙嶺', '#e9c855', 72, 89, 81, 'back', '夏遠舟', '莊沐言'],
  ['mist', '霧港車隊', '霧港', '#a4bec7', 68, 91, 80, 'back', '杜蘊星', '何予安'],
  ['lark', '雲雀競技', '雲雀', '#75b9ee', 64, 90, 78, 'back', '程慕青', '羅景和'],
];
export const TEAMS = roster.map(([id, name, shortName, color, carPerformance, reliability, pitCrew, tier, principal, engineer]) =>
  ({ id, name, shortName, color, carPerformance, reliability, pitCrew, tier, principal, engineer }));
