import { expect, it } from 'vitest';
import { emptyProject } from '../core/project';
import { makeLayer } from '../core/layers';
import { applyPreset, applyTemplate, presetDefaults, presets, staggerRanks, type PresetId } from './presets';
import { cameraId, evaluate, isSeamless } from './timeline';

const layer = makeLayer('Triangle', [{ outer: [[0, 0], [1, 0], [0, 1]], holes: [] }], '#808080');

it('turns every catalog entry into editable finite keys', () => {
  for (const id of Object.keys(presets) as PresetId[]) {
    const result = applyPreset({ ...emptyProject, layers: [layer] }, id, [layer.id], 0, presetDefaults);
    const tracks = result.timeline?.tracks ?? [];
    expect(tracks.length, id).toBeGreaterThan(0);
    expect(tracks[0].target).toBe(id === 'orbit' ? cameraId : layer.id);
    expect(tracks.every(({ keys }) => keys.every(({ time, value }) => Number.isFinite(time) &&
      (typeof value === 'number' ? Number.isFinite(value) : Array.isArray(value) ? value.every(Number.isFinite) : /^#[a-f0-9]{6}$/i.test(value))))).toBe(true);
  }
});

it('bakes deterministic spring, keeps lock respected and staggers outer layers after the center', () => {
  const ids = ['first', 'middle', 'last'];
  const layers = ids.map((id) => ({ ...layer, id, locked: id === 'last' }));
  const project = { ...emptyProject, layers };
  const options = { ...presetDefaults, stagger: 0.2, order: 'center' as const };
  const a = applyPreset(project, 'spring', ids, 0, options);
  expect(a).toEqual(applyPreset(project, 'spring', ids, 0, options));
  expect(a.timeline?.tracks).toHaveLength(2);
  expect(a.timeline?.tracks[1].keys[0].time).toBeCloseTo(0.2);
  expect(a.timeline?.tracks[0].keys.length).toBeGreaterThan(8);
  expect(a.timeline?.tracks[0].keys.length).toBeLessThan(45);
  expect(staggerRanks(ids, 'center').get('middle')).toBe(0);
  expect(staggerRanks(ids, 'random')).toEqual(staggerRanks(ids, 'random'));
});

it('creates a seamless loader template using real material and keyframes', () => {
  const result = applyTemplate({ ...emptyProject, layers: [layer] }, 'loader', [layer.id], presetDefaults);
  expect(result.layers[0].material).toBe('metal');
  expect(result.timeline?.loop).toBe('loop');
  expect(isSeamless(result)).toBe(true);
  expect(evaluate(result, 0.5).layers[0].rotation).not.toEqual(layer.rotation);
});

it('starts a preset from the evaluated motion and keeps keys before its range', () => {
  const input = {
    ...emptyProject, layers: [layer],
    timeline: { duration: 4, fps: 30, loop: 'once', tracks: [{
      target: layer.id, property: 'position', keys: [
        { time: 0, value: [0, 0, 0], easing: { kind: 'linear' } },
        { time: 2, value: [2, 0, 0], easing: { kind: 'linear' } },
      ],
    }] },
  } satisfies Parameters<typeof applyPreset>[0];
  const result = applyPreset(input, 'float', [layer.id], 1, presetDefaults);
  expect(evaluate(result, 0).layers[0].position).toEqual([0, 0, 0]);
  expect(evaluate(result, 1).layers[0].position).toEqual([1, 0, 0]);
  expect(evaluate(result, 1.4).layers[0].position[1]).toBeCloseTo(0.35);
});

it('uses the layer hue for glow and animates reflected light without turning the model', () => {
  const green = { ...layer, color: '#22cc44' };
  const project = { ...emptyProject, layers: [green] };
  const glowing = applyPreset(project, 'glow', [green.id], 0, presetDefaults);
  const peak = evaluate(glowing, 0.8).layers[0].emissive!;
  const rgb = peak.slice(1).match(/../g)!.map((channel) => parseInt(channel, 16));
  expect(rgb[1]).toBeGreaterThan(rgb[0] * 2);
  const shining = applyPreset(project, 'shine', [green.id], 0, presetDefaults);
  expect(shining.timeline?.tracks.map(({ property }) => property)).toEqual(['shine']);
  expect(evaluate(shining, 0.8).layers[0].shine).toBeCloseTo(Math.PI);
  expect(isSeamless(shining)).toBe(true);
});

it('keeps late keys reachable after applying a short scene template', () => {
  const project = applyPreset({ ...emptyProject, layers: [layer] }, 'glow', [layer.id], 8, presetDefaults);
  const result = applyTemplate(project, 'loader', [layer.id], presetDefaults);
  expect(result.timeline?.duration).toBe(project.timeline?.duration);
  expect(result.timeline?.tracks.find(track => track.property === 'emissive')).toEqual(
    project.timeline?.tracks.find(track => track.property === 'emissive'),
  );
});

it('keeps the original opacity in every preset, including loader and exit animations', () => {
  const subject = { ...layer, opacity: 0.67 };
  for (const id of Object.keys(presets) as PresetId[]) {
    const project = applyPreset({ ...emptyProject, layers: [subject] }, id, [subject.id], 0, presetDefaults);
    expect(project.timeline?.tracks.some(track => track.property === 'opacity'), id).toBe(false);
    expect(evaluate(project, 0.8).layers[0].opacity, id).toBe(0.67);
  }
});

it('keeps showcase motions centered and returns to the starting pose at fractional intensity', () => {
  for (const id of Object.keys(presets) as PresetId[]) {
    if (presets[id].group !== '3D на месте') continue;
    const project = applyPreset({ ...emptyProject, layers: [layer] }, id, [layer.id], 0, { ...presetDefaults, intensity: 0.65 });
    const tracks = project.timeline!.tracks;
    expect(tracks.map(t => t.property)).toEqual(['rotation']);
    expect(tracks[0].keys[1].value).not.toEqual(layer.rotation);
    expect(isSeamless(project), id).toBe(true);
  }
});

it('rejects motion that would collapse remaining rotation keys onto the final frame', () => {
  const project = { ...emptyProject, layers: [layer] };
  expect(applyPreset(project, 'coin', [layer.id], 119, presetDefaults)).toBe(project);
});
