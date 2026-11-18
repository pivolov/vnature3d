import { expect, it } from 'vitest';
import { defaultTimeline } from '../animation/timeline';
import { emptyProject } from '../core/project';
import { checkExport, framePlan, type ExportConfig } from './config';

const options: ExportConfig = { format: 'mp4', width: 1920, height: 1080, fps: 24, bitrate: 8_000_000,
  transparent: true, color: '#666666', supersample: false, motionSamples: 1 };

it('samples each output frame by integer index and includes a full ping-pong cycle', () => {
  const project = { ...emptyProject, timeline: { ...defaultTimeline, duration: 2, loop: 'ping-pong' as const } };
  const plan = framePlan(project, options, 0.7);
  expect(plan.frames).toBe(96);
  expect(plan.time(24)).toBe(1);
  expect(plan.time(48)).toBe(2);
  expect(plan.time(72)).toBe(1);
  expect(framePlan(project, { ...options, format: 'png' }, 0.7).time(0)).toBe(0.7);
});
it('samples motion around the frame while staying within the clip and validates H.264 dimensions', () => {
  const plan = framePlan(emptyProject, { ...options, motionSamples: 4 }, 0);
  expect(plan.time(0, 0)).toBe(0);
  expect(plan.time(12, 0)).toBeLessThan(0.5);
  expect(plan.time(12, 3)).toBeGreaterThan(0.5);
  expect(checkExport({ ...options, width: 1921 })).toContain('чётными');
  expect(checkExport({ ...options, width: 1921, format: 'png' })).toBe('');
});
