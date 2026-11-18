import { Color } from 'three';
import { materials, type Project, type Vec3 } from '../core/project';
import { ease, type Easing } from './easing';

export const layerFields = {
  position: 'Положение', rotation: 'Поворот', scale: 'Масштаб', opacity: 'Непрозрачность',
  color: 'Цвет', emissive: 'Свечение', shine: 'Направление блика', roughness: 'Шероховатость', depth: 'Глубина', bevel: 'Фаска',
} as const;
export const cameraFields = { position: 'Положение', target: 'Точка взгляда', zoom: 'Приближение' } as const;
export type Property = keyof typeof layerFields | keyof typeof cameraFields;
export type Value = number | string | Vec3;
export type Key = { time: number; value: Value; easing: Easing };
export type Track = { target: string; property: Property; keys: Key[] };
export type TimelineData = {
  duration: number; fps: 24 | 30 | 60; loop: 'once' | 'loop' | 'ping-pong'; tracks: Track[];
};
export const cameraId = '@camera';
export const defaultTimeline: TimelineData = { duration: 3, fps: 30, loop: 'loop', tracks: [] };

export function positionAt(t: number, duration: number, loop: TimelineData['loop']) {
  if (loop === 'once') return Math.max(0, Math.min(duration, t));
  const span = loop === 'loop' ? duration : duration * 2;
  const cycle = (t % span + span) % span;
  return cycle > duration ? span - cycle : cycle;
}
export function frameTime(time: number, timeline: TimelineData, snap: boolean) {
  const bounded = Math.min(timeline.duration, Math.max(0, time));
  return snap ? Math.min(timeline.duration, Math.round(bounded * timeline.fps) / timeline.fps) : bounded;
}

export function baseValue(project: Project, target: string, property: Property): Value | undefined {
  if (target === cameraId) {
    if (property === 'position' || property === 'target' || property === 'zoom') return project.camera[property];
    return;
  }
  const layer = project.layers.find(({ id }) => id === target);
  if (!layer || !Object.hasOwn(layerFields, property) || property === 'target' || property === 'zoom') return;
  if (property === 'scale') return layer.scale ?? [1, 1, 1];
  if (property === 'shine') return layer.shine ?? 0;
  if (property === 'emissive') return layer.emissive ?? '#000000';
  if (property === 'roughness') return layer.roughness ?? materials[layer.material].roughness;
  return layer[property];
}

export function sampleTrack(track: Track, time: number): Value | undefined {
  const first = track.keys[0];
  const last = track.keys.at(-1);
  if (!first || !last) return;
  if (time <= first.time) return first.value;
  if (time >= last.time) return last.value;
  let low = 0;
  let high = track.keys.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (track.keys[mid].time <= time) low = mid;
    else high = mid;
  }
  const left = track.keys[low];
  const right = track.keys[high];
  const a = left.value;
  const b = right.value;
  const t = ease((time - left.time) / (right.time - left.time), left.easing);
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, axis) => v + (b[axis] - v) * t) as Vec3;
  if (typeof a === 'string' && typeof b === 'string') return '#' + new Color(a).lerp(new Color(b), Math.max(0, Math.min(1, t))).getHexString();
  return a;
}

export function evaluate(project: Project, time: number): Project {
  const tracks = project.timeline?.tracks;
  if (!tracks?.length) return project;
  const patches = new Map<string, Partial<Record<Property, Value>>>();
  for (const track of tracks) {
    const value = sampleTrack(track, time);
    if (value === undefined) continue;
    const patch = patches.get(track.target) ?? {};
    patch[track.property] = value;
    patches.set(track.target, patch);
  }
  const camera = patches.get(cameraId);
  return {
    ...project,
    layers: project.layers.map((layer) => {
      const patch = patches.get(layer.id);
      if (!patch) return layer;
      return {
        ...layer,
        position: Array.isArray(patch.position) ? patch.position : layer.position,
        rotation: Array.isArray(patch.rotation) ? patch.rotation : layer.rotation,
        scale: Array.isArray(patch.scale) ? patch.scale : layer.scale,
        color: typeof patch.color === 'string' ? patch.color : layer.color,
        shine: typeof patch.shine === 'number' ? patch.shine : layer.shine,
        emissive: typeof patch.emissive === 'string' ? patch.emissive : layer.emissive,
        opacity: clamp(patch.opacity, layer.opacity, 0, 1),
        roughness: clamp(patch.roughness, layer.roughness, 0, 1),
        bevel: clamp(patch.bevel, layer.bevel, 0, 0.35),
        depth: clamp(patch.depth, layer.depth, 0.001, 5),
      };
    }),
    camera: camera ? {
      ...project.camera,
      position: Array.isArray(camera.position) ? camera.position : project.camera.position,
      target: Array.isArray(camera.target) ? camera.target : project.camera.target,
      zoom: clamp(camera.zoom, project.camera.zoom, 0.2, 6),
    } : project.camera,
  };
}

function clamp<T extends number | undefined>(value: Value | undefined, fallback: T, min: number, max: number) {
  return typeof value === 'number' ? Math.max(min, Math.min(max, value)) : fallback;
}

export function putKey(timeline: TimelineData, target: string, property: Property, key: Key): TimelineData {
  const match = timeline.tracks.find((track) => track.target === target && track.property === property);
  const keys = [...(match?.keys.filter(({ time }) => Math.abs(time - key.time) > 1e-6) ?? []), key]
    .sort((a, b) => a.time - b.time);
  const track = { target, property, keys };
  return { ...timeline, tracks: match ? timeline.tracks.map((item) => item === match ? track : item) : [...timeline.tracks, track] };
}

export function changeKeys(timeline: TimelineData, target: string, property: Property, replace: (keys: Key[]) => Key[]): TimelineData {
  return {
    ...timeline, tracks: timeline.tracks.map((track) => track.target === target && track.property === property
      ? { ...track, keys: replace(track.keys).sort((a, b) => a.time - b.time) } : track).filter(({ keys }) => keys.length),
  };
}

export function valueGap(a: Value, b: Value, property: Property) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return Math.max(...a.map((value, axis) => {
      const delta = value - b[axis];
      return property === 'rotation' ? Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) : Math.abs(delta);
    }));
  }
  if (typeof a === 'number' && typeof b === 'number') return property === 'shine' ? Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) : Math.abs(a - b);
  return a === b ? 0 : 1;
}

export function isSeamless(project: Project) {
  const timeline = project.timeline ?? defaultTimeline;
  return timeline.tracks.every((track) => {
    const a = sampleTrack(track, 0);
    const b = sampleTrack(track, timeline.duration);
    return a === undefined || b === undefined || valueGap(a, b, track.property) < 0.001;
  });
}

export function resizeTimeline(timeline: TimelineData, duration: number): TimelineData {
  if (duration >= timeline.duration) return { ...timeline, duration };
  const tracks = timeline.tracks.map((track) => {
    const keys = track.keys.filter((key) => key.time <= duration);
    if (keys.length === track.keys.length || keys.at(-1)?.time === duration) return { ...track, keys };
    const value = sampleTrack(track, duration);
    if (value !== undefined) keys.push({ time: duration, value, easing: { kind: 'linear' } });
    return { ...track, keys };
  });
  return { ...timeline, duration, tracks };
}
