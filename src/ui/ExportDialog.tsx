import { Download, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { defaultTimeline } from '../animation/timeline';
import type { Project } from '../core/project';
import { checkExport, formats, framePlan, type ExportConfig, type ExportFormat } from '../export/config';
import { canSaveDirectly, outputFile, type OutputFile } from '../export/output';

const resolution = { '720p': 720, '1080p': 1080, '1440p': 1440, '4K': 2160 } as const;
const aspect = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5], '9:19.5': [9, 19.5] } as const;
type Size = keyof typeof resolution | 'custom';
type Ratio = keyof typeof aspect;
const quality = { draft: 4, good: 10, max: 25 } as const;
const even = (n: number) => Math.min(4096, Math.round(n / 2) * 2);

function dimensions(size: keyof typeof resolution, ratio: Ratio) {
  const [w, h] = aspect[ratio];
  const unit = Math.min(resolution[size] / Math.min(w, h), 4096 / Math.max(w, h));
  return { width: even(unit * w), height: even(unit * h) };
}
const textSize = (bytes: number) => new Intl.NumberFormat('ru', { maximumFractionDigits: 1 }).format(bytes / 1_000_000) + ' МБ';

export function ExportDialog({ project, time, close, lottie, graphicsAvailable, renderRatio }: { project: Project; time: number; close: () => void; lottie: () => void; graphicsAvailable: boolean; renderRatio?: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const job = useRef<AbortController | null>(null);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const progressClock = useRef(0);
  const [size, setSize] = useState<Size>(renderRatio ? 'custom' : '1080p');
  const [ratio, setRatio] = useState<Ratio>('16:9');
  const [rate, setRate] = useState<keyof typeof quality | 'custom'>('good');
  const [direct, setDirect] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  useEffect(() => () => { if (result) URL.revokeObjectURL(result); }, [result]);
  const [finished, setFinished] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 1, detail: '', eta: 0 });
  const [config, set] = useState<ExportConfig>({
    format: renderRatio ? 'png' : 'mp4', traceSamples: renderRatio ? 32 : 0,
    width: renderRatio ? Math.max(16, even(1280 * Math.min(1, renderRatio))) : 1920,
    height: renderRatio ? Math.max(16, even(1280 / Math.max(1, renderRatio))) : 1080, fps: (project.timeline ?? defaultTimeline).fps,
    bitrate: 10_000_000, transparent: !renderRatio, color: '#666666', supersample: false, motionSamples: 1,
  });
  const plan = framePlan(project, config, time);
  const issue = graphicsAvailable ? checkExport(config) : 'Для экспорта видео и PNG нужен WebGL 2. Lottie доступен во вкладке рядом.';
  const video = config.format === 'mp4' || config.format === 'webm';
  const estimate = video ? config.bitrate / 8 * plan.duration * (config.transparent && config.format === 'webm' ? 1.27 : 1) : null;

  useEffect(() => {
    dialog.current?.showModal();
    return () => job.current?.abort();
  }, []);

  function update(patch: Partial<ExportConfig>) {
    set((current) => ({ ...current, ...patch }));
    setError('');
    setFinished(false);
    setResult('');
  }
  async function start() {
    if (issue || job.current) return;
    const controller = new AbortController();
    job.current = controller;
    const signal = controller.signal;
    let file: OutputFile | undefined;
    setError('');
    setRunning(true);
    setFinished(false);
    setResult('');
    setProgress({ done: 0, total: plan.frames, detail: 'Подготовка сцены…', eta: 0 });
    progressClock.current = 0;
    try {
      file = await outputFile(project.name, config.format, direct, renderRatio && config.format !== 'sequence' ? blob => setResult(URL.createObjectURL(blob)) : undefined);
      signal.throwIfAborted();
      const { exportScene } = await import('../export/encode');
      const started = performance.now();
      await exportScene(project, config, time, file, signal, (done, total, detail) => {
        const now = performance.now();
        if (done > 0 && done < total && now - progressClock.current < 80) return;
        progressClock.current = now;
        setProgress({ done, total, detail, eta: done > 2 ? (now - started) / done * (total - done) / 1000 : 0 });
      }, source => {
        const surface = previewCanvas.current;
        if (surface) surface.getContext('2d')?.drawImage(source, 0, 0, surface.width, surface.height);
      });
      setFinished(true);
    } catch (cause) {
      await file?.abort();
      if (signal.aborted) setError('Экспорт отменён.');
      else if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError(cause instanceof Error ? cause.message : 'Не удалось завершить экспорт.');
      }
    } finally {
      job.current = null;
      setRunning(false);
    }
  }
  function dismiss() {
    if (job.current) job.current.abort();
    else close();
  }

  return <dialog className="export-dialog" ref={dialog} aria-labelledby="export-title" onCancel={(event) => { event.preventDefault(); dismiss(); }}>
    <header className="export-heading"><div>
      <h2 id="export-title">{renderRatio ? 'Рендер сцены' : 'Экспорт сцены'}</h2><p title={project.name}>{project.name}</p>
    </div><button className="icon-button" aria-label="Закрыть экспорт" onClick={dismiss}><X size={18} /></button></header>
    <div className="lottie-mode-tabs"><button className="text-button" aria-pressed="true">Видео и PNG</button>
      <button className="text-button" disabled={running} onClick={lottie}>Lottie</button></div>
    <fieldset disabled={running} className="export-controls">
      <div className="export-formats" aria-label="Формат экспорта">
        {(Object.keys(formats) as ExportFormat[]).map((format) => <button key={format} type="button" aria-pressed={format === config.format}
          onClick={() => update({ format })}>{formats[format].label}</button>)}
      </div>
      <div className="export-settings">
        <label><span>Движок</span><select value={config.traceSamples || 0} onChange={event => update({ traceSamples: Number(event.target.value), motionSamples: 1, supersample: false })}>
          <option value={0}>Быстрый · WebGL</option><option value={8}>Трассировка · 8 сэмплов</option><option value={32}>Трассировка · 32 сэмпла</option><option value={128}>Трассировка · 128 сэмплов</option>
        </select></label>
        <label><span>Разрешение</span><select value={size} onChange={(event) => {
          const next = event.currentTarget.value as Size;
          setSize(next);
          if (next !== 'custom') update(dimensions(next, ratio));
        }}>
          {Object.keys(resolution).map((entry) => <option key={entry}>{entry}</option>)}<option value="custom">Своё</option>
        </select></label>
        <label><span>Пропорции</span><select value={ratio} disabled={size === 'custom'} onChange={(event) => {
          const next = event.currentTarget.value as Ratio;
          setRatio(next);
          if (size !== 'custom') update(dimensions(size, next));
        }}>
          {Object.keys(aspect).map((entry) => <option key={entry}>{entry}</option>)}
        </select></label>
        <label><span>Ширина</span><input type="number" min={16} max={4096} value={config.width || ''}
          onChange={(event) => { setSize('custom'); update({ width: Number(event.currentTarget.value) }); }} /></label>
        <label><span>Высота</span><input type="number" min={16} max={4096} value={config.height || ''}
          onChange={(event) => { setSize('custom'); update({ height: Number(event.currentTarget.value) }); }} /></label>
        {config.format !== 'png' && <label><span>Кадров в секунду</span><select value={config.fps}
          onChange={(event) => update({ fps: Number(event.currentTarget.value) as ExportConfig['fps'] })}>
          <option>24</option><option>30</option><option>60</option>
        </select></label>}
        {!config.traceSamples && config.format !== 'png' && <label><span>Сэмплы движения</span><select value={config.motionSamples}
          onChange={(event) => update({ motionSamples: Number(event.currentTarget.value) as ExportConfig['motionSamples'] })}>
          <option value={1}>Без размытия</option><option value={2}>2 сэмпла</option><option value={4}>4 сэмпла</option><option value={8}>8 сэмплов</option>
        </select></label>}
        {video && <>
          <label><span>Качество видео</span><select value={rate} onChange={(event) => {
            const next = event.currentTarget.value as typeof rate;
            setRate(next);
            if (next !== 'custom') update({ bitrate: quality[next] * 1_000_000 });
          }}><option value="draft">Черновик</option><option value="good">Хорошее</option><option value="max">Максимум</option><option value="custom">Своё</option></select></label>
          <label><span>Мбит/с</span><input type="number" min={0.1} max={100} step={0.1}
            value={config.bitrate / 1_000_000 || ''} onChange={(event) => {
              setRate('custom'); update({ bitrate: Math.round(Number(event.currentTarget.value) * 1_000_000) });
            }} /></label>
        </>}
      </div>
      <div className="export-switches">
        <label><input type="checkbox" disabled={!!config.traceSamples} checked={config.supersample} onChange={(event) => update({ supersample: event.currentTarget.checked })} /> Сглаживание ×2</label>
        {config.format !== 'mp4' && <label><input type="checkbox" checked={config.transparent}
          onChange={(event) => update({ transparent: event.currentTarget.checked })} /> Прозрачный фон</label>}
        {(config.format === 'mp4' || !config.transparent) && <label>Фон <input type="color" value={config.color}
          onChange={(event) => update({ color: event.currentTarget.value })} /></label>}
        {canSaveDirectly() && <label><input type="checkbox" checked={direct} onChange={(event) => setDirect(event.currentTarget.checked)} /> Записать сразу на диск</label>}
      </div>
    </fieldset>
    <div className="export-meta">
      {config.format === 'mp4' && <p>MP4 использует выбранный фон. Для прозрачности выберите WebM или PNG.</p>}
      {config.format === 'webm' && config.transparent && <p>Прозрачность кодируется отдельной плоскостью VP9. Проверяйте воспроизведение в целевом приложении.</p>}
      <p>{config.width || '—'} × {config.height || '—'} px · {config.format === 'png' ? 'кадр на ' + time.toFixed(2) + ' с' :
        plan.frames + ' кадров · ' + plan.duration.toFixed(2) + ' с'}{estimate !== null ? ' · ≈ ' + textSize(estimate) : ''}</p>
      {running && <div className="export-progress" role="status">
        {!!config.traceSamples && <canvas ref={previewCanvas} width={320} height={Math.max(1, Math.min(640, Math.round(320 * config.height / config.width)))} style={{ width: '100%', maxHeight: '30vh', objectFit: 'contain' }} />}
        <progress max={progress.total} value={progress.done} aria-label="Ход экспорта" />
        <span>{progress.detail} · {progress.done}/{progress.total}{progress.eta > 1 ? ' · осталось ≈ ' + Math.ceil(progress.eta) + ' с' : ''}</span>
      </div>}
      {(issue || error) && <p className="export-error" role="alert">{issue || error}</p>}
      {result && <div>{video ? <video controls src={result} style={{ width: '100%' }} /> : <img src={result} alt="Готовый кадр" style={{ width: '100%' }} />}
        <a href={result} download={project.name + '.' + formats[config.format].extension}>Сохранить {formats[config.format].label}</a></div>}
      {finished && <p className="export-success" role="status">Файл готов.</p>}
    </div>
    <footer className="export-actions">
      <button className="secondary" type="button" onClick={dismiss}>{running ? 'Отменить экспорт' : 'Закрыть'}</button>
      <button className="primary" type="button" disabled={running || !!issue} onClick={() => void start()}><Download size={16} /> {renderRatio ? 'Начать рендер' : 'Экспортировать'}</button>
    </footer>
  </dialog>;
}
