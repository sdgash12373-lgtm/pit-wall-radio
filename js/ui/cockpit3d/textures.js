import * as THREE from 'three';
import { seeded } from './trackPath.js';

// 程序生成貼圖：不依賴任何外部圖片檔。所有亂數使用固定種子，畫面不會閃爍。
function canvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function texture(c, { repeat = [1, 1], color = true, anisotropy = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = anisotropy;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function noise(ctx, w, h, rnd, count, colors, size = [1, 2]) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
    const s = size[0] + rnd() * (size[1] - size[0]);
    ctx.fillRect(rnd() * w, rnd() * h, s, s);
  }
}

// 柏油路：顆粒、補丁、胎痕與賽車路線較深的橡膠帶。u 方向為橫向（0=左緣、1=右緣），v 為前進方向。
export function asphalt(wet, { lines = true } = {}) {
  const [c, ctx] = canvas(512, 1024), rnd = seeded('asphalt');
  // 卡通風：乾淨的中灰柏油，只有柔和的大塊明暗與少量細點。
  ctx.fillStyle = wet ? '#4b5058' : '#6a6f77'; ctx.fillRect(0, 0, 512, 1024);
  for (let i = 0; i < 40; i++) { ctx.fillStyle = rnd() < 0.5 ? '#00000010' : '#ffffff0a'; ctx.beginPath(); ctx.ellipse(rnd() * 512, rnd() * 1024, 40 + rnd() * 120, 80 + rnd() * 200, 0, 0, Math.PI * 2); ctx.fill(); }
  noise(ctx, 512, 1024, rnd, 6000, wet ? ['#454a52', '#535860'] : ['#646970', '#72777e'], [1, 2]);
  // 賽車路線的橡膠帶
  const band = ctx.createLinearGradient(0, 0, 512, 0);
  band.addColorStop(0, '#0000'); band.addColorStop(0.32, '#0000'); band.addColorStop(0.45, wet ? '#0002' : '#0003');
  band.addColorStop(0.55, wet ? '#0002' : '#0003'); band.addColorStop(0.68, '#0000'); band.addColorStop(1, '#0000');
  ctx.fillStyle = band; ctx.fillRect(0, 0, 512, 1024);
  for (let i = 0; i < 18; i++) { // 柏油補丁
    ctx.fillStyle = rnd() < 0.5 ? '#0000000f' : '#ffffff08';
    ctx.fillRect(rnd() * 480, rnd() * 1000, 20 + rnd() * 90, 30 + rnd() * 140);
  }
  ctx.strokeStyle = '#00000022'; ctx.lineWidth = 3;
  for (let i = 0; i < 40; i++) { const x = 160 + rnd() * 190; ctx.beginPath(); ctx.moveTo(x, rnd() * 1024); ctx.lineTo(x + (rnd() - .5) * 20, rnd() * 1024); ctx.stroke(); }
  // 兩側白色邊線
  if (lines) { ctx.fillStyle = '#e9ece8'; ctx.fillRect(10, 0, 9, 1024); ctx.fillRect(493, 0, 9, 1024); }
  return texture(c, { repeat: [1, 1] });
}

export function asphaltRoughness(wet) {
  const [c, ctx] = canvas(256, 512), rnd = seeded('rough');
  ctx.fillStyle = wet ? '#3a3a3a' : '#e0e0e0'; ctx.fillRect(0, 0, 256, 512);
  noise(ctx, 256, 512, rnd, 20000, wet ? ['#202020', '#555555', '#2c2c2c'] : ['#c8c8c8', '#f2f2f2', '#b4b4b4'], [1, 2]);
  if (wet) { for (let i = 0; i < 30; i++) { ctx.fillStyle = '#0a0a0a'; ctx.beginPath(); ctx.ellipse(rnd() * 256, rnd() * 512, 8 + rnd() * 30, 20 + rnd() * 60, 0, 0, Math.PI * 2); ctx.fill(); } }
  return texture(c, { color: false });
}

export function kerb() {
  const [c, ctx] = canvas(64, 256);
  for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#f1f1ee' : '#c8202a'; ctx.fillRect(0, i * 64, 64, 64); }
  const g = ctx.createLinearGradient(0, 0, 64, 0); g.addColorStop(0, '#0004'); g.addColorStop(.3, '#0000'); g.addColorStop(1, '#0003');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 256);
  return texture(c);
}

export function grass(wet) {
  const [c, ctx] = canvas(512, 512), rnd = seeded('grass');
  // 卡通風：鮮綠草地＋寬割草條紋
  ctx.fillStyle = wet ? '#4f9a3b' : '#62c44a'; ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = wet ? '#468c34' : '#55b23f'; ctx.fillRect(0, 0, 512, 256);
  noise(ctx, 512, 512, rnd, 5000, wet ? ['#59a846', '#428431'] : ['#6dd055', '#4fa83b'], [1, 3]);
  return texture(c, { repeat: [1, 1] });
}

export function gravel() {
  const [c, ctx] = canvas(256, 256), rnd = seeded('gravel');
  ctx.fillStyle = '#ead7a0'; ctx.fillRect(0, 0, 256, 256);
  noise(ctx, 256, 256, rnd, 6000, ['#dcc78c', '#f3e3b6', '#cfb979'], [1.5, 3.5]);
  return texture(c, { repeat: [1, 1] });
}

// 觀眾席：一排排座位與五顏六色的觀眾。
export function crowd() {
  const [c, ctx] = canvas(1024, 256), rnd = seeded('crowd');
  ctx.fillStyle = '#2b3036'; ctx.fillRect(0, 0, 1024, 256);
  for (let row = 0; row < 16; row++) {
    ctx.fillStyle = row % 2 ? '#3a4048' : '#323840'; ctx.fillRect(0, row * 16, 1024, 16);
    for (let x = 0; x < 1024; x += 6) {
      if (rnd() < 0.18) continue;
      const hue = Math.floor(rnd() * 360);
      ctx.fillStyle = rnd() < 0.3 ? '#c8202a' : `hsl(${hue},${30 + rnd() * 50}%,${35 + rnd() * 35}%)`;
      ctx.fillRect(x, row * 16 + 4, 4, 7);
      ctx.fillStyle = `hsl(25,${30 + rnd() * 30}%,${45 + rnd() * 25}%)`; ctx.fillRect(x + 1, row * 16 + 1, 3, 3);
    }
  }
  return texture(c, { repeat: [3, 1] });
}

// 護欄廣告牌：虛構品牌字樣。
const BRANDS = [['PWR', '#c8202a', '#ffffff'], ['APEX', '#111418', '#f2c300'], ['NOVA', '#0d4aa8', '#ffffff'], ['VELOX', '#f2f2f2', '#c8202a'], ['ORBIT', '#0f7a52', '#ffffff'], ['KESTREL', '#1b1b1b', '#5ad1ff'], ['TIDE', '#ffffff', '#0d4aa8']];
export function billboards() {
  const [c, ctx] = canvas(2048, 128);
  BRANDS.forEach(([word, bg, fg], i) => {
    const x = i * (2048 / BRANDS.length), w = 2048 / BRANDS.length;
    ctx.fillStyle = bg; ctx.fillRect(x, 0, w, 128);
    ctx.fillStyle = fg; ctx.font = 'italic 900 78px "Bahnschrift","Arial Black",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(word, x + w / 2, 68);
    ctx.fillStyle = '#0003'; ctx.fillRect(x + w - 3, 0, 3, 128);
  });
  return texture(c, { repeat: [1, 1] });
}

export function concrete() {
  const [c, ctx] = canvas(256, 256), rnd = seeded('concrete');
  ctx.fillStyle = '#9a9c98'; ctx.fillRect(0, 0, 256, 256);
  noise(ctx, 256, 256, rnd, 12000, ['#8c8e8a', '#a8aaa6', '#7e807c'], [1, 3]);
  ctx.fillStyle = '#0002'; for (let x = 0; x < 256; x += 64) ctx.fillRect(x, 0, 2, 256);
  return texture(c);
}

// 碳纖維編織紋路。
export function carbon() {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#121416'; ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 8) for (let x = 0; x < 128; x += 8) {
    const g = ctx.createLinearGradient(x, y, x + 8, y + 8);
    const flip = ((x + y) / 8) % 2;
    g.addColorStop(0, flip ? '#1f2326' : '#0c0d0f'); g.addColorStop(1, flip ? '#0c0d0f' : '#24282c');
    ctx.fillStyle = g; ctx.fillRect(x, y, 8, 8);
  }
  return texture(c, { repeat: [6, 6] });
}

export function building(rnd) {
  const [c, ctx] = canvas(128, 256);
  const tone = 120 + Math.floor(rnd() * 80);
  ctx.fillStyle = `rgb(${tone},${tone - 6},${tone - 14})`; ctx.fillRect(0, 0, 128, 256);
  for (let y = 10; y < 250; y += 22) for (let x = 8; x < 120; x += 20) {
    ctx.fillStyle = rnd() < 0.25 ? '#e9d9a6' : `rgb(${40 + rnd() * 40},${55 + rnd() * 40},${70 + rnd() * 40})`;
    ctx.fillRect(x, y, 12, 14);
  }
  return texture(c);
}

// 鏡頭水珠：透明背景上的水滴（含高光）。
export function droplets() {
  const [c, ctx] = canvas(1024, 1024), rnd = seeded('drops');
  for (let i = 0; i < 1300; i++) { // 大量細小水珠＋少數大水滴
    const x = rnd() * 1024, y = rnd() * 1024, r = 1.2 + rnd() ** 4 * 16;
    const g = ctx.createRadialGradient(x - r * .3, y - r * .3, r * .1, x, y, r);
    g.addColorStop(0, '#ffffff77'); g.addColorStop(.45, '#c8dceb33'); g.addColorStop(.8, '#0a141c22'); g.addColorStop(1, '#ffffff00');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r, r * (1 + rnd() * .5), 0, 0, Math.PI * 2); ctx.fill();
    if (r > 8 && rnd() < .5) { ctx.fillStyle = '#ffffff22'; ctx.fillRect(x - 1, y, 2, 20 + rnd() * 60); } // 下滑水痕
  }
  return texture(c, { repeat: [1, 1] });
}

export function sprayTexture() {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, '#ffffffaa'); g.addColorStop(.5, '#ffffff33'); g.addColorStop(1, '#ffffff00');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return texture(c);
}
