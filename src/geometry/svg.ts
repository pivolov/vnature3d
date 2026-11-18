import { Box2, Color, Vector2 } from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import type { Layer, Shape, Vec2 } from '../core/project';

export const maxSvgBytes = 1024 * 1024;

type Paint = { fill?: string; stroke?: string; fillOpacity?: number; opacity?: number; visibility?: string; display?: string };
type PathData = {
  style: Paint;
  node: Element;
  gradients: Record<string, { stops: { color: string; opacity: number }[] }>;
};

function sample(path: { getPoints: (divisions: number) => Vector2[] }): Vec2[] {
  const points = path.getPoints(24);
  if (points.length > 1 && points[0].equals(points[points.length - 1])) points.pop();
  return points.map(({ x, y }) => [x, -y]);
}

function moments(points: Vec2[]) {
  let area = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const cross = ax * by - bx * ay;
    area += cross;
    x += (ax + bx) * cross;
    y += (ay + by) * cross;
  }
  const sign = Math.sign(area);
  return { weight: Math.abs(area) / 2, x: sign * x / 6, y: sign * y / 6 };
}

export function importSvg(source: string): { layers: Layer[]; notices: string[] } {
  if (new TextEncoder().encode(source).length > maxSvgBytes) throw new Error('SVG превышает 1 МБ. Упростите исходный файл.');
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg' || doc.doctype) {
    throw new Error('Не удалось прочитать SVG. Проверьте, что файл содержит корректную SVG-разметку.');
  }

  const notices = new Set<string>();
  if (doc.querySelector('text')) notices.add('Текст пропущен. Переведите его в кривые в исходном SVG.');
  if (doc.querySelector('image, mask, clipPath, filter, pattern, foreignObject, use')) {
    notices.add('Встроенные изображения, ссылки, эффекты и маски могут быть пропущены. Преобразуйте их в контуры.');
  }
  doc.querySelectorAll('defs image, mask, clipPath, filter, pattern, foreignObject, script, image, use').forEach((node) => node.remove());

  // Keep the viewBox aspect ratio by using the same normalization factor on both axes.
  const bounds = new Box2();
  const layers = new Map<string, Layer>();
  let pointCount = 0;
  for (const path of new SVGLoader().parse(new XMLSerializer().serializeToString(doc)).paths) {
    const { style, gradients, node } = path.userData as PathData;
    if (style.display === 'none' || style.visibility === 'hidden' || node.closest('[display="none"]')) continue;
    if (style.stroke && style.stroke !== 'none') notices.add('Обводки пропущены. Преобразуйте их в заливки в исходном SVG.');
    if (!style.fill || style.fill === 'none') continue;
    const gradientId = /^url\(\s*['"]?#([^)'"]+)['"]?\s*\)/.exec(style.fill)?.[1]?.trim();
    const stop = gradientId && Object.hasOwn(gradients, gradientId) ? gradients[gradientId].stops[0] : undefined;
    if (style.fill.startsWith('url(')) notices.add('Градиенты сведены к сплошному цвету первого стопа.');
    const color = '#' + (style.fill.startsWith('url(') && !stop ? path.color : new Color(stop?.color ?? style.fill)).getHexString();
    const opacity = Math.max(0, Math.min(1, (stop?.opacity ?? 1) * (style.opacity ?? 1) * (style.fillOpacity ?? 1)));
    if (!opacity) continue;

    const shapes: Shape[] = [];
    for (const shape of path.toShapes()) {
      const outer = sample(shape);
      const holes = shape.holes.map(sample).filter((hole) => hole.length >= 3);
      pointCount += outer.length + holes.reduce((sum, hole) => sum + hole.length, 0);
      if (pointCount > 24000) throw new Error('В SVG слишком много точек. Упростите контуры и повторите импорт.');
      if (outer.length < 3 || !moments(outer).weight) continue;
      for (const [x, y] of outer) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('В SVG есть некорректные координаты.');
        bounds.expandByPoint(new Vector2(x, y));
      }
      shapes.push({ outer, holes });
    }
    if (!shapes.length) continue;
    const key = color + '/' + opacity;
    const existing = layers.get(key);
    if (existing) {
      existing.shapes.push(...shapes);
    } else {
      layers.set(key, {
        id: 'layer-' + (layers.size + 1), name: node.getAttribute('id') || 'Заливка ' + (layers.size + 1),
        shapes, color, opacity, material: 'clay', visible: true,
        depth: 0.55, bevel: 0.045, bevelSegments: 3,
        position: [0, 0, layers.size * 0.025], rotation: [0, 0, 0],
      });
    }
  }

  if (!layers.size) throw new Error(['В SVG нет замкнутых контуров с видимой заливкой.', ...notices].join(' '));
  const size = bounds.getSize(new Vector2());
  const scale = 3.8 / Math.max(size.x, size.y);
  if (!Number.isFinite(scale)) throw new Error('Размеры контуров SVG выходят за допустимый диапазон.');
  const center = bounds.getCenter(new Vector2());
  let weight = 0;
  let sumX = 0;
  let sumY = 0;
  for (const layer of layers.values()) {
    for (const shape of layer.shapes) {
      for (const [index, contour] of [shape.outer, ...shape.holes].entries()) {
        for (const point of contour) {
          point[0] = (point[0] - center.x) * scale;
          point[1] = (point[1] - center.y) * scale;
          if (!point.every(Number.isFinite)) throw new Error('В SVG есть некорректные координаты.');
        }
        const m = moments(contour);
        const sign = index ? -1 : 1;
        weight += m.weight * sign;
        sumX += m.x * sign;
        sumY += m.y * sign;
      }
    }
  }
  if (weight > 0) {
    for (const layer of layers.values()) {
      for (const shape of layer.shapes) {
        for (const contour of [shape.outer, ...shape.holes]) {
          for (const point of contour) {
            point[0] -= sumX / weight;
            point[1] -= sumY / weight;
          }
        }
      }
    }
  }
  return { layers: [...layers.values()], notices: [...notices] };
}
