import * as THREE from 'three';
import { DS, HALF_WIDTH, sample, seeded } from './trackPath.js';
import * as tex from './textures.js';
import { inPitZone } from './trackside.js';

const KERB_K = 0.0028; // 曲率超過此值的路段加上路肩

// 沿路徑生成帶狀幾何：from~to 公尺、橫向 a~b（正值為右側）、高度偏移 y。
function strip(path, from, to, a, b, y = 0, vLength = 10, uMode = 'across', groundHeight = null) {
  const n = Math.max(2, Math.round((to - from) / DS) + 1);
  const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), idx = [];
  for (let i = 0; i < n; i++) {
    const s = from + (to - from) * i / (n - 1);
    const p = sample(path, s, a), q = sample(path, s, b);
    const ground = groundHeight ? groundHeight(s, Math.max(Math.abs(a), Math.abs(b))) : null;
    pos.set([p.x, ground === null ? p.y + y : Math.min(p.y+y,ground), p.z, q.x, ground === null ? q.y + y : Math.min(q.y+y,ground), q.z], i * 6);
    const v = s / vLength;
    if (uMode === 'meters') uv.set([a / vLength, v, b / vLength, v], i * 4);
    else if (uMode === 'across') uv.set([0, v, 1, v], i * 4); else uv.set([v, 0, v, 1], i * 4);
    if (i < n - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } // 正面朝上
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// 沿路徑生成垂直牆面（護欄、防護網）。
function wall(path, from, to, lateral, y0, y1, uLength, vLength = y1 - y0) {
  const n = Math.max(2, Math.round((to - from) / (DS * 2)) + 1);
  const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), idx = [];
  for (let i = 0; i < n; i++) {
    const s = from + (to - from) * i / (n - 1);
    const p = sample(path, s, lateral);
    pos.set([p.x, p.y + y0, p.z, p.x, p.y + y1, p.z], i * 6);
    uv.set([s / uLength, 0, s / uLength, (y1 - y0) / vLength], i * 4);
    if (i < n - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function runs(path, predicate) {
  const result = []; let start = null;
  const end = path.closed ? path.L : path.s0 + (path.count - 1) * DS;
  const from = path.closed ? 0 : path.s0;
  for (let s = from; s <= end; s += DS) {
    const on = predicate(s);
    if (on && start === null) start = s;
    if ((!on || s + DS > end) && start !== null) { const last = path.closed && !on ? s-DS : s; if (last - start > 8) result.push([start, last]); start = null; }
  }
  return result;
}

function fenceTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d'); ctx.strokeStyle = '#c9ced2'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(64, 64); ctx.moveTo(64, 0); ctx.lineTo(0, 64); ctx.stroke();
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 18); t.anisotropy = 4;
  return t;
}

// Segment grid rather than point-only tests, so clearance includes spaces
// between samples. Ignore the local 150 m by cyclic distance at the projection.
export function createTrackIndex(path) {
  const cell=20, grid=new Map(), key=(x,z)=>x+','+z;
  const n=Math.ceil(path.L/DS), step=path.L/n;
  if (path.closed) for (let i=0; i<n; i++) {
    const a=sample(path,i*step), b=sample(path,(i+1)*step);
    const segment={a,b,s:i*step};
    for (let x=Math.floor(Math.min(a.x,b.x)/cell); x<=Math.floor(Math.max(a.x,b.x)/cell); x++)
      for (let z=Math.floor(Math.min(a.z,b.z)/cell); z<=Math.floor(Math.max(a.z,b.z)/cell); z++) {
        const k=key(x,z); if (!grid.has(k)) grid.set(k,[]); grid.get(k).push(segment);
      }
  }
  function visit(x,z,radius,fn) {
    const seen=new Set();
    for (let cx=Math.floor((x-radius)/cell); cx<=Math.floor((x+radius)/cell); cx++)
      for (let cz=Math.floor((z-radius)/cell); cz<=Math.floor((z+radius)/cell); cz++)
        for (const segment of grid.get(key(cx,cz)) ?? []) {
          if (seen.has(segment)) continue; seen.add(segment);
          const {a,b}=segment, dx=b.x-a.x, dz=b.z-a.z;
          const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz || 1)));
          if (Math.hypot(x-a.x-t*dx,z-a.z-t*dz)<=radius && fn(segment,t)) return true;
        }
    return false;
  }
  return {
    nearOtherTrack(x,z,s,clearance) {
      if (!path.closed) return false;
      const local=((s%path.L)+path.L)%path.L;
      return visit(x,z,clearance,(seg,t)=> {
        const d=Math.abs(seg.s+t*step-local);
        return Math.min(d,path.L-d)>150;
      });
    },
    // Wide terrain strips must also stay below a nearby lower section of road.
    groundHeight(s,radius) {
      const p=sample(path,s); let y=p.y;
      visit(p.x,p.z,radius+HALF_WIDTH+4,(seg)=> { y=Math.min(y,seg.a.y,seg.b.y); return false; });
      return y-0.2;
    },
  };
}

export function buildWorld(path, track, wet) {
  const group = new THREE.Group();
  const start = path.closed ? 0 : path.s0, end = path.closed ? path.L : path.s0 + (path.count - 1) * DS;
  const { nearOtherTrack, groundHeight } = createTrackIndex(path);
  const terrainHeight = path.closed ? groundHeight : null;
  const street = track.character === 'street';
  const rnd = seeded(`${track.id}:scenery`);

  // 路面
  const asphaltMap = tex.asphalt(wet, { lines: false });
  const roadMat = new THREE.MeshStandardMaterial({ map: asphaltMap, color: wet ? '#9aa3ad' : '#ffffff', roughness: wet ? 0.18 : 0.85, metalness: wet ? 0.15 : 0, envMapIntensity: wet ? 1.6 : 0.3 });
  const road = new THREE.Mesh(strip(path, start, end, -HALF_WIDTH, HALF_WIDTH, 0.02, 24), roadMat);
  road.receiveShadow = true; group.add(road);
  // Painted markings survive both the canvas fallback and the PBR replacement.
  const lineMat = new THREE.MeshStandardMaterial({ color: '#e9ece8', roughness: wet ? 0.28 : 0.75 });
  for (const side of [-1, 1]) {
    const edge = side * (HALF_WIDTH - 0.3);
    const line = new THREE.Mesh(strip(path, start, end, edge - 0.1, edge + 0.1, 0.035), lineMat);
    line.receiveShadow = true; group.add(line);
  }

  // 路肩（彎道路段兩側）
  const kerbMat = new THREE.MeshStandardMaterial({ map: tex.kerb(), roughness: wet ? 0.3 : 0.7 });
  for (const [a, b] of runs(path, s => Math.abs(path.curvature(s)) > KERB_K)) {
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(strip(path, a, b, side < 0 ? -HALF_WIDTH - 1.3 : HALF_WIDTH, side < 0 ? -HALF_WIDTH : HALF_WIDTH + 1.3, 0.05, 6), kerbMat);
      m.receiveShadow = true; group.add(m);
    }
  }

  // 草地、碎石區（彎道外側）或街道人行道
  if (street) {
    const pave = new THREE.MeshStandardMaterial({ map: tex.concrete(), roughness: 0.85 });
    for (const side of [-1, 1]) {
      const a = Math.min(side * HALF_WIDTH, side * 9), b = Math.max(side * HALF_WIDTH, side * 9);
      const sidewalk = new THREE.Mesh(strip(path, start, end, a, b, 0.01, 2.71, 'meters', terrainHeight), pave);
      sidewalk.receiveShadow = true; group.add(sidewalk);
    }
  } else {
    const grassMat = new THREE.MeshStandardMaterial({ map: tex.grass(wet), roughness: 1 });
    grassMat.map.repeat.set(1, 1);
    for (const side of [-1, 1]) {
      const g = new THREE.Mesh(strip(path, start, end, side < 0 ? -160 : HALF_WIDTH, side < 0 ? -HALF_WIDTH : 160, -0.03, 16, 'meters', terrainHeight), grassMat);
      g.receiveShadow = true; group.add(g);
    }
    const gravelMat = new THREE.MeshStandardMaterial({ map: tex.gravel(), roughness: 1 });
    gravelMat.map.repeat.set(1, 1);
    for (const [a, b] of runs(path, s => Math.abs(path.curvature(s + 30)) > 0.006)) {
      const side = Math.sign(path.curvature(a + 20)) > 0 ? -1 : 1; // 彎道外側
      const runoff = new THREE.Mesh(strip(path, a, path.closed ? Math.min(end,b+40) : b+40, side < 0 ? -26 : HALF_WIDTH + 1.4, side < 0 ? -HALF_WIDTH - 1.4 : 26, path.closed ? -0.04 : 0, 6, 'meters', terrainHeight), gravelMat);
      runoff.receiveShadow = true; group.add(runoff);
    }
  }

  // 護欄＋廣告牌＋防護網
  const barrier = street ? 9.2 : 27;
  const boardMap = tex.billboards();
  const boardMat = new THREE.MeshStandardMaterial({ map: boardMap, roughness: 0.6, side: THREE.DoubleSide });
  const barrierMat = new THREE.MeshStandardMaterial({ map: tex.concrete(), roughness: wet ? 0.65 : 0.9, side: THREE.DoubleSide });
  const fenceMat = new THREE.MeshStandardMaterial({ map: fenceTexture(), color: '#aab0b6', transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 });
  const postMat = new THREE.MeshStandardMaterial({ color: '#7d848a', metalness: 0.7, roughness: 0.4 });
  // 右側護欄在維修區範圍讓給維修牆與 P 房。
  const barrierRuns = side => {
    if (!path.closed) return side < 0 ? [[start,end]] : runs(path,s=>!inPitZone(path,s));
    return runs(path,s=> {
      if (side>0 && inPitZone(path,s)) return false;
      const p=sample(path,s,side*barrier);
      // Two-meter buffer covers interpolation and all three wall offsets.
      return !nearOtherTrack(p.x,p.z,s,HALF_WIDTH+3+2);
    });
  };
  for (const side of [-1, 1]) for (const [a, b] of barrierRuns(side)) {
    const w = new THREE.Mesh(wall(path, a, b, side * barrier, 0, 1.15, 2.71, 2.71), barrierMat);
    w.castShadow = true; w.receiveShadow = true; group.add(w);
    for (let s = a; s < b; s += 140) {
      const board = new THREE.Mesh(wall(path, s, Math.min(s + 45, b), side * (barrier - 0.02), 0.3, 1.05, 45), boardMat);
      board.receiveShadow = true; group.add(board);
    }
    const top = new THREE.Mesh(wall(path, a, b, side * (barrier + 0.05), 1.15, street ? 4.2 : 3.6, 3), fenceMat);
    group.add(top);
  }
  const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 3.6, 6);
  const postCount = Math.ceil((end - start) / 12) * 2;
  const posts = new THREE.InstancedMesh(postGeo, postMat, postCount);
  const m4 = new THREE.Matrix4(); let pi = 0;
  for (let s = start; s < end && pi < postCount - 1; s += 12) for (const side of [-1, 1]) {
    if (side > 0 && inPitZone(path, s)) continue;
    const p = sample(path, s, side * (barrier + 0.1));
    if (nearOtherTrack(p.x,p.z,s,HALF_WIDTH+3)) continue;
    m4.makeTranslation(p.x, p.y + 1.8, p.z); posts.setMatrixAt(pi++, m4);
  }
  posts.count = pi; group.add(posts);

  // 看台（卡通風）：階梯座位＋Q 版觀眾＋白色弧形頂棚，依週期位置放在直線路段旁。
  const frameMat = new THREE.MeshStandardMaterial({ color: '#8f9aa6', roughness: 0.55, metalness: 0.2 });
  const seatMat = new THREE.MeshStandardMaterial({ color: '#4d6fb5', roughness: 0.6 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.35, side: THREE.DoubleSide });
  const bodyGeo = new THREE.CylinderGeometry(0.2, 0.26, 0.6, 7), headGeo = new THREE.IcosahedronGeometry(0.2, 1);
  const fanMat = new THREE.MeshStandardMaterial({ roughness: 0.7 }), skinMat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
  const shirt = ['#e8323c', '#ffffff', '#f6c21b', '#2f7fe0', '#e8323c', '#2fb36a', '#ff8a1f', '#7a4fd6', '#e8323c', '#1b1d22'];
  const skin = ['#f6d3b3', '#e9b48c', '#c98a5b', '#8d5a3b', '#f2c9a0'];
  const standEvery = street ? 260 : 300;
  for (let base = Math.floor(start / standEvery) * standEvery; base < end; base += standEvery) {
    const local = ((base % path.L) + path.L) % path.L;
    const r = seeded(`${track.id}:stand:${Math.round(local)}`);
    const sMid = base + r() * 80;
    if (Math.abs(path.curvature(sMid)) > 0.003 || sMid < start + 40 || sMid > end - 40) continue;
    const side = inPitZone(path, sMid) ? -1 : r() < 0.5 ? -1 : 1; // 主看台在維修區對面
    const len = 60 + r() * 50, rows = 9, rowDepth = 1.5, rowRise = 1.05;
    const p = sample(path, sMid, side * (barrier + 4));
    // Bound the complete stand (roof, seats and rear columns), not just its origin.
    const footprint=Math.hypot(len/2+2,rows*rowDepth+4);
    if (nearOtherTrack(p.x,p.z,sMid,HALF_WIDTH+8+footprint)) continue;
    const stand = new THREE.Group();
    // 階梯座位（面向賽道 +z）
    for (let row = 0; row < rows; row++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(len, 0.35, rowDepth), row % 2 ? seatMat : frameMat);
      step.position.set(0, 0.9 + row * rowRise, -row * rowDepth); step.receiveShadow = true; stand.add(step);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(len, rows * rowRise + 3, 0.5), frameMat); back.position.set(0, (rows * rowRise + 3) / 2, -rows * rowDepth); stand.add(back);
    // Q 版觀眾
    const perRow = Math.floor(len / 1.1), total = perRow * rows;
    const bodies = new THREE.InstancedMesh(bodyGeo, fanMat, total), heads = new THREE.InstancedMesh(headGeo, skinMat, total);
    const m = new THREE.Matrix4(), c = new THREE.Color(); let k = 0;
    for (let row = 0; row < rows; row++) for (let i = 0; i < perRow; i++) {
      if (r() < 0.12) continue;
      const x = -len / 2 + 0.6 + i * 1.1 + (r() - 0.5) * 0.2, y = 0.9 + row * rowRise + 0.18, z = -row * rowDepth + 0.1;
      const cheer = r() < 0.15 ? 0.25 : 0;
      m.makeTranslation(x, y + 0.3 + cheer, z); bodies.setMatrixAt(k, m); bodies.setColorAt(k, c.set(shirt[Math.floor(r() * shirt.length)]));
      m.makeTranslation(x, y + 0.82 + cheer, z); heads.setMatrixAt(k, m); heads.setColorAt(k, c.set(skin[Math.floor(r() * skin.length)]));
      k++;
    }
    bodies.count = heads.count = k; bodies.computeBoundingSphere(); heads.computeBoundingSphere();
    stand.add(bodies, heads);
    // 白色弧形頂棚（一段段拱頂）
    const arcs = Math.max(3, Math.round(len / 14)), arcW = len / arcs, roofY = rows * rowRise + 4.5;
    for (let i = 0; i < arcs; i++) {
      const arc = new THREE.Mesh(new THREE.CylinderGeometry(arcW / 2, arcW / 2, rows * rowDepth + 4, 18, 1, true, -Math.PI / 2, Math.PI), roofMat);
      arc.rotation.x = Math.PI / 2; arc.rotation.z = Math.PI / 2; arc.scale.set(1, 1, 0.35);
      arc.position.set(-len / 2 + arcW * (i + 0.5), roofY, -rows * rowDepth / 2 + 1); arc.castShadow = true; stand.add(arc);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, roofY, 8), frameMat);
      col.position.set(-len / 2 + arcW * i, roofY / 2, -rows * rowDepth + 0.4); stand.add(col);
    }
    stand.position.set(p.x, p.y, p.z);
    stand.rotation.y = -p.heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
    group.add(stand);
  }

  // 遠景：樹林或街道建築
  if (street) {
    const mats = [0, 1, 2, 3].map(i => new THREE.MeshStandardMaterial({ map: tex.building(seeded(`b${i}`)), roughness: 0.8 }));
    const box = new THREE.BoxGeometry(1, 1, 1);
    const per = mats.map(m => new THREE.InstancedMesh(box, m, Math.ceil((end - start) / 18) + 4));
    const counts = per.map(() => 0);
    for (let s = start; s < end; s += 18) {
      const r = seeded(`${track.id}:bld:${Math.round(((s % path.L) + path.L) % path.L)}`);
      for (const side of [-1, 1]) {
        if (r() < 0.15 || side > 0 && inPitZone(path, s)) continue;
        const w = 14 + r() * 12, h = 10 + r() * 35, d = 14 + r() * 10;
        const p = sample(path, s, side * (13 + d / 2 + r() * 4));
        if (nearOtherTrack(p.x,p.z,s,HALF_WIDTH+8+Math.hypot(w,d)/2)) continue;
        const k = Math.floor(r() * per.length);
        if (counts[k] >= per[k].count) continue;
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -p.heading);
        m4.compose(new THREE.Vector3(p.x, p.y + h / 2, p.z), q, new THREE.Vector3(w, h, d));
        per[k].setMatrixAt(counts[k]++, m4);
      }
    }
    per.forEach((mesh, i) => { mesh.count = counts[i]; mesh.castShadow = true; group.add(mesh); });
  } else {
    // 卡通樹：2~3 顆圓球組成的樹冠，每棵綠色深淺不同。
    const leaves = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    const trunk = new THREE.MeshStandardMaterial({ color: '#8a5a34', roughness: 1 });
    const crownGeo = new THREE.IcosahedronGeometry(1, 2), trunkGeo = new THREE.CylinderGeometry(0.3, 0.42, 1, 7);
    const max = Math.ceil((end - start) / 9) * 2;
    const crowns = new THREE.InstancedMesh(crownGeo, leaves, max * 3), trunks = new THREE.InstancedMesh(trunkGeo, trunk, max);
    let n = 0, cn = 0; const q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
    const greens = wet ? ['#3f8a37', '#4b9a3e', '#367a30'] : ['#4fb544', '#62c94f', '#3fa03b', '#7dd35a'];
    for (let s = start; s < end; s += 9) {
      const r = seeded(`${track.id}:tree:${Math.round(((s % path.L) + path.L) % path.L)}`);
      for (const side of [-1, 1]) {
        if (r() < 0.35 || side > 0 && inPitZone(path, s)) continue;
        const lat = side * (barrier + 14 + r() * 110);
        const treeS=path.closed ? Math.min(end,s+r()*8) : s+r()*8;
        const p = sample(path, treeS, lat);
        const h = 5 + r() * 5, w = 2.6 + r() * 2;
        if (nearOtherTrack(p.x,p.z,treeS,HALF_WIDTH+8+w*2.1)) continue;
        v.set(p.x, p.y + h * 0.3, p.z); sc.set(1, h * 0.6, 1); q.identity();
        m4.compose(v, q, sc); trunks.setMatrixAt(n++, m4);
        const blobs = 2 + Math.floor(r() * 2), shade = greens[Math.floor(r() * greens.length)];
        for (let b = 0; b < blobs; b++) {
          const rr = w * (0.75 + r() * 0.4);
          v.set(p.x + (r() - 0.5) * w * 0.9, p.y + h * 0.7 + b * w * 0.55, p.z + (r() - 0.5) * w * 0.9); sc.set(rr, rr * 0.92, rr);
          m4.compose(v, q, sc); crowns.setMatrixAt(cn, m4); crowns.setColorAt(cn, col.set(shade).offsetHSL(0, 0, (r() - 0.5) * 0.08)); cn++;
        }
      }
    }
    crowns.count = cn; trunks.count = n; crowns.castShadow = true;
    group.add(crowns, trunks);
  }
  void rnd;
  return group;
}
