import { describe, expect, it } from 'vitest';
import { emptyProject } from '../core/project';
import { makeLayer } from '../core/layers';
import { validateProject } from '../core/storage';
import { ease, spring, families } from './easing';
import { defaultTimeline, evaluate, frameTime, isSeamless, positionAt, putKey } from './timeline';

describe('easing', () => {
  it('keeps endpoints for every easing family and handles hold and bezier', () => {
    for (const family of families) {
      const easing = { kind: 'named', family, direction: 'in-out' } as const;
      expect(ease(0, easing)).toBe(0);
      expect(ease(1, easing)).toBe(1);
      expect(ease(0.5, easing)).toBeCloseTo(0.5);
    }
    expect(ease(0.99, { kind: 'hold' })).toBe(0);
    expect(ease(0.5, { kind: 'bezier', x1: 0, y1: 0, x2: 1, y2: 1 })).toBeCloseTo(0.5);
  });
  it('evaluates a deterministic damped response including critical damping', () => {
    expect(spring(0)).toBe(0);
    expect(spring(1, 16, 0.43)).toBeCloseTo(1, 2);
    expect(spring(0.5, 10, 1)).toBeCloseTo(1 - Math.exp(-5) * 6);
    expect(spring(3, 10, 1.4)).toBeCloseTo(1, 3);
  });
});

it('snap, wrap, ping-pong and exact integer frame evaluation are deterministic', () => {
  expect(frameTime(1.016, defaultTimeline, true)).toBe(1);
  expect(positionAt(3.3, 3, 'loop')).toBeCloseTo(0.3);
  expect(positionAt(3.3, 3, 'ping-pong')).toBeCloseTo(2.7);
  expect(positionAt(-0.2, 3, 'loop')).toBeCloseTo(2.8);
  expect(positionAt(10, 3, 'once')).toBe(3);
});

it('round-trips animated projects and keeps flat scene data immutable', () => {
  const layer = makeLayer('Triangle', [{ outer: [[0, 0], [1, 0], [0, 1]], holes: [] }], '#808080');
  const timeline = putKey(putKey(defaultTimeline, layer.id, 'rotation', { time: 0, value: [0, 0, 0], easing: { kind: 'linear' } }),
    layer.id, 'rotation', { time: 3, value: [0, 2 * Math.PI, 0], easing: { kind: 'linear' } });
  const project = validateProject(JSON.parse(JSON.stringify({ ...emptyProject, layers: [layer], timeline })));
  expect(evaluate(project, 1.5).layers[0].rotation[1]).toBeCloseTo(Math.PI);
  expect(project.layers[0].rotation[1]).toBe(0);
  expect(isSeamless(project)).toBe(true);
  expect(() => validateProject({ ...project, groups: [{ id: 'g', name: 'Group', visible: true, parentId: 'g' }] })).toThrow('иерархия');
});
