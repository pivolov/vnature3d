import { traceRaster, type RasterImage, type RasterOptions } from '../geometry/raster';

self.onmessage = (event: MessageEvent<{ image: RasterImage; options: RasterOptions }>) => {
  try {
    self.postMessage({ result: traceRaster(event.data.image, event.data.options) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Не удалось построить контуры.' });
  }
};
