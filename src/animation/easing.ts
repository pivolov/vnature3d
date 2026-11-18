export const families = ['sine', 'quad', 'cubic', 'expo', 'back', 'elastic', 'bounce'] as const;
export type Easing = { kind: 'linear' | 'hold' } |
  { kind: 'bezier'; x1: number; y1: number; x2: number; y2: number } |
  { kind: 'named'; family: typeof families[number]; direction: 'in' | 'out' | 'in-out' };

function bounce(t: number) {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t - 1.5 / d) ** 2 + 0.75;
  if (t < 2.5 / d) return n * (t - 2.25 / d) ** 2 + 0.9375;
  return n * (t - 2.625 / d) ** 2 + 0.984375;
}
const easeIn = {
  sine: (t: number) => 1 - Math.cos(t * Math.PI / 2),
  quad: (t: number) => t ** 2,
  cubic: (t: number) => t ** 3,
  expo: (t: number) => 2 ** (10 * t - 10),
  back: (t: number) => 2.70158 * t ** 3 - 1.70158 * t ** 2,
  elastic: (t: number) => -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * 2 * Math.PI / 3),
  bounce: (t: number) => 1 - bounce(1 - t),
};

export function ease(t: number, easing: Easing): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (easing.kind === 'linear') return t;
  if (easing.kind === 'hold') return 0;
  if (easing.kind === 'bezier') {
    const cubic = (u: number, a: number, b: number) => 3 * (1 - u) ** 2 * u * a + 3 * (1 - u) * u ** 2 * b + u ** 3;
    let low = 0;
    let high = 1;
    for (let index = 0; index < 24; index++) {
      const middle = (low + high) / 2;
      if (cubic(middle, easing.x1, easing.x2) < t) low = middle;
      else high = middle;
    }
    return cubic((low + high) / 2, easing.y1, easing.y2);
  }
  if (easing.kind !== 'named') return t;
  const fn = easeIn[easing.family];
  if (easing.direction === 'in') return fn(t);
  if (easing.direction === 'out') return 1 - fn(1 - t);
  return t < 0.5 ? fn(t * 2) / 2 : 1 - fn(2 - t * 2) / 2;
}

export function spring(t: number, frequency = 11, damping = 0.48): number {
  if (t <= 0) return 0;
  if (Math.abs(damping - 1) < 0.0001) return 1 - Math.exp(-frequency * t) * (1 + frequency * t);
  if (damping < 1) {
    const s = Math.sqrt(1 - damping ** 2);
    const angle = frequency * s * t;
    return 1 - Math.exp(-damping * frequency * t) * (Math.cos(angle) + damping / s * Math.sin(angle));
  }
  const root = Math.sqrt(damping ** 2 - 1);
  const a = -frequency * (damping - root);
  const b = -frequency * (damping + root);
  return 1 + (b * Math.exp(a * t) - a * Math.exp(b * t)) / (a - b);
}
