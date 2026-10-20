import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildPath, sample, speedAt, racingLine, distanceAtFraction } from './trackPath.js';
import { buildWorld } from './world.js';
import { buildTrackside, PIT } from './trackside.js';
import { createCar, setCompound, setRainLight, spinWheels } from './carModel.js';
import { createCockpit, drawLcd } from './cockpitModel.js';
import { getModels, preloadModels } from './models.js';
import { droplets, sprayTexture } from './textures.js';
import { createSunFlare, createToonSky, createPuffyClouds } from './atmosphere.js';
import { COMPOUNDS } from '../../data/tyres.js';
import { createPostFX } from './postfx.js';

const GEARS = [0, 85, 125, 160, 195, 228, 258, 288]; // 各檔起始速度（km/h）
const EYE = 0.92;
const PIT_SPEED = 80 / 3.6;

const smooth = t => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

// 發車格：每格相隔 8 公尺、左右交錯，桿位在起跑線後 8 公尺。
export function gridSlot(position) {
  return { s: -8 - (position - 1) * 8, lateral: position % 2 ? -2.4 : 2.4 };
}

// Three.js 擬真第一人稱座艙。
// 模式：grid（發車格待命）→ race（依單圈進度行駛）；pit（進站流程）；garage（停在 P 房前，排位出發前）。
export class Cockpit3D {
  constructor(canvas, teams, track) {
    this.canvas = canvas; this.teams = teams; this.track = track;
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // 卡通風：Neutral 色調映射保留飽和色彩。
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.path = buildPath(track);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.03, 3000);
    // rig＝車身位置；head＝駕駛頭部（座艙模型掛在此，跟車身一起震動）；camera 只負責俯仰。
    this.rig = new THREE.Group(); this.head = new THREE.Group(); this.head.position.y = EYE;
    this.rig.add(this.head); this.head.add(this.camera);
    this.scene.add(this.rig);

    this.sky = null; this.envRT = null;
    this.sun = new THREE.Vector3();
    this.hemi = new THREE.HemisphereLight('#cfe3ff', '#4a5a3a', 0.7); this.scene.add(this.hemi);
    const light = this.light = new THREE.DirectionalLight('#fff4e0', 3.2);
    const shadowSize = Math.min(2048, renderer.capabilities.maxTextureSize);
    light.castShadow = true; light.shadow.mapSize.set(shadowSize, shadowSize);
    Object.assign(light.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 260 });
    light.shadow.bias = -0.00025; light.shadow.normalBias = 0.015; light.shadow.radius = 3;
    this.scene.add(light, light.target);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.flare = createSunFlare(); this.scene.add(this.flare);
    this.clouds = null; this.cockpit = null; this.trackside = null;
    this.ownColor = '#cad9e5';

    this.mirrorTarget = new THREE.WebGLRenderTarget(640, 200, { samples: 2 });
    this.mirrorTarget.texture.colorSpace = THREE.SRGBColorSpace;
    this.rearCamera = new THREE.PerspectiveCamera(26, 3.2, 0.5, 900);
    this.rearCamera.position.set(0, EYE + 0.05, 0.4); this.rearCamera.rotation.y = Math.PI;
    this.rig.add(this.rearCamera);

    const dropMat = new THREE.MeshBasicMaterial({ map: droplets(), transparent: true, opacity: 0, depthWrite: false, depthTest: false });
    this.drops = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), dropMat); this.drops.renderOrder = 999;
    this.drops.position.z = -0.08; this.camera.add(this.drops);
    const rainGeo = new THREE.BufferGeometry(); const n = 1400;
    this.rainPos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) this.resetDrop(i, true);
    rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#b8c6d2', transparent: true, opacity: 0.35 }));
    this.rain.frustumCulled = false; this.rain.visible = false; this.rig.add(this.rain);
    const sprayGeo = new THREE.BufferGeometry(); this.sprayPos = new Float32Array(160 * 3);
    sprayGeo.setAttribute('position', new THREE.BufferAttribute(this.sprayPos, 3));
    this.spray = new THREE.Points(sprayGeo, new THREE.PointsMaterial({ map: sprayTexture(), size: 2.6, transparent: true, opacity: 0.0, depthWrite: false, color: '#dfe7ee' }));
    this.spray.frustumCulled = false; this.scene.add(this.spray);

    // 轉播攝影機風格後製；手機（窄螢幕）用低畫質。
    const narrow = (canvas.getBoundingClientRect().width || 1280) < 760;
    this.postfx = createPostFX(renderer, this.scene, this.camera, { quality: narrow ? 'low' : 'high' });

    this.cars = new Map();
    preloadModels(); // Tripo 模型背景載入，完成後由 applyModels 套用
    this.motionRate = 1 / 14; this.lastMotion = undefined;
    this.mode = 'race'; this.synced = false; this.pit = null; this.launch = null; this.grid = null;
    this.s = 0; this.lateral = 0; this.time = 0; this.effect = null; this.lights = 0;
    this.gear = 1; this.wet = null; this.world = null; this.speedFactor = 1; this.lcdTimer = 0;
    this.telemetry = { speed: 0, rpm: 4000, gear: 1, steer: 0, throttle: 0, brake: 0, shifting: false, drs: false };
    this.resize = () => {
      const rect = canvas.getBoundingClientRect(); const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
      renderer.setPixelRatio(this.quality?.ratio ?? Math.min(globalThis.devicePixelRatio || 1, 1.5));
      renderer.setSize(w, h, false);
      this.postfx?.setSize(w, h, renderer.getPixelRatio());
      const aspect = w / h;
      this.camera.aspect = aspect;
      this.camera.position.set(0, aspect < 1 ? 0.06 : 0, aspect < 1 ? 0.2 : 0);
      this.camera.fov = THREE.MathUtils.clamp(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(50)) / aspect) * 180 / Math.PI, 56, 96);
      this.camera.updateProjectionMatrix();
      const vh = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 0.08;
      this.drops.scale.set(vh * aspect, vh, 1);
    };
    this.observer = new ResizeObserver(this.resize); this.observer.observe(canvas); this.resize();
  }

  // ── 對外控制 ─────────────────────────────────────────
  setGrid(position) { this.mode = 'grid'; this.grid = gridSlot(position); this.s = this.grid.s; this.lateral = this.grid.lateral; this.synced = false; }
  // 編隊圈：從發車格出發繞一整圈（左右擺動暖胎），結束時回到同一個發車格。
  startFormation(seconds = 14) { this.mode = 'formation'; this.formation = { t: 0, dur: seconds, fromS: this.grid?.s ?? this.s }; }
  // 冷卻圈：方格旗後以低速繼續繞行。
  startCooldown() { this.mode = 'cooldown'; this.pit = null; this.launch = null; }
  get formationDone() { return this.mode !== 'formation'; }
  setLights(count) { this.lights = count; this.trackside?.setLights(count); }
  release() { this.mode = 'race'; this.launch = { t: 0, fromS: this.s, fromLat: this.lateral }; this.synced = false; this.setLights(0); }
  boxS() { return this.trackside && this.playerTeam ? this.trackside.boxFor(this.playerTeam) : PIT.box; }
  // 進站資訊（給 HUD 的 IN PIT 計時卡與 LCD 限速器顯示）
  pitState() { return this.pit ? { phase: this.pit.phase, elapsed: this.pit.clock ?? 0 } : this.mode === 'garage' ? { phase: 'garage', elapsed: 0 } : null; }
  setGarage() { this.mode = 'garage'; this.pit = null; this.s = this.boxS(); this.synced = false; this.trackside?.placeCrew(this.boxS()); }
  leaveGarage() { this.mode = 'race'; this.pit = { phase: 'out', t: 0, stationary: 0 }; this.synced = false; if (this.trackside) this.trackside.crew.visible = false; }
  // 預告本圈結束要進站：車子到維修區入口時就沿進站路切入（race.js 依策略預測後呼叫）。
  planPit(on) {
    this.pitPlan = !!on;
    // 預測要進站但這圈其實沒有進站：已在維修區內就直接通過（drive-through）駛出。
    if (!on && this.pit && !this.pit.confirmed && this.pit.phase !== 'out') { this.pit.phase = 'out'; this.pit.t = 1.5; }
  }
  startPitEntry(info = null) {
    const fromSpeed = speedAt(this.path, this.s) * this.speedFactor;
    this.pit = { phase: 'in', t: 0, clock: 0, fromSpeed, confirmed: !!info, stationary: info ? THREE.MathUtils.clamp(info.stationarySeconds ?? 2.6, 2, 120) : null };
    this.synced = false;
  }
  transition(kind, car, info) {
    if (kind === 'pit') {
      const stationary = THREE.MathUtils.clamp(info?.stationarySeconds ?? 2.6, 2, 120);
      if (this.pit) { this.pit.confirmed = true; this.pit.stationary = stationary; return; } // 已沿進站路駛入
      const ts = this.trackside, rel = ts?.relative(this.s);
      if (ts && rel > ts.pit.from - 80 && rel < ts.pit.entryEnd) { this.startPitEntry(info); return; }
      // 未預測到的進站（鏡頭已過入口）：直接切到維修車道。
      this.pit = { phase: 'in', t: 0, clock: 0, fromSpeed: PIT_SPEED, confirmed: true, stationary };
      this.s = this.boxS() - 150; this.lateral = ts?.lane.fast ?? 13; this.synced = false;
      return;
    }
    this.effect = { kind, car, age: 0 };
  }
  getTelemetry() { return { ...this.telemetry }; }
  // 給音效用：最近幾台車的距離（公尺，正值在前）與接近速度（m/s，正值為接近）
  traffic() { return this.trafficInfo ?? []; }

  resetDrop(i, initial) {
    const x = (Math.random() - 0.5) * 40, z = -Math.random() * 45 + 3, y = initial ? Math.random() * 14 : 14;
    this.rainPos.set([x, y, z, x + 0.05, y - 0.7, z + 0.15], i * 6);
  }

  build(sim, wet) {
    if (this.world) { this.scene.remove(this.world); this.world.traverse(o => { o.geometry?.dispose(); }); }
    this.world = buildWorld(this.path, this.track, wet); this.scene.add(this.world);
    // 卡通天空與立體雲
    if (this.sky) { this.scene.remove(this.sky); this.sky.geometry.dispose(); this.sky.material.dispose(); }
    this.sky = createToonSky(wet); this.scene.add(this.sky);
    if (this.clouds) { this.scene.remove(this.clouds.group); this.clouds.dispose(); }
    this.clouds = createPuffyClouds(wet, this.track.id); this.scene.add(this.clouds.group);
    const elevation = wet ? 32 : 42, azimuth = 150;
    this.sun.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(azimuth));
    this.light.color.set(wet ? '#e6ecf2' : '#fff1d8');
    this.light.intensity = wet ? 1.2 : 2.6;
    this.hemi.color.set(wet ? '#c9d3dd' : '#bfe0ff'); this.hemi.groundColor.set(wet ? '#5b6650' : '#7fa35a');
    this.hemi.intensity = wet ? 1.5 : 1.25;
    if (!this.envRT) this.envRT = this.pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = wet ? 0.55 : 0.5;
    this.scene.background = null;
    this.scene.fog = new THREE.Fog(wet ? '#c3cad1' : '#d8ecff', wet ? 120 : 260, wet ? 900 : 1900);
    this.rain.visible = wet;
    this.flare.visible = false;
    const me = sim.getCar(sim.playerId);
    this.playerTeam = me.teamId;
    this.ownColor = this.teams.find(t => t.id === me.teamId)?.color ?? this.ownColor;
    this.modelsApplied ||= !!getModels();
    if (!this.cockpit) this.buildCockpit();
    if (!this.trackside) this.buildTrackside();
    if (this.cockpit) this.cockpit.drops.visible = wet;
    this.wet = wet;
  }
  buildCockpit() {
    if (this.cockpit) this.head.remove(this.cockpit.root);
    this.cockpit = createCockpit(this.ownColor);
    this.head.add(this.cockpit.root);
    const [left, right] = this.cockpit.mirrors;
    for (const [glass, u0, u1] of [[left, 1, 0.5], [right, 0.5, 0]]) {
      const uv = glass.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) < 0.5 ? u0 : u1);
      uv.needsUpdate = true;
      glass.material = new THREE.MeshBasicMaterial({ map: this.mirrorTarget.texture });
    }
    this.cockpit.drops.visible = !!this.wet;
  }
  buildTrackside() {
    const visible = this.trackside?.crew.visible;
    if (this.trackside) this.scene.remove(this.trackside.group);
    this.trackside = buildTrackside(this.path, this.teams, this.playerTeam, this.track.character === 'street');
    this.scene.add(this.trackside.group);
    this.trackside.setLights(this.lights);
    if (visible) this.trackside.placeCrew(this.boxS());
  }
  // Tripo 模型晚於第一次建場景載入完成時，改用模型重建座艙、賽車與技師（只做一次）。
  applyModels() {
    if (this.modelsApplied || !getModels() || !this.cockpit) return;
    this.modelsApplied = true;
    this.buildCockpit(); this.buildTrackside();
    for (const car of this.cars.values()) this.scene.remove(car);
    this.cars.clear();
  }

  carMesh(info) {
    let car = this.cars.get(info.carId);
    if (!car) {
      car = createCar(this.teams.find(t => t.id === info.teamId)?.color ?? '#cccccc');
      car.userData.dist = null;
      this.cars.set(info.carId, car); this.scene.add(car);
    }
    car.visible = true;
    return car;
  }
  placeCar(car, s, lateral, wet) {
    const p = sample(this.path, s, lateral);
    car.position.set(p.x, p.y, p.z); car.rotation.set(0, -p.heading, 0);
    spinWheels(car, s); setRainLight(car, wet, this.time);
    return p;
  }

  // ── 每幀：決定鏡頭位置與速度 ─────────────────────────
  advance(sim, me, s, motion, dt) {
    const L = this.path.L, wrap = d => ((d + L / 2) % L + L) % L - L / 2;
    let ds = 0, kmh, lateralTarget = null;
    if (this.mode === 'grid' || this.mode === 'garage') {
      kmh = 0;
    } else if (this.mode === 'formation') {
      const f = this.formation; f.t += dt;
      const u = Math.min(1, f.t / f.dur), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; // 慢起步、慢停車
      const target = f.fromS + L * e;
      ds = Math.max(0, target - this.s); kmh = 30 + 120 * Math.sin(Math.PI * u) * (0.8 + 0.2 * Math.sin(f.t * 1.7)); // 編隊圈實際約 80~150 km/h
      lateralTarget = racingLine(this.path, this.s) * 0.4 + Math.sin(f.t * 3.2) * 1.4 * Math.sin(Math.PI * u); // 擺動暖胎
      if (u >= 1) { this.mode = 'grid'; this.s = f.fromS; ds = 0; kmh = 0; }
    } else if (this.mode === 'cooldown') {
      const v = speedAt(this.path, this.s) * 0.42; ds = v * dt * 1.5; kmh = v * 3.6;
    } else if (this.pit) {
      const p = this.pit, ts = this.trackside, lane = ts?.lane ?? { fast: 13, work: 18.4 };
      const layout = ts?.pit ?? { from: PIT.from, to: PIT.to, entryEnd: PIT.from + 150, exitStart: PIT.to - 170 };
      const rel = ts ? ts.relative(this.s) : this.s, route = ts ? ts.routeLat(this.s) : lane.fast;
      // 維修區畫面與單圈縮時比例一致（儀表仍顯示 80 km/h 限速）。
      const scale = THREE.MathUtils.clamp(this.path.lapSeconds * this.motionRate, 1, 8);
      p.t += dt * (p.phase === 'stop' ? 1 : scale);
      p.clock = (p.clock ?? 0) + dt * (p.phase === 'stop' ? 1 : scale); // 維修區內經過的（模擬）秒數
      if (p.phase === 'in') {
        const remain = this.boxS() - rel;
        // 進站路上從賽道速度減速到限速，過了限速線維持 80 km/h，接近 P 房再停車。
        const entering = THREE.MathUtils.clamp((rel - layout.from) / (layout.entryEnd - layout.from), 0, 1);
        const cruise = PIT_SPEED + Math.max(0, (p.fromSpeed ?? PIT_SPEED) - PIT_SPEED) * (1 - smooth(entering));
        const v = Math.min(cruise, Math.max(1.5, remain * 0.9));
        ds = Math.min(Math.max(0, remain), v * dt * scale); kmh = v * 3.6;
        lateralTarget = remain < 60 ? lane.fast + (lane.work - lane.fast) * smooth(1 - remain / 60) : route;
        if (remain < 0.3) { p.phase = 'stop'; p.t = 0; ts?.placeCrew(this.boxS()); }
      } else if (p.phase === 'stop') {
        kmh = 0; lateralTarget = lane.work;
        if (p.stationary !== null && p.t > p.stationary) { p.phase = 'out'; p.t = 0; }
      } else {
        const exiting = THREE.MathUtils.clamp((rel - layout.exitStart) / (layout.to - layout.exitStart), 0, 1);
        const v = Math.min(PIT_SPEED + (speedAt(this.path, this.s) - PIT_SPEED) * smooth(exiting), 4 + p.t * 9);
        ds = v * dt * scale; kmh = v * 3.6;
        lateralTarget = rel < layout.exitStart ? lane.fast + (lane.work - lane.fast) * (1 - smooth(p.t / 1.5)) : route;
        if (rel >= layout.to) { this.pit = null; this.pitPlan = false; this.synced = false; if (ts) ts.crew.visible = false; }
      }
    } else {
      // 正賽／排位：跟隨單圈進度；起步、出站後先追上進度再鎖定。
      const target = distanceAtFraction(this.path, motion);
      const delta = wrap(target - this.s);
      const base = speedAt(this.path, this.s);
      if (this.launch) {
        this.launch.t += dt;
        const v = Math.min(base, 3 + this.launch.t * 13);
        ds = Math.min(Math.max(0, delta) + 40, v * dt); kmh = v * 3.6;
        if (this.launch.t > 1.2 && delta < 1) { this.launch = null; this.synced = true; }
      } else if (this.synced && Math.abs(delta) < 60) {
        ds = Math.max(0, delta); kmh = base * 3.6 * this.speedFactor;
      } else {
        const v = delta > 0 ? Math.max(base, delta * 1.5) : base * 0.6;
        ds = delta > 0 ? Math.min(delta, v * dt) : v * dt * 0.2; kmh = base * 3.6 * this.speedFactor;
        if (Math.abs(delta) < 2) this.synced = true;
      }
    }
    this.s += ds;
    if (this.s > L) this.s -= L;
    // 預告進站：抵達維修區入口時切入進站路
    if (this.mode === 'race' && this.pitPlan && !this.pit && !this.launch && this.trackside) {
      const rel = this.trackside.relative(this.s), from = this.trackside.pit.from;
      if (rel >= from && rel < from + 80) this.startPitEntry();
    }
    // 橫向位置
    let lateral = lateralTarget ?? racingLine(this.path, this.s);
    if (this.launch && this.grid) lateral = this.launch.fromLat + (racingLine(this.path, this.s) - this.launch.fromLat) * smooth((this.s - this.launch.fromS) / 160);
    if (this.mode === 'grid' && this.grid) lateral = this.grid.lateral;
    if (this.mode === 'formation' && this.grid) lateral += this.grid.lateral * (1 - Math.sin(Math.PI * Math.min(1, this.formation.t / this.formation.dur)));
    if (this.mode === 'garage') lateral = this.trackside?.lane.work ?? 18.4;
    if (this.effect?.kind === 'pass') lateral += Math.sin(Math.min(1, this.effect.age / 1.6) * Math.PI) * -3;
    this.lateral += (lateral - this.lateral) * Math.min(1, dt * 6);
    return { ds, kmh };
  }

  // 自動畫質：每秒檢查平均幀時間，太慢就降低解析度，有餘裕再調回。
  adaptQuality(dt) {
    const q = this.quality ??= { acc: 0, n: 0, ratio: Math.min(globalThis.devicePixelRatio || 1, 1.5), max: Math.min(globalThis.devicePixelRatio || 1, 1.5) };
    q.acc += dt; q.n++;
    if (q.acc < 1) return;
    const avg = q.acc / q.n; q.acc = 0; q.n = 0;
    let next = q.ratio;
    if (avg > 0.021) next = Math.max(0.6, q.ratio - 0.15); else if (avg < 0.0135) next = Math.min(q.max, q.ratio + 0.1);
    if (Math.abs(next - q.ratio) > 0.01) { q.ratio = next; this.renderer.setPixelRatio(next); const rect = this.canvas.getBoundingClientRect(); this.renderer.setSize(rect.width, rect.height, false); this.postfx?.setSize(rect.width, rect.height, next); }
  }

  draw(sim, motion, dt) {
    if (dt > 0) this.adaptQuality(dt);
    const s = sim.getPlayerSituation(), me = sim.getCar(sim.playerId);
    const wet = s.wetness >= 0.2;
    if (this.wet !== wet) this.build(sim, wet);
    this.applyModels();
    this.time += dt;
    if (this.effect) { this.effect.age += dt; if (this.effect.age > 1.8) this.effect = null; }
    let target = 1;
    if (s.safetyCar === 'sc') target = 0.5; else if (s.safetyCar === 'vsc') target = 0.62;
    if (wet) target *= 0.86;
    if (me.status === 'dnf') target = 0;
    this.speedFactor += (target - this.speedFactor) * Math.min(1, dt * 1.5);
    // 單圈進度速率（每秒幾圈），供維修區縮時使用
    if (this.lastMotion !== undefined && dt > 0) this.motionRate += (Math.max(0, motion - this.lastMotion) / dt - this.motionRate) * Math.min(1, dt * 2);
    this.lastMotion = motion;
    const { ds, kmh: rawKmh } = me.status === 'dnf' ? { ds: 0, kmh: 0 } : this.advance(sim, me, s, motion, dt);
    const kmh = rawKmh;

    // 遙測
    const prevGear = this.gear;
    while (this.gear < 8 && kmh > GEARS[this.gear] + 4) this.gear++;
    while (this.gear > 1 && kmh < GEARS[this.gear - 1] - 6) this.gear--;
    const lo = GEARS[this.gear - 1], hi = this.gear < 8 ? GEARS[this.gear] : 340;
    const idle = this.mode === 'grid' ? 7000 + Math.sin(this.time * 9) * 900 * (this.lights > 0 ? 1 : 0.3) : 4200;
    const rpm = kmh < 1 ? idle : this.pit ? 6800 : THREE.MathUtils.clamp(4400 + (kmh - lo) / (hi - lo) * 7900, 4000, 12500);
    const dv = speedAt(this.path, this.s + 6) - speedAt(this.path, this.s);
    const k = this.pit || kmh < 1 ? 0 : this.path.curvature(this.s + 6);
    const steer = THREE.MathUtils.clamp(k * 24, -1, 1);
    const overtake = typeof sim.overtakeModeAvailable === 'function' ? !!sim.overtakeModeAvailable(sim.playerId)
      : !!(s.carAhead && s.carAhead.gap < 1 && sim.state.lap >= 2 && s.safetyCar === 'none' && !wet);
    this.telemetry = { speed: kmh, rpm: me.status === 'dnf' ? 0 : rpm, gear: kmh < 1 && this.mode !== 'race' ? 1 : this.gear, steer,
      throttle: dv >= 0 ? 1 : 0.1, brake: dv < -0.8 ? 1 : 0, shifting: prevGear !== this.gear, drs: overtake, overtake };

    // 鏡頭姿態
    const here = sample(this.path, this.s, this.lateral);
    const ahead = this.pit ? sample(this.path, this.s + 14, this.lateral) : sample(this.path, this.s + 14, racingLine(this.path, this.s + 14));
    const fx = ahead.x - here.x, fy = ahead.y - here.y, fz = ahead.z - here.z;
    this.rig.position.set(here.x, here.y, here.z);
    this.rig.rotation.set(Math.atan2(fy, Math.hypot(fx, fz)) * 0.6, Math.atan2(-fx, -fz), 0, 'YXZ');
    const shake = (Math.sin(this.time * 47) + Math.sin(this.time * 31.7)) * 0.0009 * Math.min(1, kmh / 200 + (this.mode === 'grid' ? 0.4 : 0));
    this.camera.rotation.set(-0.19, 0, 0);
    this.head.rotation.set(shake + (this.telemetry.brake ? 0.012 : 0), 0, -steer * 0.03 + shake * 0.5);
    this.light.position.set(here.x + this.sun.x * 80, here.y + this.sun.y * 80, here.z + this.sun.z * 80);
    this.light.target.position.set(here.x, here.y, here.z);
    this.sky?.position.copy(this.rig.position);
    this.clouds.update(this.rig.position, this.time);
    this.camera.getWorldPosition(this.flare.position).addScaledVector(this.sun, 2400);

    // 座艙
    const cp = this.cockpit;
    cp.wheel.rotation.z = -steer * 1.15;
    const changing = this.pit?.phase === 'stop';
    cp.fronts.forEach((f, i) => {
      f.rotation.y = -steer * 0.35;
      // 換胎：舊胎往外拔出、新胎裝回
      const t = changing ? this.pit.t / this.pit.stationary : 0;
      const out = changing ? Math.sin(Math.min(1, t * 1.25) * Math.PI) * 0.5 : 0;
      f.position.x = (i === 0 ? -1 : 1) * (0.86 + out);
    });
    if (this.trackside && changing) for (const [i, m] of this.trackside.members.entries()) { const g = m.userData.gun; g.userData.baseY ??= g.position.y; g.position.y = g.userData.baseY + Math.sin(this.time * 90 + i) * 0.006; m.position.y = Math.max(0, Math.sin(this.time * 6 + i) * 0.03); }
    const lit = Math.round(THREE.MathUtils.clamp((rpm - 9000) / 3300, 0, 1) * 15);
    cp.leds.forEach((m, i) => {
      if (i < 15) m.emissiveIntensity = i < lit ? (lit >= 14 && Math.sin(this.time * 40) > 0 ? 0 : 3) : 0;
      else m.emissiveIntensity = s.safetyCar !== 'none' && Math.sin(this.time * 9) > 0 ? 3 : 0;
    });
    cp.status.forEach((m, i) => { m.emissiveIntensity = (i === 1 || i === 8 || (i === 4 && this.telemetry.brake) || (i === 6 && overtake) || (i < 5 && this.lights > i)) ? 2.2 : 0.15; });
    this.lcdTimer -= dt;
    if (this.lcdTimer <= 0) {
      this.lcdTimer = 0.1;
      const lapProgress = this.mode === 'race' ? (((motion % 1) + 1) % 1) * (me.lastLap || this.path.lapSeconds) : 0;
      drawLcd(cp.lcd, { lapTime: fmt(lapProgress), delta: s.carAhead ? s.carAhead.gap : 0, gear: this.pit || this.mode !== 'race' && kmh < 1 ? 'N' : this.gear,
        position: me.position, lap: Math.max(1, Math.min(sim.state.lap + (this.mode === 'race' ? 1 : 0), sim.state.totalLaps)),
        speed: kmh, rpm, compound: me.tyre.compound, wear: me.tyre.wear, mode: me.pushMode, drs: overtake, limiter: !!this.pit || this.mode === 'garage' });
    }

    this.placeTraffic(sim, me, wet, dt, kmh);

    // 雨天
    if (wet) {
      const fall = dt * 22;
      for (let i = 0; i < this.rainPos.length / 6; i++) {
        const o = i * 6; this.rainPos[o + 1] -= fall; this.rainPos[o + 4] -= fall;
        this.rainPos[o + 2] += ds; this.rainPos[o + 5] += ds;
        if (this.rainPos[o + 1] < -1 || this.rainPos[o + 2] > 4) this.resetDrop(i, false);
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.drops.material.opacity = Math.min(0.9, 0.35 + s.wetness * 0.6);
      this.drops.material.map.offset.y = (this.drops.material.map.offset.y + dt * 0.02) % 1;
    } else this.drops.material.opacity = 0;

    this.renderer.toneMappingExposure += ((me.status === 'dnf' ? 0.45 : 1.0) - this.renderer.toneMappingExposure) * Math.min(1, dt * 2);
    cp.root.visible = false; this.rain.visible = false; this.flare.visible = false;
    this.renderer.setRenderTarget(this.mirrorTarget); this.renderer.render(this.scene, this.rearCamera);
    this.renderer.setRenderTarget(null);
    cp.root.visible = true; this.rain.visible = wet;
    this.postfx.render(dt, { speed: kmh, wet, braking: !!this.telemetry.brake, dnf: me.status === 'dnf' });
  }

  // 對手車：發車格依格位；比賽中顯示時間差 ±5 秒內的車（每秒約 30 公尺，便於觀察纏鬥）。
  placeTraffic(sim, me, wet, dt, kmh) {
    for (const car of this.cars.values()) car.visible = false;
    this.spray.material.opacity = 0;
    const order = sim.getOrder ? sim.getOrder() : [];
    const launching = this.mode === 'grid' || this.mode === 'formation' || this.launch;
    let nearestAhead = null;
    for (const other of order) {
      if (other.carId === me.carId || other.status === 'dnf') continue;
      let want, lateral;
      if (launching) {
        const slot = gridSlot(other.position), mine = gridSlot(me.position);
        const launchMove = this.launch ? this.s - this.launch.fromS : 0;
        want = slot.s - mine.s; lateral = slot.lateral;
        if (this.mode === 'formation') { const u = Math.sin(Math.PI * Math.min(1, this.formation.t / this.formation.dur)); want *= 1 + u * 1.6; lateral = lateral * (1 - u) + racingLine(this.path, this.s + want) * 0.4 + Math.sin(this.formation.t * 3.2 + other.position) * 1.4 * u; }
        if (this.launch) { want += launchMove * 0.02 * (me.position - other.position); lateral += (racingLine(this.path, this.s + want) - lateral) * smooth(launchMove / 200); }
      } else {
        const gap = me.totalTime - other.totalTime; // > 0：對方在前
        if (Math.abs(gap) > 5) continue;
        want = Math.sign(gap) * (5 + Math.abs(gap) * 30);
        lateral = racingLine(this.path, this.s + want) + hashSide(other.carId) * 1.4;
        if (other.status === 'pit') {
          // 同時進站的車停在各自車隊的 P 房前（玩家在維修區時才看得到）
          if (!this.pit || !this.trackside) continue;
          const car = this.carMesh(other); car.userData.dist = null;
          this.placeCar(car, this.trackside.boxFor(other.teamId), this.trackside.lane.work, wet);
          continue;
        }
      }
      const car = this.carMesh(other);
      const d = car.userData.dist;
      // 平滑時間約為三分之一圈：每圈結算的時間差不會讓車輛瞬間跳動
      const ease = launching ? dt * 4 : dt * Math.max(0.35, 3 * this.motionRate);
      car.userData.dist = d === null || Math.abs(want - d) > 160 ? want : d + (want - d) * Math.min(1, ease);
      setCompound(car, COMPOUNDS[other.tyre.compound].color);
      this.placeCar(car, this.s + car.userData.dist, lateral, wet);
      if (car.userData.dist > 0 && (!nearestAhead || car.userData.dist < nearestAhead.userData.dist)) nearestAhead = car;
    }
    for (const car of this.cars.values()) if (!car.visible) car.userData.dist = null;
    const info = [];
    for (const [carId, car] of this.cars) {
      if (!car.visible || car.userData.dist === null) { car.userData.prevDist = null; continue; }
      const d = car.userData.dist, p = car.userData.prevDist;
      const closing = p == null || dt <= 0 ? 0 : (Math.abs(p) - Math.abs(d)) / dt;
      car.userData.prevDist = d; info.push({ carId, distance: d, closing });
    }
    this.trafficInfo = info.sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance)).slice(0, 4);
    if (nearestAhead && wet) this.updateSpray(nearestAhead, wet, kmh);
  }

  updateSpray(car, wet, kmh) {
    const base = car.position, yaw = car.rotation.y;
    const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    for (let i = 0; i < this.sprayPos.length / 3; i++) {
      const d = 2.6 + ((i * 37 + this.time * 60) % 26);
      const spread = (d / 26) * 2.4;
      this.sprayPos.set([base.x + back.x * d + Math.sin(i * 12.9 + this.time * 3) * spread, base.y + 0.3 + ((i * 7) % 10) / 10 * (0.6 + spread * 0.6), base.z + back.z * d + Math.cos(i * 7.3 + this.time * 2) * spread], i * 3);
    }
    this.spray.geometry.attributes.position.needsUpdate = true;
    this.spray.material.opacity = Math.min(0.5, kmh / 500);
  }

  dispose() {
    this.disposed = true;
    this.observer.disconnect();
    this.clouds?.dispose(); this.flare.dispose?.(); this.mirrorTarget.dispose(); this.envRT?.dispose(); this.pmrem.dispose();
    this.scene.traverse(o => { o.geometry?.dispose(); });
    this.postfx?.dispose();
    this.renderer.dispose();
  }
}

// 依車號決定車偏左或偏右，避免全部擠在同一條線、被 Halo 中柱擋住。
function hashSide(id) { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) | 0; return h & 1 ? 1 : -1; }

function fmt(seconds) {
  const m = Math.floor(seconds / 60), s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}
