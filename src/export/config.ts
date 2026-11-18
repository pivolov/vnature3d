import type { Project } from '../core/project';
import { defaultTimeline, positionAt } from '../animation/timeline';

export const formats = {
  mp4: { label: 'MP4', extension: 'mp4', type: 'video/mp4' },
  webm: { label: 'WebM', extension: 'webm', type: 'video/webm' },
  sequence: { label: 'PNG ZIP', extension: 'zip', type: 'application/zip' },
  png: { label: 'PNG', extension: 'png', type: 'image/png' },
} as const;

export type ExportFormat = keyof typeof formats;
export type ExportConfig = {
  format: ExportFormat; width: number; height: number; fps: 24 | 30 | 60;
  bitrate: number; transparent: boolean; color: string; supersample: boolean; motionSamples: 1 | 2 | 4 | 8;
};

export function framePlan(project: Project, options: ExportConfig, playhead: number) {
  const timeline = project.timeline ?? defaultTimeline;
  const duration = timeline.loop === 'ping-pong' ? timeline.duration * 2 : timeline.duration;
  const frames = options.format === 'png' ? 1 : Math.max(1, Math.ceil(duration * options.fps - 1e-7));
  return {
    frames, duration: frames / options.fps,
    time(frame: number, sample = 0) {
      if (options.format === 'png') return playhead;
      const offset = options.motionSamples > 1 ? ((sample + 0.5) / options.motionSamples - 0.5) / options.fps : 0;
      const t = Math.max(0, Math.min(duration, frame / options.fps + offset));
      return positionAt(t, timeline.duration, timeline.loop === 'ping-pong' ? 'ping-pong' : 'once');
    },
  };
}

export function checkExport(options: ExportConfig) {
  const { format, width, height, bitrate } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || Math.min(width, height) < 16 || Math.max(width, height) > 4096) {
    return 'Размер кадра должен быть от 16 до 4096 px по каждой стороне.';
  }
  if (format === 'mp4' && (width % 2 || height % 2)) return 'Для H.264 ширина и высота должны быть чётными.';
  if ((format === 'mp4' || format === 'webm') && !(bitrate >= 100000 && bitrate <= 100000000)) return 'Битрейт должен быть от 0,1 до 100 Мбит/с.';
  return '';
}
