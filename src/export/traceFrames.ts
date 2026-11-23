import { createWebGLRenderer } from '../render/webgl';
import { Color } from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { DenoiseMaterial, ProceduralEquirectTexture, WebGLPathTracer } from 'three-gpu-pathtracer';
import { evaluate } from '../animation/timeline';
import type { Project } from '../core/project';
import { createProjectScene, projection } from '../render/projectScene';
import type { ExportConfig } from './config';

export function traceFrames(project: Project, options: ExportConfig, signal: AbortSignal, progress: (sample: number, canvas: HTMLCanvasElement) => void) {
  const renderer = createWebGLRenderer({ alpha: true, preserveDrawingBuffer: true });
  try {
    if (!renderer.extensions.has('EXT_color_buffer_float')) throw new Error('Для трассировки нужен WebGL 2 с float-текстурами. Выберите быстрый режим.');
    renderer.setSize(options.width, options.height, false);
    const model = createProjectScene(renderer);
    const cameraPair = projection(options.width, options.height);
    const tracer = new WebGLPathTracer(renderer);
    const filter = new DenoiseMaterial({ sigma: 1.4, kSigma: 2, threshold: 0.14 });
    const quad = new FullScreenQuad(filter);
    const still = options.format === 'png';
    tracer.tiles.set(still ? Math.ceil(options.width / 384) : 2, still ? Math.ceil(options.height / 384) : 2);
    tracer.bounces = 5;
    tracer.transmissiveBounces = 8;
    tracer.renderDelay = tracer.minSamples = tracer.fadeDuration = 0;
    tracer.dynamicLowRes = tracer.rasterizeScene = false;
    tracer.textureSize.set(256, 256);
    const studio = new ProceduralEquirectTexture(256, 128);
    studio.generationCallback = (polar, _uv, _coord, color) => {
      const softbox = Math.abs(polar.theta + 1.3) < 0.34 && Math.abs(polar.phi - 1.1) < 0.5;
      const strip = Math.abs(polar.theta - 1.8) < 0.15 && Math.abs(polar.phi - 1.3) < 0.7;
      color.setScalar(softbox ? 6 : strip ? 4 : 0.18);
    };
    studio.update();
    model.scene.environment = studio;
    model.scene.background = options.transparent && options.format !== 'mp4' ? null : new Color(options.color);
    // Video alpha extraction needs a 2D canvas; the GPU canvas owns a WebGL context.
    const canvas = document.createElement('canvas');
    canvas.width = options.width;
    canvas.height = options.height;
    const context = canvas.getContext('2d', { willReadFrequently: still })!;
    return {
      canvas,
      async draw(at: (sample: number) => number) {
        const pose = evaluate(project, at(0));
        model.update(pose);
        const camera = cameraPair[pose.camera.projection];
        camera.position.set(...pose.camera.position);
        camera.lookAt(...pose.camera.target);
        camera.zoom = pose.camera.zoom;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        tracer.setScene(model.scene, camera);
        tracer.reset();
        const count = options.traceSamples ?? 16;
        let last = -1;
        while (tracer.samples < count) {
          signal.throwIfAborted();
          if (renderer.getContext().isContextLost()) throw new Error('GPU остановил рендер. Уменьшите разрешение.');
          tracer.renderSample();
          const sample = Math.floor(tracer.samples);
          if (sample !== last) { progress(sample, renderer.domElement); last = sample; }
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        if (!options.transparent || options.format === 'mp4') {
          filter.map = tracer.target.texture;
          if (still) {
            const tile = 384;
            renderer.setScissorTest(true);
            try {
              for (let y = 0; y < options.height; y += tile) {
                for (let x = 0; x < options.width; x += tile) {
                  signal.throwIfAborted();
                  if (renderer.getContext().isContextLost()) throw new Error('GPU остановился при шумоподавлении PNG. Уменьшите разрешение.');
                  renderer.setScissor(x, y, Math.min(tile, options.width - x), Math.min(tile, options.height - y));
                  quad.render(renderer);
                  await new Promise(resolve => setTimeout(resolve, 0));
                }
              }
            } finally { renderer.setScissorTest(false); }
          } else quad.render(renderer);
        }
        if (renderer.getContext().isContextLost()) throw new Error('GPU остановился перед чтением кадра. Уменьшите разрешение.');
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(renderer.domElement, 0, 0);
      },
      dispose() { quad.dispose(); filter.dispose(); tracer.dispose(); studio.dispose(); model.dispose(); renderer.dispose(); renderer.forceContextLoss(); },
    };
  } catch (error) { renderer.dispose(); renderer.forceContextLoss(); throw error; }
}
