import type { TimelineData } from '../animation/timeline';

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export type Shape = {
  outer: Vec2[];
  holes: Vec2[][];
};

export const materials = {
  glass: { label: 'Прозрачное стекло', roughness: 0, metalness: 0, clearcoat: 0 },
  frosted: { label: 'Матовое стекло', roughness: 0.48, metalness: 0, clearcoat: 0 },
  chrome: { label: 'Полированный хром', roughness: 0.085, metalness: 1, clearcoat: 0.18 },
  ceramic: { label: 'Глазурованная керамика', roughness: 0.38, metalness: 0, clearcoat: 1 },
  clay: { label: 'Матовая глина', roughness: 0.68, metalness: 0.02, clearcoat: 0.12 },
  plastic: { label: 'Глянцевый пластик', roughness: 0.24, metalness: 0.02, clearcoat: 0.8 },
  metal: { label: 'Шлифованный металл', roughness: 0.36, metalness: 0.85, clearcoat: 0.2 },
  gold: { label: 'Золото', roughness: 0.23, metalness: 0.9, clearcoat: 0.35 },
} as const;

export function isGlass(material: keyof typeof materials) {
  return material === 'glass' || material === 'frosted';
}

export type Layer = {
  id: string;
  name: string;
  shapes: Shape[];
  relief?: { width: number; height: number; heights: number[] };
  parentId?: string;
  order?: number;
  locked?: boolean;
  color: string;
  material: keyof typeof materials;
  opacity: number;
  scale?: Vec3;
  emissive?: string;
  roughness?: number;
  shine?: number;
  visible: boolean;
  depth: number;
  bevel: number;
  bevelSegments: number;
  position: Vec3;
  rotation: Vec3;
};

export type CameraPreset = 'studio' | 'front' | 'top' | 'iso';
export type LightPreset = 'studio' | 'soft' | 'dramatic' | 'neon';

export const defaultLighting = {
  azimuth: Math.atan2(3, 5) * 180 / Math.PI,
  elevation: Math.atan2(5, Math.hypot(3, 5)) * 180 / Math.PI,
  strength: 1, fill: 1, reflections: 1, studioAngle: 0, exposure: 1, shadows: false,
};

export function keyDirection(settings: Pick<typeof defaultLighting, 'azimuth' | 'elevation'>): Vec3 {
  const yaw = settings.azimuth * Math.PI / 180;
  const pitch = settings.elevation * Math.PI / 180;
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
}

export type LayerGroup = {
  id: string;
  name: string;
  parentId?: string;
  order?: number;
  visible: boolean;
  locked?: boolean;
};

export type Project = {
  schemaVersion: 1;
  name: string;
  layers: Layer[];
  groups?: LayerGroup[];
  notices: string[];
  timeline?: TimelineData;
  light: LightPreset;
  lighting?: Pick<typeof defaultLighting, 'azimuth' | 'elevation' | 'strength' | 'fill'> &
    Partial<Pick<typeof defaultLighting, 'reflections' | 'studioAngle' | 'exposure' | 'shadows'>>;
  camera: { preset: CameraPreset; projection: 'perspective' | 'orthographic'; position: Vec3; target: Vec3; zoom: number };
};

export const cameraPositions: Record<CameraPreset, Vec3> = {
  studio: [3.1, 2.4, 7.8],
  front: [0, 0, 8.7],
  top: [0, 8.7, 0.01],
  iso: [5, 5, 5],
};

export const emptyProject: Project = {
  schemaVersion: 1,
  name: 'Новый проект',
  layers: [],
  notices: [],
  light: 'studio',
  camera: { preset: 'studio', projection: 'perspective', position: cameraPositions.studio, target: [0, 0, 0], zoom: 1 },
};
