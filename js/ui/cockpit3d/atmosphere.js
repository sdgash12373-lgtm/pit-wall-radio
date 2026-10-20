import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { seeded } from './trackPath.js';

// 可平鋪的數值雜訊（多層 fBm），用來生成雲朵。
function tileNoise(size, cells, rnd) {
  const grid = Array.from({ length: cells * cells }, () => rnd());
  const at = (x, y) => grid[((y % cells + cells) % cells) * cells + ((x % cells + cells) % cells)];
  const smooth = t => t * t * (3 - 2 * t);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x / size * cells, fy = y / size * cells;
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = smooth(fx - ix), ty = smooth(fy - iy);
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx;
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
    out[y * size + x] = a + (b - a) * ty;
  }
  return out;
}

// 雲朵貼圖：亮面在上、底部略暗，雨天覆蓋率高且偏灰。
function cloudTexture(wet) {
  const size = 512, rnd = seeded(wet ? 'clouds-wet' : 'clouds');
  const layers = [[4, 0.5], [8, 0.25], [16, 0.14], [32, 0.07], [64, 0.04]].map(([cells, w]) => [tileNoise(size, cells, rnd), w]);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  const cover = wet ? 0.28 : 0.5, soft = wet ? 0.5 : 0.22;
  for (let i = 0; i < size * size; i++) {
    let n = 0; for (const [layer, w] of layers) n += layer[i] * w;
    const density = Math.max(0, Math.min(1, (n - cover) / soft));
    const shade = wet ? 150 + n * 50 : 205 + n * 50;
    img.data.set([shade, shade + (wet ? 4 : 2), shade + (wet ? 10 : 8), Math.round(density * 255)], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// 雲層邊緣淡出（避免在地平線看到平面邊界）。
function fadeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
  g.addColorStop(0, '#fff'); g.addColorStop(0.55, '#fff'); g.addColorStop(1, '#000');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

// 兩層雲：高空薄雲＋較低的積雲，隨時間緩慢飄移。
export function createClouds(wet) {
  const group = new THREE.Group();
  const fade = fadeTexture();
  const layers = [[520, 7, wet ? 0.95 : 0.85, 1], [900, 4, wet ? 0.9 : 0.55, 0.6]].map(([height, repeat, opacity, speed]) => {
    const map = cloudTexture(wet); map.repeat.set(repeat, repeat);
    const mat = new THREE.MeshBasicMaterial({ map, alphaMap: fade, transparent: true, opacity, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), mat);
    mesh.rotation.x = Math.PI / 2; mesh.position.y = height; mesh.renderOrder = -1;
    mesh.userData.speed = speed;
    group.add(mesh);
    return mesh;
  });
  return {
    group,
    update(cameraPosition, time) {
      group.position.set(cameraPosition.x, 0, cameraPosition.z);
      // 雲層跟隨鏡頭，但貼圖依世界座標位移，看起來是靜止的天空在頭頂流過。
      for (const mesh of layers) {
        const r = mesh.material.map.repeat.x / 9000;
        mesh.material.map.offset.set(cameraPosition.x * r + time * 0.0016 * mesh.userData.speed, -cameraPosition.z * r + time * 0.0007 * mesh.userData.speed);
      }
    },
    dispose() { for (const m of layers) { m.material.map.dispose(); m.material.dispose(); m.geometry.dispose(); } fade.dispose(); },
  };
}

function glow(size, stops) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'), g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function ring(size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'), g = ctx.createRadialGradient(size / 2, size / 2, size * 0.32, size / 2, size / 2, size / 2);
  g.addColorStop(0, '#000'); g.addColorStop(0.6, '#15191d'); g.addColorStop(0.75, '#1d2a36'); g.addColorStop(1, '#000');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 太陽鏡頭光暈：太陽本體泛光＋沿畫面中心排列的光斑；被 Halo、車身遮住時會自動淡出（Lensflare 內建遮擋偵測）。
export function createSunFlare() {
  const flare = new Lensflare();
  const core = glow(512, [[0, '#ffffff'], [0.06, '#fff3dc'], [0.2, '#4a3d2c'], [0.5, '#16110b'], [1, '#000000']]);
  // Lensflare 採加法混合：亮度由 RGB 決定，暗色＝淡。
  const hex = glow(128, [[0, '#1e2328'], [0.6, '#11161b'], [0.85, '#1a2128'], [1, '#000000']]);
  const halo = ring(256);
  flare.addElement(new LensflareElement(core, 520, 0, new THREE.Color(1, 0.96, 0.88)));
  flare.addElement(new LensflareElement(halo, 300, 0.0));
  flare.addElement(new LensflareElement(hex, 60, 0.35, new THREE.Color(0.7, 0.9, 1)));
  flare.addElement(new LensflareElement(hex, 90, 0.55, new THREE.Color(1, 0.8, 0.6)));
  flare.addElement(new LensflareElement(hex, 45, 0.75, new THREE.Color(0.6, 1, 0.8)));
  flare.addElement(new LensflareElement(halo, 160, 1.0, new THREE.Color(0.7, 0.85, 1)));
  flare.frustumCulled = false;
  return flare;
}

// 車底接觸陰影（假 AO）：讓遠處的車也牢牢貼地。
let contact;
export function contactShadow(width = 2.4, length = 6) {
  if (!contact) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 64, 4, 32, 64, 62);
    g.addColorStop(0, '#000000d0'); g.addColorStop(0.55, '#00000080'); g.addColorStop(1, '#00000000');
    ctx.save(); ctx.scale(1, 1); ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 128); ctx.restore();
    contact = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0.85 });
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length), contact);
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.035; mesh.renderOrder = 1;
  return mesh;
}

// ── 卡通風天空：漸層天頂＋地平線柔光；蓬鬆的立體積雲（由多顆球體組成）──
export function createToonSky(wet) {
  const geo = new THREE.SphereGeometry(2600, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(wet ? '#7b8796' : '#2f7fe0') },
      mid: { value: new THREE.Color(wet ? '#a9b2bc' : '#79b8f5') },
      horizon: { value: new THREE.Color(wet ? '#cfd4d8' : '#dcefff') },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top, mid, horizon; varying vec3 vDir;
      void main(){ float h = clamp(vDir.y, -0.2, 1.0);
        vec3 c = h < 0.18 ? mix(horizon, mid, smoothstep(-0.02, 0.18, h)) : mix(mid, top, smoothstep(0.18, 0.75, h));
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = -2;
  return mesh;
}

export function createPuffyClouds(wet, seed = 'clouds') {
  const rnd = seeded(`${seed}:${wet ? 'wet' : 'dry'}`);
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: wet ? '#d7dce2' : '#ffffff', roughness: 1, emissive: wet ? '#5d646c' : '#9fb7d6', emissiveIntensity: 0.35, fog: false });
  const ball = new THREE.IcosahedronGeometry(1, 3);
  const count = wet ? 34 : 22, puffs = [];
  for (let i = 0; i < count; i++) {
    const angle = rnd() * Math.PI * 2, dist = 700 + rnd() * 1300;
    const cloud = new THREE.Group();
    const size = (wet ? 70 : 55) + rnd() * 70;
    const n = 6 + Math.floor(rnd() * 6);
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(ball, mat);
      const r = size * (0.45 + rnd() * 0.5);
      m.scale.set(r, r * (0.7 + rnd() * 0.25), r);
      m.position.set((rnd() - 0.5) * size * 2.6, (rnd() - 0.2) * size * 0.6, (rnd() - 0.5) * size * 1.2);
      cloud.add(m);
    }
    cloud.position.set(Math.cos(angle) * dist, (wet ? 260 : 320) + rnd() * 380, Math.sin(angle) * dist);
    cloud.lookAt(0, cloud.position.y, 0);
    cloud.userData.drift = 2 + rnd() * 4;
    group.add(cloud); puffs.push(cloud);
  }
  return {
    group,
    update(cameraPosition, time) {
      group.position.set(cameraPosition.x, 0, cameraPosition.z);
      group.rotation.y = time * 0.002; // 雲緩慢飄移
    },
    dispose() { ball.dispose(); mat.dispose(); },
  };
}
