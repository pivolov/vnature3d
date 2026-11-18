import { expect, it } from 'vitest';
import { reduceLinear, simplifyPath } from './reduction';
import type { Vec2 } from '../core/project';

it('removes straight samples while keeping changes larger than tolerance', () => {
  const points = [[0, 0], [1, 1], [2, 2], [3, 4], [4, 4]];
  expect(reduceLinear(points, ([time]) => time, ([, value]) => [value], 0.05)).toEqual([points[0], points[2], points[3], points[4]]);
});
it('reduces dense rings without dropping vertices below a closed triangle', () => {
  const ring = Array.from({ length: 720 }, (_, i): Vec2 => [100 * Math.cos(i * Math.PI / 360), 100 * Math.sin(i * Math.PI / 360)]);
  const simplified = simplifyPath(ring, 1);
  expect(simplified.length).toBeLessThan(50);
  expect(simplified.length).toBeGreaterThanOrEqual(3);
  expect(simplified[0]).toEqual(ring[0]);
});
