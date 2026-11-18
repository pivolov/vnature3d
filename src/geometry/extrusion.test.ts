import { expect, it } from 'vitest';
import { extrudeLayer } from './extrusion';

it('preserves planar lighting on a rounded extruded face with an aperture', () => {
  const ring = (radius: number) => Array.from({ length: 120 }, (_, index): [number, number] => {
    const angle = index * Math.PI / 60;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
  const geometry = extrudeLayer({
    id: 'ring', name: 'Ring', shapes: [{ outer: ring(1), holes: [ring(0.45)] }],
    color: '#ffffff', opacity: 1, material: 'plastic', visible: true,
    depth: 0.55, bevel: 0.09, bevelSegments: 6, position: [0, 0, 0], rotation: [0, 0, 0],
  });
  const normals = geometry.getAttribute('normal');
  const positions = geometry.getAttribute('position');
  const cap = geometry.groups[0];
  for (let i = cap.start; i < cap.start + cap.count; i++) {
    expect([normals.getX(i), normals.getY(i), normals.getZ(i)]).toEqual([0, 0, Math.sign(positions.getZ(i))]);
  }
  const wallNormal = Array.from({ length: normals.count - cap.count }, (_, i) => Math.abs(normals.getZ(i + cap.count)));
  expect(wallNormal.some((z) => z > 0.8 && z < 1)).toBe(true);
  geometry.dispose();
});
