import { ChevronLeft, ChevronRight, CirclePlus, Copy, Diamond, Gauge, Pause, Play, SkipBack, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { staggerRanks, type PresetOptions } from '../animation/presets';
import { ease, families, type Easing } from '../animation/easing';
import {
  baseValue, cameraFields, cameraId, changeKeys, defaultTimeline, frameTime, isSeamless, layerFields,
  putKey, resizeTimeline, sampleTrack, type Key, type Property, type TimelineData, type Track, type Value,
} from '../animation/timeline';
import type { Project, Vec3 } from '../core/project';

type Props = {
  project: Project; target: string | null; layerName?: string; disabled: boolean;
  time: number; seek: (value: number) => void;
  play: number; setPlay: (speed: number) => void;
  autoKey: boolean; setAutoKey: (value: boolean) => void;
  update: (change: (timeline: TimelineData) => TimelineData) => void;
};

const directionLabels = { in: 'Вход', out: 'Выход', 'in-out': 'Вход–выход' };
const nameOf = (property: Property) => property in layerFields ? layerFields[property as keyof typeof layerFields] : cameraFields[property as keyof typeof cameraFields];
const linear: Easing = { kind: 'linear' };
const sameTime = (a: number, b: number) => Math.abs(a - b) < 1e-6;

function EditValue({ value, property, onChange }: { value: Value; property: Property; onChange: (value: Value) => void }) {
  if (typeof value === 'string') return <label className="timeline-field">Цвет <input type="color" key={value} defaultValue={value}
    onBlur={(event) => onChange(event.currentTarget.value)} /></label>;
  const angle = property === 'rotation' || property === 'shine';
  return (Array.isArray(value) ? value : [value]).map((raw, index) => {
    const shown = angle ? raw * 180 / Math.PI : raw;
    const label = Array.isArray(value) ? ['X', 'Y', 'Z'][index] : 'Значение';
    return <label className="timeline-field" key={label + raw}>{label}<input type="number" step="any" defaultValue={Number(shown.toFixed(4))}
      onBlur={(event) => {
        const next = event.currentTarget.valueAsNumber;
        if (!Number.isFinite(next) || Math.abs(next - shown) < 0.00005) return;
        const converted = angle ? next * Math.PI / 180 : next;
        if (Array.isArray(value)) {
          const tuple: Vec3 = [...value];
          tuple[index] = converted;
          onChange(tuple);
        } else onChange(converted);
      }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>;
  });
}

function Curve({ track, keyframe, update }: { track?: Track; keyframe?: Key; update: (next: Key) => void }) {
  const [axis, setAxis] = useState(0);
  const drag = useRef<'first' | 'second' | null>(null);
  const [draft, setDraft] = useState<Easing | null>(null);
  const yScale = useRef({ low: 0, span: 1 });
  const easing = draft ?? keyframe?.easing;
  if (!track || !keyframe || !easing) return <p className="timeline-help">Выберите ключ, чтобы настроить его кривую.</p>;
  const scalar = (value: Value) => typeof value === 'number' ? value : Array.isArray(value) ? value[axis] : parseInt(value.slice(1), 16);
  const keyIndex = track.keys.indexOf(keyframe);
  const nextKey = track.keys[keyIndex + 1] ?? keyframe;
  const a = scalar(keyframe.value);
  const b = scalar(nextKey.value);
  const samples = Array.from({ length: 49 }, (_, i) => a + (b - a) * ease(i / 48, easing));
  const low = Math.min(a, b, ...samples);
  const high = Math.max(a, b, ...samples);
  const span = Math.max(0.00001, high - low);
  const point = (x: number, y: number): [number, number] => [14 + x * 210, high === low ? 43 : 68 - (y - low) * 51 / span];
  const points = samples.map((value, i) => point(i / 48, value).join(',')).join(' ');
  const handles = easing.kind === 'bezier' && Math.abs(b - a) > 0.00001 ? [
    point(easing.x1, a + (b - a) * easing.y1), point(easing.x2, a + (b - a) * easing.y2),
  ] : null;
  const onlyVector = Array.isArray(keyframe.value);
  return <div className="curve-editor">
    <svg viewBox="0 0 240 82" aria-label="График значений" role="img"
      onPointerMove={(event) => {
        if (!drag.current || easing.kind !== 'bezier') return;
        const resolved = event.currentTarget.createSVGPoint();
        resolved.x = event.clientX;
        resolved.y = event.clientY;
        const matrix = event.currentTarget.getScreenCTM();
        if (!matrix) return;
        const p = resolved.matrixTransform(matrix.inverse());
        const x = Math.min(1, Math.max(0, (p.x - 14) / 210));
        const y = Math.min(4, Math.max(-4, ((68 - p.y) * yScale.current.span / 51 + yScale.current.low - a) / (b - a)));
        setDraft(drag.current === 'first' ? { ...easing, x1: x, y1: y } : { ...easing, x2: x, y2: y });
      }}
      onPointerUp={() => {
        if (drag.current && draft) update({ ...keyframe, easing: draft });
        drag.current = null; setDraft(null);
      }}
      onPointerCancel={() => { drag.current = null; setDraft(null); }}>
      <path d="M14 15V68H224 M14 42H224 M84 15V68 M154 15V68" className="curve-grid" />
      <polyline points={points} className="curve-line" />
      {handles?.map(([x, y], index) => {
        const [ex, ey] = point(index, index ? b : a);
        return <g key={index}>
          <line x1={ex} y1={ey} x2={x} y2={y} className="curve-handle" />
          <circle cx={x} cy={y} r="5" className="curve-knob" onPointerDown={(event) => {
            drag.current = index ? 'second' : 'first';
            yScale.current = { low, span };
            event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
          }} />
        </g>;
      })}
    </svg>
    {onlyVector && <select aria-label="Ось графика" value={axis} onChange={(event) => setAxis(Number(event.currentTarget.value))}>
      <option value={0}>X</option><option value={1}>Y</option><option value={2}>Z</option>
    </select>}
  </div>;
}

export function Timeline({ project, target, layerName, disabled, time, seek, play, setPlay, autoKey, setAutoKey, update }: Props) {
  const data = project.timeline ?? defaultTimeline;
  const [chosen, setChosen] = useState<Property>('position');
  const [focus, setFocus] = useState<{ target: string; property: Property; time: number }>();
  const [snap, setSnap] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [origin, setOrigin] = useState(0);
  const [page, setPage] = useState(0);
  const [stagger, setStagger] = useState(0);
  const [staggerOrder, setStaggerOrder] = useState<PresetOptions['order']>('forward');
  const [mode, setMode] = useState<'keys' | 'curve' | 'scene'>('keys');
  const clip = useRef<{ property: Property; key: Key } | undefined>(undefined);
  const gesture = useRef<{ pointer: number; source: number; property: Property; start: number; width: number } | undefined>(undefined);
  const skipClick = useRef(false);
  const [dragTime, setDragTime] = useState<number | null>(null);
  const span = data.duration / zoom;
  const start = Math.min(origin, data.duration - span);
  const fields = Object.keys(target === cameraId ? cameraFields : layerFields) as Property[];
  const property = fields.includes(chosen) ? chosen : 'position';
  const tracks = data.tracks.filter((track) => track.target === target);
  const shown = [...new Set([property, ...tracks.map((track) => track.property)])];
  const pageCount = Math.ceil(shown.length / 3);
  const currentPage = Math.min(pageCount - 1, page);
  const visible = shown.slice(currentPage * 3, (currentPage + 1) * 3);
  const track = tracks.find((item) => item.property === property);
  const keyframe = focus?.target === target && focus?.property === property ? track?.keys.find((key) => sameTime(key.time, focus.time)) : undefined;

  function setKey(next: Key, field = property) {
    if (!target || disabled) return;
    update((timeline) => putKey(timeline, target, field, next));
    setFocus({ target, property: field, time: next.time });
  }
  function addKey(at = time, field = property) {
    if (!target || disabled) return;
    const current = tracks.find((item) => item.property === field);
    const exact = frameTime(at, data, snap);
    const value = (current && sampleTrack(current, exact)) ?? baseValue(project, target, field);
    if (value === undefined) return;
    setChosen(field);
    setKey({ time: exact, value, easing: current?.keys.find((key) => sameTime(key.time, exact))?.easing ?? linear }, field);
  }
  function remove() {
    if (!target || !keyframe || disabled) return;
    update((timeline) => changeKeys(timeline, target, property, (keys) => keys.filter((key) => !sameTime(key.time, keyframe.time))));
    setFocus(undefined);
  }
  function copy() {
    if (keyframe) clip.current = { property, key: keyframe };
  }
  function paste() {
    if (!clip.current || !fields.includes(clip.current.property)) return;
    const to = frameTime(time, data, snap);
    setChosen(clip.current.property);
    setKey({ ...clip.current.key, time: to }, clip.current.property);
  }

  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      if (document.querySelector('dialog[open]') || (event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, select, [contenteditable]'))) return;
      const command = event.ctrlKey || event.metaKey;
      if (command) {
        if (event.code === 'KeyC' && keyframe) { event.preventDefault(); copy(); }
        if (event.code === 'KeyV' && clip.current) { event.preventDefault(); paste(); }
        return;
      }
      if (event.altKey) return;
      if (event.code === 'Space' && !(event.target instanceof HTMLElement && event.target.closest('button'))) {
        event.preventDefault(); setPlay(play ? 0 : 1);
      } else if (event.code === 'KeyJ') setPlay(-1);
      else if (event.code === 'KeyK') setPlay(0);
      else if (event.code === 'KeyL') setPlay(1);
      else if (event.code === 'KeyI') addKey();
      else if (event.code === 'Delete' || event.code === 'Backspace') { if (keyframe) { event.preventDefault(); remove(); } }
      else if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        event.preventDefault();
        setPlay(0);
        seek(frameTime(time + (event.code === 'ArrowLeft' ? -1 : 1) / data.fps, data, true));
      }
    }
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  });

  function seekPointer(event: PointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    seek(frameTime(start + span * Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), data, snap));
  }
  function moveKey(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    const next = frameTime(current.source + (event.clientX - current.start) / current.width * span, data, snap);
    setDragTime(next);
    seek(next);
  }
  function dropKey(event: PointerEvent<HTMLButtonElement>, key: Key) {
    const current = gesture.current;
    if (!target || !current || current.pointer !== event.pointerId) return;
    const next = frameTime(current.source + (event.clientX - current.start) / current.width * span, data, snap);
    if (!sameTime(next, current.source)) {
      skipClick.current = true;
      update((timeline) => putKey(changeKeys(timeline, target, current.property, (keys) => keys.filter((item) =>
        !sameTime(item.time, current.source))), target, current.property, { ...key, time: next }));
      setFocus({ target, property: current.property, time: next });
    }
    gesture.current = undefined;
    setDragTime(null);
  }
  const cursor = (time - start) / span * 100;
  const marks = Array.from({ length: 7 }, (_, i) => start + span * i / 6);

  return <section className="timeline" aria-label="Таймлайн">
    <div className="timeline-bar">
      <h2>Таймлайн</h2><span className="timeline-target" title={layerName}>{layerName || 'Выберите слой'}</span>
      <div className="transport">
        <button type="button" className="icon-button" title="К началу" aria-label="К началу" onClick={() => { setPlay(0); seek(0); }}><SkipBack size={15} /></button>
        <button type="button" className="icon-button play-button" aria-label={play ? 'Пауза' : 'Воспроизвести'} onClick={() => setPlay(play ? 0 : 1)}>
          {play ? <Pause size={16} /> : <Play size={16} />}</button>
        <output aria-label="Время" className="timecode">{time.toFixed(2)} с</output>
      </div>
      <div className="timeline-modes" aria-label="Настройки таймлайна">
        <button type="button" aria-pressed={mode === 'keys'} onClick={() => setMode('keys')}>Ключи</button>
        <button type="button" aria-pressed={mode === 'curve'} onClick={() => setMode('curve')}>Кривые</button>
        <button type="button" aria-pressed={mode === 'scene'} onClick={() => setMode('scene')}>Сцена</button>
      </div>
    </div>
    <div className="timeline-body">
      <div className="timeline-tracks">
        <div className="track-select">
          <select aria-label="Свойство дорожки" value={property} onChange={(event) => { setChosen(event.currentTarget.value as Property); setPage(0); }} disabled={!target}>
            {fields.map((field) => <option key={field} value={field}>{nameOf(field)}</option>)}
          </select>
          <button className="icon-button" title="Добавить ключ (I)" aria-label="Добавить ключ" disabled={disabled || !target} onClick={() => addKey()}><CirclePlus size={16} /></button>
        </div>
        <div className="time-ruler" aria-label="Линейка времени" onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId); setPlay(0); seekPointer(event);
        }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seekPointer(event); }}>
          {marks.map((mark) => <span key={mark}>{mark.toFixed(span < 1 ? 2 : 1)}</span>)}
          {cursor >= 0 && cursor <= 100 && <i style={{ left: cursor + '%' }} />}
        </div>
        {visible.map((field) => <div className="track-row" key={field}>
          <button type="button" className="track-name" aria-pressed={field === property} onClick={() => setChosen(field)}>{nameOf(field)}</button>
          <div className="track-lane" onDoubleClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const rect = event.currentTarget.getBoundingClientRect();
            addKey(start + (event.clientX - rect.left) / rect.width * span, field);
          }}>
            {cursor >= 0 && cursor <= 100 && <i style={{ left: cursor + '%' }} />}
            {tracks.find((item) => item.property === field)?.keys.map((key) => {
              const moving = gesture.current?.property === field && sameTime(gesture.current.source, key.time);
              const percent = ((moving && dragTime !== null ? dragTime : key.time) - start) / span * 100;
              if (!moving && (percent < -0.0001 || percent > 100.0001)) return null;
              return <button key={key.time} className={'timeline-key' + ((tracks.find((item) => item.property === field)?.keys.length ?? 0) > zoom * 28 ? ' dense-key' : '')} type="button" style={{ left: percent + '%' }}
                aria-label={nameOf(field) + ', ключ ' + key.time.toFixed(2) + ' с'} aria-pressed={keyframe === key}
                onClick={() => {
                  if (skipClick.current) { skipClick.current = false; return; }
                  skipClick.current = false;
                  setPlay(0); setChosen(field); setFocus({ target: target ?? '', property: field, time: key.time }); seek(key.time);
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0 || disabled) return;
                  skipClick.current = false;
                  setPlay(0); setChosen(field); setFocus({ target: target ?? '', property: field, time: key.time }); seek(key.time);
                  gesture.current = { pointer: event.pointerId, property: field, source: key.time, start: event.clientX, width: event.currentTarget.parentElement?.clientWidth ?? 1 };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={moveKey} onPointerUp={(event) => dropKey(event, key)}
                onPointerCancel={() => { gesture.current = undefined; setDragTime(null); }}><Diamond size={13} /></button>;
            })}
          </div>
        </div>)}
      </div>
      <div className="timeline-tools">
        {mode === 'scene' && <div className="timeline-settings">
          <label className="timeline-field">Длина, с<input title="При сокращении ключи за новым концом обрезаются. Изменение можно отменить." aria-label="Длительность" type="number" min={0.1} max={120} step={0.1}
            key={data.duration} defaultValue={data.duration} onBlur={(event) => {
              const duration = event.currentTarget.valueAsNumber;
              if (Number.isFinite(duration)) update((current) => resizeTimeline(current, Math.max(0.1, Math.min(120, duration))));
            }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
          <label className="timeline-field">FPS<select value={data.fps} onChange={(event) => {
            const fps = Number(event.currentTarget.value) as TimelineData['fps']; update((current) => ({ ...current, fps }));
          }}><option>24</option><option>30</option><option>60</option></select></label>
          <label className="timeline-field">Повтор<select value={data.loop} onChange={(event) => {
            const loop = event.currentTarget.value as TimelineData['loop']; update((current) => ({ ...current, loop }));
          }}><option value="once">Один раз</option><option value="loop">Петля</option><option value="ping-pong">Туда–обратно</option></select></label>
          <span className="timeline-help">{isSeamless(project) ? 'Начало и конец совпадают' : 'Начало и конец различаются'}</span>
          <div className="timeline-stagger">
            <label className="timeline-field">Каскад {stagger.toFixed(2)} с <input aria-label="Каскад" type="range" min={0} max={5} step={0.05}
              value={stagger} onChange={(event) => setStagger(event.currentTarget.valueAsNumber)} /></label>
            <select aria-label="Порядок каскада" value={staggerOrder}
              onChange={(event) => setStaggerOrder(event.currentTarget.value as PresetOptions['order'])}>
              <option value="forward">По порядку</option><option value="center">От центра</option><option value="random">Случайно</option>
            </select>
            <button type="button" className="text-button" disabled={!stagger || !data.tracks.length} onClick={() => {
              const ids = project.layers.filter((layer) => data.tracks.some(({ target: identity }) => identity === layer.id))
                .map(({ id }) => id);
              const order = staggerRanks(ids, staggerOrder);
              update((current) => {
                const tracks = current.tracks.map((track) => ({ ...track, keys: track.keys.map((key) => ({
                  ...key, time: Math.min(120, key.time + stagger * (order.get(track.target) ?? 0)),
                })).filter((key, index, keys) => index === keys.length - 1 || key.time !== keys[index + 1].time) }));
                return { ...current, tracks, duration: Math.max(current.duration, ...tracks.map((track) => track.keys.at(-1)?.time ?? 0)) };
              });
            }}>Сдвинуть</button>
          </div>
        </div>}
        {mode === 'curve' && <Curve track={track} keyframe={keyframe} update={setKey} />}
        {mode === 'keys' && <div className="timeline-settings">
          <label className="toggle-field"><input type="checkbox" checked={autoKey} onChange={(event) => setAutoKey(event.currentTarget.checked)} /> Автоключ</label>
          <label className="toggle-field"><input type="checkbox" checked={snap} onChange={(event) => setSnap(event.currentTarget.checked)} /> По кадрам</label>
          {keyframe ? <>
            <EditValue value={keyframe.value} property={property} onChange={(value) => setKey({ ...keyframe, value })} />
            <label className="timeline-field">Кривая<select aria-label="Интерполяция" disabled={disabled}
              value={keyframe.easing.kind === 'named' ? keyframe.easing.family : keyframe.easing.kind}
              onChange={(event) => {
                const kind = event.currentTarget.value;
                const easing: Easing = kind === 'linear' || kind === 'hold' ? { kind } :
                  kind === 'bezier' ? { kind, x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } :
                  { kind: 'named', family: kind as typeof families[number], direction: 'in-out' };
                setKey({ ...keyframe, easing });
              }}>
              <option value="linear">Линейная</option><option value="hold">Ступенька</option><option value="bezier">Безье</option>
              {families.map((family) => <option key={family}>{family}</option>)}
            </select></label>
            {keyframe.easing.kind === 'named' && <select aria-label="Направление интерполяции" value={keyframe.easing.direction}
              onChange={(event) => {
                if (keyframe.easing.kind === 'named') setKey({ ...keyframe, easing: { ...keyframe.easing, direction: event.currentTarget.value as keyof typeof directionLabels } });
              }}>{Object.entries(directionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
            <button className="icon-button" title="Копировать ключ" aria-label="Копировать ключ" onClick={copy}><Copy size={14} /></button>
            <button className="icon-button" title="Удалить ключ" aria-label="Удалить ключ" disabled={disabled} onClick={remove}><Trash2 size={14} /></button>
          </> : <span className="timeline-help">Выбери свойство и добавь ключ на текущем кадре.</span>}
        </div>}
      </div>
    </div>
    <div className="timeline-footer">
      <span><button className="icon-button" aria-label="Предыдущие дорожки" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={14} /></button>
        <output>{currentPage + 1} / {pageCount}</output>
        <button className="icon-button" aria-label="Следующие дорожки" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={14} /></button></span>
      <label title="Масштаб таймлайна"><Gauge size={14} /><input aria-label="Масштаб таймлайна" type="range" min={1} max={8} step={1} value={zoom}
        onChange={(event) => { const value = event.currentTarget.valueAsNumber; setZoom(value); setOrigin(Math.max(0, time - data.duration / value / 2)); }} /></label>
      {zoom > 1 && <input type="range" aria-label="Прокрутка времени" min={0} max={data.duration - span} step={0.01} value={start}
        onChange={(event) => setOrigin(event.currentTarget.valueAsNumber)} />}
      <button className="text-button" type="button" disabled={!target || disabled} onClick={paste}>Вставить ключ</button>
    </div>
  </section>;
}
