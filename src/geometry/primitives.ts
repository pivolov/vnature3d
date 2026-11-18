import { difference, intersection, union, type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping';
import { parse } from 'opentype.js';
import type { Layer, Shape, Vec2 } from '../core/project';
import { importSvg } from './svg';

export type Primitive = 'rectangle' | 'circle' | 'polygon' | 'star';
export type BooleanOperation = 'union' | 'difference' | 'intersection';

export const primitiveNames: Record<Primitive, string> = {
  rectangle: 'Прямоугольник', circle: 'Круг', polygon: 'Многоугольник', star: 'Звезда',
};

export function primitiveShape(kind: Primitive, sides: number): Shape {
  if (kind === 'rectangle') return { outer: [[-1.2, -0.8], [1.2, -0.8], [1.2, 0.8], [-1.2, 0.8]], holes: [] };
  const count = kind === 'circle' ? 144 : sides * (kind === 'star' ? 2 : 1);
  const outer = Array.from({ length: count }, (_, index): Vec2 => {
    const angle = Math.PI / 2 + 2 * Math.PI * index / count;
    const radius = kind === 'star' && index % 2 ? 0.54 : 1.15;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
  return { outer, holes: [] };
}

export function textShapes(text: string, fontData: ArrayBuffer) {
  const font = parse(fontData);
  const missing = [...new Set([...text].filter((char) => char.trim() && !font.hasChar(char)))];
  if (missing.length) throw new Error('В шрифте нет символов: ' + missing.join(' '));
  const data = font.getPath(text, 0, 0, 100).toPathData(3);
  return importSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="' + data + '"/></svg>').layers[0].shapes;
}

function polygons(layer: Layer): MultiPolygon {
  const angle = layer.rotation[2];
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const [dx, dy] = layer.position;
  const [sx, sy] = layer.scale ?? [1, 1, 1];
  const ring = (points: Vec2[]): Ring => {
    const result = points.map(([x, y]): Vec2 => [dx + x * sx * cos - y * sy * sin, dy + x * sx * sin + y * sy * cos]);
    return [...result, result[0]];
  };
  const shapes = layer.shapes.map(({ outer, holes }): Polygon => [ring(outer), ...holes.map(ring)]);
  return union(shapes);
}

export function combineShapes(a: Layer, b: Layer, operation: BooleanOperation): Shape[] {
  if (a.relief || b.relief || [a, b].some(({ rotation }) => rotation[0] || rotation[1])) {
    throw new Error('Для булевой операции выберите два плоских контура без наклона по X и Y.');
  }
  const result = { union, difference, intersection }[operation](polygons(a), polygons(b));
  if (!result.length) throw new Error('Результат пуст. Проверьте положение фигур.');
  return result.map(([outer, ...holes]) => ({ outer: outer.slice(0, -1), holes: holes.map((hole) => hole.slice(0, -1)) }));
}
