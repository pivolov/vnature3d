import { Quaternion, Vector3 } from 'three';
import { effectiveLayer } from '../core/layers';
import { materials, type Layer, type LightPreset, type Project, type Vec3 } from '../core/project';
import { spring, type Easing } from './easing';
import { cameraId, defaultTimeline, frameTime, type Key, type Property, type TimelineData, type Track, type Value } from './timeline';

export type PresetOptions = {
  duration: number; delay: number; intensity: number; direction: 'x' | 'y' | 'z' | '-x' | '-y' | '-z';
  stagger: number; order: 'forward' | 'center' | 'random'; easing: Easing;
};
export const presetDefaults: PresetOptions = {
  duration: 1.6, delay: 0, intensity: 1, direction: 'y', stagger: 0, order: 'forward',
  easing: { kind: 'named', family: 'sine', direction: 'in-out' },
};
const axisIndex = { x: 0, y: 1, z: 2 } as const;
const unit = Math.PI / 180;

type Samples = [number, number][];
type Recipe = {
  position?: Samples; radial?: Samples; rotation?: Samples; scale?: Samples; opacity?: Samples;
  squash?: Samples; roughness?: Samples; glow?: Samples; jitter?: Samples;
  camera?: 'orbit';
};
const pulse = (...values: number[]): Samples => values.map((value, i) => [i / (values.length - 1), value]);

export const presets = {
  fade: { label: 'Появление', group: 'Вход', recipe: { opacity: pulse(0, 1), scale: pulse(0.65, 1) } },
  pop: { label: 'Pop', group: 'Вход', recipe: { scale: [[0, 0.25], [0.56, 1.16], [0.8, 0.95], [1, 1]] } },
  drop: { label: 'Падение и отскок', group: 'Вход', recipe: { position: [[0, 1.8], [0.5, 0], [0.67, 0.38], [0.8, 0], [0.9, 0.12], [1, 0]] } },
  slide: { label: 'Скольжение 3D', group: 'Вход', recipe: { position: pulse(-2, 0), opacity: pulse(0, 1), rotation: pulse(-28, 0) } },
  flip: { label: 'Поворот с появлением', group: 'Вход', recipe: { rotation: pulse(-110, 0), opacity: [[0, 0], [0.38, 1], [1, 1]] } },
  unfold: { label: 'Разворот', group: 'Вход', recipe: { rotation: pulse(92, -12, 0), squash: pulse(0.1, 1.08, 1) } },
  assemble: { label: 'Сборка', group: 'Вход', recipe: { radial: pulse(2.1, 0), scale: pulse(0.55, 1), opacity: pulse(0, 1) } },
  explode: { label: 'Разлёт', group: 'Выход', recipe: { radial: pulse(0, 2.3), rotation: pulse(0, 70), opacity: pulse(1, 0) } },
  zoom: { label: 'Приближение насквозь', group: 'Выход', recipe: { scale: [[0, 1], [0.65, 1.3], [1, 3]], opacity: [[0, 1], [0.65, 1], [1, 0]] } },
  float: { label: 'Парение', group: 'Цикл', recipe: { position: pulse(0, 0.35, 0, -0.35, 0) } },
  spin: { label: 'Оборот 360°', group: 'Цикл', recipe: { rotation: pulse(0, 360) } },
  wobble: { label: 'Покачивание', group: 'Цикл', recipe: { rotation: pulse(0, 18, 0, -18, 0) } },
  pendulum: { label: 'Маятник', group: 'Цикл', recipe: { rotation: pulse(-28, 28, -28), position: pulse(-0.25, 0.25, -0.25) } },
  breathing: { label: 'Дыхание', group: 'Цикл', recipe: { scale: pulse(1, 1.13, 1) } },
  orbit: { label: 'Орбита камеры', group: 'Цикл', recipe: { camera: 'orbit' } },
  tilt: { label: 'Наклон', group: 'Цикл', recipe: { rotation: pulse(0, -16, 12, 0), position: pulse(0, 0.18, -0.12, 0) } },
  shine: { label: 'Пробегающий блик', group: 'Цикл', recipe: { roughness: pulse(0, -0.22, 0), rotation: pulse(0, 15, -12, 0) } },
  glow: { label: 'Пульс свечения', group: 'Цикл', recipe: { glow: pulse(0, 0.55, 0) } },
  shake: { label: 'Встряска', group: 'Акцент', recipe: { jitter: pulse(0, 0.32, -0.3, 0.23, -0.19, 0.12, 0) } },
  jelly: { label: 'Желе', group: 'Акцент', recipe: { squash: pulse(1, 0.59, 1.26, 0.9, 1) } },
  heartbeat: { label: 'Сердцебиение', group: 'Акцент', recipe: { scale: [[0, 1], [0.18, 1.23], [0.33, 1], [0.47, 1.14], [0.67, 1], [1, 1]] } },
  spring: { label: 'Пружина', group: 'Акцент', recipe: {} },
  rubber: { label: 'Резинка', group: 'Акцент', recipe: { squash: pulse(1, 1.36, 0.73, 1.16, 0.91, 1) } },
  segments: { label: 'Вращение сегментов', group: 'Лоадер', recipe: { rotation: pulse(0, 360), opacity: pulse(1, 0.45, 1) } },
  morph: { label: 'Пульсация формы', group: 'Лоадер', recipe: { squash: pulse(1, 0.75, 1, 1.27, 1) } },
  progress: { label: 'Заполнение', group: 'Лоадер', recipe: { squash: [[0, 0.03], [0.88, 1], [1, 1]], opacity: [[0, 0.25], [0.3, 1], [1, 1]] } },
} satisfies Record<string, { label: string; group: string; recipe: Recipe }>;
export type PresetId = keyof typeof presets;

export const templates = {
  splash: { label: 'Splash intro', light: 'dramatic', material: 'plastic', sequence: ['fade', 'wobble'] },
  onboarding: { label: 'Onboarding hero', light: 'soft', material: 'clay', sequence: ['assemble', 'float'] },
  success: { label: 'Success check', light: 'studio', material: 'plastic', sequence: ['pop', 'glow'] },
  loader: { label: 'Loader loop', light: 'studio', material: 'metal', sequence: ['segments'] },
} satisfies Record<string, { label: string; light: LightPreset; material: Layer['material']; sequence: PresetId[] }>;
export type TemplateId = keyof typeof templates;

function toVector([x, y, z]: Vec3, axis: number, delta: number): Vec3 {
  const value: Vec3 = [x, y, z];
  value[axis] += delta;
  return value;
}
const linear: Easing = { kind: 'linear' };

function stableRandom(id: string) {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function staggerRanks(ids: string[], order: PresetOptions['order']) {
  const sorted = ids.map((id, index) => ({ id, index }));
  if (order === 'center') sorted.sort((a, b) => Math.abs(a.index - (ids.length - 1) / 2) - Math.abs(b.index - (ids.length - 1) / 2));
  if (order === 'random') sorted.sort((a, b) => stableRandom(a.id) - stableRandom(b.id));
  return new Map(sorted.map(({ id }, rank) => [id, rank]));
}

export function applyPreset(project: Project, id: PresetId, ids: string[], start: number, options: PresetOptions): Project {
  let timeline: TimelineData = project.timeline ?? defaultTimeline;
  const recipe: Recipe = presets[id].recipe;
  const layers = project.layers.filter((layer) => ids.includes(layer.id) && !effectiveLayer(project, layer).locked);
  const ranks = staggerRanks(layers.map((layer) => layer.id), options.order);
  const axis = axisIndex[options.direction.at(-1) as keyof typeof axisIndex];
  const sign = options.direction.startsWith('-') ? -1 : 1;
  const end = Math.min(120, start + options.delay + options.duration + (recipe.camera ? 0 : Math.max(0, layers.length - 1) * options.stagger));
  if (start + options.delay >= 120) return project;
  timeline = { ...timeline, duration: Math.max(timeline.duration, end) };
  const generated: Track[] = [];
  function channel(target: string, property: Property, offset: number, samples: Samples, combine: (amount: number) => Value, easing = options.easing) {
    const distinct = new Map<number, Key>();
    for (const [unitTime, amount] of samples) {
      const time = frameTime(offset + unitTime * options.duration, timeline, true);
      distinct.set(time, { time, value: combine(amount), easing });
    }
    if (distinct.size) generated.push({ target, property, keys: [...distinct.values()] });
  }
  if (recipe.camera) {
    const origin = new Vector3(...project.camera.target);
    const distance = new Vector3(...project.camera.position).sub(origin);
    const axisVector = new Vector3().setComponent(axis, sign);
    const samples: Samples = Array.from({ length: 33 }, (_, step) => [step / 32, step / 32]);
    channel(cameraId, 'position', start + options.delay, samples, (t) => distance.clone().applyQuaternion(
      new Quaternion().setFromAxisAngle(axisVector, t * Math.PI * 2 * options.intensity)).add(origin).toArray(), linear);
  }

  for (const [index, layer] of layers.entries()) {
    const offset = start + options.delay + (ranks.get(layer.id) ?? 0) * options.stagger;
    if (offset >= 120 || recipe.camera) continue;
    const set = (property: Property, samples: Samples, combine: (amount: number) => Value, easing = options.easing) =>
      channel(layer.id, property, offset, samples, combine, easing);
    const strength = options.intensity;
    const scale = layer.scale ?? [1, 1, 1];
    if (recipe.position || recipe.jitter) set('position', (recipe.position ?? recipe.jitter)!, (amount) => toVector(layer.position, axis, amount * sign * strength));
    if (recipe.radial) {
      const angle = index * Math.PI * 2 / Math.max(1, layers.length);
      set('position', recipe.radial, (amount) => [layer.position[0] + amount * Math.cos(angle) * sign * strength,
        layer.position[1] + amount * Math.sin(angle) * sign * strength, layer.position[2]]);
    }
    if (recipe.rotation) set('rotation', recipe.rotation, (amount) => toVector(layer.rotation, axis, amount * sign * unit * strength),
      id === 'spin' || id === 'segments' ? linear : options.easing);
    if (recipe.opacity) set('opacity', recipe.opacity, (amount) => Math.max(0, Math.min(1, layer.opacity * (1 + (amount - 1) * strength))));
    if (recipe.scale || recipe.squash) set('scale', (recipe.scale ?? recipe.squash)!, (amount) => {
      const multiplier = Math.max(0.01, 1 + (amount - 1) * strength);
      const balanced = id === 'progress' || id === 'unfold' ? 1 : 1 / Math.sqrt(multiplier);
      return scale.map((value, i) => value * (recipe.scale || i === axis ? multiplier : balanced)) as Vec3;
    });
    if (recipe.roughness) set('roughness', recipe.roughness, (amount) => Math.max(0, (layer.roughness ?? materials[layer.material].roughness) + amount * strength));
    if (recipe.glow) set('emissive', recipe.glow, (amount) => {
      const brightness = Math.min(255, Math.round(Math.max(0, amount * strength) * 255));
      return '#' + brightness.toString(16).padStart(2, '0').repeat(3);
    });
    if (id === 'spring') {
      const count = Math.min(181, Math.max(5, Math.ceil(options.duration * timeline.fps) + 1));
      const samples: Samples = Array.from({ length: count }, (_, i) => {
        const t = i / (count - 1);
        return [t, i === count - 1 ? 1 : spring(t, 16, 0.43)];
      });
      set('scale', samples, (amount) => scale.map((value) => Math.max(0.01, value * (1 + (amount - 1) * 0.48 * strength))) as Vec3, linear);
    }
  }
  const tracks = new Map(timeline.tracks.map((track) => [track.target + '/' + track.property, track]));
  for (const track of generated) {
    const low = track.keys[0].time;
    const high = track.keys.at(-1)!.time;
    const id = track.target + '/' + track.property;
    const outside = tracks.get(id)?.keys.filter(({ time }) => time < low - 1e-6 || time > high + 1e-6) ?? [];
    tracks.set(id, { ...track, keys: [...outside, ...track.keys].sort((a, b) => a.time - b.time) });
  }
  timeline = { ...timeline, tracks: [...tracks.values()] };
  if (!generated.length) return project;
  return { ...project, timeline };
}

export function applyTemplate(project: Project, id: TemplateId, ids: string[], options: PresetOptions): Project {
  const template = templates[id];
  const timeline = { ...defaultTimeline, ...project.timeline, duration: options.duration * template.sequence.length + options.delay, loop: id === 'loader' ? 'loop' as const : 'once' as const };
  const prepared = { ...project, timeline, light: template.light,
    layers: project.layers.map((layer) => ids.includes(layer.id) && !effectiveLayer(project, layer).locked
      ? { ...layer, material: template.material, roughness: undefined } : layer) };
  return template.sequence.reduce<Project>((current, preset, index) => applyPreset(current, preset, ids, index * options.duration, options), prepared);
}
