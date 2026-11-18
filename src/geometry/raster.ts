import { createTangent, fitCubic } from 'fit-curve';
import type { Shape, Vec2 } from '../core/project';

export type RasterOptions = {
  mode: 'silhouette' | 'colors' | 'relief';
  threshold: number;
  background: string;
  smoothing: number;
  simplify: number;
  minArea: number;
  colors: number;
  corner: number;
};
export type RasterImage = { width: number; height: number; data: Uint8ClampedArray; hasAlpha: boolean };
export type RasterResult = {
  layers: { color: string; shapes: Shape[] }[];
  relief?: { width: number; height: number; heights: number[] };
};

type RGB = [number, number, number];

function rgb(hex: string): RGB {
  const value = Number.parseInt(hex.slice(1), 16);
  return [value >> 16, (value >> 8) & 255, value & 255];
}

function hex(color: RGB) {
  return '#' + color.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('');
}

function distance(a: RGB, b: RGB) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function quantize(pixels: RGB[], count: number) {
  const bins = new Map<number, { color: RGB; count: number }>();
  for (const color of pixels) {
    const key = (color[0] >> 3) * 1024 + (color[1] >> 3) * 32 + (color[2] >> 3);
    const bin = bins.get(key);
    if (bin) bin.count++;
    else bins.set(key, { color, count: 1 });
  }
  const cells = [...bins.values()].sort((a, b) => b.count - a.count);
  if (!cells.length) return [];
  const palette = [cells[0].color];
  while (palette.length < Math.min(count, cells.length)) {
    let best = cells[0];
    let score = -1;
    for (const cell of cells) {
      const candidate = Math.min(...palette.map((color) => distance(color, cell.color))) * Math.sqrt(cell.count);
      if (candidate > score) {
        score = candidate;
        best = cell;
      }
    }
    palette.push(best.color);
  }
  for (let pass = 0; pass < 4; pass++) {
    const sums = palette.map(() => [0, 0, 0, 0]);
    for (const color of pixels) {
      const total = sums[closest(color, palette)];
      for (let i = 0; i < 3; i++) total[i] += color[i];
      total[3]++;
    }
    sums.forEach(([r, g, b, n], index) => {
      if (n) palette[index] = [r / n, g / n, b / n];
    });
  }
  return palette;
}

function closest(pixel: RGB, palette: RGB[]) {
  let minimum = Infinity;
  let index = 0;
  palette.forEach((color, i) => {
    const score = distance(pixel, color);
    if (score < minimum) {
      index = i;
      minimum = score;
    }
  });
  return index;
}

// Edge order is top, right, bottom, left. Ambiguous saddles use the center value.
const cases: number[][] = [[], [3, 0], [0, 1], [3, 1], [1, 2], [3, 0, 1, 2], [0, 2], [3, 2],
  [2, 3], [0, 2], [0, 1, 2, 3], [1, 2], [1, 3], [0, 1], [3, 0], []];

function contours(field: Float32Array, width: number, height: number, threshold: number) {
  const edges = new Map<number, { point: Vec2; neighbors: number[] }>();
  const stride = width + 2;
  const get = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height ? 0 : field[y * width + x];
  for (let y = -1; y < height; y++) {
    for (let x = -1; x < width; x++) {
      const values = [get(x, y), get(x + 1, y), get(x + 1, y + 1), get(x, y + 1)];
      const code = values.reduce((mask, value, i) => mask | (value >= threshold ? 1 << i : 0), 0);
      let pairs = cases[code];
      if (values[0] + values[1] + values[2] + values[3] >= 4 * threshold) {
        if (code === 5) pairs = cases[10];
        if (code === 10) pairs = cases[5];
      }
      if (!pairs.length) continue;
      const vertex = (y + 1) * stride + x + 1;
      function edge(index: number) {
        const key = [vertex * 2, (vertex + 1) * 2 + 1, (vertex + stride) * 2, vertex * 2 + 1][index];
        if (!edges.has(key)) {
          const [first, last] = [[0, 1], [1, 2], [3, 2], [0, 3]][index];
          const ratio = (threshold - values[first]) / (values[last] - values[first]);
          const point: Vec2 = [[x + ratio, y], [x + 1, y + ratio], [x + ratio, y + 1], [x, y + ratio]][index] as Vec2;
          edges.set(key, { point, neighbors: [] });
        }
        return key;
      }
      for (let i = 0; i < pairs.length; i += 2) {
        const a = edge(pairs[i]);
        const b = edge(pairs[i + 1]);
        edges.get(a)?.neighbors.push(b);
        edges.get(b)?.neighbors.push(a);
      }
    }
  }
  const loops: Vec2[][] = [];
  const seen = new Set<number>();
  for (const key of edges.keys()) {
    if (seen.has(key)) continue;
    const loop: Vec2[] = [];
    let previous = -1;
    let current: number | undefined = key;
    while (current !== undefined && !seen.has(current)) {
      const node: { point: Vec2; neighbors: number[] } = edges.get(current)!;
      seen.add(current);
      loop.push(node.point);
      const next: number | undefined = node.neighbors.find((neighbor) => neighbor !== previous);
      previous = current;
      current = next;
    }
    if (current === key && loop.length > 2) loops.push(loop);
  }
  return loops;
}

function area(loop: Vec2[]) {
  return Math.abs(loop.reduce((sum, [x, y], i) => {
    const [nx, ny] = loop[(i + 1) % loop.length];
    return sum + x * ny - nx * y;
  }, 0)) / 2;
}

function inside([x, y]: Vec2, loop: Vec2[]) {
  let result = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [ax, ay] = loop[i];
    const [bx, by] = loop[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) result = !result;
  }
  return result;
}

function simplifyLine(points: Vec2[], tolerance: number) {
  const keep = new Set([0, points.length - 1]);
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    const [ax, ay] = points[start];
    const [bx, by] = points[end];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    let furthest = start;
    let largest = tolerance ** 2;
    for (let index = start + 1; index < end; index++) {
      const [x, y] = points[index];
      const t = lengthSquared ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared)) : 0;
      const delta = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
      if (delta > largest) {
        largest = delta;
        furthest = index;
      }
    }
    if (furthest === start) continue;
    keep.add(furthest);
    stack.push([start, furthest], [furthest, end]);
  }
  return points.filter((_, index) => keep.has(index));
}

function refine(loop: Vec2[], options: RasterOptions): Vec2[] {
  const middle = Math.floor(loop.length / 2);
  const simplified = [...simplifyLine(loop.slice(0, middle + 1), options.simplify).slice(0, -1),
    ...simplifyLine([...loop.slice(middle), loop[0]], options.simplify).slice(0, -1)];
  const base = simplified.length >= 3 ? simplified : loop;
  if (!options.smoothing) return base;
  const at = (index: number) => base[(index + base.length) % base.length];
  const corners = new Set<number>();
  base.forEach(([x, y], index) => {
    const [ax, ay] = at(index - 1);
    const [bx, by] = at(index + 1);
    const ux = ax - x;
    const uy = ay - y;
    const vx = bx - x;
    const vy = by - y;
    const angle = Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy) * 180 / Math.PI;
    if (angle < options.corner) corners.add(index);
  });
  const splits = new Set(corners);
  if (splits.size < 2) {
    const first = splits.values().next().value ?? 0;
    splits.add(first);
    splits.add((first + Math.floor(base.length / 2)) % base.length);
  }
  for (let i = 192; i < base.length; i += 192) splits.add(i);
  const starts = [...splits].sort((a, b) => a - b);
  const tolerance = (0.28 + options.smoothing * 0.48) ** 2;
  return starts.flatMap((start, index): Vec2[] => {
    const end = starts[index + 1] ?? starts[0] + base.length;
    if (end - start === 1 && corners.has(start) && corners.has(end % base.length)) return [at(start)];
    const span = Array.from({ length: end - start + 1 }, (_, i) => at(start + i));
    const left = createTangent(at(start + 1), corners.has(start) ? at(start) : at(start - 1));
    const right = createTangent(at(end - 1), corners.has(end % base.length) ? at(end) : at(end + 1));
    return fitCubic(span, left, right, tolerance).flatMap(([a, b, c, d]) => {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - b[0], c[1] - b[1]) + Math.hypot(d[0] - c[0], d[1] - c[1]);
      const count = Math.min(32, Math.max(2, Math.ceil(length / 2.5)));
      return Array.from({ length: count }, (_, i): Vec2 => {
        const t = i / count;
        const u = 1 - t;
        const coordinate = (axis: number) => u ** 3 * a[axis] + 3 * u * u * t * b[axis] + 3 * u * t * t * c[axis] + t ** 3 * d[axis];
        return [coordinate(0), coordinate(1)];
      });
    });
  });
}

function shapesFromLoops(loops: Vec2[][], width: number, height: number, options: RasterOptions) {
  const scale = 3.8 / Math.max(width, height);
  const normalize = (loop: Vec2[]) => refine(loop, options).map(([x, y]): Vec2 => [
    (x - (width - 1) / 2) * scale, ((height - 1) / 2 - y) * scale,
  ]);
  const ordered = loops.map((loop) => ({ loop, size: area(loop), depth: 0, shape: undefined as Shape | undefined }))
    .filter(({ size }) => size >= options.minArea).sort((a, b) => b.size - a.size);
  if (ordered.length > 2400) throw new Error('Слишком много контуров. Увеличьте минимальную площадь или упростите изображение.');
  const shapes: Shape[] = [];
  ordered.forEach((entry, index) => {
    let enclosing: typeof entry | undefined;
    for (let i = index - 1; i >= 0; i--) {
      if (inside(entry.loop[0], ordered[i].loop)) {
        enclosing = ordered[i];
        break;
      }
    }
    entry.depth = enclosing ? enclosing.depth + 1 : 0;
    if (entry.depth % 2) enclosing?.shape?.holes.push(normalize(entry.loop));
    else {
      entry.shape = { outer: normalize(entry.loop), holes: [] };
      shapes.push(entry.shape);
    }
  });
  return shapes;
}

export function traceRaster(image: RasterImage, options: RasterOptions): RasterResult {
  const { width, height, data, hasAlpha } = image;
  if (options.mode === 'relief') {
    const step = Math.max(1, Math.ceil(Math.max(width, height) / 120));
    const heights: number[] = [];
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * 4;
        heights.push((0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) * data[i + 3] / 65025);
      }
    }
    return { layers: [], relief: { width: Math.ceil(width / step), height: Math.ceil(height / step), heights } };
  }
  const background = rgb(options.background);
  const threshold = (options.threshold + 0.5) / 256;
  const values = new Float32Array(width * height);
  const foreground: { color: RGB; index: number }[] = [];
  for (let index = 0; index < values.length; index++) {
    const i = index * 4;
    const color: RGB = [data[i], data[i + 1], data[i + 2]];
    const score = hasAlpha ? data[i + 3] / 255 : Math.sqrt(distance(background, color) / (3 * 255 ** 2));
    values[index] = score;
    if (score >= threshold) foreground.push({ index, color });
  }
  if (!foreground.length) return { layers: [] };
  const palette = quantize(foreground.map(({ color }) => color), options.mode === 'colors' ? options.colors : 1);
  const labels = new Int8Array(values.length).fill(-1);
  foreground.forEach(({ index, color }) => { labels[index] = closest(color, palette); });
  const layers = palette.map((color, label) => {
    const mask = palette.length === 1 ? values : Float32Array.from(labels, (value) => value === label ? 1 : 0);
    const loops = contours(mask, width, height, palette.length === 1 ? threshold : 0.5);
    return { color: hex(color), shapes: shapesFromLoops(loops, width, height, options) };
  }).filter(({ shapes }) => shapes.length > 0);
  const pointCount = layers.reduce((sum, { shapes }) => sum + shapes.reduce(
    (total, { outer, holes }) => total + outer.length + holes.reduce((count, hole) => count + hole.length, 0), 0), 0);
  if (pointCount > 24000) throw new Error('Слишком много точек. Увеличьте упрощение или минимальную площадь.');
  return { layers };
}
