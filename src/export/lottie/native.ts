import { Vector3 } from 'three';
import type { Layer, Project, Vec2 } from '../../core/project';
import { simplifyPath } from '../../utils/reduction';
import { constant, defaults, numbers, round, shapeLayer, staticPath, transform, type LottieOptions, type LottieShape } from './model';
import { cameras, flatFill, poseAt, screen, visibleLayers } from './scene';

export function pickMode(project: Project) {
  const { camera } = project;
  const layers = visibleLayers(project);
  if (Math.hypot(camera.position[0] - camera.target[0], camera.position[1] - camera.target[1]) > 1e-4 ||
    camera.position[2] <= camera.target[2] || project.timeline?.tracks.some(({ target }) => target === '@camera')) return 'bake';
  const selected = new Map(layers.map((layer) => [layer.id, layer]));
  let yRotation = false;
  function checkRotation(rotation: number[]) {
    const [x, y, z] = rotation;
    if (Math.abs(Math.sin(x / 2)) > 1e-5 || Math.abs(y) > Math.PI / 3) return false;
    yRotation ||= Math.abs(y) > 1e-5;
    return !yRotation || Math.abs(z) < Math.PI;
  }
  if (layers.some((layer) => layer.relief || !checkRotation(layer.rotation))) return 'bake';
  for (const track of project.timeline?.tracks ?? []) {
    const layer = selected.get(track.target);
    if (!layer) continue;
    if (track.property === 'depth' || track.property === 'bevel') return 'bake';
    if (track.property === 'rotation' && track.keys.some(({ value }) => Array.isArray(value) && !checkRotation(value))) return 'bake';
    if (track.property === 'position' && track.keys.some(({ value }) => Array.isArray(value) && Math.abs(value[2] - layer.position[2]) > 1e-5)) return 'bake';
  }
  if (!yRotation && layers.every((layer) => layer.depth <= 0.015 && layer.bevel === 0)) return 'native';
  return yRotation && layers.every((layer) => layer.depth <= 0.8 && layer.bevel < 0.1) ? 'pseudo' : 'bake';
}

export function planarLayers(project: Project, options: LottieOptions, frames: number, samples: number[], pseudo: boolean) {
  const cameraFor = cameras(options);
  const camera = cameraFor(project);
  const edits = samples.map((frame) => ({ frame, layers: new Map(poseAt(project, frame, options).layers.map((layer) => [layer.id, layer])) }));
  const layers = visibleLayers(project).sort((a, b) => b.position[2] - a.position[2]);
  let shapes = 0;
  const normal = new Vector3(0, 0, 1);
  const result = layers.map((layer, index) => {
    const planeZ = layer.position[2] + ((layer.scale?.[2] ?? 1) * layer.depth / 2);
    const origin = screen(new Vector3(0, 0, planeZ), camera, options);
    const pixel = screen(new Vector3(1, 0, planeZ), camera, options)[0] - origin[0];
    if (!(pixel > 0)) throw new Error('Слой находится за камерой. Измените ракурс экспорта.');
    const keyed = <T extends number | number[]>(sample: (item: Layer) => T, tolerance: number) => numbers(
      edits.map(({ frame, layers }) => ({ frame, value: sample(layers.get(layer.id) ?? layer) })), tolerance);
    const shapeGroups = (back: boolean): LottieShape[] => layer.shapes.map((shape, shapeIndex) => {
      const paths = [shape.outer, ...shape.holes].map((ring, ringIndex) => staticPath(
        simplifyPath(ring, options.tolerance / pixel).map(([x, y]): Vec2 => [round(x * pixel), round(-y * pixel)]), 'Contour ' + (ringIndex + 1)));
      shapes += paths.length;
      const fillAt = (item: Layer) => {
        const fill = flatFill(item, normal, project.light);
        return back ? fill.map((value) => round(value * 0.65, 3)) : fill;
      };
      const shine = !back && layer.material !== 'clay';
      const fill: LottieShape = shine ? {
        ty: 'gf', nm: 'Soft material gradient', r: 2, t: 1, o: defaults.o,
        s: constant([-pixel, -pixel]), e: constant([pixel, pixel]),
        g: { p: 3, k: keyed((item) => {
          const rgb = fillAt(item);
          return [0, ...rgb.map((value) => round(value * 0.86, 3)), 0.45, ...rgb,
            1, ...rgb.map((value) => round(Math.min(1, value * 1.12 + 0.01), 3))];
        }, 0.008) },
      } : { ty: 'fl', nm: 'Fill', r: 2, o: defaults.o, c: keyed(fillAt, 0.008) };
      return { ty: 'gr', nm: 'Shape ' + (shapeIndex + 1), it: [
        ...paths, fill,
        back ? { ...transform, p: keyed((item) => [round(-Math.sin(item.rotation[1]) * item.depth * pixel), 0], options.tolerance) } : transform,
      ] };
    });
    const contents: LottieShape[] = [{
      ty: 'gr', nm: 'Surface', it: [
        ...shapeGroups(false), ...(pseudo && layer.depth > 0.03 ? shapeGroups(true) : []),
        { ...transform, ty: 'tr', sa: pseudo ? constant(0) : undefined, sk: pseudo ? keyed((item) => round(Math.sin(item.rotation[1]) * 10), 0.08) : undefined },
      ],
    }];
    return shapeLayer(layer.name, index + 1, frames, contents, {
      ...defaults,
      p: keyed((item) => [...screen(new Vector3(...item.position), camera, options), 0], options.tolerance),
      s: keyed((item) => {
        const [sx, sy] = item.scale ?? [1, 1, 1];
        return [round(100 * sx * (pseudo ? Math.cos(item.rotation[1]) : 1)), round(100 * sy), 100];
      }, 0.08),
      r: keyed((item) => round(-item.rotation[2] * 180 / Math.PI), 0.08),
      o: keyed((item) => round(item.opacity * 100), 0.08),
    });
  });
  return { layers: result, shapes };
}
