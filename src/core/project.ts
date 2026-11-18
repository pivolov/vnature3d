export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export type Shape = {
  outer: Vec2[];
  holes: Vec2[][];
};

export const materials = {
  clay: { label: 'Матовая глина', roughness: 0.68, metalness: 0.02, clearcoat: 0.12 },
  plastic: { label: 'Глянцевый пластик', roughness: 0.24, metalness: 0.02, clearcoat: 0.8 },
  metal: { label: 'Шлифованный металл', roughness: 0.36, metalness: 0.85, clearcoat: 0.2 },
  gold: { label: 'Золото', roughness: 0.23, metalness: 0.9, clearcoat: 0.35 },
} as const;

export type Layer = {
  id: string;
  name: string;
  shapes: Shape[];
  color: string;
  material: keyof typeof materials;
  opacity: number;
  visible: boolean;
  depth: number;
  bevel: number;
  bevelSegments: number;
  position: Vec3;
  rotation: Vec3;
};

export type CameraPreset = 'studio' | 'front' | 'top' | 'iso';
export type LightPreset = 'studio' | 'soft' | 'dramatic' | 'neon';

export type Project = {
  schemaVersion: 1;
  name: string;
  layers: Layer[];
  notices: string[];
  light: LightPreset;
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
