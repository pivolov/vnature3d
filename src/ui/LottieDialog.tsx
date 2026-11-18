import { Download, FileCode2, Pause, Play, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AnimationItem } from 'lottie-web/build/player/lottie_light';
import { defaultTimeline, positionAt } from '../animation/timeline';
import type { Project } from '../core/project';
import { modeLabels, type LottieOptions, type LottieOutput } from '../export/lottie/model';
import { renderFrames } from '../export/renderFrames';
import { downloadLottie, snippets } from '../export/lottie/download';

type WorkerMessage = { error?: string; result?: LottieOutput; progress?: { done: number; total: number } };
type Output = { result: LottieOutput; options: LottieOptions };

function Comparison({ project, output, initial }: { project: Project; output: Output; initial: number }) {
  const { options, result } = output;
  const [playing, setPlaying] = useState(false);
  const [difference, setDifference] = useState(false);
  const [frame, setFrame] = useState(Math.min(result.frames - 1, Math.round(initial * options.fps)));
  const [message, setMessage] = useState('Проверка плеера…');
  const [ready, setReady] = useState(0);
  const source = useRef<HTMLDivElement>(null);
  const target = useRef<HTMLDivElement>(null);
  const animation = useRef<AnimationItem | null>(null);
  const renderer = useRef<ReturnType<typeof renderFrames> | null>(null);
  const current = useRef(frame);

  useEffect(() => {
    let active = true;
    import('lottie-web/build/player/lottie_light').then(({ default: player }) => {
      if (!active || !target.current) return;
      const animator = player.loadAnimation({ container: target.current, renderer: 'svg', autoplay: false,
        loop: false, animationData: JSON.parse(result.json) });
      animation.current = animator;
      animator.addEventListener('DOMLoaded', () => {
        if (active) { setMessage('Плеер загрузил JSON'); setReady((value) => value + 1); }
      });
      animator.addEventListener('data_failed', () => {
        if (active) setMessage('Плеер не смог прочитать JSON.');
      });
    }).catch(() => { if (active) setMessage('Не удалось загрузить предпросмотр Lottie.'); });
    if (source.current) {
      const factor = Math.min(1, 360 / Math.max(options.width, options.height));
      try {
        renderer.current = renderFrames(project, {
          format: 'png', width: Math.max(16, Math.round(options.width * factor)), height: Math.max(16, Math.round(options.height * factor)),
          fps: options.fps, transparent: true, color: '#000000', bitrate: 1e6, supersample: false, motionSamples: 1,
        });
        source.current.append(renderer.current.canvas);
        setReady((value) => value + 1);
      } catch {
        source.current.textContent = '3D-превью недоступно';
      }
    }
    return () => {
      active = false;
      animation.current?.destroy();
      renderer.current?.canvas.remove();
      renderer.current?.dispose();
      animation.current = null;
      renderer.current = null;
    };
  }, [project, options, result.json]);

  useEffect(() => {
    const timeline = project.timeline ?? defaultTimeline;
    const time = positionAt(frame / options.fps, timeline.duration, timeline.loop === 'ping-pong' ? 'ping-pong' : 'once');
    try { renderer.current?.draw(() => time, 1); } catch { /* The offline export remains available. */ }
    animation.current?.goToAndStop(frame, true);
    current.current = frame;
  }, [frame, options.fps, project.timeline, ready]);

  useEffect(() => {
    if (!playing) return;
    const base = current.current;
    const start = performance.now();
    let request = 0;
    function tick(now: number) {
      setFrame((base + Math.floor((now - start) * options.fps / 1000)) % result.frames);
      request = requestAnimationFrame(tick);
    }
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [playing, options.fps, result.frames]);

  return <section className="lottie-comparison-section" aria-label="Сравнение 3D и Lottie">
    <div className="lottie-comparison" data-overlay={difference ? 'difference' : undefined}>
      <figure><div ref={source} className="lottie-preview-pane" /><figcaption>3D-сцена</figcaption></figure>
      <figure><div ref={target} className="lottie-preview-pane" /><figcaption>{difference ? 'Разница' : 'Lottie'}</figcaption></figure>
    </div>
    <div className="lottie-transport">
      <button className="secondary" aria-label={playing ? 'Пауза сравнения' : 'Проиграть сравнение'} onClick={() => setPlaying(!playing)}>
        {playing ? <Pause size={14} /> : <Play size={14} />}</button>
      <input type="range" aria-label="Кадр сравнения" min={0} max={result.frames - 1} value={frame}
        onChange={(event) => { setPlaying(false); setFrame(event.currentTarget.valueAsNumber); }} />
      <label><input type="checkbox" checked={difference} onChange={(event) => setDifference(event.currentTarget.checked)} /> Разница</label>
      <span>{message}</span>
    </div>
  </section>;
}

export function LottieDialog({ project, time, close, video }: {
  project: Project; time: number; close: () => void; video: () => void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const worker = useRef<Worker | null>(null);
  const [options, setOptions] = useState<LottieOptions>({ width: 512, height: 512, fps: (project.timeline ?? defaultTimeline).fps, step: 2, tolerance: 1.25 });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 1 });
  const [output, setOutput] = useState<Output>();
  const [snippet, setSnippet] = useState<keyof typeof snippets>('SwiftUI');
  const [copied, setCopied] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    modal.current?.showModal();
    return () => worker.current?.terminate();
  }, []);

  function generate(settings = options) {
    setProgress({ done: 0, total: 1 }); setError(''); setWorking(true);
    worker.current?.terminate();
    let job: Worker;
    try { job = new Worker(new URL('../workers/lottie.worker.ts', import.meta.url), { type: 'module' }); }
    catch { setError('В этой среде недоступен обработчик Lottie. Запустите редактор через Live Server.'); setWorking(false); return; }
    worker.current = job;
    function end() { job.terminate(); worker.current = null; setWorking(false); }
    job.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
      if (data.progress) setProgress(data.progress);
      if (data.error) { setError(data.error); end(); }
      if (data.result) {
        setOutput({ result: data.result, options: settings });
        setRevision((value) => value + 1); end();
      }
    };
    job.onerror = () => { setError('Не удалось запустить обработку Lottie. Откройте редактор через Live Server.'); end(); };
    job.postMessage({ project, options: settings });
  }
  function stop() {
    worker.current?.terminate(); worker.current = null;
    setWorking(false);
  }
  function patch(values: Partial<LottieOptions>) { setOptions({ ...options, ...values }); setOutput(undefined); setError(''); }
  const metadata = output?.result;

  return <dialog className="export-dialog lottie-dialog" ref={modal} aria-labelledby="lottie-title"
    onCancel={(event) => { event.preventDefault(); if (working) stop(); else close(); }}>
    <header className="export-heading"><div><h2 id="lottie-title">Экспорт Lottie</h2><p title={project.name}>{project.name}</p></div>
      <button className="icon-button" onClick={close} aria-label="Закрыть экспорт"><X size={18} /></button></header>
    <div className="lottie-body">
      <div className="lottie-mode-tabs"><button className="text-button" onClick={video}>Видео и PNG</button>
        <button className="text-button" aria-pressed="true">Lottie</button></div>
      <fieldset className="lottie-options" disabled={working}>
        {([['width', 'Ширина', 64, 1920, 1], ['height', 'Высота', 64, 1920, 1], ['step', 'Шаг кадров', 1, 60, 1],
          ['tolerance', 'Допуск, px', 0.1, 10, 0.25]] as const).map(([field, label, min, max, step]) =>
          <label key={field}>{label}<input type="number" min={min} max={max} step={step} value={options[field] || ''}
            onChange={(event) => patch({ [field]: Number(event.currentTarget.value) })} /></label>)}
        <label>FPS<select value={options.fps} onChange={(event) => patch({ fps: Number(event.currentTarget.value) as LottieOptions['fps'] })}>
          <option>24</option><option>30</option><option>60</option></select></label>
      </fieldset>
      {working && <div className="export-progress" role="status">
        <progress max={progress.total} value={progress.done} aria-label="Подготовка Lottie" /><span>Подготовка сцен · {progress.done}/{progress.total}</span>
      </div>}
      {error && <p className="lottie-warning" role="alert">{error}</p>}
      {output && metadata && <>
        <div className="lottie-report">
          <strong>{modeLabels[metadata.mode]}</strong>
          <span>{Math.round(metadata.bytes / 1000)} КБ · {metadata.layers} сл. · {metadata.keys} ключ. · {metadata.duration.toFixed(2)} с</span>
        </div>
        <Comparison key={revision} project={project} output={output} initial={time} />
        {metadata.warnings.map((warning) => <p className="lottie-warning" key={warning}>{warning}</p>)}
        <details className="lottie-snippets">
          <summary><FileCode2 size={15} /> Интеграция в приложение</summary>
          <p>Добавьте <code>animation.json</code> в ресурсы приложения. Для Android используйте <code>res/raw</code>.</p>
          <div><select aria-label="Платформа" value={snippet} onChange={(event) => {
            setSnippet(event.currentTarget.value as keyof typeof snippets); setCopied(false);
          }}>{Object.keys(snippets).map((name) => <option key={name}>{name}</option>)}</select>
          <button className="secondary" onClick={() => {
            void navigator.clipboard?.writeText(snippets[snippet]).then(() => setCopied(true), () => setCopied(false));
          }}>{copied ? 'Скопировано' : 'Копировать'}</button></div>
          <pre tabIndex={0}>{snippets[snippet]}</pre>
        </details>
      </>}
    </div>
    <footer className="export-actions lottie-actions">
      {working ? <button className="secondary" onClick={stop}>Отменить</button> : <>
        {output && <>
          <button className="secondary" disabled={options.step >= 60 && options.tolerance >= 10} onClick={() => {
            const stronger = { ...options, step: Math.min(60, Math.max(options.step + 1, (output.result.step ?? 1) + 1)),
              tolerance: Math.min(10, options.tolerance * 1.55) };
            setOptions(stronger); generate(stronger);
          }}>Сжать сильнее</button>
          <button className="secondary" onClick={() => downloadLottie(output.result, 'report', output.options.width, output.options.height, output.options.fps)}>Отчёт</button>
          <button className="secondary" onClick={() => downloadLottie(output.result, 'lottie', output.options.width, output.options.height, output.options.fps)}>.lottie</button>
          <button className="primary" onClick={() => downloadLottie(output.result, 'json', output.options.width, output.options.height, output.options.fps)}>
            <Download size={16} /> JSON</button>
        </>}
        {!output && <button className="primary" onClick={() => generate()}>Построить Lottie</button>}
      </>}
    </footer>
  </dialog>;
}
