import { useEffect, useRef, useState } from 'react';
import { makeLayer } from '../core/layers';
import type { Layer, Vec2 } from '../core/project';
import type { RasterImage, RasterOptions, RasterResult } from '../geometry/raster';

export async function decodeRaster(file: File) {
  if (file.size > 20 * 1024 * 1024) throw new Error('Изображение превышает 20 МБ. Уменьшите файл и повторите импорт.');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('Не удалось прочитать изображение PNG или JPG.'); });
  try {
    const ratio = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * ratio));
    const height = Math.max(1, Math.round(bitmap.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Не удалось подготовить изображение для просмотра.');
    context.drawImage(bitmap, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    return {
      name: file.name.replace(/\.(png|jpe?g)$/i, ''),
      image: { width, height, data, hasAlpha: data.some((value, index) => index % 4 === 3 && value < 250) },
      small: Math.max(bitmap.width, bitmap.height) < 512,
    };
  } finally {
    bitmap.close();
  }
}

export type RasterSource = Awaited<ReturnType<typeof decodeRaster>>;

const sliders = [
  ['threshold', 'Порог', 0, 254, 1],
  ['smoothing', 'Сглаживание', 0, 3, 1],
  ['simplify', 'Упрощение, px', 0, 5, 0.1],
  ['minArea', 'Мин. площадь, px²', 1, 128, 1],
  ['corner', 'Острые углы, °', 0, 180, 1],
] as const;

function pathString(contour: Vec2[]) {
  return 'M' + contour.map(([x, y]) => x.toFixed(3) + ' ' + (-y).toFixed(3)).join('L') + 'Z';
}

function RasterImagePreview({ image }: { image: RasterImage }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    canvas.current?.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  }, [image]);
  return <canvas ref={canvas} width={image.width} height={image.height} aria-label="Исходное изображение" />;
}

function ReliefPreview({ relief }: { relief: NonNullable<RasterResult['relief']> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    const image = context.createImageData(relief.width, relief.height);
    relief.heights.forEach((height, i) => {
      image.data.fill(Math.round(height * 255), i * 4, i * 4 + 3);
      image.data[i * 4 + 3] = 255;
    });
    context.putImageData(image, 0, 0);
  }, [relief]);
  return <canvas ref={canvas} width={relief.width} height={relief.height} aria-label="Карта высот" />;
}

export function RasterDialog({ source, onCancel, onApply }: {
  source: RasterSource; onCancel: () => void; onApply: (layers: Layer[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [options, setOptions] = useState<RasterOptions>({
    mode: 'silhouette', threshold: source.image.hasAlpha ? 127 : 30, background: '#ffffff',
    smoothing: 1, simplify: 0.8, minArea: 4, colors: 4, corner: 104,
  });
  const [preview, setPreview] = useState<{ options: RasterOptions; result?: RasterResult; error?: string }>();
  const result = preview?.options === options ? preview.result : undefined;
  const error = preview?.options === options ? preview.error : undefined;
  const pending = !result && !error;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let worker: Worker | undefined;
    const timer = window.setTimeout(() => {
      try {
        worker = new Worker(new URL('../workers/raster.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<{ result?: RasterResult; error?: string }>) => {
          setPreview({ options, ...event.data });
          worker?.terminate();
        };
        worker.onerror = () => setPreview({ options, error: 'Не удалось запустить векторизацию. Откройте редактор через Live Server.' });
        worker.postMessage({ image: source.image, options });
      } catch {
        setPreview({ options, error: 'Не удалось запустить векторизацию.' });
      }
    }, 120);
    return () => {
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [source.image, options]);

  function apply() {
    if (result?.relief) {
      onApply([{ ...makeLayer(source.name, [], '#bcbcbc'), relief: result.relief, bevel: 0, depth: 0.9 }]);
    } else if (result?.layers.length) {
      onApply(result.layers.map(({ color, shapes }, index) => ({
        ...makeLayer(result.layers.length === 1 ? source.name : 'Цвет ' + (index + 1), shapes, color),
        bevel: 0.018, position: [0, 0, index * 0.015],
      })));
    }
  }

  return <dialog className="raster-dialog" ref={dialog} aria-labelledby="raster-title" onCancel={onCancel}>
    <div className="dialog-heading">
      <h2 id="raster-title">Импорт изображения</h2>
      <span>{source.name}</span>
    </div>
    <div className="raster-previews">
      <figure><div className="raster-image"><RasterImagePreview image={source.image} /></div><figcaption>Оригинал</figcaption></figure>
      <figure aria-busy={pending}>
        <div className="raster-image">
          {result?.relief && <ReliefPreview relief={result.relief} />}
          {result?.layers.length ? <svg className="vector-preview" viewBox="-2 -2 4 4" role="img" aria-label="Контуры перед экструзией">
            {result.layers.flatMap(({ shapes, color }, i) => shapes.map(({ outer, holes }, j) =>
              <path key={i + ':' + j} d={[outer, ...holes].map(pathString).join(' ')} fill={color} fillRule="evenodd" />))}
          </svg> : null}
          {pending && <span role="status">Подготовка…</span>}
          {result && !result.relief && !result.layers.length && <span>Контуры не найдены</span>}
          {error && <span role="alert">{error}</span>}
        </div>
        <figcaption>{options.mode === 'relief' ? 'Карта высот' : 'Контуры'}</figcaption>
      </figure>
    </div>
    <div className="raster-controls">
      <label className="field"><span>Режим</span><select value={options.mode}
        onChange={(event) => setOptions({ ...options, mode: event.target.value as RasterOptions['mode'] })}>
        <option value="silhouette">Силуэт</option><option value="colors">По цветам</option><option value="relief">Рельеф</option>
      </select></label>
      {!source.image.hasAlpha && options.mode !== 'relief' && <label className="field"><span>Цвет фона</span>
        <input type="color" value={options.background} onChange={(event) => setOptions({ ...options, background: event.target.value })} />
      </label>}
      {options.mode !== 'relief' && sliders.map(([key, label, min, max, step]) => <label className="raster-slider" key={key}>
        <span>{label}</span><input type="range" min={min} max={max} step={step} value={options[key]}
          onChange={(event) => setOptions({ ...options, [key]: event.target.valueAsNumber })} /><output>{options[key]}</output>
      </label>)}
      {options.mode === 'colors' && <label className="raster-slider"><span>Цветов</span>
        <input type="range" min={2} max={8} value={options.colors}
          onChange={(event) => setOptions({ ...options, colors: event.target.valueAsNumber })} /><output>{options.colors}</output>
      </label>}
    </div>
    {source.small && <p className="raster-warning">Размер исходника меньше 512 px. Мелкие детали могут потеряться.</p>}
    <div className="dialog-actions">
      <button className="secondary" onClick={onCancel}>Отмена</button>
      <button className="primary" disabled={!result?.relief && !result?.layers.length} onClick={apply}>{options.mode === 'relief' ? 'Создать рельеф' : 'Выдавить контуры'}</button>
    </div>
  </dialog>;
}
