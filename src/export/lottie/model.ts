import type { Vec2 } from '../../core/project';
import { reduceLinear } from '../../utils/reduction';

export type LottieMode = 'native' | 'pseudo' | 'bake';
export const modeLabels: Record<LottieMode, string> = { native: 'Векторный 2D', pseudo: 'Псевдо-3D', bake: 'Запечённый 3D' };
export type LottieOptions = { width: number; height: number; fps: 24 | 30 | 60; step: number; tolerance: number };
export type LottieOutput = {
  mode: LottieMode;
  json: string;
  bytes: number;
  layers: number;
  shapes: number;
  keys: number;
  frames: number;
  duration: number;
  step: number;
  warnings: string[];
};
type Animated<T> = { a: 0; k: T } | { a: 1; k: { t: number; s: unknown; h?: number; i?: Vec2Bezier; o?: Vec2Bezier }[] };
type Vec2Bezier = { x: number; y: number };
type BezierPath = { i: Vec2[]; o: Vec2[]; v: Vec2[]; c: true };
export type LottieShape =
  | { ty: 'sh'; nm: string; ks: Animated<BezierPath> }
  | { ty: 'st'; nm: string; c: Animated<number[]>; o: Animated<number>; w: Animated<number>; lc: 2; lj: 2 }
  | { ty: 'gf'; nm: string; g: { p: number; k: Animated<number[]> }; o: Animated<number>; s: Animated<number[]>; e: Animated<number[]>; r: 2; t: 1 }
  | { ty: 'fl'; nm: string; c: Animated<number[]>; o: Animated<number>; r: 2 }
  | { ty: 'gr'; nm: string; it: LottieShape[] }
  | { ty: 'tr'; a: Animated<number[]>; p: Animated<number[]>; s: Animated<number[]>; r: Animated<number>; o: Animated<number>; sk?: Animated<number>; sa?: Animated<number> };
export type LottieLayer = { ddd: 0; ind: number; ty: 4; nm: string; sr: 1; st: 0; bm: 0; ip: number; op: number;
  ks: Omit<Extract<LottieShape, { ty: 'tr' }>, 'ty' | 'sk' | 'sa'>; shapes: LottieShape[] };
export type LottieDocument = { v: string; fr: number; ip: 0; op: number; w: number; h: number; nm: string;
  ddd: 0; assets: []; layers: LottieLayer[] };

export const round = (n: number, digits = 2) => Number(n.toFixed(digits));
export const constant = <T>(k: T): Animated<T> => ({ a: 0, k });
export function track<T>(samples: { frame: number; value: T }[], hold: boolean, equal: (a: T, b: T) => boolean, scalar = false, shape = false): Animated<T> {
  if (samples.every(({ value }) => equal(samples[0].value, value))) return constant(samples[0].value);
  const keys = hold ? samples.filter(({ value }, index) => index === 0 || !equal(samples[index - 1].value, value)) : samples;
  return { a: 1, k: keys.map(({ frame, value }) => ({
    t: frame, s: scalar || shape ? [value] : value,
    ...(hold ? { h: 1 } : { i: { x: 0.667, y: 0.667 }, o: { x: 0.333, y: 0.333 } }),
  })) };
}
export function numbers<T extends number | number[]>(samples: { frame: number; value: T }[], tolerance: number, hold = false): Animated<T> {
  const vector = (value: number | number[]): number[] => typeof value === 'number' ? [value] : value;
  const trimmed = hold ? samples : reduceLinear(samples, ({ frame }) => frame, ({ value }) => vector(value), tolerance);
  return track(trimmed, hold, (a, b) => vector(a).every((value, i) => Math.abs(value - vector(b)[i]) < 1e-6), typeof samples[0].value === 'number');
}
export function path(points: Vec2[]): BezierPath {
  const tangents = points.map((): Vec2 => [0, 0]);
  return { i: tangents, o: tangents, v: points, c: true };
}
export function staticPath(points: Vec2[], nm = 'Contour'): LottieShape {
  return { ty: 'sh', nm, ks: constant(path(points)) };
}
export function changingPath(samples: { frame: number; points: Vec2[] }[], count: number, tolerance?: number): Extract<LottieShape, { ty: 'sh' }> {
  // Hold keyframes can switch contours. Pad them to keep a consistent segment
  // count for players that allocate their path buffer from the first sample.
  const selected = tolerance === undefined ? samples :
    reduceLinear(samples, ({ frame }) => frame, ({ points }) => points.flat(), tolerance);
  return { ty: 'sh', nm: 'Contour', ks: track(selected.map(({ frame, points }) => ({
    frame, value: path([...points, ...Array.from({ length: count - points.length }, () => points.at(-1) ?? [0, 0] as Vec2)]),
  })), tolerance === undefined, (a, b) => a.v.every(([x, y], index) => x === b.v[index][0] && y === b.v[index][1]), false, true) };
}
export const defaults = {
  a: constant([0, 0, 0]), p: constant([0, 0, 0]), s: constant([100, 100, 100]), r: constant(0), o: constant(100),
};
export const transform: Extract<LottieShape, { ty: "tr" }> = { ty: 'tr', ...defaults };
export function shapeLayer(name: string, index: number, frames: number, shapes: LottieShape[], ks = defaults): LottieLayer {
  return { ddd: 0, ind: index, ty: 4, nm: name, sr: 1, st: 0, ip: 0, op: frames, bm: 0, ks, shapes };
}
export function countKeys(item: unknown): number {
  if (!item || typeof item !== 'object') return 0;
  if ('a' in item && item.a === 1 && 'k' in item && Array.isArray(item.k)) return item.k.length;
  return Object.values(item).reduce<number>((count, child) => count + countKeys(child), 0);
}
