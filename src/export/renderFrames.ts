import { createWebGLRenderer } from '../render/webgl';
import { evaluate } from '../animation/timeline';
import type { Project } from '../core/project';
import { createProjectScene, projection } from '../render/projectScene';
import type { ExportConfig } from './config';

export function canvasContext(canvas: HTMLCanvasElement, willReadFrequently = false) {
  const result = canvas.getContext('2d', { alpha: true, willReadFrequently });
  if (!result) throw new Error('Не удалось создать поверхность для экспорта.');
  return result;
}

export function renderFrames(project: Project, options: ExportConfig) {
  const factor = options.supersample ? 2 : 1;
  const width = options.width * factor;
  const height = options.height * factor;
  const canvas = document.createElement('canvas');
  canvas.width = options.width;
  canvas.height = options.height;
  const context = canvasContext(canvas, options.format === 'png');
  const renderer = createWebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  const gl = renderer.getContext();
  const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  const limit = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
  if (width > Math.min(limit, viewport[0]) || height > Math.min(limit, viewport[1])) {
    renderer.dispose();
    renderer.forceContextLoss();
    throw new Error('Этот размер превышает лимит видеокарты. Уменьшите разрешение или отключите ×2.');
  }
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.setClearColor(options.color, options.transparent && options.format !== 'mp4' ? 0 : 1);
    const model = createProjectScene(renderer);
    const { perspective, orthographic } = projection(width, height);
    context.imageSmoothingQuality = 'high';
    return {
      canvas,
      draw(at: (sample: number) => number, samples: number) {
        context.clearRect(0, 0, options.width, options.height);
        context.globalCompositeOperation = samples > 1 ? 'lighter' : 'source-over';
        context.globalAlpha = 1 / samples;
        for (let sample = 0; sample < samples; sample++) {
          if (gl.isContextLost()) throw new Error('GPU остановил рендер. Попробуйте меньшее разрешение.');
          const pose = evaluate(project, at(sample));
          model.update(pose);
          const settings = pose.camera;
          const camera = settings.projection === 'orthographic' ? orthographic : perspective;
          camera.position.set(...settings.position);
          camera.zoom = settings.zoom;
          camera.lookAt(...settings.target);
          camera.updateProjectionMatrix();
          renderer.render(model.scene, camera);
          context.drawImage(renderer.domElement, 0, 0, options.width, options.height);
        }
        context.globalAlpha = 1;
        context.globalCompositeOperation = 'source-over';
        if (!options.transparent || options.format === 'mp4') {
          context.globalCompositeOperation = 'destination-over';
          context.fillStyle = options.color;
          context.fillRect(0, 0, options.width, options.height);
          context.globalCompositeOperation = 'source-over';
        }
      },
      dispose(keepCanvas = false) {
        model.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        if (!keepCanvas) canvas.width = canvas.height = 0;
        renderer.domElement.width = renderer.domElement.height = 0;
      },
    };
  } catch (error) {
    renderer.dispose();
    renderer.forceContextLoss();
    throw error;
  }
}

export function pngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('Не удалось записать кадр PNG.'));
  }, 'image/png'));
}
