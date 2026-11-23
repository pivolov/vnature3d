import { WebGLRenderer, type WebGLRendererParameters } from 'three';

export class WebGLUnavailable extends Error {
  constructor() {
    super('Браузер не смог запустить WebGL 2. Сохраните проект, закройте другие 3D-вкладки и перезапустите браузер с аппаратным ускорением. Экспорт сцены в Blender доступен.');
  }
}

export function createWebGLRenderer(parameters: WebGLRendererParameters) {
  try {
    return new WebGLRenderer(parameters);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('WebGL context')) throw error;
    throw new WebGLUnavailable();
  }
}
