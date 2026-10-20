// FNV-1a seed hashing + Mulberry32. Forks depend on seed/label, never draw count.
function hash(value) {
  let h = 2166136261;
  for (const ch of String(value)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}
export function createRng(seed) {
  const key = String(seed);
  let state = hash(key);
  const rng = {
    next() {
      let t = state = (state + 0x6D2B79F5) >>> 0;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    },
    range(a, b) { return a + (b - a) * rng.next(); },
    int(a, b) { return Math.floor(rng.range(a, b + 1)); },
    chance(p) { return rng.next() < p; },
    pick(arr) { return arr.length ? arr[rng.int(0, arr.length - 1)] : undefined; },
    normal(mean = 0, sd = 1) {
      const u = 1 - rng.next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
    },
    fork(label) { return createRng(JSON.stringify([key, String(label)])); },
  };
  return rng;
}
