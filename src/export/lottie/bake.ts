import { Camera, Vector3 } from 'three';
import { union } from 'polygon-clipping';
import type { Layer, Project, Shape, Vec2 } from '../../core/project';
import { extrudeLayer } from '../../geometry/extrusion';
import { simplifyPath } from '../../utils/reduction';
import { cameras, flatFill, normalToWorld, poseAt, screen, visibleLayers, world } from './scene';
import { changingPath, constant, defaults, numbers, round, shapeLayer, transform, type LottieOptions, type LottieShape } from './model';

type Face = { rings: Vector3[][]; normal: Vector3; center: Vector3 };
type Paint = { owner: string; index: number; near: number; far: number; rings: Vec2[][]; color: number[]; opacity: number; depth: number; rect: [number, number, number, number] };
type Entry = { frame: number; visible: Paint[] };
const normalZ = new Vector3(0, 0, 1);

function face(rings: Vector3[][], direction?: Vector3): Face | undefined {
  const outer = rings[0];
  const normal = direction ?? outer[1].clone().sub(outer[0]).cross(outer[2].clone().sub(outer[0])).normalize();
  if (normal.lengthSq() < 1e-8) return;
  const center = outer.reduce((result, vertex) => result.add(vertex), new Vector3()).multiplyScalar(1 / outer.length);
  return { rings, normal, center };
}

function geometryFaces(layer: Layer) {
  const faces: Face[] = [];
  const geometry = extrudeLayer(layer, false);
  try {
    const positions = geometry.getAttribute('position');
    const vertex = (i: number) => new Vector3(positions.getX(i), positions.getY(i), positions.getZ(i));
    if (layer.relief) {
      const index = geometry.getIndex();
      if (!index) return faces;
      for (let i = 0; i < index.count; i += 3) {
        const next = face([[vertex(index.getX(i)), vertex(index.getX(i + 1)), vertex(index.getX(i + 2))]]);
        if (next) faces.push(next);
      }
      return faces;
    }
    // Three's cap sits on the original contour. Retaining that contour keeps
    // holes and removes all the triangulation from both flat faces.
    for (const shape of layer.shapes) {
      for (const side of [-1, 1]) {
        const z = side * (layer.depth / 2 + layer.bevel);
        const rings = [shape.outer, ...shape.holes].map((ring) => ring.map(([x, y]) => new Vector3(x, y, z)));
        const next = face(rings, normalZ.clone().multiplyScalar(side));
        if (next) faces.push(next);
      }
    }
    for (const { start, count, materialIndex } of geometry.groups) {
      if (materialIndex !== 1) continue;
      for (let i = start; i < start + count; i += 6) {
        const next = face([[vertex(i), vertex(i + 1), vertex(i + 4), vertex(i + 2)]]);
        if (next) faces.push(next);
      }
    }
    return faces;
  } finally { geometry.dispose(); }
}

function resizeRelief(layer: Layer, limit: number): Layer['relief'] {
  if (!layer.relief) return;
  const { width, height, heights } = layer.relief;
  const scale = Math.min(1, limit / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const dense: number[] = [];
  for (let row = 0; row < h; row++) for (let column = 0; column < w; column++) {
    const x = Math.round(column / Math.max(1, w - 1) * (width - 1));
    const y = Math.round(row / Math.max(1, h - 1) * (height - 1));
    dense.push(heights[y * width + x]);
  }
  return { width: w, height: h, heights: dense };
}

function bounds(points: Vec2[]): Paint['rect'] {
  return points.reduce<Paint['rect']>((rect, [x, y]) =>
    [Math.min(rect[0], x), Math.min(rect[1], y), Math.max(rect[2], x), Math.max(rect[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
}
const cross = ([ax, ay]: Vec2, [bx, by]: Vec2, [cx, cy]: Vec2) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

function occlusion(ordered: Paint[]) {
  const opaque: Paint[] = [];
  const result: Paint[] = [];
  for (const item of [...ordered].reverse()) {
    const [x0, y0, x1, y1] = item.rect;
    const covered = opaque.some((front) => {
      const [a, b, c, d] = front.rect;
      if (a > x0 || b > y0 || c < x1 || d < y1 || front.far >= item.near - 1e-4) return false;
      const outer = front.rings[0];
      return item.rings[0].every((point) => {
        const products = outer.map((start, i) => cross(start, outer[(i + 1) % outer.length], point));
        return products.every((value) => value >= -0.02) || products.every((value) => value <= 0.02);
      });
    });
    if (covered) continue;
    result.push(item);
    const outer = item.rings[0];
    if (item.opacity === 100 && item.rings.length === 1 && outer.length <= 64 && opaque.length < 340) {
      const signs = outer.map((p, i) => cross(p, outer[(i + 1) % outer.length], outer[(i + 2) % outer.length]));
      if (signs.every((value) => value >= -0.001) || signs.every((value) => value <= 0.001)) opaque.push(item);
    }
  }
  return result.reverse();
}

function mergePaint(ordered: Paint[]) {
  const result: Paint[] = [];
  let cursor = 0;
  while (cursor < ordered.length) {
    const first = ordered[cursor++];
    const group = [first];
    while (cursor < ordered.length && group.length < 32) {
      const next = ordered[cursor];
      if (first.opacity !== 100 || next.opacity !== 100 || first.owner !== next.owner ||
        !first.color.every((color, index) => color === next.color[index])) break;
      group.push(next);
      cursor++;
    }
    if (group.length === 1) { result.push(first); continue; }
    try {
      const combined = union(...group.map(({ rings }) => rings.map((ring) => [...ring, ring[0]])) as Parameters<typeof union>);
      const rings = combined.flatMap((polygon) => polygon.map((ring) => ring.slice(0, -1).map(([x, y]): Vec2 => [round(x), round(y)])));
      if (rings.length) result.push({ ...first, index: -1, rings });
      else result.push(...group);
    } catch { result.push(...group); }
  }
  return result.reverse();
}

function projectPaint(faces: Face[], layer: Layer, project: Project, camera: Camera, options: LottieOptions): Paint[] {
  const matrix = world(layer);
  const normalMatrix = normalToWorld(matrix);
  const ortho = 'isOrthographicCamera' in camera;
  const direction = ortho ? camera.getWorldDirection(new Vector3()).negate() : undefined;
  const output: Paint[] = [];
  for (const [index, item] of faces.entries()) {
    const vector = item.center.clone().applyMatrix4(matrix);
    const normal = item.normal.clone().applyNormalMatrix(normalMatrix);
    const view = direction ?? camera.position.clone().sub(vector).normalize();
    const dot = normal.dot(view);
    if (!layer.relief && dot <= 1e-6) continue;
    if (layer.relief && dot < 0) normal.negate();
    const worldRings = item.rings.map((ring) => ring.map((point) => point.clone().applyMatrix4(matrix)));
    const distance = worldRings[0].map((point) => -point.clone().applyMatrix4(camera.matrixWorldInverse).z);
    const near = Math.min(...distance);
    const far = Math.max(...distance);
    if (near < 0.05) continue;
    const rings = worldRings.map((ring) => ring.map((point) => screen(point, camera, options)));
    const rect = bounds(rings[0]);
    if (!rect.every(Number.isFinite) || rect[0] > options.width || rect[1] > options.height || rect[2] < 0 || rect[3] < 0) continue;
    let signed = 0;
    const outer = rings[0];
    for (const [index, [x, y]] of outer.entries()) {
      const [nx, ny] = outer[(index + 1) % outer.length];
      signed += x * ny - nx * y;
    }
    if (Math.abs(signed) < Math.max(0.04, options.tolerance * 0.08)) continue;
    output.push({ owner: layer.id, index, near, far, rings, rect, opacity: round(layer.opacity * 100), color: flatFill(layer, normal, project, view),
      depth: -vector.applyMatrix4(camera.matrixWorldInverse).z });
  }
  return output;
}

export function bakedLayers(project: Project, options: LottieOptions, frames: number, samples: number[], progress: (done: number, total: number) => void) {
  const cameraFor = cameras(options);
  const camera = cameraFor(project);
  const { width, height } = options;
  const compiled = new Map<string, { geometry?: Face[]; metric?: string; shapes: Shape[]; relief: Layer['relief'] }>();
  for (const layer of visibleLayers(project)) {
    const distance = camera.position.distanceTo(new Vector3(...layer.position));
    const reference = Math.min(width, height) / 6 * Math.max(1, 8 / Math.max(1, distance),
      ...(layer.scale?.map(Math.abs) ?? []));
    const tolerance = options.tolerance / reference;
    const clean = (ring: Vec2[]) => simplifyPath(ring, tolerance);
    const shapes = layer.shapes.map(({ outer, holes }) => ({ outer: clean(outer), holes: holes.map(clean) }));
    compiled.set(layer.id, { shapes, relief: resizeRelief(layer, Math.max(6, Math.round(17 / Math.sqrt(options.tolerance)))) });
  }
  const recording: Entry[] = [];
  let capacity = 0;
  let polygons = 0;
  for (const [tick, frame] of samples.entries()) {
    const pose = poseAt(project, frame, options);
    const camera = cameraFor(pose);
    const all: Paint[] = [];
    for (const layer of pose.layers) {
      if (layer.opacity < 0.0001) continue;
      const data = compiled.get(layer.id);
      if (!data) continue;
      const metric = layer.depth + ':' + layer.bevel + ':' + layer.bevelSegments;
      if (data.metric !== metric || !data.geometry) {
        const reducedBevel = Math.min(layer.bevelSegments, options.tolerance > 2 ? 1 : options.tolerance > 0.6 ? 2 : 4);
        data.geometry = geometryFaces({ ...layer, bevelSegments: reducedBevel, shapes: data.shapes, relief: data.relief });
        data.metric = metric;
      }
      const projected = projectPaint(data.geometry, layer, pose, camera, options);
      all.push(...projected);
      if (all.length > 7000) throw new Error('В кадре слишком много граней. Увеличьте допуск или экспортируйте видео.');
    }
    all.sort((a, b) => b.depth - a.depth);
    const visible = mergePaint(occlusion(all));
    capacity = Math.max(capacity, visible.length);
    polygons += visible.length;
    if (capacity > 450 || polygons > 48000) throw new Error('Превышен бюджет запекания. Увеличьте допуск и шаг кадров или выберите видео.');
    recording.push({ frame, visible });
    if (tick % 5 === 0 || tick === samples.length - 1) progress(tick + 1, samples.length);
  }
  const zero: Vec2[] = [[0, 0], [0, 0], [0, 0]];
  let shapes = 0;
  let vertexBudget = 0;
  const layers = Array.from({ length: capacity }, (_, slot) => {
    const series = recording.map(({ frame, visible }) => ({ frame, paint: visible[slot] }));
    const rings = Math.max(...series.map(({ paint }) => paint?.rings.length ?? 0));
    shapes += rings;
    const paths = Array.from({ length: rings }, (_, ring) => {
      const keys = series.map(({ frame, paint }) => ({ frame, points: paint?.rings[ring] ?? zero }));
      const points = Math.max(...keys.map((key) => key.points.length));
      if (points > 1500) throw new Error('Один из контуров слишком сложен для Lottie. Увеличьте допуск.');
      const first = series[0].paint;
      const stable = !!first && first.index >= 0 && series.every(({ paint }, index) =>
        paint?.owner === first.owner && paint.index === first.index && keys[index].points.length === points);
      const shape = changingPath(keys, points, stable ? options.tolerance * 0.55 : undefined);
      vertexBudget += points * (shape.ks.a ? shape.ks.k.length : 1);
      if (vertexBudget > 550000) throw new Error('Слишком много данных для контуров Lottie. Увеличьте шаг и допуск или выберите видео.');
      return shape;
    });
    const color = numbers(series.map(({ frame, paint }) => ({ frame, value: paint?.color ?? [0, 0, 0] })), 0, true);
    const fill: LottieShape = { ty: 'fl', nm: 'Fill', r: 2, o: constant(100), c: color };
    const seam: LottieShape = { ty: 'st', nm: 'Edge coverage', lc: 2, lj: 2, w: constant(0.65), c: color,
      o: numbers(series.map(({ frame, paint }) => ({ frame, value: paint?.opacity === 100 ? 100 : 0 })), 0, true) };
    return shapeLayer('Projected surface ' + (slot + 1), slot + 1, frames, [
      { ty: 'gr', nm: 'Surface', it: [...paths, fill, seam, transform] },
    ], { ...defaults, o: numbers(series.map(({ frame, paint }) => ({ frame, value: paint?.opacity ?? 0 })), 0, true) });
  });
  return { layers, shapes };
}
