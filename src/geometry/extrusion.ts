import { ExtrudeGeometry, Path, PlaneGeometry, Shape } from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Layer, Vec2 } from '../core/project';

function outline(path: Path, points: Vec2[]) {
  path.moveTo(...points[0]);
  for (const point of points.slice(1)) path.lineTo(...point);
  path.closePath();
  return path;
}

export function extrudeLayer(layer: Layer, smooth = true) {
  if (layer.relief) {
    const { width, height, heights } = layer.relief;
    const scale = 3.8 / Math.max(width, height);
    const surface = new PlaneGeometry(width * scale, height * scale, Math.max(1, width - 1), Math.max(1, height - 1));
    const vertices = surface.getAttribute('position');
    const columns = Math.max(2, width);
    for (let i = 0; i < vertices.count; i++) {
      const x = Math.min(width - 1, i % columns);
      const y = Math.min(height - 1, Math.floor(i / columns));
      vertices.setZ(i, (heights[y * width + x] - 0.5) * layer.depth);
    }
    surface.computeVertexNormals();
    return surface;
  }
  const shapes = layer.shapes.map(({ outer, holes }) => {
    const shape = new Shape();
    outline(shape, outer);
    shape.holes = holes.map((hole) => outline(new Path(), hole));
    return shape;
  });
  const geometry = new ExtrudeGeometry(shapes, {
    depth: layer.depth, bevelEnabled: layer.bevel > 0, bevelSize: layer.bevel,
    bevelThickness: layer.bevel, bevelSegments: layer.bevelSegments,
  });
  geometry.translate(0, 0, -layer.depth / 2);
  if (!smooth) return geometry;
  toCreasedNormals(geometry, layer.bevel > 0 ? Math.PI / 3 + 0.002 : Math.PI / 4);

  // The bevel meets both caps tangentially. Match the shared boundary normal
  // while keeping every cap triangle uniformly perpendicular to its plane.
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const capZ = layer.depth / 2 + layer.bevel;
  for (const { start, count, materialIndex } of geometry.groups) {
    for (let index = start; index < start + count; index++) {
      const z = positions.getZ(index);
      if (materialIndex === 0 || (layer.bevel > 0 && Math.abs(Math.abs(z) - capZ) < 1e-6)) {
        normals.setXYZ(index, 0, 0, Math.sign(z));
      }
    }
  }
  return geometry;
}
