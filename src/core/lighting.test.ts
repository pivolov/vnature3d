import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { defaultLighting, emptyProject, keyDirection } from './project';
import { validateProject } from './storage';
import { makeLayer } from './layers';
import { flatFill } from '../export/lottie/scene';

it('preserves the studio direction for older projects and saves custom lighting', () => {
  expect(validateProject(emptyProject).lighting).toBeUndefined();
  expect(new Vector3(...keyDirection(defaultLighting)).distanceTo(new Vector3(3, 5, 5).normalize())).toBeLessThan(1e-9);
  const lighting = { azimuth: -90, elevation: 0, strength: 2, fill: 0.2 };
  expect(validateProject({ ...emptyProject, lighting }).lighting).toEqual(lighting);
});

it('lights the side facing the key in the Lottie approximation', () => {
  const layer = makeLayer('Грань', [], '#888888');
  const project = { ...emptyProject, lighting: { azimuth: 90, elevation: 0, strength: 2, fill: 0 } };
  expect(flatFill(layer, new Vector3(1, 0, 0), project)[0]).toBeGreaterThan(flatFill(layer, new Vector3(-1, 0, 0), project)[0]);
});
