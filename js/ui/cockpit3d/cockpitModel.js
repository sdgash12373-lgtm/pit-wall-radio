import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { carbon } from './textures.js';
import { getModels, makeCockpitParts, fitModel, MODEL_FIT } from './models.js';
import { COMPOUNDS } from '../../data/tyres.js';

// 駕駛者視角的座艙。座標以「頭部」為原點（前方 -z、上方 +y、不含鏡頭俯仰）。
// 比例依轉播車載鏡頭推算：方向盤距眼睛約 0.3m、佔畫面寬約 45%；Halo 中柱從畫面頂端垂下。

// 車身塗裝：車隊主色＋白色斜紋＋細飾條＋虛構贊助字樣，下緣漸暗為碳纖。
function liveryTexture(teamColor) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f3f4f2'; ctx.fillRect(0, 0, 1024, 512);
  ctx.fillStyle = teamColor;
  ctx.beginPath(); ctx.moveTo(0, 300); ctx.lineTo(1024, 170); ctx.lineTo(1024, 512); ctx.lineTo(0, 512); ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.moveTo(0, 300); ctx.lineTo(1024, 170); ctx.lineTo(1024, 186); ctx.lineTo(0, 316); ctx.fill();
  ctx.font = 'italic 900 64px "Bahnschrift","Arial Black",sans-serif'; ctx.fillStyle = '#111'; ctx.globalAlpha = 0.75;
  ctx.fillText('PWR', 120, 230); ctx.font = 'italic 700 34px "Bahnschrift",sans-serif'; ctx.fillText('APEX · NOVA', 640, 120);
  ctx.globalAlpha = 1;
  const shade = ctx.createLinearGradient(0, 380, 0, 512); shade.addColorStop(0, '#0000'); shade.addColorStop(1, '#000a');
  ctx.fillStyle = shade; ctx.fillRect(0, 380, 1024, 132);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// 前蓋：由近而遠變窄、變低，頂面中央隆起、兩側往下彎（類似駕駛艙前段的單體殼）。
function deckGeometry() {
  const g = new THREE.PlaneGeometry(1, 1, 24, 30);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.5, v = p.getY(i) + 0.5; // u: 左→右, v: 近→遠
    const z = -0.42 - v * 1.5;
    const halfW = 0.5 - v * 0.3;
    const across = (u - 0.5) * 2; // -1~1
    const crown = -0.1 - v * 0.17;
    const y = crown - Math.pow(Math.abs(across), 2.4) * (0.22 - v * 0.08);
    p.setXYZ(i, across * halfW, y, z);
    uv.setXY(i, u, v);
  }
  g.computeVertexNormals();
  return g;
}

export function createCockpit(teamColor, models = getModels()) {
  const root = new THREE.Group();
  const carbonMap = carbon();
  const livery = new THREE.MeshPhysicalMaterial({ map: liveryTexture(teamColor), roughness: 0.32, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide });
  const paint = new THREE.MeshPhysicalMaterial({ color: teamColor, roughness: 0.3, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 });
  const white = new THREE.MeshPhysicalMaterial({ color: '#eceeec', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 });
  const dark = new THREE.MeshPhysicalMaterial({ map: carbonMap, color: '#7d838a', roughness: 0.38, metalness: 0.25, clearcoat: 0.7, clearcoatRoughness: 0.25 });
  const matte = new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.85 });
  const halo = new THREE.MeshStandardMaterial({ color: '#141619', roughness: 0.42, metalness: 0.6 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#151617', roughness: 0.9 });
  const add = (parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };

  // 前蓋（塗裝）與延伸出去的車鼻
  add(root, deckGeometry(), livery, 0, 0, 0);
  const nose = new THREE.BoxGeometry(0.5, 0.2, 2.2, 4, 2, 20);
  const np = nose.attributes.position;
  for (let i = 0; i < np.count; i++) {
    const t = -np.getZ(i) / 2.2 + 0.5;
    np.setX(i, np.getX(i) * (1 - t * 0.5));
    np.setY(i, np.getY(i) - t * 0.3);
  }
  nose.computeVertexNormals();
  add(root, nose, white, 0, -0.4, -2.95);
  const bodyParts = [...root.children];

  // 前輪與懸吊
  for (const s of [-1, 1]) {
    const tyre = new THREE.Group(); tyre.position.set(s * 0.86, -0.62, -2.15); tyre.userData.front = true; root.add(tyre);
    add(tyre, new THREE.CylinderGeometry(0.36, 0.36, 0.33, 40), rubber, 0, 0, 0, 0, 0, Math.PI / 2);
    add(tyre, new THREE.TorusGeometry(0.33, 0.035, 10, 40), rubber, 0, 0, 0, 0, Math.PI / 2, 0).scale.set(1, 1, 4.2);
    add(tyre, new THREE.CylinderGeometry(0.22, 0.22, 0.335, 24), new THREE.MeshStandardMaterial({ color: '#2a2d30', metalness: 0.85, roughness: 0.3 }), 0, 0, 0, 0, 0, Math.PI / 2);
    add(tyre, new THREE.TorusGeometry(0.29, 0.01, 6, 40), new THREE.MeshStandardMaterial({ color: '#f4d35e', roughness: 0.6 }), -s * 0.168, 0, 0, 0, Math.PI / 2, 0);
    add(root, new THREE.CylinderGeometry(0.014, 0.014, 0.7, 6), dark, s * 0.5, -0.5, -2.1, 0, 0, Math.PI / 2 + s * 0.12);
    add(root, new THREE.CylinderGeometry(0.014, 0.014, 0.7, 6), dark, s * 0.5, -0.62, -1.95, 0, 0, Math.PI / 2 - s * 0.05);
  }

  // 駕駛艙兩側（白色肩部＋車隊色側箱），以及內部的深色艙壁
  const sideStart = root.children.length;
  for (const s of [-1, 1]) {
    add(root, new RoundedBoxGeometry(0.22, 0.16, 1.1, 5, 0.07), white, s * 0.44, -0.24, -0.2, 0, 0, s * -0.12);
    add(root, new RoundedBoxGeometry(0.14, 0.05, 0.9, 4, 0.022), matte, s * 0.33, -0.17, -0.12); // 艙緣襯墊
    add(root, new RoundedBoxGeometry(0.62, 0.34, 1.9, 6, 0.15), paint, s * 0.82, -0.5, -0.05, 0, 0, s * 0.1);
  }
  add(root, new RoundedBoxGeometry(0.62, 0.3, 0.9, 4, 0.08), matte, 0, -0.42, -0.05); // 艙內（方向盤下方的暗部）
  bodyParts.push(...root.children.slice(sideStart));

  // 方向盤後的儀表罩與「狀態燈」
  const cowl = add(root, new RoundedBoxGeometry(0.42, 0.06, 0.18, 4, 0.026), dark, 0, -0.12, -0.46, 0.18);
  const status = [];
  for (let i = 0; i < 10; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: '#101010', emissive: i < 3 ? '#ffb000' : i < 7 ? '#ff2b2b' : '#2fd35a', emissiveIntensity: 0 });
    add(cowl, new THREE.BoxGeometry(0.016, 0.006, 0.01), mat, -0.17 + i * 0.038, 0.037, 0.02);
    status.push(mat);
  }

  // Halo：頂部環形往畫面兩上角延伸，中柱垂下接到前方的鏡頭座
  const hoop = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.42, 0.3, 0.2), new THREE.Vector3(-0.36, 0.3, -0.1), new THREE.Vector3(-0.22, 0.22, -0.4),
    new THREE.Vector3(0, 0.16, -0.52), new THREE.Vector3(0.22, 0.22, -0.4), new THREE.Vector3(0.36, 0.3, -0.1), new THREE.Vector3(0.42, 0.3, 0.2)]);
  add(root, new THREE.TubeGeometry(hoop, 60, 0.026, 12), halo, 0, 0, 0);
  const pillar = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.16, -0.52), new THREE.Vector3(0, 0.1, -0.62), new THREE.Vector3(0, 0.0, -0.75), new THREE.Vector3(0, -0.08, -0.86)]);
  const pillarMesh = add(root, new THREE.TubeGeometry(pillar, 24, 0.022, 10), halo, 0, 0, 0);
  pillarMesh.scale.x = 0.85;
  add(root, new RoundedBoxGeometry(0.06, 0.045, 0.08, 3, 0.015), halo, 0, -0.07, -0.86); // 車載鏡頭座
  add(root, new THREE.CylinderGeometry(0.012, 0.012, 0.01, 16), new THREE.MeshStandardMaterial({ color: '#0a0a0a', metalness: 1, roughness: 0.1 }), 0, -0.065, -0.818, Math.PI / 2);
  for (const s of [-1, 1]) add(root, new RoundedBoxGeometry(0.07, 0.05, 0.3, 3, 0.02), halo, s * 0.4, 0.2, 0.25, 0.4); // Halo 後腳

  // 後照鏡：車隊色外殼＋支架（鏡面材質稍後指定為後視畫面）
  const mirrors = [], housings = [];
  for (const s of [-1, 1]) {
    const housing = add(root, new RoundedBoxGeometry(0.2, 0.072, 0.05, 4, 0.024), paint, s * 0.47, -0.05, -0.64, 0, s * 0.22, 0);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.056), new THREE.MeshBasicMaterial({ color: '#8899aa' }));
    glass.position.set(0, 0, 0.026); housing.add(glass);
    add(root, new THREE.CylinderGeometry(0.01, 0.012, 0.16, 8), dark, s * 0.45, -0.13, -0.66, 0, 0, s * 0.3);
    mirrors.push(glass); housings.push(housing);
  }

  // 方向盤（距眼睛約 0.3m，盤面朝向駕駛者）
  const wheel = new THREE.Group();
  wheel.position.set(0, -0.14, -0.3); wheel.rotation.x = -0.45;
  root.add(wheel);
  const shape = new THREE.Shape();
  shape.moveTo(-0.12, 0.072); shape.lineTo(0.12, 0.072); shape.quadraticCurveTo(0.158, 0.072, 0.162, 0.04);
  shape.lineTo(0.172, -0.055); shape.quadraticCurveTo(0.168, -0.098, 0.128, -0.1); shape.lineTo(0.085, -0.082);
  shape.lineTo(-0.085, -0.082); shape.lineTo(-0.128, -0.1); shape.quadraticCurveTo(-0.168, -0.098, -0.172, -0.055);
  shape.lineTo(-0.162, 0.04); shape.quadraticCurveTo(-0.158, 0.072, -0.12, 0.072);
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.007, bevelSegments: 4 }), dark);
  body.position.z = -0.03; body.castShadow = true; body.receiveShadow = true; wheel.add(body);
  add(wheel, new RoundedBoxGeometry(0.17, 0.11, 0.008, 3, 0.004), matte, 0, -0.008, 0.004); // LCD 外框
  for (const s of [-1, 1]) {
    const grip = add(wheel, new THREE.CapsuleGeometry(0.026, 0.1, 6, 12), rubber, s * 0.152, -0.025, 0.0);
    grip.rotation.z = s * 0.1;
  }
  // LCD
  const lcdCanvas = document.createElement('canvas'); lcdCanvas.width = 512; lcdCanvas.height = 300;
  const lcdTex = new THREE.CanvasTexture(lcdCanvas); lcdTex.colorSpace = THREE.SRGBColorSpace; lcdTex.anisotropy = 8;
  const lcd = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.088), new THREE.MeshBasicMaterial({ map: lcdTex, toneMapped: false }));
  lcd.position.set(0, -0.008, 0.0095); wheel.add(lcd);
  // 按鈕（彩色、帶白色刻字環）與旋鈕
  const buttonColors = ['#d62d2d', '#2fae4f', '#f2c300', '#2f6fd6', '#f2f2f2', '#ff7a1a', '#7a3ad6', '#16b1c9'];
  const btnGeo = new THREE.CylinderGeometry(0.0085, 0.0085, 0.006, 18), ringGeo = new THREE.TorusGeometry(0.0095, 0.0012, 4, 18);
  const ringMat = new THREE.MeshStandardMaterial({ color: '#d9dde0', roughness: 0.4 });
  [[-0.105, 0.05], [-0.128, 0.022], [-0.122, -0.008], [-0.1, -0.036], [0.105, 0.05], [0.128, 0.022], [0.122, -0.008], [0.1, -0.036], [-0.068, 0.062], [0.068, 0.062]].forEach(([x, y], i) => {
    const color = buttonColors[i % buttonColors.length];
    add(wheel, btnGeo, new THREE.MeshStandardMaterial({ color, roughness: 0.35, emissive: color, emissiveIntensity: 0.2 }), x, y, 0.006, Math.PI / 2);
    add(wheel, ringGeo, ringMat, x, y, 0.004);
  });
  const knobGeo = new THREE.CylinderGeometry(0.0125, 0.0125, 0.014, 24);
  [['#f2c300', -0.06, -0.072], ['#2f6fd6', 0, -0.078], ['#d62d2d', 0.06, -0.072], ['#c9cdd1', -0.115, -0.065], ['#c9cdd1', 0.115, -0.065]].forEach(([color, x, y]) => {
    add(wheel, knobGeo, new THREE.MeshStandardMaterial({ color: '#202326', metalness: 0.6, roughness: 0.3 }), x, y, 0.008, Math.PI / 2);
    add(wheel, new THREE.TorusGeometry(0.0115, 0.0025, 6, 24), new THREE.MeshStandardMaterial({ color, roughness: 0.4 }), x, y, 0.0155);
  });
  const leds = [];
  for (let i = 0; i < 15; i++) {
    const color = i < 5 ? '#26e05a' : i < 10 ? '#ff2b2b' : '#3a7bff';
    const mat = new THREE.MeshStandardMaterial({ color: '#111', emissive: color, emissiveIntensity: 0 });
    add(wheel, new THREE.SphereGeometry(0.0038, 10, 8), mat, -0.077 + i * 0.011, 0.066, 0.006);
    leds.push(mat);
  }
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { // 兩側旗號燈
    const mat = new THREE.MeshStandardMaterial({ color: '#111', emissive: '#ffb000', emissiveIntensity: 0 });
    add(wheel, new THREE.SphereGeometry(0.0045, 10, 8), mat, s * 0.087, 0.03 - i * 0.022, 0.006);
    leds.push(mat);
  }

  // 手套：車隊色手背、深色掌面、四指包住握把、拇指搭在盤面，袖口與前臂往下延伸出畫面
  const wheelParts = wheel.children.filter(o => o !== lcd && !leds.includes(o.material));
  const hands = [];
  const glove = new THREE.MeshPhysicalMaterial({ color: teamColor, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4 });
  const palm = new THREE.MeshStandardMaterial({ color: '#1b1c1e', roughness: 0.9 });
  const cuffMat = new THREE.MeshStandardMaterial({ color: '#111214', roughness: 0.8 });
  for (const s of [-1, 1]) {
    const hand = new THREE.Group(); hand.position.set(s * 0.158, -0.04, 0.0); hand.rotation.set(0, s * 0.55, s * 0.1); hand.scale.setScalar(1.08); wheel.add(hand);
    add(hand, new RoundedBoxGeometry(0.06, 0.112, 0.046, 5, 0.022), glove, s * 0.02, 0.0, 0.03);
    for (let f = 0; f < 4; f++) {
      const finger = add(hand, new THREE.TorusGeometry(0.031, 0.0145, 12, 20, Math.PI * 1.3), glove, 0, 0.04 - f * 0.026, 0.003);
      finger.rotation.set(Math.PI / 2, 0, s > 0 ? Math.PI * 0.85 : -Math.PI * 0.15);
    }
    const thumb = add(hand, new THREE.CapsuleGeometry(0.0125, 0.05, 6, 12), glove, -s * 0.042, 0.03, 0.03, 0.1, -s * 0.5, -s * 1.15);
    thumb.scale.set(1, 1, 0.85);
    add(hand, new THREE.CylinderGeometry(0.04, 0.046, 0.06, 18), cuffMat, s * 0.018, -0.07, 0.06, Math.PI / 2 - 0.65);
    const arm = add(hand, new THREE.CylinderGeometry(0.05, 0.068, 0.6, 18), glove, s * 0.05, -0.2, 0.3, Math.PI / 2 - 0.65, 0, s * 0.15);
    hands.push({ hand, parts: hand.children.filter(o => o !== arm) });
    arm.material = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor).multiplyScalar(0.45), roughness: 0.92 });
  }

  // 雨天水珠：散落在車身、儀表罩與 Halo 上的亮面小水滴（雨天才顯示）
  const drops = new THREE.Group(); drops.visible = false; root.add(drops);
  const dropMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.02, transmission: 0.6, thickness: 0.02, clearcoat: 1, transparent: true, opacity: 0.75 });
  const dropGeo = new THREE.SphereGeometry(1, 10, 8);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 70; i++) {
    const side = rnd() < 0.5 ? -1 : 1, onDeck = rnd() < 0.55;
    const x = onDeck ? (rnd() - 0.5) * 0.8 : side * (0.3 + rnd() * 0.25), z = onDeck ? -0.5 - rnd() * 1.1 : -0.1 - rnd() * 0.9;
    const y = onDeck ? -0.1 - (-z - 0.42) * 0.11 - Math.pow(Math.abs(x) / 0.5, 2.4) * 0.2 + 0.012 : -0.3 + 0.012;
    const r = 0.004 + rnd() * 0.009;
    const d = new THREE.Mesh(dropGeo, dropMat); d.position.set(x, y, z); d.scale.set(r, r * 0.55, r * 1.2); drops.add(d);
  }
  if (models) {
    const parts = makeCockpitParts(teamColor, models);
    const bounds = (parent, nodes) => {
      root.updateMatrixWorld(true);
      const box = new THREE.Box3(), inverse = parent.matrixWorld.clone().invert();
      for (const node of nodes) node.traverse(o => {
        if (!o.geometry) return;
        o.geometry.computeBoundingBox();
        box.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld)));
      });
      return box;
    };
    const replace = (parent, nodes, model, key) => {
      if (!model || !nodes.length) return null;
      const fitted = fitModel(model, bounds(parent, nodes), key);
      for (const node of nodes) parent.remove(node);
      parent.add(fitted); return fitted;
    };
    replace(root, bodyParts, parts.body, 'body');
    replace(root, root.children.filter(o => o.material === halo), parts.halo, 'halo');
    const fittedWheel = replace(wheel, wheelParts, parts.wheel, 'wheel');
    if (fittedWheel) {
      const front = bounds(wheel, [fittedWheel]).max.z + MODEL_FIT.wheel.overlayGap;
      lcd.position.z = front;
      for (const node of wheel.children) if (leds.includes(node.material)) node.position.z = front;
    }
    hands.forEach(({ hand, parts: old }, i) => replace(hand, old, parts.gloves[i], 'gloves'));
    housings.forEach((housing, i) => {
      if (!parts.mirrors[i]) return;
      const glass = mirrors[i]; housing.remove(glass);
      const shell = new THREE.Mesh(housing.geometry, housing.material);
      const pivot = new THREE.Group(); pivot.position.copy(housing.position); pivot.quaternion.copy(housing.quaternion);
      pivot.add(shell, glass); root.remove(housing); root.add(pivot);
      const fitted = replace(pivot, [shell], parts.mirrors[i], 'mirrors');
      glass.position.z = bounds(pivot, [fitted]).max.z + MODEL_FIT.mirrors.overlayGap;
    });
    for (const front of root.children.filter(o => o.userData.front)) {
      if (parts.tyres[0]) replace(front, [...front.children], parts.tyres[0].clone(true), 'tyres');
    }
  }
  const lcdCtx = lcdCanvas.getContext('2d');
  return { root, wheel, leds, status, mirrors, drops, lcd: { canvas: lcdCanvas, ctx: lcdCtx, texture: lcdTex }, fronts: root.children.filter(c => c.userData.front) };
}

// 方向盤 LCD：檔位大字、時間、差距、名次、圈數、輪胎與 ERS。
export function drawLcd(lcd, data) {
  const { ctx } = lcd, W = 512, H = 300;
  ctx.fillStyle = '#020507'; ctx.fillRect(0, 0, W, H);
  const box = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const text = (t, x, y, size, color, weight = 800) => { ctx.fillStyle = color; ctx.font = `${weight} ${size}px "Bahnschrift","Consolas",monospace`; ctx.fillText(t, x, y); };
  box(6, 6, 160, 64, '#0c2b14'); text(data.lapTime, 86, 40, 34, '#4dff7a');
  box(346, 6, 160, 64, data.delta <= 0 ? '#0c2b14' : '#2b0c0c'); text(`${data.delta > 0 ? '+' : ''}${data.delta.toFixed(2)}`, 426, 40, 36, data.delta <= 0 ? '#4dff7a' : '#ff5a5a');
  box(176, 6, 160, 206, '#05090c'); text(String(data.gear), 256, 112, 170, '#f4ff3a');
  box(6, 78, 160, 64, '#1a1d07'); text(data.position > 0 ? `P${data.position}` : 'P–', 86, 112, 44, '#f4ff3a');
  box(346, 78, 160, 64, '#1a1d07'); text(`L${data.lap}`, 426, 112, 40, '#f4ff3a');
  box(6, 150, 160, 62, '#101418'); text(`${Math.round(data.speed)}`, 86, 182, 40, '#ffffff');
  box(346, 150, 160, 62, '#101418'); text(`${Math.round(data.rpm / 100) / 10}k`, 426, 182, 36, '#ffffff');
  const compound = COMPOUNDS[data.compound];
  box(6, 220, 240, 72, '#0b0f12'); ctx.fillStyle = compound.color; ctx.beginPath(); ctx.arc(46, 256, 24, 0, Math.PI * 2); ctx.fill();
  text(compound.name.slice(0, 1), 46, 257, 26, '#0b0f12'); text(`${Math.round(data.wear)}%`, 150, 256, 40, '#ffffff');
  box(256, 220, 250, 72, data.mode === 'push' ? '#3a0c0c' : data.mode === 'conserve' ? '#0c2236' : '#0b0f12');
  text(`ERS ${data.mode === 'push' ? 'HOT' : data.mode === 'conserve' ? 'SAVE' : 'BAL'}`, 381, 256, 36, '#ffffff');
  if (data.drs) { box(176, 214, 160, 4, '#26e05a'); }
  if (data.limiter) { box(6, 262, 500, 34, '#c4151c'); text('PIT LIMITER ON', 256, 280, 26, '#ffffff'); }
  lcd.texture.needsUpdate = true;
}
