// Browser APIs are deliberately accessed only after start().
const clamp = (v, lo, hi, fallback = lo) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : fallback));
const host = () => globalThis.window ?? globalThis;
const SFX = ['f1_idle_start', 'f1_practice', 'f1_racing', 'f1_restart', 'cars_passing', 'crowd_ambience', 'crowd_cheer', 'wheel_gun_1', 'wheel_gun_2'];
export function parseManifest(data) {
  const result = { lines: {}, numbers: {} };
  const valid = clip => clip && typeof clip.file === 'string' && /^[\w-]+\.mp3$/.test(clip.file);
  for (const [key, line] of Object.entries(data?.lines ?? {})) {
    const clips = Array.isArray(line?.clips) ? line.clips.filter(valid) : [];
    if (clips.length) result.lines[key] = { speaker: line.speaker === 'player' ? 'player' : 'engineer', clips };
  }
  for (const [key, clip] of Object.entries(data?.numbers ?? {})) if (valid(clip)) result.numbers[key] = clip;
  return result;
}
export class RaceAudio {
  constructor({ enabled = true, volume = 0.65, voice = true, lang = 'en-GB' } = {}) {
    Object.assign(this, { enabled: !!enabled, volume: clamp(volume, 0, 1, 0.65), voiceEnabled: !!voice, lang, context: null,
      disposed: false, nodes: [], sources: new Set(), queue: [], current: null, gear: null, wasShifting: false,
      shiftUntil: -Infinity, shifts: 0, phase: null, throttle: 0, pitStopped: false, traffic: new Map(), lastPass: -Infinity,
      buffers: new Map(), loops: new Map(), variants: new Map(), manifest: parseManifest(null) });
  }
  start() {
    if (this.disposed || !this.enabled) return Promise.resolve();
    try {
      if (!this.context) {
        const Context = host().AudioContext ?? host().webkitAudioContext;
        if (!Context) return Promise.resolve();
        this.context = new Context(); this._build();
        this.ready = Promise.allSettled([this._loadManifest(), ...SFX.map(name => this._buffer('sfx', `${name}.mp3`)), this._worklet()]).then(() => {});
      }
      if (this.context.state === 'suspended') Promise.resolve(this.context.resume()).catch(() => {});
      return this.ready ?? Promise.resolve();
    } catch { this._releaseContext(); return Promise.resolve(); }
  }
  _node(node) { this.nodes.push(node); return node; }
  _gain(value, dest) { const n = this._node(this.context.createGain()); n.gain.value = value; n.connect(dest); return n; }
  _filter(type, frequency, q, dest) {
    const n = this._node(this.context.createBiquadFilter()); n.type = type; n.frequency.value = frequency; n.Q.value = q; n.connect(dest); return n;
  }
  _compress(dest) {
    if (!this.context.createDynamicsCompressor) return dest;
    const n = this._node(this.context.createDynamicsCompressor());
    n.threshold.value = -18; n.knee.value = 12; n.ratio.value = 5; n.attack.value = 0.004; n.release.value = 0.18; n.connect(dest); return n;
  }
  _target(param, value, time = 0.035) { if (this.context && param) param.setTargetAtTime(value, this.context.currentTime, time); }
  _source(source, dest, at = this.context.currentTime) {
    source.connect(dest); this.sources.add(source);
    source.onended = () => { this.sources.delete(source); try { source.disconnect(); } catch {} };
    source.start(at); return source;
  }
  _osc(type, frequency, gain, dest) {
    const n = this.context.createOscillator(); n.type = type; n.frequency.value = frequency;
    this._source(n, this._gain(gain, dest)); return n;
  }
  _noise(dest) { const n = this.context.createBufferSource(); n.buffer = this.noiseBuffer; n.loop = true; return this._source(n, dest); }
  _build() {
    const ctx = this.context;
    this.master = this._gain(this.volume * 0.7, ctx.destination);
    this.mix = this._compress(this.master); this.duck = this._gain(1, this.mix);
    this.engineLevel = this._gain(0, this.duck); this.shiftLevel = this._gain(1, this.engineLevel);
    this.lowpass = this._filter('lowpass', 3500, 0.6, this.shiftLevel);
    this.fallback = this._gain(1, this.lowpass);
    const shaper = this._node(ctx.createWaveShaper());
    shaper.curve = Float32Array.from({ length: 1024 }, (_, i) => Math.tanh((i / 1023 * 2 - 1) * 1.4));
    shaper.connect(this.fallback);
    const band = this._filter('bandpass', 950, 0.45, shaper);
    this.harmonics = [[0.5, 'sawtooth', 0.22], [1, 'sawtooth', 0.34], [2, 'square', 0.07], [3, 'sawtooth', 0.045]]
      .map(([ratio, type, level]) => ({ ratio, osc: this._osc(type, ratio * 225, level, band) }));
    this.turboLevel = this._gain(0, this.fallback); this.turbo = this._osc('sine', 2800, 1, this.turboLevel);
    this.noiseBuffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * 2)), ctx.sampleRate);
    const samples = this.noiseBuffer.getChannelData(0); let seed = 19317;
    for (let i = 0; i < samples.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; samples[i] = (seed >>> 0) / 2147483648 - 1; }
    this._noise(this._gain(0.024, band));
    this.windLevel = this._gain(0, this.duck); this._noise(this._filter('lowpass', 700, 0.5, this.windLevel));
    this.rainLevel = this._gain(0, this.duck); this._noise(this._filter('bandpass', 2800, 0.6, this.rainLevel));
    this.pitLevel = this._gain(0, this.fallback); this._osc('square', 38, 0.05, this.pitLevel);
    this.radioLevel = this._gain(0, this.mix); this._noise(this._filter('bandpass', 1600, 1.1, this.radioLevel));
    this.voiceChains = {};
    for (const speaker of ['engineer', 'player']) {
      const compressor = this._compress(this.mix), shape = this._node(ctx.createWaveShaper());
      shape.curve = Float32Array.from({ length: 512 }, (_, i) => Math.tanh((i / 511 * 2 - 1) * (speaker === 'player' ? 2.4 : 1.6)) * 0.75);
      shape.connect(compressor);
      const low = this._filter('lowpass', speaker === 'player' ? 2800 : 3400, 0.7, shape);
      this.voiceChains[speaker] = this._filter('highpass', speaker === 'player' ? 380 : 300, 0.7, low);
    }
  }
  async _worklet() {
    const ctx = this.context;
    try {
      if (!ctx?.audioWorklet || !host().AudioWorkletNode) return;
      await ctx.audioWorklet.addModule(new URL('./audio/engineWorklet.js', import.meta.url));
      if (this.disposed || ctx !== this.context) return;
      this.engine = this._node(new (host().AudioWorkletNode)(ctx, 'race-v6', { numberOfInputs: 0, outputChannelCount: [1] }));
      this.engine.connect(this.lowpass); this._target(this.fallback.gain, 0, 0.03);
    } catch { /* Oscillator graph remains active when worklets are unavailable. */ }
  }
  async _loadManifest() {
    try {
      const response = await host().fetch(new URL('../../assets/voice/manifest.json', import.meta.url));
      if (response.ok === false) return;
      const data = parseManifest(await response.json()); if (this.disposed) return;
      this.manifest = data;
      await Promise.allSettled(['radio_check', 'loud_clear', 'box_now', 'good_start', 'you_are', 'gap_ahead', 'seconds'].map(key => {
        const clip = data.lines[key]?.clips[0]; return clip ? this._buffer('voice', clip.file) : Promise.resolve();
      }));
    } catch { /* Missing local media must never interrupt the simulation. */ }
  }
  _buffer(folder, file) {
    const key = `${folder}/${file}`;
    if (!this.buffers.has(key)) {
      const ctx = this.context;
      this.buffers.set(key, (async () => {
        try {
          const response = await host().fetch(new URL(`../../assets/${key}`, import.meta.url));
          if (response.ok === false || !ctx) return null;
          return await ctx.decodeAudioData(await response.arrayBuffer());
        } catch { return null; }
      })());
    }
    return this.buffers.get(key);
  }
  _clip(key, variant) {
    const line = this.manifest.lines[key]; if (!line) return null;
    const index = Number.isInteger(variant) ? ((variant % line.clips.length) + line.clips.length) % line.clips.length : (this.variants.get(key) ?? 0);
    this.variants.set(key, (index + 1) % line.clips.length);
    return { ...line.clips[index], speaker: line.speaker };
  }
  voice(key, { priority = 'normal', variant } = {}) { return this._enqueue({ items: [key], variant, priority }); }
  voiceSequence(items, { priority = 'normal' } = {}) { return this._enqueue({ items: Array.isArray(items) ? items : [], priority }); }
  radio({ text = '', speaker = 'engineer', priority = 'normal' } = {}) {
    return String(text).trim() ? this._enqueue({ items: [], legacy: true, speaker, priority }) : Promise.resolve();
  }
  _enqueue(data) {
    if (this.disposed || !this.enabled || !this.voiceEnabled || !this.context) return Promise.resolve();
    return new Promise(resolve => {
      const item = { ...data, priority: ['high', 'normal', 'low'].includes(data.priority) ? data.priority : 'normal', resolve };
      if (item.priority === 'high') {
        const index = this.queue.findIndex(e => e.priority !== 'high'); this.queue.splice(index < 0 ? this.queue.length : index, 0, item);
      } else this.queue.push(item);
      while (this.queue.length > 3) {
        let i = this.queue.findIndex(e => e.priority === 'low'); if (i < 0) i = this.queue.findIndex(e => e.priority === 'normal');
        this.queue.splice(i < 0 ? this.queue.length - 1 : i, 1)[0].resolve();
      }
      if (item.priority === 'high' && this.current?.priority !== 'high') this.current?.finish();
      this._pump();
    });
  }
  async _pump() {
    if (this.current || !this.queue.length || this.disposed || !this.enabled || !this.voiceEnabled) return;
    const item = this.queue.shift(); this.current = item; const local = new Set(); let finished = false, timer;
    item.finish = () => {
      if (finished) return; finished = true; clearTimeout(timer);
      for (const source of local) { try { source.stop(); } catch {} }
      this._target(this.duck?.gain, 1, 0.08); this._target(this.radioLevel?.gain, 0, 0.02);
      if (this.current === item) this.current = null; item.resolve(); this._pump();
    };
    try {
      if (!item.legacy) await this.ready;
      if (finished || this.disposed) return;
      const clips = item.items.map((entry, index) => typeof entry === 'string' ? this._clip(entry, index === 0 ? item.variant : undefined)
        : this.manifest.numbers[entry?.num] ? { ...this.manifest.numbers[entry.num], speaker: 'engineer' } : null);
      // An incomplete sentence is skipped rather than speaking misleading fragments.
      if (clips.some(c => !c) || (!clips.length && !item.legacy)) { item.finish(); return; }
      const buffers = await Promise.all(clips.map(c => this._buffer('voice', c.file)));
      if (finished || this.disposed) return;
      if (buffers.some(b => !b)) { item.finish(); return; }
      const ctx = this.context, start = ctx.currentTime + 0.08;
      this._target(this.duck.gain, 0.4, 0.025);
      this._target(this.radioLevel.gain, clips[0]?.speaker === 'player' || item.speaker === 'player' ? 0.021 : 0.012, 0.02);
      const squelch = at => { local.add(this._pulse(at, 0.045, 0.032, true)); local.add(this._pulse(at, 0.03, 0.025, false)); };
      squelch(ctx.currentTime);
      let at = start;
      buffers.forEach((buffer, i) => {
        const source = ctx.createBufferSource(); source.buffer = buffer;
        this._source(source, this.voiceChains[clips[i].speaker], at); local.add(source);
        at += buffer.duration + (i < buffers.length - 1 ? 0.04 : 0);
      });
      if (item.legacy) at += 0.32;
      squelch(at);
      timer = setTimeout(item.finish, Math.max(0, (at + 0.07 - ctx.currentTime) * 1000));
    } catch { item.finish(); }
  }
  _pulse(at, duration, level, beep, destination = this.mix) {
    const ctx = this.context, envelope = ctx.createGain(); envelope.connect(destination);
    envelope.gain.setValueAtTime(0, at); envelope.gain.linearRampToValueAtTime(level, at + 0.003);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    const source = beep ? ctx.createOscillator() : ctx.createBufferSource();
    if (beep) { source.type = 'square'; source.frequency.value = 1650; } else source.buffer = this.noiseBuffer;
    this._source(source, envelope, at);
    source.onended = () => { this.sources.delete(source); source.disconnect(); envelope.disconnect(); };
    source.stop(at + duration + 0.005); return source;
  }
  async sfx(name, { volume = 1, rate = 1, delay = 0 } = {}) {
    if (this.disposed || !this.enabled || !this.context) return;
    const file = name === 'wheel_gun' ? `wheel_gun_${Math.random() < 0.5 ? 1 : 2}` : name === 'pass_by' ? 'cars_passing' : name;
    if (!SFX.includes(file)) return;
    const ctx = this.context, requested = ctx.currentTime + clamp(delay, 0, 5);
    try {
      const buffer = await this._buffer('sfx', `${file}.mp3`);
      if (!buffer || this.disposed || !this.enabled || ctx !== this.context) return;
      const source = ctx.createBufferSource(), gain = ctx.createGain(); source.buffer = buffer;
      const level = clamp(volume, 0, 2, 1) * 0.25;
      source.playbackRate.value = clamp(rate, 0.5, 2, 1); gain.gain.value = level; gain.connect(this.duck);
      const duration = Math.min(buffer.duration, name === 'pass_by' ? 2.5 : name === 'wheel_gun' ? 0.75 : 5);
      const at = Math.max(ctx.currentTime, requested), offset = name === 'pass_by' ? Math.random() * Math.max(0, buffer.duration - duration) : 0;
      gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(level, at + 0.015);
      const end = at + duration / source.playbackRate.value;
      gain.gain.setValueAtTime(level, Math.max(at + 0.015, end - 0.05)); gain.gain.linearRampToValueAtTime(0, end);
      source.connect(gain); this.sources.add(source);
      source.onended = () => { this.sources.delete(source); source.disconnect(); gain.disconnect(); };
      source.start(at, offset, duration);
    } catch { /* Optional sound. */ }
  }
  _loop(name, volume, brightness = 2500) {
    const existing = this.loops.get(name);
    if (existing) { existing.volume = volume; this._target(existing.gain?.gain, volume, 0.25); this._target(existing.filter?.frequency, brightness, 0.15); return; }
    if (volume <= 0) return;
    const entry = { volume }; this.loops.set(name, entry); const ctx = this.context;
    this._buffer('sfx', `${name}.mp3`).then(buffer => {
      if (!buffer || this.disposed || ctx !== this.context) return;
      const gain = this._gain(0, this.duck), filter = this._filter('lowpass', brightness, 0.5, gain);
      const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
      source.loopStart = Math.min(0.2, buffer.duration * 0.05); source.loopEnd = Math.min(buffer.duration, source.loopStart + 6);
      this._source(source, filter); Object.assign(entry, { gain, filter, source }); this._target(gain.gain, entry.volume, 0.3);
    }).catch(() => {});
  }
  update(telemetry = {}, { safetyCar = 'none', inPit = false, dnf = false, wet = false, timeScale = 1, phase, traffic = [] } = {}) {
    if (this.disposed || !this.enabled || !this.context || !this.master) return;
    const now = this.context.currentTime, nextPhase = phase ?? (inPit ? 'pit' : 'race');
    inPit ||= nextPhase === 'pit' || nextPhase === 'garage';
    if (!dnf && nextPhase === 'race' && ['grid', 'formation'].includes(this.phase)) { this.sfx('crowd_cheer'); this.sfx('f1_restart', { volume: 0.5 }); }
    this.phase = nextPhase;
    const speed = clamp(telemetry.speed, 0, 380), throttle = clamp(telemetry.throttle, 0, 1);
    const stopped = inPit && nextPhase !== 'garage' && speed < 2;
    if (stopped && !this.pitStopped && !dnf) {
      const count = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) this.sfx('wheel_gun', { volume: 0.7, delay: 0.12 + i * 0.22 + Math.random() * 0.13 });
    }
    this.pitStopped = stopped;
    const gear = Math.round(clamp(telemetry.gear, 1, 8, this.gear ?? 1));
    const changed = this.gear !== null && gear !== this.gear;
    const shift = !dnf && !inPit && (changed || !!telemetry.shifting && !this.wasShifting) && now >= this.shiftUntil;
    const backfire = !dnf && ((changed && gear < this.gear && this.shifts % 3 === 0) || (this.throttle - throttle > 0.5 && Math.random() < 0.3));
    if (backfire && !this.engine) this._pulse(now, 0.055, 0.09, false, this.engineLevel);
    if (shift) { this.shiftUntil = now + 0.04 + Math.random() * 0.03; this.shifts++; }
    this.gear = gear; this.wasShifting = !!telemetry.shifting; this.throttle = throttle;
    const neutral = safetyCar === 'sc' || safetyCar === 'vsc';
    let rpm = clamp(telemetry.rpm, 4000, 15000, 4500);
    if (nextPhase === 'grid') { const rev = Math.max(0, Math.sin(now * 0.73)) ** 18; rpm = 4200 + Math.sin(now * 4.1) * 220 + rev * 6200; }
    if (nextPhase === 'formation') rpm = Math.min(rpm, 7800);
    if (nextPhase === 'garage' || nextPhase === 'cooldown') rpm = 4200;
    if (neutral) rpm = Math.min(rpm, safetyCar === 'sc' ? 6200 : 7200);
    if (inPit && nextPhase !== 'garage') rpm = 6000;
    if (now < this.shiftUntil) rpm *= 0.8;
    rpm *= clamp(1 + Math.log2(clamp(timeScale, 0.25, 4, 1)) * 0.025, 0.95, 1.05);
    this.engine?.port.postMessage({ rpm, throttle, pit: inPit && nextPhase !== 'garage', cut: now < this.shiftUntil, backfire });
    for (const { ratio, osc } of this.harmonics) this._target(osc.frequency, rpm / 60 * 3 * ratio, 0.022);
    this._target(this.lowpass.frequency, 1900 + throttle * 2600 + rpm * 0.07);
    this._target(this.turbo.frequency, 2300 + rpm * 0.13 + throttle * 1100, 0.07); this._target(this.turboLevel.gain, throttle * 0.012);
    this._target(this.shiftLevel.gain, now < this.shiftUntil ? 0.08 : 1, 0.008);
    this._target(this.engineLevel.gain, dnf ? 0 : (0.35 + throttle * 0.4) * (neutral ? 0.55 : inPit ? 0.48 : 1), dnf ? 0.32 : 0.04);
    this._target(this.pitLevel.gain, inPit && !dnf ? 1 : 0);
    this._target(this.windLevel.gain, dnf ? 0 : (speed / 380) ** 1.5 * 0.12, 0.12);
    this._target(this.rainLevel.gain, wet && !dnf ? 0.012 + speed / 380 * 0.09 : 0, 0.2);
    const currentTraffic = new Map(); let nearest = Infinity;
    if (Array.isArray(traffic)) traffic.forEach((car, index) => {
      if (!Number.isFinite(car?.distance) || !Number.isFinite(car?.closing)) return;
      nearest = Math.min(nearest, Math.abs(car.distance)); const id = car.id ?? car.carId ?? index, old = this.traffic.get(id);
      const crossing = old && old.distance * car.distance < 0;
      const reversal = old && old.closing * car.closing < 0;
      if (!dnf && nextPhase === 'race' && old && Math.min(Math.abs(car.distance), Math.abs(old.distance)) < 12 && (crossing || reversal) && now - this.lastPass > 1.2) {
        this.sfx('pass_by', { volume: 0.9, rate: clamp(1 + old.closing / 250, 0.92, 1.08, 1) }); this.lastPass = now;
      }
      currentTraffic.set(id, { distance: car.distance, closing: car.closing });
    });
    this.traffic = currentTraffic;
    const proximity = nextPhase === 'race' && !dnf ? Math.exp(-nearest / 35) : 0;
    this._loop('f1_idle_start', !dnf && ['grid', 'formation'].includes(nextPhase) ? 0.055 : 0, 1800);
    this._loop('f1_racing', proximity * 0.1, 800 + proximity * 4500);
    this._loop('f1_practice', proximity * 0.035, 650 + proximity * 3000);
    this._loop('crowd_ambience', !dnf && (inPit || nextPhase === 'grid') ? 0.035 : 0, 2000);
  }
  setEnabled(enabled) { if (this.disposed) return; this.enabled = !!enabled; this._target(this.master?.gain, this.enabled ? this.volume * 0.7 : 0, 0.025); if (!this.enabled) this._cancelRadio(); }
  setVolume(volume) { if (!this.disposed) { this.volume = clamp(volume, 0, 1, this.volume); this._target(this.master?.gain, this.enabled ? this.volume * 0.7 : 0); } }
  setVoiceEnabled(enabled) { if (!this.disposed) { this.voiceEnabled = !!enabled; if (!this.voiceEnabled) this._cancelRadio(); } }
  setLang(lang) { if (!this.disposed) this.lang = String(lang || 'en-GB'); }
  _cancelRadio() { for (const item of this.queue.splice(0)) item.resolve(); this.current?.finish(); }
  _releaseContext() {
    try { this.engine?.port.close?.(); } catch {}
    for (const source of this.sources) { try { source.stop(); source.disconnect(); } catch {} } this.sources.clear();
    for (const node of this.nodes) { try { node.disconnect(); } catch {} } this.nodes = [];
    const ctx = this.context; this.context = null; this.master = null;
    this.buffers.clear(); this.loops.clear(); this.engine = null;
    if (ctx) { try { Promise.resolve(ctx.close()).catch(() => {}); } catch {} }
  }
  dispose() { if (!this.disposed) { this.disposed = true; this._cancelRadio(); this._releaseContext(); } }
}
