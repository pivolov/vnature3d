import { Camera, Color, Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import { evaluate, positionAt } from '../../animation/timeline';
import { effectiveLayer } from '../../core/layers';
import { defaultLighting, keyDirection, materials, type Layer, type Project, type Vec2 } from '../../core/project';
import { projection } from '../../render/projectScene';
import type { LottieOptions } from './model';
import { round } from './model';

export function visibleLayers(project: Project) { return project.layers.filter((layer) => effectiveLayer(project, layer).visible); }
export function poseAt(project: Project, frame: number, options: LottieOptions) {
  if (!project.timeline) return project;
  const { loop, duration } = project.timeline;
  return evaluate(project, positionAt(frame / options.fps, duration, loop === 'ping-pong' ? 'ping-pong' : 'once'));
}
export function cameras(options: LottieOptions) {
  const { perspective, orthographic } = projection(options.width, options.height);
  return (project: Project) => {
    const settings = project.camera;
    const camera = settings.projection === 'orthographic' ? orthographic : perspective;
    camera.position.set(...settings.position);
    camera.zoom = settings.zoom;
    camera.lookAt(...settings.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return camera;
  };
}
export function screen(point: Vector3, camera: Camera, options: LottieOptions): Vec2 {
  const p = point.clone().project(camera);
  return [round((p.x + 1) * options.width / 2), round((1 - p.y) * options.height / 2)];
}
export function world(layer: Layer) {
  return new Matrix4().compose(new Vector3(...layer.position), new Quaternion().setFromEuler(new Euler(...layer.rotation)),
    new Vector3(...(layer.scale ?? [1, 1, 1])));
}
export function normalToWorld(matrix: Matrix4) { return new Matrix3().getNormalMatrix(matrix); }

const illumination = {
  studio: [0.41, 0.63, 0.21, 0.25],
  soft: [0.57, 0.41, 0.29, 0.16],
  dramatic: [0.22, 0.86, 0.10, 0.36],
  neon: [0.30, 0.46, 0.25, 0.5],
};
const lights = [new Vector3(3, 5, 5).normalize(), new Vector3(-4, 1, 4).normalize(), new Vector3(1, 3, -5).normalize()];
const head = new Vector3(0, 0, 1);
export function flatFill(layer: Layer, normal: Vector3, project: Project, view = head) {
  const [ambient, a, b, c] = illumination[project.light];
  const settings = project.lighting ?? defaultLighting;
  const key = project.lighting ? new Vector3(...keyDirection(settings)) : lights[0];
  const base = new Color(layer.color);
  const how = materials[layer.material];
  const roughness = layer.roughness ?? how.roughness;
  const rotation = layer.shine ?? 0;
  const reflection = new Vector3(Math.sin(rotation + 0.32), 0.45, Math.cos(rotation + 0.32)).normalize();
  const half = reflection.add(view).normalize();
  const spec = Math.pow(Math.max(0, normal.dot(half)), 6 + 45 * (1 - roughness)) * (0.04 + how.metalness * 0.17 + how.clearcoat * 0.1);
  const diffuse = ambient * settings.fill + a * settings.strength * Math.max(0, normal.dot(key)) +
    b * settings.fill * Math.max(0, normal.dot(lights[1])) + c * Math.max(0, normal.dot(lights[2]));
  const color = base.multiplyScalar(diffuse * 0.9).addScalar(spec).add(new Color(layer.emissive ?? '#000000')).convertLinearToSRGB();
  const channel = (value: number) => round(Math.round(Math.min(1, Math.max(0, value)) * 40) / 40, 3);
  return [channel(color.r), channel(color.g), channel(color.b)];
}
