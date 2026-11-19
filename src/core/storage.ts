import { z } from 'zod';
import { cameraPositions, materials, type Project } from './project';
import { baseValue, cameraId, type Property } from '../animation/timeline';
import { families } from '../animation/easing';

const num = z.number().finite();
const vec2 = z.tuple([num, num]);
const vec3 = z.tuple([num, num, num]);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const humanName = z.string().min(1).max(512);
const id = z.string().min(1).max(160);
const node = z.object({ id, name: humanName, parentId: id.optional(), order: num.optional(),
  visible: z.boolean(), locked: z.boolean().optional() });
const contour = z.array(vec2).min(3).max(24000);
const layer = node.extend({
  shapes: z.array(z.object({ outer: contour, holes: z.array(contour).max(2400) })).max(2400),
  relief: z.object({ width: num.int().min(1).max(120), height: num.int().min(1).max(120),
    heights: z.array(num.min(0).max(1)).max(14400) }).refine((value) => value.heights.length === value.width * value.height).optional(),
  color, material: z.enum(Object.keys(materials) as [keyof typeof materials, ...Array<keyof typeof materials>]),
  opacity: num.min(0).max(1), depth: num.min(0.001).max(5), bevel: num.min(0).max(0.35),
  bevelSegments: num.int().min(1).max(8), position: vec3, rotation: vec3, scale: vec3.optional(),
  emissive: color.optional(), shine: num.optional(), roughness: num.min(0).max(1).optional(),
}).refine(({ shapes, relief }) => !!shapes.length || !!relief);
const easing = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('linear') }), z.object({ kind: z.literal('hold') }),
  z.object({ kind: z.literal('named'), family: z.enum(families), direction: z.enum(['in', 'out', 'in-out']) }),
  z.object({ kind: z.literal('bezier'), x1: num.min(0).max(1), x2: num.min(0).max(1), y1: num.min(-4).max(4), y2: num.min(-4).max(4) }),
]);
const property = z.enum(['position', 'rotation', 'scale', 'opacity', 'color', 'emissive', 'shine', 'roughness', 'depth', 'bevel', 'target', 'zoom'] satisfies Property[]);
const schema = z.object({
  schemaVersion: z.literal(1), name: humanName, layers: z.array(layer).max(1000), groups: z.array(node).max(250).optional(),
  notices: z.array(z.string().max(1024)).max(30), light: z.enum(['studio', 'soft', 'dramatic', 'neon']),
  lighting: z.object({ azimuth: num.min(-180).max(180), elevation: num.min(-90).max(90),
    strength: num.min(0).max(3), fill: num.min(0).max(2) }).optional(),
  camera: z.object({
    preset: z.enum(Object.keys(cameraPositions) as [keyof typeof cameraPositions, ...Array<keyof typeof cameraPositions>]),
    projection: z.enum(['perspective', 'orthographic']), position: vec3, target: vec3, zoom: num.min(0.2).max(6),
  }),
  timeline: z.object({
    duration: num.min(0.1).max(120), fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
    loop: z.enum(['once', 'loop', 'ping-pong']), tracks: z.array(z.object({
      target: id, property, keys: z.array(z.object({ time: num.min(0).max(120), value: z.union([num, vec3, color]), easing })).min(1).max(7201),
    })).max(9000),
  }).optional(),
});

export function validateProject(raw: unknown): Project {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new Error('Не удалось открыть проект .l3d. Проверьте файл и его версию.');
  const project: Project = parsed.data;
  const groups = new Map(project.groups?.map((group) => [group.id, group.parentId]));
  const seen = new Set<string>([cameraId]);
  let points = 0;
  for (const item of [...project.layers, ...(project.groups ?? [])]) {
    if (seen.has(item.id)) throw new Error('В проекте повторяются идентификаторы слоёв.');
    seen.add(item.id);
    const ancestors = new Set([item.id]);
    let parent = item.parentId;
    while (parent) {
      if (ancestors.has(parent) || !groups.has(parent)) throw new Error('Повреждена иерархия проекта.');
      ancestors.add(parent);
      parent = groups.get(parent);
    }
  }
  for (const { shapes } of project.layers) for (const shape of shapes) points += shape.outer.length + shape.holes.reduce((count, hole) => count + hole.length, 0);
  if (points > 480000) throw new Error('В проекте слишком много точек.');
  const tracks = new Set<string>();
  for (const track of project.timeline?.tracks ?? []) {
    const identity = track.target + '/' + track.property;
    const base = baseValue(project, track.target, track.property);
    if (base === undefined || tracks.has(identity) || track.keys.some((key, index) =>
      typeof key.value !== typeof base || (index > 0 && key.time <= track.keys[index - 1].time))) {
      throw new Error('В проекте есть повреждённые дорожки анимации.');
    }
    tracks.add(identity);
  }
  if (project.timeline) {
    const last = Math.max(project.timeline.duration, ...project.timeline.tracks.map((track) => track.keys.at(-1)?.time ?? 0));
    if (last > project.timeline.duration) project.timeline = { ...project.timeline, duration: last };
  }
  return project;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('vd3d-editor', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Хранилище открыто в другой вкладке.'));
  });
}
export async function readProject() {
  const db = await database();
  try {
    return await new Promise<Project | undefined>((resolve, reject) => {
      const request = db.transaction('projects').objectStore('projects').get('current');
      request.onsuccess = () => {
        try { resolve(request.result === undefined ? undefined : validateProject(request.result)); } catch (error) { reject(error); }
      };
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function saveProject(project: Project) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('projects', 'readwrite');
      tx.objectStore('projects').put(project, 'current');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export function downloadProject(project: Project) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(project)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = (project.name.replace(/[<>:"/\\|?*]/g, '_') || 'project') + '.l3d';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
