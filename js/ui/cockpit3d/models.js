import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// All coordinates below are proportions of the original (unrotated) bounding box.
export const MODEL_STYLE = {
  weldTolerance: 1e-5, roughness: 0.55, metalness: 0.1,
  colors: { tyre: '#1b1c1f', carbon: '#222428', halo: '#141619', wheel: '#202326',
    screen: '#0b0d10', rubber: '#151617', rim: '#2a2d30', white: '#ffffff', visor: '#10141a', dark: '#292d33' },
  car: { floor: 0.1, wheelX: 0.62, wheelZ: [-0.68, 0.51], wheelRadius: 0.17, wheelY: 0.31,
    componentX: 0.55, componentZ: 0.22, roundMin: 0.6, roundMax: 1.6, maxWheelHeight: 0.8,
    minWheelHeight: 0.35,
    endX: 0.85, endZ: 0.83, endShade: 0.65 },
  body: { floor: 0.1, innerX: 0.28, innerZ: 0.3, upNormal: 0.5, recessY: 0.55 },
  gloves: { cuff: 0.18 },
  wheel: { gripX: 0.72, screenX: 0.35, screenY0: 0.35, screenY1: 0.75, frontZ: 0.6,
    flatNormal: 0.75, buttonZ: 0.82, buttonX: 0.42, buttonY: 0.4,
    buttons: ['#ec3535', '#f4d35e', '#3885ff', '#37d46a'] },
  crew: { headY: 0.76, visorZ: 0.65, shoeY: 0.13, gloveX: 0.78, gloveY: 0.55 },
  tyre: { rimRadius: 0.56, ringRadius: 0.81, ringWidth: 0.045, sideX: 0.72 },
};

// Radians, optional reflection, and the axis used for uniform bbox fitting.
// Adjusting this table is sufficient to correct the unknown Tripo facing direction.
export const MODEL_FIT = {
  // body／halo／gloves 的 box 由 Claude 在駕駛視角實測後指定（座艙座標，鏡頭在原點、前方為 -z）。
  car: { rotateY: Math.PI, axis: 'z' }, body: { rotateY: 0, axis: 'x', box: [-1.0, -0.8, -1.7, 1.0, -0.28, 0.3] },
  halo: { rotateY: 0, axis: 'x', box: [-0.44, -0.3, -1.1, 0.44, 0.3, 0.15] }, gloves: { rotateY: 0, axis: 'y', box: [-0.03, -0.065, -0.01, 0.07, 0.065, 0.08] },
  wheel: { rotateY: Math.PI, axis: 'x', overlayGap: 0.003 },
  mirrors: { rotateY: 0, axis: 'x', overlayGap: 0.002 },
  tyres: { rotateY: 0, axis: 'y' }, crew: { rotateY: 0, axis: 'y' },
};
const FILES = { body: 'cockpit_v1', halo: 'cockpit_v2', gloves: 'cockpit_v3', wheel: 'cockpit_v4',
  car: 'car', crew: 'crew', mirrors: 'mirror', tyres: 'tyre' };
let pending, loaded = null;
export function getModels() { return loaded; }
export function preloadModels() {
  return pending ??= Promise.all(Object.entries(FILES).map(async ([key, file]) => {
    try {
      const gltf = await new GLTFLoader().loadAsync(new URL(`../../../assets/models/${file}.glb`, import.meta.url).href);
      return [key, prepareModel(gltf.scene, key)];
    } catch { return [key, null]; }
  })).then(entries => (loaded = Object.fromEntries(entries)));
}

// Position-only weld, with neighbouring spatial buckets to respect true distance
// even across bucket boundaries. Does not mutate the input or require a DOM.
export function weldPositions(geometry, tolerance = MODEL_STYLE.weldTolerance) {
  if (!(tolerance > 0)) throw new RangeError('tolerance must be positive');
  const p = geometry.getAttribute('position'), buckets = new Map(), positions = [], remap = [];
  for (let i = 0; i < p.count; i++) {
    const v = [p.getX(i), p.getY(i), p.getZ(i)], cell = v.map(n => Math.floor(n / tolerance));
    let found;
    for (let x = -1; x <= 1 && found === undefined; x++) for (let y = -1; y <= 1 && found === undefined; y++) for (let z = -1; z <= 1 && found === undefined; z++) {
      for (const j of buckets.get(`${cell[0] + x},${cell[1] + y},${cell[2] + z}`) ?? []) {
        if (v.reduce((sum, n, k) => sum + (n - positions[j * 3 + k]) ** 2, 0) <= tolerance ** 2) { found = j; break; }
      }
    }
    if (found === undefined) {
      found = positions.length / 3; positions.push(...v);
      const key = cell.join(','); if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(found);
    }
    remap.push(found);
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setIndex(Array.from({ length: geometry.index?.count ?? p.count }, (_, i) => remap[geometry.index ? geometry.index.getX(i) : i]));
  result.computeVertexNormals(); result.computeBoundingBox();
  return result;
}

// Components connect at shared vertices. Returned geometries retain original
// coordinates; userData.center / boundingBox describe each component.
export function splitComponents(geometry) {
  const p = geometry.getAttribute('position'), index = geometry.index;
  const ids = index ? Array.from(index.array) : Array.from({ length: p.count }, (_, i) => i);
  const parents = Array.from({ length: p.count }, (_, i) => i);
  const find = i => { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; } return i; };
  for (let i = 0; i < ids.length; i += 3) { const a = find(ids[i]); parents[find(ids[i + 1])] = a; parents[find(ids[i + 2])] = a; }
  const groups = new Map();
  for (let i = 0; i < ids.length; i += 3) { const key = find(ids[i]); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(...ids.slice(i, i + 3)); }
  return [...groups.values()].map(triangles => {
    const g = new THREE.BufferGeometry(), map = new Map(), vertices = [], indices = [];
    for (const id of triangles) {
      if (!map.has(id)) { map.set(id, map.size); vertices.push(id); }
      indices.push(map.get(id));
    }
    for (const [name, attr] of Object.entries(geometry.attributes)) {
      const values = vertices.flatMap(id => Array.from({ length: attr.itemSize }, (_, k) => attr.getComponent(id, k)));
      g.setAttribute(name, new THREE.BufferAttribute(new attr.array.constructor(values), attr.itemSize, attr.normalized));
    }
    g.setIndex(indices); g.computeBoundingBox();
    g.userData.center = g.boundingBox.getCenter(new THREE.Vector3());
    const s = g.boundingBox.getSize(new THREE.Vector3()); g.userData.volume = s.x * s.y * s.z;
    return g;
  }).sort((a, b) => b.userData.volume - a.userData.volume);
}

// Rule inputs: x/z in [-1,1], y in [0,1], normalized normal, and optional
// component metadata. Values are region names, mapped to linear vertex colors.
export const COLOR_RULES = {
  car(p, n, component = {}) {
    const s = MODEL_STYLE.car;
    if (component.isWheel) return tyreRegion(p);
    if (Math.abs(p.x) > s.wheelX && s.wheelZ.some(z => Math.hypot(p.z - z, (p.y - s.wheelY) * (p.aspectY ?? 1) * 2) < s.wheelRadius)) return 'tyre';
    if (p.y < s.floor) return 'carbon';
    return Math.abs(p.x) > s.endX && Math.abs(p.z) > s.endZ ? 'teamDark' : 'team';
  },
  body(p, n) { const s = MODEL_STYLE.body; return p.y < s.floor || (Math.abs(p.x) < s.innerX && p.z > -s.innerZ && (n.y > s.upNormal || p.y < s.recessY)) ? 'carbon' : 'team'; },
  halo() { return 'halo'; },
  gloves(p) { return p.y < MODEL_STYLE.gloves.cuff ? 'white' : 'team'; },
  wheel(p, n) {
    const s = MODEL_STYLE.wheel;
    if (Math.abs(p.x) > s.gripX) return 'rubber';
    if (Math.abs(p.x) < s.screenX && p.y > s.screenY0 && p.y < s.screenY1 && p.z > s.frontZ && n.z > s.flatNormal) return 'screen';
    if (p.z > s.buttonZ && Math.abs(p.x) > s.buttonX) return `button${(p.x > 0 ? 2 : 0) + (p.y > s.buttonY ? 1 : 0)}`;
    return 'wheel';
  },
  crew(p) { const s = MODEL_STYLE.crew; return p.y > s.headY && p.z > s.visorZ ? 'visor' : p.y < s.shoeY || (Math.abs(p.x) > s.gloveX && p.y < s.gloveY) ? 'dark' : 'team'; },
  mirrors() { return 'team'; }, tyres: tyreRegion,
};
function tyreRegion(p) {
  const s = MODEL_STYLE.tyre, r = Math.hypot((p.y - 0.5) * 2, p.z);
  if (Math.abs(p.x) > s.sideX && Math.abs(r - s.ringRadius) < s.ringWidth) return 'compound';
  return r < s.rimRadius ? 'rim' : 'tyre';
}
function proportional(p, box) {
  const s = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  return { x: (p.x - c.x) * 2 / (s.x || 1), y: (p.y - box.min.y) / (s.y || 1), z: (p.z - c.z) * 2 / (s.z || 1), aspectY: s.y / (s.z || 1) };
}
export function colorGeometry(g, key, fullBox, component = {}) {
  const p = g.attributes.position, n = g.attributes.normal, colors = [], weights = [], point = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    point.fromBufferAttribute(p, i); normal.fromBufferAttribute(n, i);
    const region = COLOR_RULES[key](proportional(point, component.colorBox ?? (key === 'tyres' || key === 'gloves' ? g.boundingBox : fullBox)), normal, component);
    const c = new THREE.Color(region.startsWith('team') || region === 'compound' ? '#ffffff' : region.startsWith('button') ? MODEL_STYLE.wheel.buttons[Number(region.slice(-1))] : MODEL_STYLE.colors[region]);
    if (region === 'teamDark') c.multiplyScalar(MODEL_STYLE.car.endShade);
    colors.push(c.r, c.g, c.b); weights.push(region.startsWith('team') ? 1 : 0, region === 'compound' ? 1 : 0);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('modelTint', new THREE.Float32BufferAttribute(weights, 2));
  return g;
}
export function prepareModel(scene, key) {
  scene.updateMatrixWorld(true);
  const geometries = [];
  scene.traverse(o => { if (o.isMesh) geometries.push(o.geometry.clone().applyMatrix4(o.matrixWorld)); });
  if (!geometries.length) return null;
  const merged = new THREE.BufferGeometry(), positions = [];
  for (const g of geometries) {
    const p = g.attributes.position;
    for (let i = 0; i < (g.index?.count ?? p.count); i++) { const j = g.index ? g.index.getX(i) : i; positions.push(p.getX(j), p.getY(j), p.getZ(j)); }
    g.dispose();
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const welded = weldPositions(merged); merged.dispose();
  const box = welded.boundingBox.clone(), parts = splitComponents(welded); welded.dispose();
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3()), s = MODEL_STYLE.car;
  const candidates = key === 'car' ? parts.filter(g => {
    const c = g.userData.center, d = g.boundingBox.getSize(new THREE.Vector3()), round = d.y / d.z;
    return Math.abs(c.x - center.x) > size.x * s.componentX / 2 && Math.abs(c.z - center.z) > size.z * s.componentZ / 2 && round > s.roundMin && round < s.roundMax && d.y < size.y * s.maxWheelHeight && d.y > size.y * s.minWheelHeight;
  }) : [];
  // Tyres and their separate rims can occupy the same corner. Use the largest
  // component as the pivot and color-space bbox for all pieces at that corner.
  const corners = new Map();
  for (const g of candidates) {
    const corner = `${Math.sign(g.userData.center.x - center.x)},${Math.sign(g.userData.center.z - center.z)}`;
    if (!corners.has(corner)) corners.set(corner, []); corners.get(corner).push(g);
  }
  if (corners.size === 4) for (const [corner, group] of corners) for (const g of group) {
    g.userData.wheelGroup = corner; g.userData.wheelCenter = group[0].userData.center;
    g.userData.colorBox = group[0].boundingBox;
  }
  // Use the whole left/right object bbox when a tyre or glove has loose details.
  if (key === 'tyres' || key === 'gloves') for (const side of [-1, 1]) {
    const group = parts.filter(g => (g.userData.center.x < center.x ? -1 : 1) === side), colorBox = new THREE.Box3();
    for (const g of group) colorBox.union(g.boundingBox);
    for (const g of group) g.userData.colorBox = colorBox;
  }
  for (const g of parts) { g.userData.isWheel = !!g.userData.wheelGroup; colorGeometry(g, key, box, g.userData); }
  // Keep raw components for inspection, but merge static pieces once to avoid
  // dozens of draw calls per car. All instances share these prepared buffers.
  const renderParts = [];
  const groups = new Map();
  for (const g of parts) {
    const groupKey = key === 'car' ? g.userData.wheelGroup ?? 'body' : (key === 'tyres' || key === 'gloves' || key === 'mirrors') ? (g.userData.center.x < center.x ? 'left' : 'right') : 'all';
    if (!groups.has(groupKey)) groups.set(groupKey, []); groups.get(groupKey).push(g);
  }
  for (const group of groups.values()) renderParts.push(mergeParts(group));
  return { parts, renderParts, box };
}
function mergeParts(parts) {
  const g = new THREE.BufferGeometry(), indices = [];
  let offset = 0;
  for (const part of parts) { for (const id of part.index.array) indices.push(id + offset); offset += part.attributes.position.count; }
  for (const [key, attr] of Object.entries(parts[0].attributes)) {
    const array = new Float32Array(parts.reduce((sum, part) => sum + part.attributes[key].array.length, 0));
    let at = 0; for (const part of parts) { array.set(part.attributes[key].array, at); at += part.attributes[key].array.length; }
    g.setAttribute(key, new THREE.BufferAttribute(array, attr.itemSize));
  }
  g.setIndex(indices); g.computeBoundingBox();
  g.userData = { ...parts[0].userData, center: g.boundingBox.getCenter(new THREE.Vector3()) };
  return g;
}
function material(team, compound = '#f4d35e') {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: MODEL_STYLE.roughness, metalness: MODEL_STYLE.metalness, side: THREE.DoubleSide });
  m.userData.modelUniforms = { teamTint: { value: new THREE.Color(team) }, compoundTint: { value: new THREE.Color(compound) } };
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, m.userData.modelUniforms);
    shader.vertexShader = 'attribute vec2 modelTint;\nuniform vec3 teamTint;\nuniform vec3 compoundTint;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\nvColor.xyz *= mix(vec3(1.0), teamTint, modelTint.x) * mix(vec3(1.0), compoundTint, modelTint.y);');
  };
  m.customProgramCacheKey = () => 'tripo-tint-v1';
  return m;
}
function updateTint(object, name, color) {
  const seen = new Set();
  object?.traverse(o => { for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) {
    if (!seen.has(m)) { m.userData.modelUniforms?.[name]?.value.set(color); seen.add(m); }
  } });
  return object;
}
export function tintModel(object, color) { return updateTint(object, 'teamTint', color); }
export function setTyreCompound(object, color) { return updateTint(object, 'compoundTint', color); }
function instance(key, color, models, parts = models?.[key]?.renderParts ?? models?.[key]?.parts) {
  if (!parts?.length) return null;
  const root = new THREE.Group(), content = new THREE.Group(), fit = MODEL_FIT[key], m = material(color);
  content.rotation.set(fit.rotateX ?? 0, fit.rotateY ?? 0, fit.rotateZ ?? 0);
  content.scale.set(fit.flipX ? -1 : 1, fit.flipY ? -1 : 1, fit.flipZ ? -1 : 1);
  root.add(content); root.userData.wheels = [];
  for (const g of parts) {
    const mesh = new THREE.Mesh(g, m); mesh.castShadow = mesh.receiveShadow = true;
    if (g.userData.isWheel) {
      const pivot = new THREE.Group(); pivot.position.copy(g.userData.wheelCenter ?? g.userData.center); mesh.position.copy(pivot.position).negate();
      pivot.add(mesh); content.add(pivot); root.userData.wheels.push(pivot);
    } else content.add(mesh);
  }
  return root;
}
export function makeCar(color, models = getModels()) { return instance('car', color, models); }
export function makeCrew(color, models = getModels()) { return instance('crew', color, models); }
function pair(key, color, models) {
  const parts = models?.[key]?.renderParts ?? models?.[key]?.parts;
  if (!parts?.length) return [null, null];
  // Retain every reconstruction fragment on its corresponding side.
  const center = models[key].box.getCenter(new THREE.Vector3()).x;
  return [-1, 1].map(sign => instance(key, color, models, parts.filter(g => (g.userData.center.x < center ? -1 : 1) === sign)));
}
export function makeCockpitParts(color, models = getModels()) {
  if (!models) return null;
  return { body: instance('body', color, models), halo: instance('halo', color, models), wheel: instance('wheel', color, models),
    gloves: pair('gloves', color, models), mirrors: pair('mirrors', color, models),
    tyres: pair('tyres', color, models) };
}
export function makeTyre(compoundColor, models = getModels()) {
  const part = (models?.tyres?.renderParts ?? models?.tyres?.parts)?.[0];
  return setTyreCompound(part ? instance('tyres', '#ffffff', models, [part]) : null, compoundColor);
}

// Fit in the parent's local coordinates; neither shared geometry nor its bbox
// is changed. A separate pivot preserves existing steering/animation groups.
export function fitModel(object, targetBox, key) {
  const wrapper = new THREE.Group(); wrapper.add(object);
  // MODEL_FIT[key].box = [minX, minY, minZ, maxX, maxY, maxZ]（父層座標）可直接指定放置範圍，取代程式部件的 bbox。
  const manual = MODEL_FIT[key].box;
  if (manual) targetBox = new THREE.Box3(new THREE.Vector3(...manual.slice(0, 3)), new THREE.Vector3(...manual.slice(3)));
  const source = new THREE.Box3().setFromObject(object), from = source.getSize(new THREE.Vector3()), to = targetBox.getSize(new THREE.Vector3());
  const axis = MODEL_FIT[key].axis;
  const scale = axis ? to[axis] / (from[axis] || 1) : Math.max(to.x, to.y, to.z) / (Math.max(from.x, from.y, from.z) || 1);
  object.scale.multiplyScalar(scale);
  object.position.copy(source.getCenter(new THREE.Vector3())).multiplyScalar(-scale);
  wrapper.position.copy(targetBox.getCenter(new THREE.Vector3()));
  return wrapper;
}
