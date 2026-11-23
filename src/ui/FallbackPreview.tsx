import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { effectiveLayer } from '../core/layers';
import type { Project, Vec2 } from '../core/project';

export function FallbackPreview({ project }: { project: Project }) {
  const point = new Vector3();
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  const layers = project.layers.map(layer => effectiveLayer(project, layer))
    .filter(layer => layer.visible && layer.opacity > 0)
    .sort((a, b) => a.position[2] - b.position[2])
    .map(layer => {
      const rotation = new Quaternion().setFromEuler(new Euler(...layer.rotation));
      const transform = new Matrix4().compose(new Vector3(...layer.position), rotation, new Vector3(...(layer.scale ?? [1, 1, 1])));
      let rings = layer.shapes.flatMap(shape => [shape.outer, ...shape.holes]);
      if (!rings.length && layer.relief) {
        const { width, height } = layer.relief;
        const factor = 1.9 / Math.max(width, height);
        const x = width * factor, y = height * factor;
        rings = [[[-x, -y], [x, -y], [x, y], [-x, y]] satisfies Vec2[]];
      }
      const path = rings.map(ring => ring.map(([x, y], index) => {
        point.set(x, y, layer.depth / 2).applyMatrix4(transform);
        bounds.left = Math.min(bounds.left, point.x);
        bounds.right = Math.max(bounds.right, point.x);
        bounds.top = Math.min(bounds.top, -point.y);
        bounds.bottom = Math.max(bounds.bottom, -point.y);
        return (index === 0 ? 'M' : 'L') + point.x.toFixed(4) + ' ' + (-point.y).toFixed(4);
      }).join(' ') + 'Z').join(' ');
      return { ...layer, path };
    });
  if (!Number.isFinite(bounds.left)) return null;
  const padding = Math.max(0.3, (bounds.right - bounds.left) * 0.12, (bounds.bottom - bounds.top) * 0.12);
  return <svg className="viewport-fallback" role="img" aria-label="Упрощённый вид спереди"
    viewBox={[bounds.left - padding, bounds.top - padding, bounds.right - bounds.left + 2 * padding, bounds.bottom - bounds.top + 2 * padding].join(' ')}>
    {layers.map(({ id, path, color, opacity }) => <path key={id} d={path} fill={color} fillOpacity={opacity} fillRule="evenodd" />)}
  </svg>;
}
