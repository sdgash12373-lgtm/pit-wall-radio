import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { sample, HALF_WIDTH } from './trackPath.js';
import { asphalt, concrete } from './textures.js';
import { makeCrew } from './models.js';

// 主直線右側的維修區（起終點線前後）：維修牆、快車道／工作車道、各車隊 P 房，以及起跑燈架。
// 座標：s 為沿賽道距離（0＝起終點線），lateral 正值為右側。
export const PIT = { from: -320, to: 760, box: 160, wall: 10, fast: 13.2, work: 18.4 };
const ENTRY = 150, EXIT = 170;   // 進站／出站連接路長度（公尺）
const smoothstep = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const relative = (path, s) => { const L = path.L; return ((s + L / 2) % L + L) % L - L / 2; }; // 相對起終點線的距離 [-L/2, L/2)

// 依主直線的實際彎度決定維修區範圍：從起終點線往前後延伸到彎度變大為止。
// from／to 為相對起終點線的距離；entryEnd 起是維修車道（有維修牆），exitStart 起駛回賽道。
export function pitLayout(path) {
  if (path.pitLayout) return path.pitLayout;
  const straight = s => Math.abs(path.curvature(s)) < 1 / 160;
  let back = 0, fwd = 0;
  while (back > -330 && straight(back - 10)) back -= 10;
  while (fwd < 480 && straight(fwd + 10)) fwd += 10;
  const from = Math.min(-200, back), to = Math.max(400, fwd); // 維修區約 0.6～0.8 公里（接近真實）
  return (path.pitLayout = { from, to, entryEnd: from + ENTRY, exitStart: to - EXIT, box: PIT.box });
}

export function inPitZone(path, s) {
  const pit = pitLayout(path), rel = relative(path, s);
  return rel > pit.from - 40 && rel < pit.to + 40;
}

// 維修區路線的橫向位置：進站路從賽道右側平順切入快車道，出站路從快車道併回賽道。
function routeLat(pit, rel, lane, join = 2.6) {
  if (rel < pit.entryEnd) return join + (lane.fast - join) * smoothstep((rel - pit.from) / ENTRY);
  if (rel > pit.exitStart) return lane.fast + (join - lane.fast) * smoothstep((rel - pit.exitStart) / EXIT);
  return lane.fast;
}

function oriented(path, s, lateral, y = 0) {
  const p = sample(path, s, lateral);
  const obj = new THREE.Group();
  obj.position.set(p.x, p.y + y, p.z); obj.rotation.y = -p.heading;
  return obj;
}

// 沿路徑的平面帶（以 4 公尺取樣）；a、b 可為常數或 s → 橫向位置的函式。
function band(path, from, to, a, b, y, material, tileSize = null) {
  const n = Math.max(2, Math.round((to - from) / 4) + 1);
  const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx = [];
  const at = (f, s) => typeof f === 'function' ? f(s) : f;
  for (let i = 0; i < n; i++) {
    const s = from + (to - from) * i / (n - 1), la = at(a, s), lb = at(b, s), p = sample(path, s, la), q = sample(path, s, lb);
    pos.set([p.x, p.y + y, p.z, q.x, q.y + y, q.z], i * 6);
    uv.set(tileSize ? [la / tileSize, s / tileSize, lb / tileSize, s / tileSize] : [0, s / 12, 1, s / 12], i * 4);
    if (i < n - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, material); mesh.receiveShadow = true;
  return mesh;
}

function laneMarkings() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e9ece8'; ctx.fillRect(118, 0, 5, 512);           // 快車道／工作車道分隔線
  ctx.fillStyle = '#f2c300'; for (let y = 0; y < 512; y += 64) ctx.fillRect(132, y, 120, 4); // 工作車道定位線
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Q 版技師：大頭盔（車隊色＋深色面罩）、短身材；pose：'gun' 蹲姿持氣動扳手、'stand' 站姿。
function crewMember(color, pose = 'stand') {
  const g = new THREE.Group();
  const suit = new THREE.MeshPhysicalMaterial({ color, roughness: 0.55, clearcoat: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.6 });
  const visor = new THREE.MeshPhysicalMaterial({ color: '#10141a', roughness: 0.1, metalness: 0.4, clearcoat: 1 });
  const white = new THREE.MeshStandardMaterial({ color: '#f4f5f6', roughness: 0.5 });
  const crouch = pose === 'gun' ? 0.32 : 0;
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m; };
  add(new RoundedBoxGeometry(0.5, 0.5, 0.36, 4, 0.14), suit, 0, 0.82 - crouch, 0);                         // 身體
  add(new RoundedBoxGeometry(0.46, 0.12, 0.34, 3, 0.05), white, 0, 0.98 - crouch, 0);                       // 白色腰帶飾條
  for (const sx of [-1, 1]) add(new THREE.CapsuleGeometry(0.1, pose === 'gun' ? 0.12 : 0.32, 4, 8), dark, sx * 0.13, pose === 'gun' ? 0.32 : 0.36, pose === 'gun' ? 0.12 : 0, pose === 'gun' ? 1.1 : 0); // 腿
  for (const sx of [-1, 1]) add(new THREE.CapsuleGeometry(0.075, 0.26, 4, 8), suit, sx * 0.3, 0.86 - crouch, 0.16, -1.1, 0, sx * 0.25);   // 手臂前伸
  const head = add(new THREE.SphereGeometry(0.34, 20, 16), suit, 0, 1.38 - crouch, 0);                       // 大頭盔
  head.scale.set(1, 0.95, 1.02);
  add(new THREE.SphereGeometry(0.3, 18, 12, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.32, Math.PI * 0.3), visor, 0, 1.36 - crouch, 0.06); // 面罩
  add(new THREE.BoxGeometry(0.5, 0.06, 0.06), white, 0, 1.6 - crouch, 0.15);                                  // 頭盔飾條
  let gun = null;
  if (pose === 'gun') {
    gun = add(new THREE.CylinderGeometry(0.07, 0.07, 0.42, 10), dark, 0, 0.8 - crouch, 0.42, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 12), new THREE.MeshStandardMaterial({ color: '#f2c300', roughness: 0.4 }), 0, 0.8 - crouch, 0.66, Math.PI / 2);
  }
  g.userData.gun = gun ?? head;
  return g;
}

export function buildTrackside(path, teams, playerTeamId, street) {
  const group = new THREE.Group();
  const wallLat = street ? 9.2 : PIT.wall;
  const laneMat = new THREE.MeshStandardMaterial({ map: asphalt(false, { lines: false }), roughness: 0.85 });
  const markingMat = new THREE.MeshStandardMaterial({ map: laneMarkings(), transparent: true, alphaTest: 0.3, depthWrite: false, roughness: 0.75 });
  const wallMat = new THREE.MeshStandardMaterial({ map: concrete(), roughness: 0.9 });
  // BoxGeometry has per-face 0..1 UVs; project each face into metres.
  const wallGeo = new THREE.BoxGeometry(0.6, 1.1, 6.02);
  const { position, normal, uv } = wallGeo.attributes;
  for (let i = 0; i < uv.count; i++) {
    const xFace = Math.abs(normal.getX(i)) > 0.5, yFace = Math.abs(normal.getY(i)) > 0.5;
    uv.setXY(i, (xFace ? position.getZ(i) : position.getX(i)) / 2.71,
      (yFace ? position.getZ(i) : position.getY(i)) / 2.71);
  }
  const pit = pitLayout(path), lane = { fast: wallLat + 3.2, work: wallLat + 8.6 };
  const first = path.s0 + 4, last = path.s0 + (path.count - 2) * 2;
  // 相對起終點線的區間 → 路徑上的絕對 s 區間。封閉賽道（真實座標）只建一份並在起終點線處接合；
  // 舊的開放路徑沿用「一圈前後兩份」，讓鏡頭跨圈時看得到同一個維修區。
  const spans = (ra, rb) => {
    const list = path.closed
      ? [[path.L + ra, path.L + Math.min(rb, 0)], [Math.max(ra, 0), rb]]
      : [[ra, rb], [ra + path.L, rb + path.L]];
    return list.filter(([a, b]) => b - a > 1 && a >= first && b <= last);
  };
  const abs = rel => (path.closed && rel < 0 ? rel + path.L : rel);
  const routeAt = s => routeLat(pit, relative(path, s), lane);
  // 進站路（賽道右側切入）→ 維修車道（快車道＋工作車道）→ 出站路（併回賽道）
  for (const [a, b] of spans(pit.from, pit.entryEnd)) group.add(band(path, a, b,
    s => Math.min(wallLat + 0.6, Math.max(HALF_WIDTH - 1, routeAt(s) - 3.4)),
    s => Math.max(routeAt(s) + 3.4, HALF_WIDTH + 3 + (wallLat + 10 - HALF_WIDTH) * smoothstep((relative(path, s) - pit.from) / ENTRY) ** 1.5), 0.03, laneMat, 5));
  for (const [a, b] of spans(pit.exitStart, pit.to)) group.add(band(path, a, b,
    s => Math.min(wallLat + 0.6, Math.max(HALF_WIDTH - 1, routeAt(s) - 3.4)),
    s => Math.max(routeAt(s) + 3.4, wallLat + 13 - (wallLat + 10 - HALF_WIDTH) * smoothstep((relative(path, s) - pit.exitStart) / EXIT) ** 1.5), 0.03, laneMat, 5));
  for (const [a, b] of spans(pit.entryEnd, pit.exitStart)) {
    group.add(band(path, a, b, wallLat + 0.6, wallLat + 13, 0.03, laneMat, 5));
    group.add(band(path, a, b, wallLat + 0.6, wallLat + 13, 0.045, markingMat));
    // 維修牆（只在維修車道旁；進出站路段留開口）
    for (let s = a; s + 6 <= b + 0.01; s += 6) {
      const seg = oriented(path, s + 3, wallLat, 0.55);
      const block = new THREE.Mesh(wallGeo, wallMat); block.castShadow = true; block.receiveShadow = true;
      seg.add(block); group.add(seg);
    }
  }
  // 維修牆兩端的黃黑緩衝頭
  const noseMat = new THREE.MeshStandardMaterial({ color: '#f2c300', roughness: 0.55 });
  for (const rel of [pit.entryEnd, pit.exitStart]) {
    const s = abs(rel); if (s < first || s > last) continue;
    const nose = oriented(path, s, wallLat, 0.6);
    nose.add(new THREE.Mesh(new RoundedBoxGeometry(0.9, 1.2, 2.2, 3, 0.3), noseMat)); group.add(nose);
  }
  // P 房建築：一排車隊車庫
  const building = new THREE.MeshStandardMaterial({ color: '#c9ced3', roughness: 0.6, metalness: 0.2 });
  const interior = new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.9 });
  const garageW = 14;
  for (const offset of path.closed ? [0] : [0, path.L]) teams.forEach((team, i) => {
    const s = abs(pit.box - garageW * 4 + i * garageW + garageW / 2) + offset;
    if (s < first || s > last) return;
    const box = oriented(path, s, wallLat + 13 + 7);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(14, 7.5, garageW), building); shell.position.y = 3.75; shell.receiveShadow = true;
    const open = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.6, garageW - 2), interior); open.position.set(-7, 2.3, 0);
    const brand = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.1, garageW - 1), new THREE.MeshStandardMaterial({ color: team.color, roughness: 0.5, emissive: team.color, emissiveIntensity: team.id === playerTeamId ? 0.25 : 0.05 }));
    brand.position.set(-7.1, 5.5, 0);
    box.add(shell, open, brand); group.add(box);
  });
  for (const offset of path.closed ? [0] : [0, path.L]) {
    if (offset + 2 < first || offset + 2 > last) continue;
    // 起跑燈架（起終點線上方）
    const gantry = oriented(path, offset + 2, 0, 0);
    const beamMat = new THREE.MeshStandardMaterial({ color: '#1d2024', roughness: 0.5, metalness: 0.6 });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(24, 0.6, 0.6), beamMat); beam.position.y = 7.2;
    for (const side of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7.5, 0.5), beamMat); post.position.set(side * 12, 3.75, 0); gantry.add(post); }
    gantry.add(beam);
    const lamps = [];
    for (let i = 0; i < 5; i++) {
      const pod = new THREE.Mesh(new RoundedBoxGeometry(0.7, 1.5, 0.35, 3, 0.08), beamMat); pod.position.set(-2.4 + i * 1.2, 6.1, 0.3);
      gantry.add(pod);
      for (const y of [0.35, -0.2]) {
        const mat = new THREE.MeshStandardMaterial({ color: '#2a0505', emissive: '#ff1a10', emissiveIntensity: 0 });
        const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.2, 18), mat); lamp.position.set(0, y, 0.18); lamp.rotation.y = 0;
        pod.add(lamp); lamps.push({ mat, column: i });
      }
    }
    // 燈架朝向來車（-z 前進方向，燈面要朝 +z）
    group.add(gantry);
    group.userData.lamps = (group.userData.lamps ?? []).concat(lamps);
  }
  // 自家 P 房的技師（進站時才顯示）
  const team = teams.find(t => t.id === playerTeamId);
  const crew = new THREE.Group(); crew.visible = false;
    // [x, z, 姿勢, 面向]：前輪兩側各一名持扳手＋一名換胎；車頭前方千斤頂與指揮員；後輪組在鏡頭後方。
  const spots = [[-1.35, -2.1, 'gun', Math.PI / 2], [1.35, -2.1, 'gun', -Math.PI / 2], [-1.8, -2.75, 'stand', Math.PI / 2.4], [1.8, -2.75, 'stand', -Math.PI / 2.4],
    [-1.75, -1.45, 'stand', Math.PI / 1.7], [1.75, -1.45, 'stand', -Math.PI / 1.7], [0, -4.6, 'stand', 0], [-0.9, -5.4, 'stand', 0.3],
    [-1.35, 1.75, 'gun', Math.PI / 2], [1.35, 1.75, 'gun', -Math.PI / 2]];
  // 有 Tripo 技師模型時改用模型（約 1.6 公尺高），否則使用程式產生的 Q 版技師。
  const crewOf = pose => { const model = makeCrew(team?.color ?? '#cccccc'); if (!model) return crewMember(team?.color ?? '#cccccc', pose); const m = new THREE.Group(); model.scale.setScalar(1.35); m.add(model); m.userData.gun = model; return m; };
  const members = spots.map(([x, z, pose, ry]) => { const m = crewOf(pose); m.position.set(x, 0, z); m.rotation.y = ry; crew.add(m); return m; });
  group.add(crew);
  return {
    group, crew, members, lamps: group.userData.lamps, wallLat,
    // 各車隊 P 房中心的 s 位置（與車庫排列一致）
    boxFor(teamId) { const i = Math.max(0, teams.findIndex(t => t.id === teamId)); return pit.box - 14 * 4 + i * 14 + 7; },
    lane, pit,
    // 維修區路線上 s 處的橫向位置（進站路、快車道、出站路）
    routeLat(s) { return routeLat(pit, relative(path, s), lane); },
    relative(s) { return relative(path, s); },
    placeCrew(s) {
      const p = sample(path, s, wallLat + 8.6);
      crew.position.set(p.x, p.y, p.z); crew.rotation.y = -p.heading; crew.visible = true;
    },
    setLights(count) { for (const l of this.lamps) l.mat.emissiveIntensity = l.column < count ? 6 : 0; },
  };
}
