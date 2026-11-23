import { ExtrudeGeometry, Path, PlaneGeometry, Shape, SphereGeometry, Vector3, type BufferGeometry } from 'three';
import type { Layer, Vec2 } from '../core/project';

function outline(path: Path, input: Vec2[], clockwise: boolean) {
  const area = input.reduce((sum, [x, y], i) => {
    const next = input[(i + 1) % input.length];
    return sum + x * next[1] - y * next[0];
  }, 0);
  const points = (area < 0) === clockwise ? input : [...input].reverse();
  path.moveTo(...points[0]);
  for (const point of points.slice(1)) path.lineTo(...point);
  path.closePath();
  return path;
}

// ExtrudeGeometry duplicates vertices at triangle boundaries. Smooth only
// coincident corners and weight by corner angle so a quad's diagonal is invisible.
function smoothWalls(geometry: BufferGeometry, crease: number) {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const buckets = new Map<string, { index: number; normal: Vector3; weight: number }[]>();
  const a = new Vector3(), b = new Vector3(), origin = new Vector3();
  for (const group of geometry.groups) {
    if (group.materialIndex !== 1) continue;
    for (let face = group.start; face < group.start + group.count; face += 3) {
      for (let corner = 0; corner < 3; corner++) {
        const index = face + corner;
        origin.fromBufferAttribute(positions, index);
        a.fromBufferAttribute(positions, face + (corner + 1) % 3).sub(origin);
        b.fromBufferAttribute(positions, face + (corner + 2) % 3).sub(origin);
        const key = origin.x + ',' + origin.y + ',' + origin.z;
        let bucket = buckets.get(key);
        if (!bucket) { bucket = []; buckets.set(key, bucket); }
        bucket.push({ index, normal: new Vector3().fromBufferAttribute(normals, index), weight: a.angleTo(b) });
      }
    }
  }
  for (const bucket of buckets.values()) for (const vertex of bucket) {
    a.set(0, 0, 0);
    for (const other of bucket) if (vertex.normal.dot(other.normal) > crease) a.addScaledVector(other.normal, other.weight);
    a.normalize();
    normals.setXYZ(vertex.index, a.x, a.y, a.z);
  }
}

export function extrudeLayer(layer: Layer, smooth = true) {
  if (layer.solid === 'sphere') {
    return new SphereGeometry(1.15, smooth ? 48 : 16, smooth ? 32 : 10).scale(1, 1, layer.depth / 2.3);
  }
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
    outline(shape, outer, true);
    shape.holes = holes.map((hole) => outline(new Path(), hole, false));
    return shape;
  });
  // The outward wall offset shrinks apertures. Bound it by a conservative
  // hydraulic radius so small circular holes and thin slots keep an opening.
  let bevel = layer.bevel;
  for (const { holes } of layer.shapes) for (const ring of holes) {
    let twiceArea = 0, perimeter = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x, y] = ring[i], [nx, ny] = ring[(i + 1) % ring.length];
      twiceArea += x * ny - nx * y;
      perimeter += Math.hypot(nx - x, ny - y);
    }
    if (perimeter) bevel = Math.min(bevel, Math.abs(twiceArea) / (2 * perimeter));
  }
  const geometry = new ExtrudeGeometry(shapes, {
    depth: layer.depth, bevelEnabled: bevel > 0, bevelSize: bevel,
    bevelThickness: bevel, bevelSegments: layer.bevelSegments,
  });
  geometry.translate(0, 0, -layer.depth / 2);
  if (!smooth) return geometry;
  smoothWalls(geometry, Math.cos(layer.bevel > 0 ? Math.PI / 3 + 0.002 : Math.PI / 4));

  // The bevel meets both caps tangentially. Match the shared boundary normal
  // while keeping every cap triangle uniformly perpendicular to its plane.
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const capZ = layer.depth / 2 + bevel;
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
