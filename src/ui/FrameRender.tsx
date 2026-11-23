import { useEffect, useRef, useState } from 'react';
import type { Project } from '../core/project';

export function FrameRender({ project, time, ratio, close }: { project: Project; time: number; ratio: number; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const width = Math.max(1, Math.round(1920 * Math.min(1, ratio)));
  const height = Math.max(1, Math.round(1920 / Math.max(1, ratio)));
  useEffect(() => {
    dialog.current?.showModal();
    let cancelled = false;
    let result = '';
    async function render() {
      try {
        const { renderFrames, pngBlob } = await import('../export/renderFrames');
        if (cancelled) return;
        const renderer = renderFrames(project, { format: 'png', width, height, fps: 30, bitrate: 0,
          transparent: false, color: '#666666', supersample: false, motionSamples: 1 });
        try {
          renderer.draw(() => time, 1);
          const blob = await pngBlob(renderer.canvas);
          if (!cancelled) {
            result = URL.createObjectURL(blob);
            setUrl(result);
          }
        } finally { renderer.dispose(); }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Не удалось отрендерить кадр.');
      }
    }
    void render();
    return () => { cancelled = true; if (result) URL.revokeObjectURL(result); };
  }, [project, time, width, height]);
  return <dialog ref={dialog} className="raster-dialog frame-render" aria-label="Рендер кадра" onCancel={close}>
    <div className="dialog-heading"><h2>Рендер кадра</h2><button onClick={close}>Закрыть</button></div>
    {url ? <><img src={url} alt="Готовый кадр с текущей камеры" />
      <div className="dialog-actions"><span>{width} × {height} · {time.toFixed(2)} с</span>
      <a download={project.name + '-frame.png'} href={url}>Скачать PNG</a></div></>
      : <p role={error ? 'alert' : 'status'}>{error || 'Рендерим кадр…'}</p>}
  </dialog>;
}
