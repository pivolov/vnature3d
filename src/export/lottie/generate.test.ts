import { strFromU8, unzipSync } from 'fflate';
import { expect, it } from 'vitest';
import { defaultTimeline, putKey } from '../../animation/timeline';
import { makeLayer } from '../../core/layers';
import { emptyProject, cameraPositions, type Project } from '../../core/project';
import { archiveLottie } from './download';
import { generateLottie } from './generate';
import type { LottieDocument, LottieOptions } from './model';

const layer = makeLayer('Ring', [{
  outer: [[-1, -1], [1, -1], [1, 1], [-1, 1]],
  holes: [[[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]],
}], '#37c184');
const options: LottieOptions = { width: 256, height: 256, fps: 30, step: 1, tolerance: 1 };
const front: Project = { ...emptyProject, layers: [{ ...layer, bevel: 0, depth: 0.01 }],
  camera: { ...emptyProject.camera, preset: 'front', position: cameraPositions.front },
  timeline: { ...defaultTimeline, duration: 0.5 } };

it('exports true 2D shape transforms and preserves the inner contour', () => {
  let timeline = putKey(front.timeline!, layer.id, 'position', { time: 0, value: [0, 0, 0], easing: { kind: 'linear' } });
  timeline = putKey(timeline, layer.id, 'position', { time: 0.5, value: [1, 0, 0], easing: { kind: 'linear' } });
  const result = generateLottie({ ...front, timeline }, options);
  const doc: LottieDocument = JSON.parse(result.json);
  expect(result.mode).toBe('native');
  expect(result.shapes).toBe(2);
  expect(doc.layers[0].ks.p.a).toBe(1);
  expect(result.keys).toBe(2);
  expect(doc.ddd).toBe(0);
});

it('automatically exports a limited Y tilt as pseudo-3D', () => {
  const timeline = putKey(front.timeline!, layer.id, 'rotation', { time: 0, value: [0, 0.45, 0], easing: { kind: 'linear' } });
  expect(generateLottie({ ...front, timeline }, options).mode).toBe('pseudo');
});

it('bakes projected faces and packages an identical animation in dotLottie', () => {
  const result = generateLottie({ ...front, camera: emptyProject.camera, layers: [layer] }, options);
  expect(result.mode).toBe('bake');
  expect(result.layers).toBeGreaterThan(1);
  expect(result.keys).toBe(0);
  const archive = unzipSync(archiveLottie(result.json));
  expect(JSON.parse(strFromU8(archive['manifest.json'])).animations[0].id).toBe('main');
  expect(strFromU8(archive['a/main.json'])).toBe(result.json);
});
