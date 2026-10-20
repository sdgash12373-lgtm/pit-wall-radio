import { CIRCUITS } from '../../data/circuits.js';
// 3D 座艙用的賽道路徑：依賽道特性產生曲率序列、積分出中心線，並計算擬真的速度曲線。
// 純數學、不依賴 three.js，可在 Node 測試。
// 路徑以「週期」設計：曲率 k(s) 以 L 為週期，因此鏡頭在 s 超過 L 時可無縫跳回 s-L。

export const DS = 2;            // 取樣間距（公尺）
export const HALF_WIDTH = 6;    // 路面半寬
const PRE = 300, POST = 900;    // 路徑在一圈前後多延伸的長度

function hashString(text) {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function seeded(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRESETS = {
  street:       { straight: [70, 320],  radius: [18, 60],   angle: [70, 100], length: 4200 },
  'high-speed': { straight: [350, 950], radius: [120, 420], angle: [25, 110], length: 5600 },
  technical:    { straight: [90, 380],  radius: [35, 130],  angle: [40, 160], length: 4600 },
  balanced:     { straight: [180, 700], radius: [40, 260],  angle: [35, 150], length: 5000 },
};

// 真實賽道：依 layout（直線／彎道，從起終點線開始）轉成曲率段落。k > 0 為右彎。
function layoutPieces(layout) {
  return layout.map(p => p.type === 'corner'
    ? { len: Math.max(1, p.radius * p.angle * Math.PI / 180), k: (p.dir === 'R' ? 1 : -1) / Math.max(5, p.radius) }
    : { len: Math.max(1, p.length), k: 0 });
}

// 無 layout 時的備援：直線與彎道交替的隨機賽道。
function pieces(track) {
  if (Array.isArray(track.layout) && track.layout.length) return layoutPieces(track.layout);
  const rnd = seeded(`${track.id}:layout`);
  const p = PRESETS[track.character] ?? PRESETS.balanced;
  const pick = ([a, b]) => a + (b - a) * rnd();
  const list = [];
  let total = 0, dir = rnd() < 0.5 ? 1 : -1;
  while (total < p.length - 400) {
    const straight = pick(p.straight);
    list.push({ len: straight, k: 0 }); total += straight;
    const chicane = track.character !== 'high-speed' && rnd() < 0.18;
    const corners = chicane ? 2 : 1;
    for (let i = 0; i < corners; i++) {
      const radius = chicane ? pick([22, 45]) : pick(p.radius);
      const angle = (chicane ? pick([35, 60]) : pick(p.angle)) * Math.PI / 180;
      const len = radius * angle;
      dir = chicane ? (i === 0 ? dir : -dir) : (rnd() < 0.62 ? -dir : dir);
      list.push({ len, k: dir / radius }); total += len;
      if (chicane && i === 0) { list.push({ len: 18, k: 0 }); total += 18; }
    }
  }
  list.push({ len: Math.max(250, p.length - total), k: 0 }); // 主直線
  return list;
}

// 以 40 公尺的線性過渡平滑曲率，避免方向盤瞬間跳動。
function curvatureFunction(list) {
  const L = list.reduce((sum, p) => sum + p.len, 0);
  const starts = []; let acc = 0;
  for (const p of list) { starts.push(acc); acc += p.len; }
  const raw = s => {
    s = ((s % L) + L) % L;
    let i = starts.length - 1;
    while (i > 0 && starts[i] > s) i--;
    return list[i].k;
  };
  const RAMP = 24, STEPS = 8;
  const smooth = s => { let sum = 0; for (let i = 0; i <= STEPS; i++) sum += raw(s - RAMP / 2 + RAMP * i / STEPS); return sum / (STEPS + 1); };
  return { L, k: smooth };
}

const periodic = (s, L) => ((s % L) + L) % L;
// Keep the canonical L/n grid private. Sampling it directly avoids a second
// interpolation across the DS grid's partial final cell when L is odd.
const closedSamplers = new WeakMap();
const angleDelta = a => Math.atan2(Math.sin(a), Math.cos(a));

// Closed centripetal Catmull-Rom (Barry-Goldman evaluation).
function realGeometry(points, L) {
  const pts = points.filter((p, i) => i === 0 || Math.hypot(p[0]-points[i-1][0], p[1]-points[i-1][1]) > 1e-6);
  while (pts.length > 1 && Math.hypot(pts.at(-1)[0]-pts[0][0], pts.at(-1)[1]-pts[0][1]) < 1e-6) pts.pop();
  const dense = [pts[0]], lengths = [0];
  const blend = (a,b,ta,tb,t) => a.map((v,j) => ((tb-t)*v+(t-ta)*b[j])/(tb-ta));
  for (let i=0; i<pts.length; i++) {
    const [p0,p1,p2,p3] = [-1,0,1,2].map(d => pts[(i+d+pts.length)%pts.length]);
    const knot = (a,b) => Math.sqrt(Math.hypot(b[0]-a[0], b[1]-a[1]));
    const t0=0, t1=knot(p0,p1), t2=t1+knot(p1,p2), t3=t2+knot(p2,p3);
    const steps = Math.max(8, Math.ceil(Math.hypot(p2[0]-p1[0],p2[1]-p1[1])*2));
    for (let j=1; j<=steps; j++) {
      const t=t1+(t2-t1)*j/steps;
      const a=blend(p0,p1,t0,t1,t), b=blend(p1,p2,t1,t2,t), c=blend(p2,p3,t2,t3,t);
      const q=blend(blend(a,b,t0,t2,t),blend(b,c,t1,t3,t),t1,t2,t);
      const prev=dense.at(-1);
      lengths.push(lengths.at(-1)+Math.hypot(q[0]-prev[0],q[1]-prev[1])); dense.push(q);
    }
  }
  const total=lengths.at(-1), scale=L/total, n=Math.ceil(L/DS), step=L/n;
  const px=[], py=[]; let cursor=0;
  for (let i=0; i<n; i++) {
    const target=total*i/n;
    while (lengths[cursor+1]<target) cursor++;
    const t=(target-lengths[cursor])/(lengths[cursor+1]-lengths[cursor] || 1);
    px.push((dense[cursor][0]+(dense[cursor+1][0]-dense[cursor][0])*t-pts[0][0])*scale);
    py.push((dense[cursor][1]+(dense[cursor+1][1]-dense[cursor][1])*t-pts[0][1])*scale);
  }
  // East/north -> x/-z, followed by a proper rotation: no reflection.
  const dx=px[1]-px[n-1], dy=py[1]-py[n-1], norm=Math.hypot(dx,dy);
  const east=dx/norm, north=dy/norm;
  const xs=px.map((x,i) => x*north-py[i]*east);
  const zs=px.map((x,i) => -(x*east+py[i]*north));
  const raw=xs.map((_,i) => Math.atan2(xs[(i+1)%n]-xs[(i+n-1)%n], -(zs[(i+1)%n]-zs[(i+n-1)%n])));
  const hs=[0];
  for (let i=1; i<n; i++) hs.push(hs[i-1]+angleDelta(raw[i]-raw[i-1]));
  const turn=hs[n-1]+angleDelta(raw[0]-raw[n-1]);
  const ks=hs.map((h,i) => ((i===n-1 ? turn : hs[i+1])-(i===0 ? hs[n-1]-turn : hs[i-1]))/(2*step));
  // Periodic Gaussian: sigma 8 m, support 36 m; total signed turn is preserved.
  const radius=Math.ceil(18/step), weights=Array.from({length:2*radius+1},(_,j) => Math.exp(-0.5*((j-radius)*step/8)**2));
  const weight=weights.reduce((a,b)=>a+b,0);
  const smooth=ks.map((_,i) => weights.reduce((sum,w,j)=>sum+w*ks[(i+j-radius+n)%n],0)/weight);
  const interpolate = (arr, local, angular=false) => {
    const f=local/step, i=Math.min(n-1,Math.floor(f)), t=f-i;
    const next=i+1===n ? arr[0]+(angular ? turn : 0) : arr[i+1];
    return arr[i]+(next-arr[i])*t;
  };
  return {
    k: s => interpolate(smooth,periodic(s,L)),
    at: s => {
      const local=periodic(s,L), laps=Math.round((s-local)/L);
      return { x:interpolate(xs,local), z:interpolate(zs,local), heading:interpolate(hs,local,true)+laps*turn };
    },
  };
}

export function buildPath(track) {
  const circuit=CIRCUITS[track.id];
  const geometry=circuit ? realGeometry(circuit.points,track.lengthKm*1000) : null;
  const { L, k } = geometry ? { L:track.lengthKm*1000, k:geometry.k } : curvatureFunction(pieces(track));
  const rnd = seeded(`${track.id}:elevation`);
  const amp = track.character === 'high-speed' ? 2.5 : track.character === 'street' ? 1.2 : 4;
  const harmonics = [1, 2, 3].map(n => ({ n, a: amp * (0.4 + rnd() * 0.6) / n, phase: rnd() * Math.PI * 2 }));
  const elevationOffset = geometry ? harmonics.reduce((y,h) => y+h.a*Math.sin(h.phase),0) : 0;
  const elevation = s => harmonics.reduce((y, h) => y + h.a * Math.sin(2 * Math.PI * h.n * s / L + h.phase), 0)-elevationOffset;

  const count = Math.ceil((PRE + L + POST) / DS) + 1;
  const s0 = -PRE;
  const xs = new Float32Array(count), ys = new Float32Array(count), zs = new Float32Array(count);
  const hs = new Float32Array(count), ks = new Float32Array(count);
  let x = 0, z = 0, heading = 0;
  for (let i = 0; i < count; i++) {
    const s = s0 + i * DS;
    const kk = k(s);
    if (geometry) ({ x, z, heading } = geometry.at(s));
    xs[i] = x; zs[i] = z; ys[i] = elevation(s); hs[i] = heading; ks[i] = kk;
    if (!geometry) {
      heading += kk * DS;
      x += Math.sin(heading) * DS; z -= Math.cos(heading) * DS;
    } // 前進方向為 -z
  }
  const speed = speedProfile(L, k, track);
  // 圈內時間比例對照表：cumulative[i] = 從起點跑到 i×DS 所需秒數。
  const cumulative = new Float32Array(speed.length + 1);
  for (let i = 0; i < speed.length; i++) cumulative[i + 1] = cumulative[i] + DS / Math.max(5, speed[i]);
  const path = { L, s0, count, xs, ys, zs, hs, ks, speed, curvature: k, cumulative, lapSeconds: cumulative[speed.length], closed:!!geometry };
  if (geometry) closedSamplers.set(path, s => ({ ...geometry.at(s), y:elevation(periodic(s,L)), k:k(s) }));
  return path;
}

// 速度曲線：彎道依側向加速度限制，再做煞車（往回）與加速（往前）兩次掃描。
export function speedProfile(L, k, track) {
  const n = Math.ceil(L / DS);
  const vmax = track.character === 'high-speed' ? 93 : track.character === 'street' ? 82 : 89;
  const lat = 42, brake = 48;
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.min(vmax, Math.sqrt(lat / Math.max(1e-4, Math.abs(k(i * DS)))));
  const limit = v.slice();
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 2 * n - 1; i >= 0; i--) { // 煞車：往回掃兩圈確保週期一致
      const a = i % n, b = (i + 1) % n;
      v[a] = Math.min(v[a], Math.sqrt(v[b] * v[b] + 2 * brake * DS));
    }
    for (let i = 0; i < 2 * n; i++) { // 加速：低速時加速度大
      const a = (i + 1) % n, b = i % n;
      const accel = 15 * (1 - v[b] / (vmax + 6));
      v[a] = Math.min(v[a], limit[a], Math.sqrt(v[b] * v[b] + 2 * Math.max(0.5, accel) * DS));
    }
  }
  return v;
}

const wrapIndex = (path, s) => (s - path.s0) / DS;

// 取得路徑上 s 處（含橫向偏移）的位置與切線方向。
export function sample(path, s, lateral = 0) {
  const closedSample=closedSamplers.get(path);
  if (closedSample) {
    const p=closedSample(s);
    p.x+=Math.cos(p.heading)*lateral; p.z+=Math.sin(p.heading)*lateral;
    return p;
  }
  const f = Math.min(path.count - 2, Math.max(0, wrapIndex(path, s)));
  const i = Math.floor(f), t = f - i;
  const lerp = (arr) => arr[i] + (arr[i + 1] - arr[i]) * t;
  const heading = lerp(path.hs);
  const x = lerp(path.xs), y = lerp(path.ys), z = lerp(path.zs);
  // 左側法向量（前進為 -z、heading 為繞 y 軸的偏轉）
  const nx = -Math.cos(heading), nz = -Math.sin(heading);
  return { x: x - nx * lateral, y, z: z - nz * lateral, heading, k: lerp(path.ks) };
}

export function speedAt(path, s) {
  const n = path.speed.length;
  const f = ((s % path.L + path.L) % path.L) / DS;
  const i = Math.floor(f) % n, t = f - Math.floor(f);
  return path.speed[i] + (path.speed[(i + 1) % n] - path.speed[i]) * t;
}

// 賽車路線：彎前靠外、彎心切內，平滑的橫向偏移（正值為右側）。
export function racingLine(path, s) {
  let mean=0;
  for (let offset=-24; offset<=24; offset+=6) mean+=path.curvature(s+offset);
  const value=mean/9*320, limit=HALF_WIDTH-2.2;
  return Math.max(-limit,Math.min(limit,value));
}

// 依「圈內時間比例」回傳賽道位置 s：直線上推進快、彎道慢，讓畫面速度感與速度曲線一致。
export function distanceAtFraction(path, fraction) {
  const f = ((fraction % 1) + 1) % 1, target = f * path.lapSeconds, c = path.cumulative;
  let lo = 0, hi = c.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] <= target) lo = mid; else hi = mid; }
  const span = c[hi] - c[lo] || 1;
  return (lo + (target - c[lo]) / span) * DS;
}

// distanceAtFraction 的反函式：賽道位置 s → 圈內時間比例（0~1）。
export function fractionAtDistance(path, s) {
  const local = ((s % path.L) + path.L) % path.L, f = local / DS;
  const i = Math.min(path.cumulative.length - 2, Math.floor(f));
  const c = path.cumulative;
  return (c[i] + (c[i + 1] - c[i]) * (f - i)) / path.lapSeconds;
}
