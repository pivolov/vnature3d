// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { makeLayer } from '../core/layers';
import { combineShapes, primitiveShape } from './primitives';

it('subtracts a central circle from a rectangle without losing the hole', () => {
  const a = makeLayer('Rectangle', [primitiveShape('rectangle', 4)], '#ffffff');
  const b = makeLayer('Circle', [primitiveShape('circle', 4)], '#ffffff');
  b.shapes[0].outer = b.shapes[0].outer.map(([x, y]) => [x / 4, y / 4]);
  const shapes = combineShapes(a, b, 'difference');
  expect(shapes).toHaveLength(1);
  expect(shapes[0].holes).toHaveLength(1);
});
