import { HalfFloatType, Vector2, WebGLRenderTarget } from 'three';
import { EffectComposer } from '../../../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../../../vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../../../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../../../vendor/three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from '../../../vendor/three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from '../../../vendor/three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from '../../../vendor/three/addons/shaders/FXAAShader.js';

// All brightness values below are scene-linear, BEFORE exposure / ACES / sRGB.
// Selection is by luminance and local contrast, not by object identity/layers.
export const POSTFX_DEFAULTS = Object.freeze({
  quality: 'high', aa: true,
  bloomStrength: 0.25, bloomRadius: 0.4, bloomThreshold: 0.95,
  bloomKnee: 0.15, bloomClamp: 1.5, bloomContrast: 0.35,
  bloomSampleRadius: 12, bloomResolutionScale: 1,
  motionBlur: 0.006, speedStart: 150, speedEnd: 330,
  vignette: 0.1, chromaticAberration: 0.0006, grain: 0.003,
  wetContrast: 0.94, wetSaturation: 0.88, wetCool: 0.025,
  dnfSaturation: 0.2, dnfBrightness: 0.7, transitionRate: 3,
});

const ranges = {
  bloomStrength: [0, 1], bloomRadius: [0, 1], bloomThreshold: [0.9, 60000],
  bloomKnee: [0.001, 100], bloomClamp: [0, 8], bloomContrast: [0.01, 4],
  bloomSampleRadius: [1, 128], bloomResolutionScale: [0.125, 1],
  motionBlur: [0, 0.02], speedStart: [0, 1000], speedEnd: [1, 2000],
  vignette: [0, 0.5], chromaticAberration: [0, 0.003], grain: [0, 0.02],
  wetContrast: [0.5, 1], wetSaturation: [0, 1], wetCool: [0, 0.15],
  dnfSaturation: [0, 1], dnfBrightness: [0, 1], transitionRate: [0, 30],
};
const finite = (value, fallback, min, max) => Number.isFinite(value)
  ? Math.min(max, Math.max(min, value)) : fallback;

/** Pure, Node-safe validation; unknown keys are ignored. Options are flat. */
export function normalizePostFXOptions(input = {}) {
  input = input ?? {};
  const result = { ...POSTFX_DEFAULTS };
  result.quality = input.quality === 'low' ? 'low' : 'high';
  result.aa = typeof input.aa === 'boolean' ? input.aa : result.aa;
  for (const [key, [min, max]] of Object.entries(ranges)) {
    result[key] = finite(input[key], result[key], min, max);
  }
  result.speedEnd = Math.max(result.speedStart + 1, result.speedEnd);
  return result;
}

/** Smoothstep speed ramp; low quality always disables motion blur. */
export function postFXSpeedAmount(speed, options = POSTFX_DEFAULTS) {
  if (options.quality === 'low') return 0;
  const t = finite((speed - options.speedStart) / (options.speedEnd - options.speedStart), 0, 0, 1);
  return t * t * (3 - 2 * t) * options.motionBlur;
}

const vertexShader = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A fixed threshold alone cannot distinguish a bright HDR sky from a lamp.
// Reject broad, uniform highlights using four nearby samples, then bound the
// selected radiance BEFORE the mip blur. HDRI intensity cannot amplify bloom
// without bound. This leaves the scene's original HDR signal untouched.
const bloomFragment = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform float luminosityThreshold, smoothWidth, sourceClamp, localContrast;
  uniform vec2 sampleOffset;
  varying vec2 vUv;
  vec3 sampleHDR(vec2 uv) {
    return clamp(texture2D(tDiffuse, clamp(uv, vec2(0.0), vec2(1.0))).rgb, 0.0, 60000.0);
  }
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  void main() {
    vec3 c = sampleHDR(vUv);
    float y = luma(c);
    float surrounding = 0.25 * (
      luma(sampleHDR(vUv + vec2(sampleOffset.x, 0.0))) +
      luma(sampleHDR(vUv - vec2(sampleOffset.x, 0.0))) +
      luma(sampleHDR(vUv + vec2(0.0, sampleOffset.y))) +
      luma(sampleHDR(vUv - vec2(0.0, sampleOffset.y))));
    float gate = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, y);
    float relativePeak = max(y - surrounding, 0.0) / max(surrounding, 0.1);
    gate *= smoothstep(localContrast, localContrast * 2.0, relativePeak);
    float peak = max(max(c.r, c.g), c.b);
    c *= min(1.0, sourceClamp / max(peak, 0.0001));
    gl_FragColor = vec4(c * gate, 0.0);
  }
`;

// One full-resolution pass for lens, speed and weather. No history/depth buffers.
const lensFragment = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec2 resolution;
  uniform float motion, vignette, aberration, grain, frame;
  uniform float wet, dnf, wetContrast, wetSaturation, wetCool;
  uniform float dnfSaturation, dnfBrightness;
  varying vec2 vUv;
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  vec4 sampleImage(vec2 uv) {
    vec2 halfPixel = 0.5 / resolution;
    return texture2D(tDiffuse, clamp(uv, halfPixel, 1.0 - halfPixel));
  }
  void main() {
    vec2 radial = vUv - 0.5;
    float edge = smoothstep(0.2, 0.7, length(radial));
    vec4 base = sampleImage(vUv);
    vec3 c = base.rgb;
    #ifndef LOW_QUALITY
      if (motion > 0.0 && edge > 0.0) {
        vec2 stepUV = radial * motion * edge;
        c = (c + sampleImage(vUv - stepUV * 0.25).rgb +
          sampleImage(vUv - stepUV * 0.5).rgb +
          sampleImage(vUv - stepUV * 0.75).rgb +
          sampleImage(vUv - stepUV).rgb) * 0.2;
      }
    #endif
    if (aberration > 0.0 && edge > 0.0) {
      vec2 shift = radial * aberration * edge;
      // Apply only the channel difference, preserving the radial blur result.
      c.r += sampleImage(vUv + shift).r - base.r;
      c.b += sampleImage(vUv - shift).b - base.b;
    }
    c = mix(vec3(luma(c)), c, mix(1.0, wetSaturation, wet));
    // Compress contrast around middle gray, before tone mapping.
    c = mix(vec3(0.18), c, mix(1.0, wetContrast, wet));
    c *= mix(vec3(1.0), vec3(1.0 - wetCool, 1.0 - wetCool * 0.25, 1.0), wet);
    c = mix(vec3(luma(c)), c, mix(1.0, dnfSaturation, dnf));
    c *= mix(1.0, dnfBrightness, dnf);
    c *= 1.0 - vignette * edge * edge;
    float noise = fract(sin(dot(floor(vUv * resolution), vec2(12.9898, 78.233))
      + frame * 17.13) * 43758.5453) - 0.5;
    c += noise * grain * min(c, vec3(1.0));
    gl_FragColor = vec4(max(c, vec3(0.0)), base.a);
  }
`;

/**
 * Main-view only. Call after mirror rendering and renderer.setRenderTarget(null).
 * Does not alter renderer exposure, tone mapping, color space, shadows or size.
 * Order: linear HalfFloat RenderPass -> bounded bloom -> lens -> AA -> OutputPass.
 * All tuning options are POSTFX_DEFAULTS keys, passed at creation or setOptions.
 * Quality is fixed at creation; aa can be toggled at runtime.
 * GPU time must be measured on the target device; no universal <4ms guarantee.
 */
export function createPostFX(renderer, scene, camera, options = {}) {
  let settings = normalizePostFXOptions(options);
  const low = settings.quality === 'low';
  let enabled = true, disposed = false, frame = 0, wet = 0, dnf = 0;
  let width = 1, height = 1, ratio = 1;

  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: true });
  target.texture.name = 'CockpitPostFX.linearHDR';
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new Vector2(32, 32), 0.25, 0.4, settings.bloomThreshold);
  Object.assign(bloom.highPassUniforms, {
    sourceClamp: { value: 1.5 }, localContrast: { value: 0.35 },
    sampleOffset: { value: new Vector2() },
  });
  bloom.materialHighPassFilter.fragmentShader = bloomFragment;
  bloom.materialHighPassFilter.needsUpdate = true;
  const sizeBloom = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => {
    const scale = settings.bloomResolutionScale * (low ? 0.5 : 1);
    // UnrealBloom already starts at half resolution; low starts at quarter.
    sizeBloom(Math.max(32, Math.round(w * scale)), Math.max(32, Math.round(h * scale)));
  };

  const uniforms = {
    tDiffuse: { value: null }, resolution: { value: new Vector2(1, 1) },
  };
  for (const key of ['motion', 'vignette', 'aberration', 'grain', 'frame', 'wet', 'dnf',
    'wetContrast', 'wetSaturation', 'wetCool', 'dnfSaturation', 'dnfBrightness']) {
    uniforms[key] = { value: 0 };
  }
  const lens = new ShaderPass({ name: 'CockpitBroadcastLens', uniforms, vertexShader,
    fragmentShader: lensFragment, defines: low ? { LOW_QUALITY: 1 } : {} });
  const aa = low ? new ShaderPass(FXAAShader) : new SMAAPass(1, 1);
  const output = new OutputPass();
  for (const pass of [renderPass, bloom, lens, aa, output]) composer.addPass(pass);

  function applySettings() {
    bloom.strength = settings.bloomStrength;
    bloom.radius = settings.bloomRadius;
    bloom.threshold = settings.bloomThreshold;
    bloom.enabled = settings.bloomStrength > 0 && settings.bloomClamp > 0;
    bloom.highPassUniforms.smoothWidth.value = settings.bloomKnee;
    bloom.highPassUniforms.sourceClamp.value = settings.bloomClamp;
    bloom.highPassUniforms.localContrast.value = settings.bloomContrast;
    bloom.highPassUniforms.sampleOffset.value.set(
      settings.bloomSampleRadius / width, settings.bloomSampleRadius / height);
    aa.enabled = settings.aa;
    const u = lens.uniforms;
    for (const key of ['vignette', 'grain', 'wetContrast', 'wetSaturation', 'wetCool',
      'dnfSaturation', 'dnfBrightness']) u[key].value = settings[key];
    u.aberration.value = settings.chromaticAberration;
  }

  function setSize(w, h, pixelRatio = renderer.getPixelRatio()) {
    if (disposed) return;
    width = finite(w, 1, 1, 16384);
    height = finite(h, 1, 1, 16384);
    ratio = finite(pixelRatio, 1, 0.25, 4);
    composer.setPixelRatio(ratio);
    composer.setSize(width, height);
    const pw = Math.max(1, Math.floor(width * ratio));
    const ph = Math.max(1, Math.floor(height * ratio));
    lens.uniforms.resolution.value.set(pw, ph);
    if (low) aa.uniforms.resolution.value.set(1 / pw, 1 / ph);
    applySettings();
  }

  const size = renderer.getSize(new Vector2());
  setSize(size.x, size.y, renderer.getPixelRatio());

  return {
    setSize,
    setEnabled(value) { enabled = Boolean(value); },
    // Copy returned settings: callers cannot bypass validation by mutating them.
    getOptions() { return { ...settings }; },
    setOptions(patch = {}) {
      if (disposed) return;
      const previousScale = settings.bloomResolutionScale;
      settings = normalizePostFXOptions({ ...settings, ...patch, quality: settings.quality });
      applySettings();
      if (previousScale !== settings.bloomResolutionScale) bloom.setSize(width * ratio, height * ratio);
    },
    render(dt = 0, state = {}) {
      if (disposed) return;
      if (!enabled) { renderer.render(scene, camera); return; }
      state = state ?? {};
      const delta = finite(dt, 0, 0, 0.25);
      const blend = settings.transitionRate === 0 ? 1 : 1 - Math.exp(-settings.transitionRate * delta);
      wet += (Number(Boolean(state.wet)) - wet) * blend;
      dnf += (Number(Boolean(state.dnf)) - dnf) * blend;
      lens.uniforms.motion.value = postFXSpeedAmount(state.speed, settings);
      lens.uniforms.wet.value = wet;
      lens.uniforms.dnf.value = dnf;
      lens.uniforms.frame.value = frame = (frame + 1) % 4096;
      // state.braking is intentionally accepted without another camera tilt.
      composer.render(delta);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // r170 UnrealBloomPass.dispose omits its high-pass material.
      bloom.materialHighPassFilter.dispose();
      for (const pass of composer.passes) pass.dispose();
      composer.dispose();
    },
  };
}
