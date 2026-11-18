import { framePlan, type ExportConfig } from '../config';
import type { Project } from '../../core/project';
import { bakedLayers } from './bake';
import { countKeys, type LottieDocument, type LottieOptions, type LottieOutput } from './model';
import { pickMode, planarLayers } from './native';
import { visibleLayers } from './scene';

export function generateLottie(project: Project, options: LottieOptions, progress: (done: number, total: number) => void = () => undefined): LottieOutput {
  if (![options.width, options.height].every((value) => Number.isInteger(value) && value >= 64 && value <= 1920) ||
    ![24, 30, 60].includes(options.fps) || !Number.isInteger(options.step) || options.step < 1 || options.step > 60 ||
    !Number.isFinite(options.tolerance) || options.tolerance < 0.1 || options.tolerance > 10) throw new Error('Проверьте размеры, FPS, шаг и допуск Lottie.');
  const visible = visibleLayers(project);
  if (!visible.length) throw new Error('Для экспорта нужен хотя бы один видимый слой.');
  const mode = pickMode(project);
  const settings: ExportConfig = { ...options, format: 'webm', bitrate: 4_000_000,
    transparent: true, color: '#000000', supersample: false, motionSamples: 1 };
  const { frames, duration } = framePlan(project, settings, 0);
  const warnings: string[] = [];
  const step = Math.max(options.step, mode === 'bake' ? Math.ceil((frames - 1) / 239) : Math.ceil((frames - 1) / 2400));
  if (step > options.step) warnings.push('Для длинной сцены увеличен шаг выборки до ' + step + '.');
  const animated = !!project.timeline?.tracks.length;
  const samples = animated ? Array.from({ length: Math.ceil(frames / step) }, (_, index) => index * step) : [0];
  if (animated && samples.at(-1) !== frames - 1) samples.push(frames - 1);
  const result = mode === 'bake' ? bakedLayers(project, options, frames, samples, progress)
    : planarLayers(project, options, frames, samples, mode === 'pseudo');
  if (!result.layers.length) throw new Error('В кадре нет видимой геометрии. Проверьте положение камеры и непрозрачность.');
  if (mode === 'pseudo') warnings.push('Глубина передаётся сжатием, наклоном и параллаксом плоских слоёв.');
  if (mode === 'bake') warnings.push('Объём передан плоскими гранями. Сложные перекрытия и пересечения могут выглядеть иначе.');
  if (visible.some((layer) => layer.relief)) warnings.push('Рельеф экспортирован с пониженным разрешением сетки.');
  if (visible.some((layer) => layer.material !== 'clay' || layer.shine !== undefined) ||
    project.timeline?.tracks.some(({ property }) => property === 'shine' || property === 'roughness')) {
    warnings.push('Отражения и движущийся блик аппроксимируются цветом граней. Физическое стекло, тени и постэффекты не переносятся.');
  }
  const composition: LottieDocument = { v: '5.12.2', fr: options.fps, ip: 0, op: frames, w: options.width, h: options.height,
    nm: project.name, ddd: 0, assets: [], layers: result.layers };
  const count = countKeys(composition);
  if (count > 100000 || result.shapes > 3000) throw new Error('Превышен лимит ключей или контуров Lottie. Увеличьте шаг и допуск.');
  const json = JSON.stringify(composition);
  const bytes = new TextEncoder().encode(json).byteLength;
  if (bytes > 14 * 1024 * 1024) throw new Error('JSON превышает 14 МБ. Увеличьте шаг и допуск либо экспортируйте видео.');
  if (bytes > 300_000) warnings.push('JSON больше 300 КБ. Для мобильного интерфейса увеличьте шаг или допуск и снова сравните превью.');
  return { mode, json, bytes, layers: result.layers.length, keys: count, shapes: result.shapes, frames, duration, step, warnings };
}
