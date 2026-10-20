// Sample-level V6 four-stroke combustion, exhaust delay lines and induction.
// No browser globals are evaluated when imported by Node.
const Processor = globalThis.AudioWorkletProcessor ?? class {};
const variations = [0.99, 1.018, 0.983, 1.012, 1.004, 0.993];
export class V6Engine extends Processor {
  constructor() {
    super();
    this.state = { rpm: 4500, throttle: 0, pit: false, cut: false, backfire: false };
    this.rpm = 4500; this.throttle = 0; this.phase = 0; this.cylinder = 0;
    this.pulseAge = 1; this.amplitude = 1; this.turboPhase = 0; this.motorPhase = 0;
    this.clock = 0; this.burst = 0; this.seed = 19317; this.intake = 0; this.air = 0;
    const sr = globalThis.sampleRate ?? 48000;
    this.delays = [0.0031, 0.0047, 0.0063].map(t => ({ data: new Float32Array(Math.round(t * sr)), index: 0 }));
    if (this.port) this.port.onmessage = ({ data }) => {
      this.state = { ...this.state, ...data };
      if (data.backfire) this.burst = 1;
    };
  }
  noise() { let s = this.seed; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.seed = s; return (s >>> 0) / 2147483648 - 1; }
  process(inputs, outputs) {
    const output = outputs[0]; if (!output?.length) return true;
    const sr = globalThis.sampleRate ?? 48000, dt = 1 / sr;
    for (let i = 0; i < output[0].length; i++) {
      this.clock += dt;
      this.rpm += (this.state.rpm - this.rpm) * 0.0015;
      this.throttle += (this.state.throttle - this.throttle) * 0.001;
      const cut = this.state.cut || (this.state.pit && this.clock % 0.115 < 0.027);
      this.phase += this.rpm / 60 * 3 * variations[this.cylinder] * dt;
      if (this.phase >= 1) {
        this.phase -= 1; this.cylinder = (this.cylinder + 1) % 6;
        if (!cut) { this.pulseAge = 0; this.amplitude = 0.83 + this.noise() * 0.12; }
      }
      this.pulseAge += dt;
      const noise = this.noise();
      const pulse = Math.exp(-this.pulseAge * 1900) * (Math.sin(this.pulseAge * 2 * Math.PI * 1450) + noise * 0.35) * this.amplitude;
      let exhaust = pulse * 0.6;
      for (const delay of this.delays) {
        const echo = delay.data[delay.index];
        delay.data[delay.index] = pulse + echo * 0.48;
        delay.index = (delay.index + 1) % delay.data.length;
        exhaust += echo * 0.24;
      }
      this.air += (noise - this.air) * 0.32;
      this.intake += (this.air - this.intake) * 0.035;
      this.turboPhase = (this.turboPhase + (2200 + this.rpm * 0.19 + this.throttle * 1300) * dt) % 1;
      this.motorPhase = (this.motorPhase + this.rpm * 0.8 * dt) % 1;
      this.burst *= Math.exp(-dt * 100);
      const accessories = Math.sin(this.turboPhase * Math.PI * 2) * this.throttle * 0.022
        + Math.sin(this.motorPhase * Math.PI * 2) * 0.006
        + (this.air - this.intake) * this.throttle * 0.075;
      const value = Math.tanh(exhaust * (0.8 + this.throttle * 0.9) + noise * this.burst * 0.4) * (cut ? 0.09 : 0.85) + accessories;
      for (const channel of output) channel[i] = value;
    }
    return true;
  }
}
if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('race-v6', V6Engine);
