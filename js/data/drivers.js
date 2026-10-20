import { TEAMS } from './teams.js';

const names = ['洛祈衡', '伊澤嵐', '柯星澤', '芮映川', '祁望野', '莫晴舟', '蘇亦帆', '白聿森', '裴知夏', '黎遠岑', '安沐河', '尹曜辰', '池書航', '溫予澈', '邵南風', '季牧雲', '容以山', '封景澄', '楚言溪', '桑聞雨'];
const nations = ['霽嶼聯邦', '璃原共和國', '星灣公國', '嵐川王國', '青穹聯盟'];
export const DRIVERS = names.map((name, i) => ({
  id: `driver-${i + 1}`, name, nationality: nations[i % nations.length], number: i + 11,
  teamId: TEAMS[Math.floor(i / 2)].id, age: 21 + (i * 7 % 15),
  stats: {
    pace: 94 - Math.floor(i / 2) * 2 - i % 2 * 3,
    racecraft: 78 + i * 7 % 20, tyreMgmt: 77 + i * 3 % 20,
    wet: 74 + i * 11 % 24, consistency: 82 + i * 5 % 16, composure: 79 + i * 7 % 19,
  },
}));
