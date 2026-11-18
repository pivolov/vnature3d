import {
  Aperture, ArrowDownToLine, ChevronDown, FilePlus2, FolderOpen, Grid2X2, Layers3, SlidersHorizontal, Save, Video,
  Move, Orbit, Redo2, Undo2, Upload, X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Timeline } from './Timeline';
import { PresetLibrary, type PresetSelection } from './PresetLibrary';
import { applyPreset, applyTemplate, presets, templates, type PresetOptions } from '../animation/presets';
import { baseValue, cameraId, defaultTimeline, evaluate, frameTime, positionAt, putKey, type Property, type TimelineData } from '../animation/timeline';
import { downloadProject, readProject, saveProject, validateProject } from '../core/storage';
import { createEditor } from '../core/editor';
import { effectiveLayer, isDescendant, makeLayer } from '../core/layers';
import { LayerTree } from './LayerTree';
import { PrimitiveEditor } from './PrimitiveEditor';
import { decodeRaster, RasterDialog, type RasterSource } from './RasterDialog';
import { cameraPositions, emptyProject, materials, type CameraPreset, type Layer, type LightPreset, type Project, type Vec3 } from '../core/project';
import { primitiveShape } from '../geometry/primitives';
import { demos } from '../geometry/demos';
import { importSvg, maxSvgBytes } from '../geometry/svg';
import { mountViewport } from '../render/viewport';

const useEditor = createEditor({ ...emptyProject, ...importSvg(demos[0].svg), name: demos[0].name });
const angles = { studio: '3/4', front: 'Спереди', top: 'Сверху', iso: 'Изометрия' } as const;
const lights = { studio: 'Студия', soft: 'Мягкий', dramatic: 'Драматичный', neon: 'Неон' } as const;

function IconButton({ label, children, onClick, disabled, pressed, text }: {
  label: string; children: ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean; text?: string;
}) {
  return <button className={'icon-button' + (text ? ' file-action' : '')} type="button" title={label} aria-label={label} aria-pressed={pressed}
    disabled={disabled} onClick={onClick}>{children}{text && <span>{text}</span>}</button>;
}

function NumberField({ label, value, min, max, step = 0.01, onCommit }: {
  label: string; value: number; min: number; max: number; step?: number; onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return <label className="number-field"><span>{label}</span><input type="number" min={min} max={max} step={step}
    value={draft ?? Number(value.toFixed(3))}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={(event) => {
      const next = event.target.valueAsNumber;
      if (draft !== null && Number.isFinite(next)) {
        const normalized = Math.min(max, Math.max(min, step === 1 ? Math.round(next) : next));
        if (Math.abs(normalized - value) > 0.00001) onCommit(normalized);
      }
      setDraft(null);
    }}
    onKeyDown={(event) => {
      if (event.key === 'Enter') event.currentTarget.blur();
      if (event.key === 'Escape') {
        event.currentTarget.value = String(value);
        event.currentTarget.blur();
      }
    }} /></label>;
}

function Section({ title, children, expanded = false }: { title: string; children: ReactNode; expanded?: boolean }) {
  return <details open={expanded}><summary>{title}<ChevronDown size={14} /></summary><div className="section-fields">{children}</div></details>;
}

function LayerInspector({ layer, set }: { layer: Layer; set: (patch: Partial<Layer>) => void }) {
  function vector(field: 'position' | 'rotation' | 'scale', index: number, value: number) {
    const next: Vec3 = [...(layer[field] ?? [1, 1, 1])];
    next[index] = field === 'rotation' ? value * Math.PI / 180 : value;
    set({ [field]: next });
  }

  return <>
    <Section title="Геометрия" expanded>
      <NumberField label={layer.relief ? "Высота рельефа" : "Глубина"} value={layer.depth} min={0.01} max={3} step={0.05} onCommit={(depth) => set({ depth })} />
      {!layer.relief && <><NumberField label="Фаска" value={layer.bevel} min={0} max={0.35} onCommit={(bevel) => set({ bevel })} />
      <NumberField label="Сегменты фаски" value={layer.bevelSegments} min={1} max={8} step={1}
        onCommit={(bevelSegments) => set({ bevelSegments })} /></>}
    </Section>
    <Section title="Материал">
      <label className="field"><span>Пресет</span><select value={layer.material}
        onChange={(event) => {
          const material = event.target.value as Layer['material'];
          set({ material, roughness: undefined, ...(material === 'gold' ? { color: '#eec269' } : {}) });
        }}>
        {Object.entries(materials).map(([value, material]) => <option key={value} value={value}>{material.label}</option>)}
      </select></label>
      <label className="field"><span>Цвет</span><span className="color-field">
        <input type="color" defaultValue={layer.color}
          onBlur={(event) => {
            if (event.target.value !== layer.color) set({ color: event.target.value });
          }} key={layer.color + layer.material} />
        <span>{layer.color}</span>
      </span></label>
      <NumberField label="Шероховатость" value={layer.roughness ?? materials[layer.material].roughness} min={0} max={1}
        onCommit={(roughness) => set({ roughness })} />
      <label className="field"><span>Свечение</span><input type="color" key={layer.emissive ?? '#000000'}
        defaultValue={layer.emissive ?? '#000000'} onBlur={(event) => {
          if (event.currentTarget.value !== (layer.emissive ?? '#000000')) set({ emissive: event.currentTarget.value });
        }} /></label>
    </Section>
    <Section title="Трансформация" expanded>
      <div className="vector-label">Положение</div>
      <div className="vector">{['X', 'Y', 'Z'].map((axis, index) =>
        <NumberField key={axis} label={axis} value={layer.position[index]} min={-10} max={10} step={0.05}
          onCommit={(value) => vector('position', index, value)} />)}</div>
      <div className="vector-label">Поворот, °</div>
      <div className="vector">{['X', 'Y', 'Z'].map((axis, index) =>
        <NumberField key={axis} label={axis} value={layer.rotation[index] * 180 / Math.PI} min={-360} max={360} step={1}
          onCommit={(value) => vector('rotation', index, value)} />)}</div>
      <div className="vector-label">Масштаб</div>
      <div className="vector">{['X', 'Y', 'Z'].map((axis, index) =>
        <NumberField key={axis} label={axis} min={0.01} max={10} value={(layer.scale ?? [1, 1, 1])[index]}
          onCommit={(value) => vector('scale', index, value)} />)}</div>
      <NumberField label="Непрозрачность" value={layer.opacity} min={0} max={1} onCommit={(opacity) => set({ opacity })} />
    </Section>
  </>;
}

export function App() {
  const { project, selectedId, change, select, restore, past, future, undo, redo } = useEditor();
  const [time, setTime] = useState(0);
  const [play, setPlay] = useState(0);
  const [autoKey, setAutoKey] = useState(false);
  const [cameraTrack, setCameraTrack] = useState(false);
  const [side, setSide] = useState<'layers' | 'create' | 'presets'>('layers');
  const [mobilePanel, setMobilePanel] = useState<'tools' | 'inspector' | null>(null);
  const [restored, setRestored] = useState(false);
  const [storageStatus, setStorageStatus] = useState('');
  const [preview, setPreview] = useState<{ project: Project; label: string; duration: number } | null>(null);
  const [previewTime, setPreviewTime] = useState(0);
  const timeRef = useRef(0);
  const resumeTime = useRef(0);
  const sceneTimeline = project.timeline ?? defaultTimeline;
  const pose = useMemo(() => evaluate(project, time), [project, time]);
  const previewPose = useMemo(() => preview && evaluate(preview.project, previewTime), [preview, previewTime]);
  const effectiveLayers = useMemo(() => project.layers.map((layer) => effectiveLayer(project, layer)), [project]);
  const activeLayers = effectiveLayers.filter((layer) => layer.visible && !layer.locked);
  const canAnimateSelected = activeLayers.some(({ id }) => id === selectedId || !!selectedId && isDescendant(project, id, selectedId));
  const selectLayer = useCallback((id: string) => { setCameraTrack(false); select(id); }, [select]);
  const selectedSource = pose.layers.find((layer) => layer.id === selectedId);
  const selected = selectedSource && effectiveLayer(pose, selectedSource);
  const fileField = useRef<HTMLInputElement>(null);
  const projectField = useRef<HTMLInputElement>(null);
  const actions = useRef<{ layer: (id: string, patch: Partial<Layer>) => void; camera: (patch: Partial<Project['camera']>) => void } | null>(null);
  const saveQueue = useRef(Promise.resolve());
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<ReturnType<typeof mountViewport> | null>(null);
  const importSequence = useRef(0);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [grid, setGrid] = useState(true);
  const [gizmo, setGizmo] = useState(false);
  const [error, setError] = useState('');
  const [raster, setRaster] = useState<RasterSource | null>(null);
  const [graphicsError, setGraphicsError] = useState('');

  function seek(value: number) {
    const next = Math.max(0, Math.min(sceneTimeline.duration, value));
    timeRef.current = next;
    resumeTime.current = next;
    setTime(next);
  }
  function playback(speed: number) {
    if (speed) setPreview(null);
    if (!play && speed === 1 && timeRef.current >= sceneTimeline.duration) seek(0);
    if (!play && speed === -1 && timeRef.current <= 0) seek(sceneTimeline.duration);
    setPlay(speed);
  }
  function updateTimeline(update: (timeline: TimelineData) => TimelineData) {
    change((current) => ({ ...current, timeline: update(current.timeline ?? defaultTimeline) }));
  }
  function editKeys(current: Project, target: string, patch: Record<string, unknown>) {
    let timeline = current.timeline ?? defaultTimeline;
    const at = frameTime(timeRef.current, timeline, true);
    for (const field of Object.keys(patch) as Property[]) {
      const next = patch[field];
      const previous = baseValue(current, target, field);
      if (previous === undefined || next === undefined) continue;
      const existing = timeline.tracks.find((track) => track.target === target && track.property === field);
      if (at > 0 && !existing) timeline = putKey(timeline, target, field, { time: 0, value: previous, easing: { kind: 'linear' } });
      timeline = putKey(timeline, target, field, { time: at, value: next as NonNullable<typeof previous>,
        easing: existing?.keys.find((key) => Math.abs(key.time - at) < 1e-6)?.easing ?? { kind: 'linear' } });
    }
    return timeline;
  }
  function editLayer(id: string, patch: Partial<Layer>) {
    change((current) => {
      const layer = current.layers.find((item) => item.id === id);
      if (!layer || effectiveLayer(current, layer).locked) return current;
      const [animated, rest] = Object.entries(patch).reduce<[Record<string, unknown>, Record<string, unknown>]>((parts, [field, value]) => {
        const keyed = autoKey || current.timeline?.tracks.some((track) => track.target === id && track.property === field);
        parts[keyed && value !== undefined && baseValue(current, id, field as Property) !== undefined ? 0 : 1][field] = value;
        return parts;
      }, [{}, {}]);
      return {
        ...current,
        timeline: Object.keys(animated).length ? editKeys(current, id, animated) : current.timeline,
        layers: Object.keys(rest).length ? current.layers.map((item) => item.id === id ? { ...item, ...rest } : item) : current.layers,
      };
    });
  }
  function editCamera(patch: Partial<Project['camera']>) {
    if (play || preview) return;
    change((current) => {
      const animated = Object.fromEntries(Object.entries(patch).filter(([field]) => baseValue(current, cameraId, field as Property) !== undefined &&
        (autoKey || current.timeline?.tracks.some((track) => track.target === cameraId && track.property === field))));
      const rest = Object.fromEntries(Object.entries(patch).filter(([field]) => !(field in animated)));
      return { ...current, camera: { ...current.camera, ...rest },
        timeline: Object.keys(animated).length ? editKeys(current, cameraId, animated) : current.timeline };
    });
  }
  actions.current = { layer: editLayer, camera: editCamera };

  useEffect(() => {
    let cancelled = false;
    const initial = useEditor.getState().project;
    readProject().then((stored) => {
      if (stored && !cancelled && useEditor.getState().project === initial) restore(stored);
    }).catch(() => { if (!cancelled) setStorageStatus('Автосохранение недоступно'); })
      .finally(() => { if (!cancelled) setRestored(true); });
    return () => { cancelled = true; };
  }, [restore]);
  useEffect(() => {
    if (!restored) return;
    const timer = window.setTimeout(() => {
      saveQueue.current = saveQueue.current.then(() => saveProject(project)).then(
        () => setStorageStatus('Сохранено на этом устройстве'),
        () => setStorageStatus('Автосохранение недоступно'),
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [project, restored]);
  useEffect(() => {
    if (!preview) return;
    const start = performance.now();
    let frame = 0;
    function run(now: number) {
      if (!preview) return;
      setPreviewTime(positionAt((now - start) / 1000, preview.duration, 'loop'));
      frame = requestAnimationFrame(run);
    }
    frame = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame);
  }, [preview]);
  useEffect(() => {
    if (!play) return;
    const duration = sceneTimeline.duration;
    const origin = sceneTimeline.loop === 'ping-pong' && play < 0 ? 2 * duration - resumeTime.current : resumeTime.current;
    const start = performance.now();
    let frame = 0;
    function tick(now: number) {
      const elapsed = (now - start) / 1000;
      const raw = origin + elapsed * (sceneTimeline.loop === 'ping-pong' ? 1 : play);
      const next = positionAt(raw, duration, sceneTimeline.loop);
      timeRef.current = next;
      resumeTime.current = next;
      setTime(next);
      if (sceneTimeline.loop === 'once' && (raw >= duration || raw <= 0)) setPlay(0);
      else frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [play, sceneTimeline.duration, sceneTimeline.loop]);
  useEffect(() => {
    if (timeRef.current > sceneTimeline.duration) { timeRef.current = sceneTimeline.duration; resumeTime.current = sceneTimeline.duration; setTime(sceneTimeline.duration); }
  }, [sceneTimeline.duration]);

  useEffect(() => {
    if (!host.current) return;
    try {
      viewport.current = mountViewport(host.current, {
        select,
        move: (id, position) => actions.current?.layer(id, { position }),
        orbit: (position, target, zoom) => actions.current?.camera({ position, target, zoom }),
      });
    } catch {
      setGraphicsError('Не удалось запустить WebGL. Проверьте аппаратное ускорение и перезагрузите страницу.');
    }
    return () => {
      viewport.current?.dispose();
      viewport.current = null;
    };
  }, [select]);

  useEffect(() => {
    viewport.current?.update(previewPose || pose, selectedId, grid, gizmo && !play && !previewPose);
  }, [pose, previewPose, selectedId, grid, gizmo, play]);

  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      if (document.querySelector('dialog[open]')) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]')) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.code === 'KeyZ' || event.code === 'KeyY') {
        event.preventDefault();
        if (event.shiftKey || event.code === 'KeyY') redo();
        else undo();
      }
    }
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  }, [redo, undo]);

  function resetTime() { setPlay(0); seek(0); setCameraTrack(false); setPreview(null); }
  function applyMotion(current: Project, selection: PresetSelection, options: PresetOptions, all: boolean, start: number) {
    let composition = current;
    const allowed = current.layers.filter((layer) => {
      const active = effectiveLayer(current, layer);
      return active.visible && !active.locked && (all || layer.id === selectedId || !!selectedId && isDescendant(current, layer.id, selectedId));
    });
    let ids = allowed.map(({ id }) => id);
    if (selection.type === 'template' && !ids.length && !current.layers.length) {
      const shape = selection.id === 'success'
        ? { outer: [[-1.25, 0], [-0.92, 0.32], [-0.35, -0.22], [0.89, 0.96], [1.22, 0.62], [-0.35, -0.87]] as [number, number][], holes: [] }
        : selection.id === 'loader' ? primitiveShape('polygon', 6) : primitiveShape('star', 4);
      if (selection.id === 'loader') shape.holes = [shape.outer.map(([x, y]) => [x * 0.65, y * 0.65])];
      const layer = makeLayer(templates[selection.id].label, [shape], '#d6f494');
      composition = { ...current, name: templates[selection.id].label, layers: [layer] };
      ids = [layer.id];
    }
    if (selection.type === 'template') return ids.length ? applyTemplate(composition, selection.id, ids, options) : current;
    return applyPreset(composition, selection.id, ids, start, options);
  }
  function showMotion(request: { selection: PresetSelection; options: PresetOptions; all: boolean } | null) {
    if (!request) { setPreview(null); return; }
    const { selection, options, all } = request;
    const base = { ...project, timeline: { ...defaultTimeline, fps: sceneTimeline.fps, duration: 0.1 } };
    const temporary = applyMotion(base, selection, options, all, 0);
    if (temporary === base) return;
    setPreviewTime(0);
    setPreview({ project: temporary, duration: temporary.timeline?.duration ?? options.duration,
      label: selection.type === 'preset' ? presets[selection.id].label : templates[selection.id].label });
  }
  async function openProject(file: File) {
    const request = ++importSequence.current;
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error('Файл проекта превышает 32 МБ.');
      const opened = validateProject(JSON.parse(await file.text()));
      if (request !== importSequence.current) return;
      resetTime(); setError(''); change(() => opened);
    } catch (cause) {
      if (request === importSequence.current) setError(cause instanceof SyntaxError ? 'Файл проекта содержит неверный JSON.' :
        cause instanceof Error ? cause.message : 'Не удалось открыть проект.');
    }
  }
  function loadSource(name: string, svg: string) {
    const imported = importSvg(svg);
    resetTime();
    change(() => ({ ...emptyProject, ...imported, name }));
    select(imported.layers[0].id);
    setError('');
  }

  async function loadFile(file: File) {
    const request = ++importSequence.current;
    setError('');
    try {
      if (/\.l3d$/i.test(file.name)) { await openProject(file); return; }
      if (/\.(png|jpe?g)$/i.test(file.name) || ['image/png', 'image/jpeg'].includes(file.type)) {
        const source = await decodeRaster(file);
        if (request === importSequence.current) setRaster(source);
        return;
      }
      if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') throw new Error('Выберите файл SVG, PNG или JPG.');
      if (file.size > maxSvgBytes) throw new Error('SVG превышает 16 МБ. Упростите исходный файл.');
      const source = await file.text();
      if (request === importSequence.current) loadSource(file.name.replace(/\.svg$/i, ''), source);
    } catch (cause) {
      if (request === importSequence.current) setError(cause instanceof Error ? cause.message : 'Не удалось открыть файл.');
    }
  }

  function drop(event: DragEvent) {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void loadFile(file);
  }

  function demo(item: typeof demos[number]) {
    importSequence.current++;
    loadSource(item.name, item.svg);
  }

  function newProject() {
    importSequence.current++;
    setRaster(null);
    resetTime();
    setError('');
    change(() => emptyProject);
  }

  function angle(preset: CameraPreset) {
    editCamera({ preset, position: cameraPositions[preset], target: [0, 0, 0], zoom: 1 });
  }

  return <div className="studio" data-mobile-panel={mobilePanel ?? undefined}
    onDragEnter={(event) => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      dragDepth.current++;
      setDragging(true);
    }}
    onDragLeave={() => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    }}
    onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDrop={drop}>
    <header className="topbar">
      <img className="brand-logo" src={import.meta.env.BASE_URL + 'VD3D.svg'} alt="VD3D" />
      <div className="topbar-actions">
        <IconButton label="Новый проект" onClick={newProject}><FilePlus2 size={17} /></IconButton>
        <IconButton label="Открыть проект" text="Открыть" onClick={() => projectField.current?.click()}><FolderOpen size={17} /></IconButton>
        <IconButton label="Скачать проект" text="Скачать .l3d" onClick={() => downloadProject(project)}><Save size={17} /></IconButton>
        <span className="divider" />
        <IconButton label="Отменить" disabled={!past.length} onClick={undo}><Undo2 size={17} /></IconButton>
        <IconButton label="Повторить" disabled={!future.length} onClick={redo}><Redo2 size={17} /></IconButton>
      </div>
      <input type="file" aria-label="Файл проекта" accept=".l3d" ref={projectField} hidden onChange={(event) => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
        if (file) void openProject(file);
      }} />
      <div className="mobile-panel-tools">
        <IconButton label="Панель слоёв" pressed={mobilePanel === 'tools'} onClick={() => setMobilePanel(mobilePanel === 'tools' ? null : 'tools')}><Layers3 size={16} /></IconButton>
        <IconButton label="Панель настроек" pressed={mobilePanel === 'inspector'} onClick={() => setMobilePanel(mobilePanel === 'inspector' ? null : 'inspector')}><SlidersHorizontal size={16} /></IconButton>
      </div>
      <input type="file" aria-label="Выбрать изображение" accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg" ref={fileField} hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void loadFile(file);
        }} />
      <button className="primary" onClick={() => fileField.current?.click()}><ArrowDownToLine size={16} />Импорт</button>
    </header>

    <div className="workspace">
      <aside className="sidebar" aria-label="Слои и примеры">
        <div className="panel-tabs" aria-label="Инструменты">
          <button aria-pressed={side === 'layers'} onClick={() => { setSide('layers'); setPreview(null); }}>Слои</button>
          <button aria-pressed={side === 'create'} onClick={() => { setSide('create'); setPreview(null); }}>Фигуры</button>
          <button aria-pressed={side === 'presets'} onClick={() => setSide('presets')}>Пресеты</button>
        </div>
        <div className={side === 'layers' ? 'side-content layer-content' : 'settings-scroll side-content'}>
        {side === 'layers' && <LayerTree project={project} selectedId={selectedId} change={change}
          select={selectLayer} />}
        {side === 'presets' && <PresetLibrary canAnimate={!!activeLayers.length} canAnimateSelected={canAnimateSelected} preview={showMotion}
          apply={(selection, options, all) => {
            const start = selection.type === 'template' ? 0 : time;
            setPlay(0); setPreview(null);
            const result = applyMotion(project, selection, options, all, start);
            if (result === project) { setError('Выберите видимый слой или уменьшите задержку.'); return; }
            setError(''); change(() => result);
            setCameraTrack(selection.id === 'orbit');
            seek(start);
          }} />}
        {side === 'create' && <><PrimitiveEditor key={project.name} layers={effectiveLayers} selected={selected}
          onAdd={(layer) => {
            setError('');
            change((current) => ({ ...current, layers: [...current.layers, {
              ...layer, position: current.layers.length ? [0.55, -0.35, 0.15] : layer.position,
            }] }));
            select(layer.id);
          }}
          onCombine={(first, second, layer) => {
            setError('');
            change((current) => ({ ...current, layers: [
              ...current.layers.map((item) => item.id === first || item.id === second ? { ...item, visible: false } : item),
              layer,
            ] }));
            select(layer.id);
          }}
          onError={setError} />
        <div className="demo-list">
          <h2>Примеры</h2>
          {demos.map((item, index) => {
            const Icon = [Orbit, ArrowDownToLine, Aperture][index];
            return <button key={item.name} onClick={() => demo(item)}><Icon size={16} />{item.name}</button>;
          })}
        </div></>}
        </div>
      </aside>

      <main className="canvas-panel">
        <div className="canvas-header">
          <div className="document"><h1 title={project.name}>{project.name}</h1>{preview && <span className="preview-label">Предпросмотр · {preview.label}</span>}</div>
          <div className="canvas-tools">
            <IconButton label="Дорожки камеры" pressed={cameraTrack} onClick={() => setCameraTrack(!cameraTrack)}><Video size={17} /></IconButton>
            <IconButton label="Сетка" pressed={grid} onClick={() => setGrid(!grid)}><Grid2X2 size={17} /></IconButton>
            <IconButton label="Гизмо перемещения" pressed={gizmo} onClick={() => setGizmo(!gizmo)}><Move size={17} /></IconButton>
          </div>
        </div>
        <div className="viewport-host" ref={host} />
        {!(previewPose || project).layers.length && !graphicsError && <div className="empty-canvas">
          <Upload size={29} />
          <h2>Перетащите SVG, PNG или JPG</h2>
          <button className="secondary" onClick={() => fileField.current?.click()}>Выбрать файл</button>
        </div>}
        {graphicsError && <div className="empty-canvas" role="alert">{graphicsError}</div>}
        {(error || project.notices.length > 0) && <div className={'notice' + (error ? ' error' : '')} role={error ? 'alert' : 'status'}>
          <div>{error || project.notices.join(' ')}</div>
          {error && <IconButton label="Закрыть сообщение" onClick={() => setError('')}><X size={15} /></IconButton>}
        </div>}
        <div className="canvas-footer">
          <div className="view-switch" aria-label="Ракурс камеры">
            {(Object.keys(angles) as CameraPreset[]).map((preset) =>
              <button key={preset} aria-pressed={project.camera.preset === preset} onClick={() => angle(preset)}>{angles[preset]}</button>)}
          </div>
          <span>Перетаскивание · обзор<br />Колесо · масштаб</span>
        </div>
      </main>

      <aside className="inspector" aria-label="Инспектор">
        <div className="panel-title"><Aperture size={16} />Настройки</div>
        <div className="settings-scroll">
        {selected && (selected.locked ? <p className="muted-empty">Слой заблокирован.</p> : <LayerInspector key={selected.id} layer={selected} set={(patch) => editLayer(selected.id, patch)} />)}
        <Section title="Свет и камера">
          <label className="field"><span>Свет</span><select value={project.light} onChange={(event) => {
            const light = event.target.value as LightPreset;
            change((current) => ({ ...current, light }));
          }}>
            {Object.entries(lights).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label className="field"><span>Проекция</span><select value={project.camera.projection} onChange={(event) => {
            const projection = event.target.value as typeof project.camera.projection;
            editCamera({ projection, zoom: 1 });
          }}>
            <option value="perspective">Перспектива</option><option value="orthographic">Ортографическая</option>
          </select></label>
        </Section>
        </div>
      </aside>
    </div>

    <Timeline project={project} target={cameraTrack ? cameraId : selected?.id ?? null} layerName={cameraTrack ? 'Камера' : selected?.name}
      disabled={!!selected?.locked && !cameraTrack} time={time} seek={seek} play={play} setPlay={playback}
      autoKey={autoKey} setAutoKey={setAutoKey} update={updateTimeline} />
    <footer className="statusbar"><span>{storageStatus || 'Локальный проект'}</span>
      <span>{effectiveLayers.filter((layer) => layer.visible).length} / {project.layers.length} видимых слоёв</span></footer>
    {raster && <RasterDialog source={raster} onCancel={() => setRaster(null)} onApply={(layers) => {
      resetTime();
      change(() => ({ ...emptyProject, name: raster.name, layers }));
      select(layers[0].id);
      setRaster(null);
    }} />}
    {dragging && <div className="drop-target"><Upload size={32} />Отпустите изображение для импорта</div>}
  </div>;
}
