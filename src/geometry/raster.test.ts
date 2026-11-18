import { expect, it } from 'vitest';
import { traceRaster, type RasterImage, type RasterOptions } from './raster';

const options: RasterOptions = { mode: 'silhouette', threshold: 120, background: '#ffffff',
  smoothing: 1, simplify: 0.5, minArea: 2, colors: 2, corner: 105 };

function image(width: number, height: number, hasAlpha: boolean, rgba: (x: number, y: number) => number[]): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(rgba(x, y), (y * width + x) * 4);
  }
  return { width, height, data, hasAlpha };
}

it('traces a transparent hole and normalizes its centered ring', () => {
  const raster = image(24, 24, true, (x, y) => {
    const r = Math.hypot(x - 11.5, y - 11.5);
    return [50, 100, 150, r > 4 && r < 10 ? 255 : 0];
  });
  const { layers } = traceRaster(raster, options);
  expect(layers).toHaveLength(1);
  expect(layers[0].color).toBe('#326496');
  expect(layers[0].shapes).toHaveLength(1);
  expect(layers[0].shapes[0].holes).toHaveLength(1);
});

it('removes opaque background and keeps distinct color layers', () => {
  const raster = image(30, 12, false, (x, y) => {
    if (y < 2 || y > 9 || x < 2 || x > 27) return [255, 255, 255, 255];
    return x < 15 ? [210, 56, 40, 255] : [30, 65, 220, 255];
  });
  const { layers } = traceRaster(raster, { ...options, mode: 'colors', threshold: 25 });
  expect(layers.map(({ color }) => color).sort()).toEqual(['#1e41dc', '#d23828']);
});

it('converts brightness and alpha to normalized heights', () => {
  const raster = image(3, 1, true, (x) => x === 0 ? [0, 0, 0, 255] : [255, 255, 255, x === 1 ? 255 : 128]);
  const { relief } = traceRaster(raster, { ...options, mode: 'relief' });
  expect(relief?.width).toBe(3);
  expect(relief?.heights[0]).toBe(0);
  expect(relief?.heights[1]).toBeCloseTo(1);
  expect(relief?.heights[2]).toBeCloseTo(128 / 255);
});
