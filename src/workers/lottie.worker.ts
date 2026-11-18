import { generateLottie } from '../export/lottie/generate';
import type { LottieOptions } from '../export/lottie/model';
import type { Project } from '../core/project';

self.onmessage = ({ data }: MessageEvent<{ project: Project; options: LottieOptions }>) => {
  try {
    const result = generateLottie(data.project, data.options, (done, total) => self.postMessage({ progress: { done, total } }));
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Не удалось построить Lottie.' });
  }
};
