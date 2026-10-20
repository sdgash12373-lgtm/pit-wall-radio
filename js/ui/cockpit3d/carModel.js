import * as THREE from 'three';
import { carbon } from './textures.js';
import { getModels, makeCar, fitModel, setTyreCompound } from './models.js';
import { contactShadow } from './atmosphere.js';

// 程序建模的 F1 賽車（車頭朝 -z，原點在車身中心的地面）。尺寸接近真車：長 5.6m、寬 2.0m。
let shared;
function materials() {
  if (shared) return shared;
  const carbonMap = carbon();
  shared = {
    carbon: new THREE.MeshPhysicalMaterial({ map: carbonMap, color: '#9aa0a6', roughness: 0.35, metalness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
    tyre: new THREE.MeshStandardMaterial({ color: '#141516', roughness: 0.85 }),
    rim: new THREE.MeshStandardMaterial({ color: '#2b2e31', roughness: 0.3, metalness: 0.9 }),
    light: new THREE.MeshStandardMaterial({ color: '#ff2a2a', emissive: '#ff1a1a', emissiveIntensity: 0 }),
    halo: new THREE.MeshStandardMaterial({ color: '#1a1c1f', roughness: 0.4, metalness: 0.5 }),
  };
  return shared;
}

// 把方塊頂點依 z 位置縮放，做出漸縮的車鼻與引擎蓋。
function tapered(w, h, l, fn, segs = 12) {
  const g = new THREE.BoxGeometry(w, h, l, 2, 2, segs);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i), t = z / l + 0.5; // 0=前端(-z) 1=後端
    const [sx, sy, dy] = fn(t, p.getY(i) > 0);
    p.setX(i, p.getX(i) * sx); p.setY(i, p.getY(i) * sy + dy);
  }
  g.computeVertexNormals();
  return g;
}

export function createCar(color, compoundColor = '#f4d35e', models = getModels()) {
  const m = materials();
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 });
  const car = new THREE.Group();
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true; mesh.receiveShadow = true; car.add(mesh); return mesh;
  };
  // 底板與擴散器
  add(new THREE.BoxGeometry(1.5, 0.04, 4.6), m.carbon, 0, 0.06, 0.2);
  add(new THREE.BoxGeometry(1.0, 0.22, 0.5), m.carbon, 0, 0.17, 2.55, -0.45);
  // 車鼻（前窄後寬、前低後高）
  add(tapered(0.42, 0.26, 2.4, (t, top) => [0.45 + t * 0.55, 0.6 + t * 0.4, top ? -0.05 * (1 - t) : 0]), paint, 0, 0.36, -1.7);
  // 駕駛艙與單體殼
  add(tapered(0.75, 0.48, 1.7, t => [0.8 + t * 0.2, 1, 0]), paint, 0, 0.5, -0.1);
  // 側箱（底部內縮）
  for (const s of [-1, 1]) add(tapered(0.5, 0.42, 1.9, (t, top) => [1, top ? 1 : 0.7, 0]), paint, s * 0.58, 0.38, 0.55, 0, 0, s * 0.05);
  // 引擎蓋與鯊魚鰭
  add(tapered(0.5, 0.55, 1.8, (t, top) => [1 - t * 0.5, 1 - t * 0.55, top ? -t * 0.12 : 0]), paint, 0, 0.72, 1.15);
  add(new THREE.BoxGeometry(0.02, 0.34, 1.1), paint, 0, 1.05, 1.35);
  // 進氣口（頭頂）
  add(new THREE.BoxGeometry(0.28, 0.24, 0.35), m.carbon, 0, 1.02, 0.42);
  // Halo
  const haloCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.38, 0.72, 0.55), new THREE.Vector3(-0.36, 0.92, 0.05), new THREE.Vector3(-0.2, 0.98, -0.32),
    new THREE.Vector3(0, 0.99, -0.38), new THREE.Vector3(0.2, 0.98, -0.32), new THREE.Vector3(0.36, 0.92, 0.05), new THREE.Vector3(0.38, 0.72, 0.55)]);
  add(new THREE.TubeGeometry(haloCurve, 24, 0.035, 8), m.halo, 0, 0, 0);
  add(new THREE.CylinderGeometry(0.03, 0.04, 0.3, 8), m.halo, 0, 0.84, -0.48, -0.5);
  // 前翼（三片）與端板
  for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(1.9 - i * 0.18, 0.02, 0.22), i ? paint : m.carbon, 0, 0.09 + i * 0.05, -2.62 + i * 0.12, -0.1 - i * 0.1);
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.02, 0.2, 0.55), m.carbon, s * 0.96, 0.15, -2.55);
  // 尾翼與 DRS 片、端板
  add(new THREE.BoxGeometry(1.0, 0.03, 0.32), paint, 0, 0.92, 2.55, 0.15);
  add(new THREE.BoxGeometry(1.0, 0.025, 0.2), m.carbon, 0, 1.02, 2.5, 0.5);
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.025, 0.55, 0.55), paint, s * 0.51, 0.8, 2.52);
  add(new THREE.BoxGeometry(0.06, 0.4, 0.06), m.carbon, 0, 0.7, 2.45);
  // 雨燈（尾部中央）
  const light = add(new THREE.BoxGeometry(0.12, 0.05, 0.02), m.light.clone(), 0, 0.5, 2.82);
  // 輪胎：側壁配方色環
  const wheels = [];
  const stripe = new THREE.MeshStandardMaterial({ color: compoundColor, roughness: 0.6, emissive: compoundColor, emissiveIntensity: 0.08 });
  for (const [x, z, r, w] of [[-0.82, -1.65, 0.36, 0.33], [0.82, -1.65, 0.36, 0.33], [-0.8, 1.75, 0.36, 0.42], [0.8, 1.75, 0.36, 0.42]]) {
    const wheel = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 28), m.tyre); tyre.rotation.z = Math.PI / 2; tyre.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.01, 16), m.rim); rim.rotation.z = Math.PI / 2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.8, 0.012, 6, 32), stripe); ring.rotation.y = Math.PI / 2; ring.position.x = Math.sign(x) * (w / 2 + 0.006);
    wheel.add(tyre, rim, ring); wheel.position.set(x, r, z); car.add(wheel); wheels.push(wheel);
    // 懸吊臂
    add(new THREE.CylinderGeometry(0.018, 0.018, Math.abs(x) - 0.2, 6), m.carbon, x / 2, r + 0.08, z, 0, 0, Math.PI / 2);
  }
  car.add(contactShadow(2.3, 6.2));
  car.userData = { wheels, light: light.material, stripe, paint };
  const model = models && makeCar(color, models);
  if (model) {
    const shadow = car.children.at(-1), box = new THREE.Box3();
    car.updateMatrixWorld(true);
    for (const child of car.children) if (child !== shadow) box.union(new THREE.Box3().setFromObject(child));
    const fitted = fitModel(model, box, 'car');
    fitted.position.y -= new THREE.Box3().setFromObject(fitted).min.y;
    for (const child of [...car.children]) if (child !== light && child !== shadow) car.remove(child);
    car.add(fitted);
    car.userData.wheels = model.userData.wheels;
    car.userData.model = model;
    setTyreCompound(model, compoundColor);
  }
  return car;
}

export function setCompound(car, color) { setTyreCompound(car.userData.model, color); car.userData.stripe.color.set(color); car.userData.stripe.emissive.set(color); }
export function setRainLight(car, on, time) { car.userData.light.emissiveIntensity = on ? (Math.sin(time * 14) > 0 ? 6 : 0.4) : 0; }
export function spinWheels(car, distance) {
  for (const w of car.userData.wheels ?? []) {
    if (car.userData.model) w.rotation.x = -distance / 0.36;
    else w.children[0].rotation.x = w.children[1].rotation.x = -distance / 0.36;
  }
}
