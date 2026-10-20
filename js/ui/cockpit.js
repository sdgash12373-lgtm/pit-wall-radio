import { createRng } from '../engine/rng.js';

const TAU = Math.PI * 2;
const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const mix = (a, b, t) => a + (b - a) * t;
const TYRES = { soft: '#ff4c58', medium: '#ffe059', hard: '#e6e9ec', inter: '#49df88', wet: '#56aaff' };
// One lap of presentation data: progress, speed, steering. No sporting state is changed.
const PROFILE = [
  [0, 285, 0], [.12, 326, 0], [.16, 110, .95], [.21, 142, .7],
  [.29, 240, 0], [.34, 160, -.8], [.4, 190, -.5], [.49, 293, 0],
  [.55, 125, .92], [.61, 155, -.85], [.69, 225, 0], [.76, 300, .05],
  [.8, 100, -.98], [.86, 140, -.6], [.93, 240, 0], [1, 285, 0],
];

function polygon(c, color, ...points) {
  c.fillStyle = color; c.beginPath(); c.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) c.lineTo(points[i][0], points[i][1]);
  c.closePath(); c.fill();
}
function ellipse(c, color, x, y, rx, ry, angle = 0) {
  c.fillStyle = color; c.beginPath(); c.ellipse(x, y, rx, ry, angle, 0, TAU); c.fill();
}
function line(c, color, width, ...points) {
  c.strokeStyle = color; c.lineWidth = width; c.beginPath(); c.moveTo(...points[0]);
  for (let i = 1; i < points.length; i++) c.lineTo(...points[i]);
  c.stroke();
}
function panel(c, color, x, y, w, h, radius = 8) {
  c.fillStyle = color; c.beginPath(); c.roundRect(x, y, w, h, radius); c.fill();
}
function lapClock(seconds) {
  const ms = Math.floor(Math.max(0, seconds) * 1000);
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

export class Cockpit {
  constructor(canvas, teams, track) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.teams = new Map(teams.map(t => [t.id, t.color])); this.track = track;
    this.time = 0; this.travel = 0; this.shiftHold = 0; this.effect = null; this.stopped = false; this.disposed = false;
    this.telemetry = { speed: 285, rpm: 10500, gear: 7, steer: 0, throttle: 1, brake: 0, shifting: false, drs: false };
    const rng = createRng(`cockpit:${track.id ?? track.character}`);
    this.drops = Array.from({ length: 75 }, () => ({ x: rng.next(), y: rng.next(), r: rng.range(1.5, 5), drift: rng.range(.006, .022), phase: rng.next() * TAU }));
    this.resize = this.resize.bind(this);
    const Observer = globalThis.ResizeObserver;
    if (Observer) { this.observer = new Observer(this.resize); this.observer.observe(canvas); }
    this.resize();
  }

  color(car) { return this.teams.get(car?.teamId) ?? '#b9ced8'; }
  surface(w, h) {
    const doc = this.canvas.ownerDocument;
    const surface = doc ? doc.createElement('canvas') : new OffscreenCanvas(w, h);
    surface.width = w; surface.height = h; return surface;
  }
  resize() {
    if (this.disposed) return;
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(0, rect.width); this.height = Math.max(0, rect.height);
    this.dpr = globalThis.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.width * this.dpr); this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Background resolution is bounded; only geometry and the LCD need full display DPI.
    this.backgrounds = [this.makeBackground(false), this.makeBackground(true)];
    this.wheel = null; this.stopped = false;
  }
  transition(kind, car) {
    if (!this.disposed && !this.stopped && ['pass', 'lost', 'pit'].includes(kind)) {
      this.effect = { kind, car: car ? { ...car } : null, age: 0, duration: kind === 'pit' ? 5 : 2.4 };
    }
  }
  getTelemetry() { return { ...this.telemetry }; }
  dispose() {
    this.disposed = true; this.observer?.disconnect(); this.backgrounds = null; this.wheel = null; this.effect = null;
  }

  makeBackground(wet) {
    const surface = this.surface(1600, 900), c = surface.getContext('2d');
    const sky = c.createLinearGradient(0, 0, 0, 370);
    sky.addColorStop(0, wet ? '#525c65' : '#6e9dae'); sky.addColorStop(1, wet ? '#b0b8bc' : '#d7e4df');
    c.fillStyle = sky; c.fillRect(0, 0, 1600, 900);
    // Broad, quiet cloud bands remain fixed to the distant environment.
    for (let i = 0; i < 9; i++) ellipse(c, wet ? '#bfc5c711' : '#ffffff21', i * 240 - 80, 90 + i % 3 * 55, 260, 35);
    c.fillStyle = wet ? '#525e59' : '#63735a'; c.fillRect(0, 322, 1600, 578);
    const street = this.track.character === 'street';
    for (let i = 0; i < 46; i++) {
      const x = i * 39, height = 25 + (i * 37 % 85);
      if (street) {
        c.fillStyle = i % 2 ? '#6d7a80' : '#859197'; c.fillRect(x, 330 - height, 34, height);
        c.fillStyle = '#aab8bd';
        for (let row = 0; row < height / 13 - 1; row++) c.fillRect(x + 5, 335 - height + row * 13, 23, 3);
      } else {
        ellipse(c, wet ? '#5e6f69' : '#3d5c4b', x, 326 - height * .2, 32, height * .55);
      }
    }
    if (this.track.character !== 'high-speed') {
      for (const side of [-1, 1]) {
        c.save(); c.translate(800, 0); c.scale(side, 1);
        polygon(c, '#45525b', [75, 328], [800, 155], [800, 340], [75, 340]);
        // Raked terraces, deterministic spectators and a cantilever roof.
        for (let row = 0; row < 13; row++) {
          const y = 187 + row * 11;
          line(c, '#9aa3a5', 2, [800, y], [75, 328 + row * .7]);
          for (let col = 0; col < 38; col++) {
            const x = 105 + col * 19, depth = (x - 75) / 725;
            ellipse(c, ['#c3b6a4', '#38454e', '#7f9297', '#ae6863'][(col * 7 + row * 3) % 4], x, 328 - (328 - y) * depth - 3, 2.1, 2.6);
          }
        }
        polygon(c, '#29383e', [70, 319], [800, 126], [800, 158], [75, 327]);
        polygon(c, '#b6c0c1', [70, 315], [800, 116], [800, 127], [70, 320]);
        for (let i = 0; i < 9; i++) {
          const x = 120 + i * 85;
          line(c, '#53646a', 4, [x, 335], [x, 322 - (x - 70) * .267]);
          line(c, '#89989b', 2, [x, 320 - (x - 70) * .267], [x + 64, 321 - (x - 70) * .267]);
        }
        c.restore();
      }
    }
    if (wet) { c.fillStyle = '#c7ced02d'; c.fillRect(0, 160, 1600, 210); }
    return surface;
  }

  updateTelemetry(sim, p, s, motion, dt) {
    const phase = ((motion % 1) + 1) % 1;
    let i = 0; while (i < PROFILE.length - 2 && phase > PROFILE[i + 1][0]) i++;
    const a = PROFILE[i], b = PROFILE[i + 1], t = clamp((phase - a[0]) / (b[0] - a[0]));
    const smooth = t * t * (3 - 2 * t);
    let steer = mix(a[2], b[2], smooth);
    let target = mix(a[1], b[1], smooth);
    if (this.track.character === 'high-speed') { target = 100 + target * .73; steer *= .7; }
    if (this.track.character === 'street') target *= .83;
    if (this.track.character === 'technical') target *= .9;
    target *= p.pushMode === 'push' ? 1.035 : p.pushMode === 'conserve' ? .96 : 1;
    target *= 1 - (s.wetness ?? 0) * .17;
    const safety = (s.safetyCar ?? sim.state.safetyCar ?? 'none') !== 'none';
    if (safety) target = Math.min(target * .48, s.safetyCar === 'vsc' ? 140 : 105);
    if (this.effect?.kind === 'pit') {
      const t = this.effect.age / this.effect.duration;
      target = t < .28 ? mix(target, 65, t / .28) : t < .76 ? 0 : mix(0, 110, (t - .76) / .24);
      steer = t < .3 ? -.32 : .05;
    }
    const old = this.telemetry;
    const speed = mix(old.speed, target, 1 - Math.exp(-dt * 13));
    // Gear thresholds with hysteresis: RPM rises within a gear, then drops on upshift.
    const thresholds = [0, 72, 112, 153, 194, 235, 274, 310, 360];
    let gear = old.gear;
    this.shiftHold = Math.max(0, this.shiftHold - dt);
    if (this.shiftHold === 0) {
      if (speed > thresholds[gear] && gear < 8) gear++;
      else if (gear > 1 && speed < thresholds[gear - 1] - 9) gear--;
    }
    const shifting = gear !== old.gear;
    if (shifting) this.shiftHold = .09;
    const rpm = clamp(5800 + (speed - thresholds[gear - 1]) / (thresholds[gear] - thresholds[gear - 1]) * 6500, 4000, 12500);
    const brake = clamp((speed - target) / 34);
    const throttle = brake > .1 ? 0 : clamp(.48 + (target - speed) / 24 + (b[1] >= a[1] ? .48 : -.3));
    this.telemetry = { speed, rpm, gear, steer: mix(old.steer, steer, 1 - Math.exp(-dt * 16)), throttle, brake, shifting,
      drs: !!(s.carAhead && s.carAhead.gap < 1 && sim.state.lap >= 2 && !safety && s.wetness < .2 && Math.abs(steer) < .12 && throttle > .7 && speed > 230) };
    this.phase = phase;
  }

  draw(sim, motion, dt) {
    if (this.disposed || !this.width || !this.height) return;
    const p = sim.getCar(sim.playerId), s = sim.getPlayerSituation();
    if (!p || !s) return;
    if (this.stopped && p.status === 'dnf') { this.telemetry.shifting = false; return; }
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, .1);
    this.time += dt;
    if (this.effect) { this.effect.age += dt; if (this.effect.age > this.effect.duration) this.effect = null; }
    this.updateTelemetry(sim, p, s, Number.isFinite(motion) ? motion : 0, dt);
    this.travel += this.telemetry.speed / 3.6 * dt;
    const c = this.ctx, w = this.width, h = this.height, wet = s.wetness >= .2;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.clearRect(0, 0, w, h);
    c.save();
    // Small camera roll is independent of the much stronger wheel rotation.
    c.translate(w / 2, h / 2); c.rotate(-this.telemetry.steer * .012);
    c.translate(-w / 2 + Math.sin(this.time * 27) * Math.min(1.3, w * .001), -h / 2 + Math.sin(this.time * 39) * this.telemetry.speed / 290);
    c.scale(w / 1600, h / 900);
    c.drawImage(this.backgrounds[wet ? 1 : 0], -25, -15, 1650, 930);
    this.drawRoad(c, wet);
    if (this.effect?.kind === 'pit') this.drawPit(c, this.color(p));
    this.drawTraffic(c, s, wet);
    c.restore();
    c.save(); c.scale(w / 1600, h / 900); this.drawBody(c, p, s); this.drawHalo(c); c.restore();
    this.drawWheel(c, p, s, sim);
    if (wet) this.drawRain(c, w, h);
    if ((s.safetyCar ?? sim.state.safetyCar ?? 'none') !== 'none') {
      c.fillStyle = `rgba(255,211,40,${.22 + .55 * Math.max(0, Math.sin(this.time * 8))})`; c.fillRect(0, 0, w, 6);
    }
    if (p.status === 'dnf') {
      c.fillStyle = '#060c16a8'; c.fillRect(0, 0, w, h); this.stopped = true;
      this.telemetry = { ...this.telemetry, speed: 0, rpm: 4000, throttle: 0, brake: 1, shifting: false, drs: false };
    }
  }

  roadPoint(z, side = 0) {
    const bend = -this.telemetry.steer * 155;
    return [800 + bend * (1 - z) ** 2 + side * (17 + 1080 * z * z), 323 + 600 * z * z];
  }
  drawRoad(c, wet) {
    const scroll = this.travel * .014;
    for (let i = 0; i < 48; i++) {
      const a = i / 48, b = (i + 1) / 48;
      const stripe = Math.floor(a * 45 - scroll) % 2 === 0;
      polygon(c, stripe ? '#ccd0cb' : '#aa4247', this.roadPoint(a, -1.065), this.roadPoint(a, 1.065), this.roadPoint(b, 1.065), this.roadPoint(b, -1.065));
      polygon(c, wet ? (stripe ? '#5d696e' : '#5a666b') : (stripe ? '#414b50' : '#3e484d'), this.roadPoint(a, -1), this.roadPoint(a, 1), this.roadPoint(b, 1), this.roadPoint(b, -1));
      for (const side of [-1, 1]) {
        polygon(c, '#d2d6d0', this.roadPoint(a, side * .972), this.roadPoint(a, side * .986), this.roadPoint(b, side * .986), this.roadPoint(b, side * .972));
      }
      if (wet && i % 3 === 0) {
        polygon(c, '#d2e0df0c', this.roadPoint(a, -.75), this.roadPoint(a, .8), this.roadPoint(b, .67), this.roadPoint(b, -.6));
      }
      if (stripe && i > 2) for (const lane of [-.38, .38]) {
        polygon(c, '#b6c1bf12', this.roadPoint(a, lane), this.roadPoint(a, lane + .008), this.roadPoint(b, lane + .008), this.roadPoint(b, lane));
      }
    }
    // Perspective objects wrap at the horizon and sweep past the camera.
    for (let i = 0; i < 18; i++) {
      const z = ((i / 18 + scroll * .023) % 1), scale = z * z;
      for (const side of [-1, 1]) {
        const [x, y] = this.roadPoint(z, side * 1.12), bw = 12 + 220 * scale, bh = 4 + 52 * z;
        c.fillStyle = '#929d9e'; c.fillRect(x - (side < 0 ? bw : 0), y - bh, bw, bh);
        c.fillStyle = i % 3 ? '#163c46' : '#c3b9a3'; c.fillRect(x - (side < 0 ? bw : 0), y - bh + 3, bw, bh * .68);
        // Color blocks are fictional advertising; the only text is on the LCD.
        c.fillStyle = i % 3 ? '#71c8bd' : '#384b52';
        for (let j = 0; j < 3; j++) c.fillRect(x - (side < 0 ? bw : 0) + bw * (.15 + j * .25), y - bh * .76, bw * .13, bh * .35);
        line(c, '#d3dad578', Math.max(.5, z * 2), [x, y - bh], [x, y - bh * 2.5]);
      }
    }
    for (const side of [-1, 1]) {
      const edge = this.roadPoint(1, side * 1.12), far = this.roadPoint(0, side * 1.12);
      for (let rail = 0; rail < 4; rail++) line(c, '#bdc7c180', 1.5, [far[0], far[1] - rail * 2], [edge[0], edge[1] - 35 - rail * 34]);
    }
    if (wet) { c.fillStyle = '#c9d3d31b'; c.fillRect(0, 305, 1600, 85); }
  }

  rearCar(c, x, y, size, color, wet = false) {
    c.save(); c.translate(x, y); c.scale(size / 200, size / 200);
    if (wet) {
      for (let i = 0; i < 8; i++) {
        const drift = Math.sin(this.time * 2 + i * 1.7) * 13;
        ellipse(c, '#dce6e515', drift + (i % 2 ? -1 : 1) * i * 18, 9 + i * 6, 80 + i * 9, 19 + i * 4);
      }
      polygon(c, '#fc565926', [-12, 9], [12, 9], [23, 110], [-23, 110]);
    }
    ellipse(c, '#0a101c77', 0, 22, 110, 15);
    panel(c, '#101419', -105, -39, 40, 67, 9); panel(c, '#101419', 65, -39, 40, 67, 9);
    line(c, '#353d40', 3, [-99, -31], [-99, 19]); line(c, '#353d40', 3, [99, -31], [99, 19]);
    polygon(c, color, [-61, 10], [-32, -53], [32, -53], [61, 10]);
    polygon(c, '#111b22', [-65, 7], [65, 7], [76, 26], [-76, 26]);
    for (let i = -3; i <= 3; i++) line(c, '#657076', 2, [i * 16, 11], [i * 19, 26]);
    c.fillStyle = '#11171d'; c.fillRect(-60, -55, 8, 56); c.fillRect(52, -55, 8, 56);
    panel(c, color, -108, -65, 216, 18, 3);
    c.fillStyle = '#1a252c'; c.fillRect(-100, -55, 200, 6);
    c.fillStyle = '#d4e0db'; c.fillRect(-100, -65, 7, 14); c.fillRect(93, -65, 7, 14);
    ellipse(c, '#ff343638', 0, 8, 18, 15); panel(c, '#ff5657', -5, 0, 10, 12, 2);
    c.restore();
  }
  drawTraffic(c, s, wet) {
    const effect = this.effect, t = effect ? effect.age / effect.duration : 0;
    if (s.carAhead && !(effect?.kind === 'lost' && effect.car?.carId === s.carAhead.carId)) {
      const gap = Math.max(.08, s.carAhead.gap), z = clamp(.68 / (1 + gap * .78), .035, .68);
      const [x, y] = this.roadPoint(z);
      this.rearCar(c, x + Math.sin(this.phase * TAU * 2) * 32 * z, y, clamp(360 / (1 + gap * 1.3), 12, 340), this.color(s.carAhead), wet);
    }
    if (effect?.car && effect.kind === 'pass') {
      this.rearCar(c, 800 + t * 1150, 415 + t * 500, 210 + t * 480, this.color(effect.car), wet);
    }
    if (effect?.car && effect.kind === 'lost' && t > .22) {
      const u = clamp((t - .22) / .78);
      this.rearCar(c, mix(1750, 800, u), mix(775, 405, u), mix(620, 160, u), this.color(effect.car), wet);
    }
  }

  drawPit(c, own) {
    const t = this.effect.age / this.effect.duration;
    polygon(c, '#b0b7b7', [0, 180], [620, 306], [620, 430], [0, 730]);
    polygon(c, '#28333b', [0, 180], [620, 306], [620, 335], [0, 260]);
    for (let i = 0; i < 6; i++) {
      const x = 45 + i * 85;
      polygon(c, '#1a242d', [x, 290 + i * 12], [x + 54, 300 + i * 12], [x + 54, 555 - i * 24], [x, 590 - i * 24]);
    }
    line(c, '#f4cd54', 5, [640, 327], [350, 900]);
    const proximity = Math.sin(clamp((t - .15) / .7) * Math.PI);
    for (const side of [-1, 1]) for (let i = 0; i < 2; i++) {
      c.save(); c.translate(800 + side * (470 - proximity * 180 + i * 105), 475 + i * 42); c.scale(.6 + proximity * .7, .6 + proximity * .7);
      ellipse(c, '#151e27', 0, -48, 16, 20); panel(c, own, -23, -27, 46, 65, 12);
      line(c, '#121b24', 15, [-12, 30], [-21, 84]); line(c, '#121b24', 15, [12, 30], [27, 84]);
      line(c, own, 13, [-18, -11], [-40 * side, 25], [-64 * side, 32]);
      c.restore();
    }
  }

  drawBody(c, p, s) {
    const own = this.color(p), phone = this.width < 600;
    for (const side of [-1, 1]) {
      c.save(); c.translate(800, 0); c.scale(side, 1);
      polygon(c, '#11191f', [310, 622], [610, 590], [800, 710], [800, 900], [275, 900]);
      polygon(c, own, [300, 578], [610, 545], [800, 618], [800, 727], [400, 661]);
      polygon(c, '#d4dbda', [280, 562], [577, 532], [795, 594], [800, 623], [410, 592]);
      polygon(c, '#0c131a', [360, 662], [650, 637], [800, 740], [800, 900], [328, 900]);
      c.strokeStyle = '#56636a33'; c.lineWidth = 1;
      for (let i = 0; i < 16; i++) line(c, '#89959a12', 1, [380 + i * 22, 680], [300 + i * 32, 900]);
      line(c, '#101921', 13, [453, 583], [545, 462]);
      const mx = phone ? 560 : 575, my = 423, mw = phone ? 138 : 218, mh = phone ? 52 : 76;
      panel(c, own, mx - mw / 2 - 9, my - 9, mw + 18, mh + 18, 14);
      panel(c, '#081117', mx - mw / 2, my, mw, mh, 10);
      c.save(); c.beginPath(); c.roundRect(mx - mw / 2 + 3, my + 3, mw - 6, mh - 6, 7); c.clip();
      c.fillStyle = '#7e969e'; c.fillRect(mx - mw / 2, my, mw, mh);
      polygon(c, '#404d55', [mx - 20, my + 17], [mx + 20, my + 17], [mx + mw, my + mh], [mx - mw, my + mh]);
      const lost = this.effect?.kind === 'lost', u = lost ? this.effect.age / this.effect.duration : 0;
      const behind = lost ? this.effect.car : s.carBehind;
      if (behind && (!lost || u < .42)) {
        const size = lost ? 22 + u * 160 : clamp(68 / (Math.max(.15, behind.gap) + .55), 6, 65);
        this.rearCar(c, mx + (lost ? u * mw * 2 : 0), my + mh * .7, size, this.color(behind));
      }
      c.fillStyle = '#c1d9dd16'; c.fillRect(mx - mw / 2, my, mw, mh / 2); c.restore();
      c.restore();
    }
    // Raised cockpit surround and the deep carbon interior below it.
    c.fillStyle = '#0a1119'; c.beginPath(); c.ellipse(800, 889, 440, 351, 0, Math.PI, TAU); c.lineTo(1250, 950); c.lineTo(350, 950); c.fill();
    // Forward cowling joins the pillar base; the cockpit is recessed below it.
    polygon(c, own, [590, 487], [737, 418], [861, 418], [1010, 487], [1084, 580], [516, 580]);
    polygon(c, '#c6cecc', [590, 487], [737, 418], [861, 418], [1010, 487], [991, 506], [849, 443], [748, 443], [609, 506]);
    c.fillStyle = '#0a1119'; c.beginPath(); c.ellipse(800, 889, 440, 390, 0, Math.PI, TAU); c.lineTo(1250, 950); c.lineTo(350, 950); c.fill();
    c.strokeStyle = '#c6cecc'; c.lineWidth = 30; c.beginPath(); c.ellipse(800, 894, 449, 410, 0, Math.PI + .06, TAU - .06); c.stroke();
    c.strokeStyle = own; c.lineWidth = 7; c.beginPath(); c.ellipse(800, 894, 465, 426, 0, Math.PI + .12, TAU - .12); c.stroke();
    for (let i = 0; i < 21; i++) line(c, '#889ba00b', 2, [415 + i * 18, 600], [335 + i * 32, 900]);
  }
  drawHalo(c) {
    // A broad curved top rim tapers into a slim central pillar; no center logo.
    c.fillStyle = '#111920'; c.beginPath(); c.moveTo(-80, -55); c.lineTo(1680, -55);
    c.lineTo(1500, 0); c.bezierCurveTo(1190, -8, 936, 66, 820, 170);
    c.lineTo(806, 414); c.lineTo(787, 414); c.lineTo(775, 170);
    c.bezierCurveTo(650, 63, 400, -5, 95, 0); c.closePath(); c.fill();
    c.strokeStyle = '#667075'; c.lineWidth = 3; c.beginPath(); c.moveTo(60, 0); c.bezierCurveTo(420, 7, 650, 75, 788, 175); c.lineTo(797, 397); c.stroke();
    line(c, '#859094', 2, [811, 166], [802, 397]);
    panel(c, '#182127', 777, 397, 43, 37, 8); panel(c, '#6c777b', 786, 403, 24, 25, 5);
    ellipse(c, '#030a12', 798, 415, 8, 8); ellipse(c, '#749ba9', 800, 413, 2, 2);
  }

  makeWheel(own) {
    const surface = this.surface(840, 470), c = surface.getContext('2d'); c.translate(420, 225);
    const carbon = c.createLinearGradient(0, -180, 0, 180);
    carbon.addColorStop(0, '#303a42'); carbon.addColorStop(.35, '#10171e'); carbon.addColorStop(1, '#050b11');
    polygon(c, carbon, [-362, -170], [-205, -182], [-155, -153], [155, -153], [205, -182], [362, -170], [389, -83], [353, 150], [239, 179], [170, 127], [-170, 127], [-239, 179], [-353, 150], [-389, -83]);
    for (let i = 0; i < 44; i++) line(c, '#b4c5cd0a', 2, [-380 + i * 18, -165], [-480 + i * 18, 175]);
    for (const side of [-1, 1]) {
      c.save(); c.scale(side, 1);
      panel(c, '#050a10', 254, -161, 95, 312, 34);
      line(c, '#53616a', 4, [337, -137], [355, -48], [327, 111]);
      for (let i = 0; i < 7; i++) line(c, '#929e9f23', 2, [272, -125 + i * 35], [330, -118 + i * 35]);
      const colors = ['#e5c53a', '#de4e50', '#63bd8a', '#d6dfdf', '#438dd5', '#ce8347'];
      for (let i = 0; i < 6; i++) {
        const x = 186 + (i % 2) * 43, y = -119 + Math.floor(i / 2) * 58;
        ellipse(c, '#02080e', x, y, 20, 20); ellipse(c, colors[i], x, y - 2, 14, 14);
        ellipse(c, '#ffffff33', x - 4, y - 6, 5, 4);
      }
      for (const [x, y, color] of [[193, 93, '#529acd'], [110, 151, '#d7b547']]) {
        ellipse(c, '#3b4852', x, y, 32, 32); ellipse(c, '#0d1721', x, y, 26, 26);
        for (let i = 0; i < 12; i++) {
          const a = i / 12 * TAU; line(c, '#bac6c8', 2, [x + Math.cos(a) * 28, y + Math.sin(a) * 28], [x + Math.cos(a) * 31, y + Math.sin(a) * 31]);
        }
        ellipse(c, color, x, y, 19, 19); line(c, '#f0f3ed', 4, [x, y], [x + 4, y - 16]);
      }
      // The glove wraps over the grip: cuff, palm, folded fingers and thumb.
      polygon(c, '#111b25', [268, 101], [351, 89], [415, 245], [285, 245]);
      polygon(c, own, [270, 107], [345, 92], [405, 245], [291, 245]);
      panel(c, own, 268, -69, 91, 204, 35);
      polygon(c, '#0b151eaa', [324, -60], [352, -43], [354, 97], [332, 125], [316, 104]);
      for (let i = 0; i < 4; i++) {
        panel(c, own, 254 - i * 2, -85 + i * 34, 69, 37, 17);
        line(c, '#e6eeeb65', 2, [263, -74 + i * 34], [302, -77 + i * 34]);
        line(c, '#07111b80', 3, [260, -49 + i * 34], [313, -50 + i * 34]);
      }
      c.save(); c.translate(263, 45); c.rotate(-.38); panel(c, own, -26, -51, 50, 97, 22);
      line(c, '#e2ece5a0', 3, [-14, -36], [-17, 22]); c.restore();
      line(c, '#e3ece4b0', 4, [281, 151], [359, 129]); line(c, '#14232d', 9, [283, 166], [366, 144]);
      c.restore();
    }
    panel(c, '#050b10', -167, -147, 334, 263, 12);
    line(c, '#89999f', 3, [-163, 111], [163, 111], [163, -142], [-163, -142], [-163, 111]);
    for (const x of [-151, 151]) for (const y of [-133, 103]) {
      ellipse(c, '#7b898e', x, y, 3, 3); line(c, '#16232a', 1, [x - 2, y], [x + 2, y]);
    }
    return surface;
  }
  drawWheel(c, p, s, sim) {
    const own = this.color(p);
    if (!this.wheel || this.wheelColor !== own) { this.wheel = this.makeWheel(own); this.wheelColor = own; }
    const w = this.width, h = this.height, phone = w < 600;
    const size = phone ? w * .88 : Math.min(w * .53, h * .99);
    const t = this.telemetry;
    c.save(); c.translate(w * .5, h * (phone ? .84 : .81) + Math.sin(this.time * 34) * t.speed / 480);
    c.rotate(t.steer * 70 * Math.PI / 180); c.scale(size / 840, size / 840);
    c.drawImage(this.wheel, -420, -225);
    const lit = Math.floor(clamp((t.rpm - 6500) / 5600) * 15);
    for (let i = 0; i < 15; i++) {
      const color = i < 5 ? '#63ed79' : i < 10 ? '#ff4b56' : '#6aaaff';
      ellipse(c, i < lit ? color : '#26343e', -140 + i * 20, -169, 7, 5);
    }
    panel(c, '#16272c', -148, -127, 296, 224, 3);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const text = (value, x, y, size, color = '#cfee93') => { c.fillStyle = color; c.font = `600 ${size}px monospace`; c.fillText(String(value), x, y); };
    c.fillStyle = '#344b4e'; c.fillRect(-145, -83, 290, 2); c.fillRect(-145, 24, 290, 2); c.fillRect(-145, 60, 290, 2);
    c.fillRect(-65, -81, 2, 106); c.fillRect(62, -81, 2, 106);
    text(lapClock(this.phase * (p.lastLap || this.track.baseLapTime || 90)), 0, -105, 25);
    text(t.gear, 0, -22, 94, '#edff82');
    text(`P${s.position}`, -105, -57, 25, '#ecf3ec'); text(`${Math.round(t.speed)}`, -105, -18, 27);
    text('KM/H', -105, 9, 13, '#a9c4c8');
    text('GAP', 105, -61, 16, '#a9c4c8');
    text(s.carAhead ? `+${Math.min(99.99, s.carAhead.gap).toFixed(2)}` : '--', 105, -25, 24);
    text(`${Math.round(t.rpm)}`, 105, 7, 17);
    text(`L${Math.max(1, s.lap)}/${sim.state.totalLaps}`, -78, 44, 20, '#ecf3ec');
    const compound = p.tyre.compound, tyreColor = TYRES[compound] ?? '#ffffff';
    c.fillStyle = tyreColor; c.fillRect(12, 31, 7, 23);
    text(`${compound.slice(0, 1).toUpperCase()} ${Math.round(p.tyre.wear)}%`, 85, 44, 21, tyreColor);
    text(`ERS ${Math.round(68 + Math.sin(this.phase * TAU) * 17)}`, -78, 79, 19, '#71d9ee');
    text(p.pushMode === 'push' ? 'PUSH' : p.pushMode === 'conserve' ? 'SAVE' : 'NORM', 83, 79, 21, p.pushMode === 'push' ? '#ff9c70' : '#cfee93');
    c.restore();
  }
  drawRain(c, w, h) {
    c.lineWidth = 1;
    for (const drop of this.drops) {
      const x = (drop.x + Math.sin(this.time * .13 + drop.phase) * .002) * w;
      const y = ((drop.y + this.time * drop.drift) % 1) * h;
      const r = drop.r * clamp(w / 1100, .55, 1.4);
      ellipse(c, '#dceaf21c', x, y, r, r * 1.6, -.12);
      c.strokeStyle = '#d9edf04c'; c.beginPath(); c.ellipse(x, y, r, r * 1.6, -.12, .2, Math.PI * 1.3); c.stroke();
      ellipse(c, '#efffff65', x - r * .3, y - r * .65, Math.max(.5, r * .22), Math.max(.6, r * .3));
    }
  }
}
