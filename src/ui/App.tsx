import {
  Aperture, ArrowDownToLine, ChevronDown, FilePlus2, FolderOpen, Grid2X2, PanelBottom, Pause, Play, Download, Layers3, SlidersHorizontal, Save, Video,
  Move, Rotate3D, Sun, Orbit, Redo2, Undo2, Upload, X,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { Timeline } from './Timeline';
import { ExportDialog } from './ExportDialog';
import { PresetLibrary, type PresetSelection } from './PresetLibrary';
import { applyPreset, applyTemplate, presets, templates, type PresetOptions } from '../animation/presets';
import { baseValue, cameraId, defaultTimeline, evaluate, frameTime, positionAt, putKey, type Property, type TimelineData } from '../animation/timeline';
import { downloadProject, readProject, saveProject, validateProject } from '../core/storage';
import { createEditor } from '../core/editor';
import { effectiveLayer, isDescendant, makeLayer, placeDetailsOnFront } from '../core/layers';
import { LayerTree } from './LayerTree';
import { PrimitiveEditor } from './PrimitiveEditor';
import { decodeRaster, RasterDialog, type RasterSource } from './RasterDialog';
import { defaultLighting, cameraPositions, isGlass, emptyProject, materials, type CameraPreset, type Layer, type LightPreset, type Project, type Vec3 } from '../core/project';
import { primitiveShape } from '../geometry/primitives';
import { demos } from '../geometry/demos';
import { importSvg, maxSvgBytes } from '../geometry/svg';
import { FallbackPreview } from './FallbackPreview';
import { mountViewport } from '../render/viewport';

const GlbDialog = lazy(() => import('./GlbDialog'));
const LottieDialog = lazy(() => import('./LottieDialog').then((module) => ({ default: module.LottieDialog })));

const useEditor = createEditor({ ...emptyProject, ...importSvg(demos[0].svg), name: demos[0].name });
const frameRatios = { '1:1': 1, '4:5': 4 / 5, '9:16': 9 / 16, '9:19.5': 9 / 19.5, '16:9': 16 / 9 } as const;
const angles = { studio: '3/4', front: 'Спереди', lean: 'Лёгкий наклон', top: 'Сверху', iso: 'Изометрия' } as const;
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
      {!layer.relief && !layer.solid && <><NumberField label="Фаска" value={layer.bevel} min={0} max={0.35} onCommit={(bevel) => set({ bevel })} />
      <NumberField label="Сегменты фаски" value={layer.bevelSegments} min={1} max={8} step={1}
        onCommit={(bevelSegments) => set({ bevelSegments })} /></>}
    </Section>
    <Section title="Материал">
      <label className="field"><span>Пресет</span><select value={layer.material}
        onChange={(event) => {
          const material = event.target.value as Layer['material'];
          set({ material, roughness: materials[material].roughness, metalness: undefined, clearcoat: undefined, specularIntensity: undefined, ...(isGlass(material) && !isGlass(layer.material) ? { color: '#ffffff' } : material === 'gold' ? { color: '#eec269' } : material === 'chrome' ? { color: '#dfe2e5' } : {}) });
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
      <NumberField label={isGlass(layer.material) ? "Матовость (0–1)" : "Шероховатость"} value={layer.roughness ?? materials[layer.material].roughness} min={0} max={1}
        onCommit={(roughness) => set({ roughness })} />
      <NumberField label="Сила блика" value={layer.specularIntensity ?? (isGlass(layer.material) ? 0.5 : 1)} min={0} max={1} onCommit={specularIntensity => set({ specularIntensity })} />
      <NumberField label="Металличность" value={layer.metalness ?? materials[layer.material].metalness} min={0} max={1} onCommit={metalness => set({ metalness })} />
      <NumberField label="Лак" value={layer.clearcoat ?? materials[layer.material].clearcoat} min={0} max={1} onCommit={clearcoat => set({ clearcoat })} />
      {isGlass(layer.material) && <>
        <NumberField label="Пропускание света" value={layer.transmission ?? 1} min={0} max={1} onCommit={transmission => set({ transmission })} />
        <NumberField label="Преломление (IOR)" value={layer.ior ?? 1.5} min={1} max={2.5} onCommit={ior => set({ ior })} />
        <NumberField label="Оптическая толщина" value={layer.opticalThickness ?? layer.depth} min={0} max={5} onCommit={opticalThickness => set({ opticalThickness })} />
      </>}
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
  const [glb, setGlb] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');
  const [timelineVisible, setTimelineVisible] = useState(true);
  const [inspect, setInspect] = useState<'layer' | 'scene'>('layer');
  const [exportOpen, setExportOpen] = useState<'video' | 'lottie' | false>(false);
  const [grid, setGrid] = useState(true);
  const [gizmo, setGizmo] = useState<'translate' | 'rotate' | false>(false);
  const [lightDraft, setLightDraft] = useState<typeof defaultLighting | null>(null);
  const settings = lightDraft ?? { ...defaultLighting, ...project.lighting };
  function commitLight(value: typeof defaultLighting) {
    setLightDraft(null);
    change(current => ({ ...current, lighting: value }));
  }
  const [error, setError] = useState('');
  const [raster, setRaster] = useState<RasterSource | null>(null);
  const [rendering, setRendering] = useState(false);
  const [graphicsError, setGraphicsError] = useState('');
  const [graphicsRevision, resetGraphics] = useState(0);
  const [frame, setFrame] = useState<{ project: Project; time: number; ratio: number } | null>(null);
  const [frameGuide, setFrameGuide] = useState<keyof typeof frameRatios | ''>('');

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
    const origin = resumeTime.current;
    const start = performance.now();
    let frame = 0;
    function tick(now: number) {
      const elapsed = (now - start) / 1000;
      const raw = origin + elapsed * play;
      const next = positionAt(raw, duration, sceneTimeline.loop);
      timeRef.current = next;
      const span = sceneTimeline.loop === 'ping-pong' ? duration * 2 : duration;
      resumeTime.current = sceneTimeline.loop === 'once' ? next : (raw % span + span) % span;
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
    if (!host.current || rendering) return;
    try {
      setGraphicsError('');
      viewport.current = mountViewport(host.current, {
        select: selectLayer,
        graphics: (restored) => {
          if (restored) { setGraphicsError(''); resetGraphics((value) => value + 1); }
          else setGraphicsError('GPU прервал предпросмотр. Редактор попробует восстановить сцену.');
        },
        rotate: (id, rotation) => actions.current?.layer(id, { rotation }),
        move: (id, position) => actions.current?.layer(id, { position }),
        orbit: (position, target, zoom) => actions.current?.camera({ position, target, zoom }),
      }, graphicsRevision > 0);
    } catch {
      setGraphicsError('Браузер не смог запустить 3D.');
    }
    return () => {
      viewport.current?.dispose();
      viewport.current = null;
    };
  }, [selectLayer, graphicsRevision, rendering]);

  useEffect(() => {
    const scene = previewPose || pose;
    viewport.current?.update(lightDraft ? { ...scene, lighting: lightDraft } : scene, selectedId, grid && viewMode === 'edit',
      !play && !previewPose && viewMode === 'edit' && gizmo);
  }, [pose, previewPose, lightDraft, selectedId, grid, gizmo, play, viewMode, graphicsRevision, rendering]);

  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      if (document.querySelector('dialog[open]')) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]')) return;
      if (event.code === 'Escape') {
        setViewMode('edit'); setMobilePanel(null); setPreview(null); return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.code === 'KeyS' && !event.shiftKey) {
        event.preventDefault(); downloadProject(useEditor.getState().project); return;
      }
      if (event.code === 'KeyO' && !event.shiftKey) {
        event.preventDefault(); projectField.current?.click(); return;
      }
      if (event.code === 'KeyE' && event.shiftKey && useEditor.getState().project.layers.length) {
        event.preventDefault(); setPlay(0); setPreview(null); setExportOpen('video'); return;
      }
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
    const base = { ...evaluate(project, time), timeline: { ...defaultTimeline, fps: sceneTimeline.fps, duration: 0.1 } };
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
      if (/\.glb$/i.test(file.name)) { setPlay(0); setGlb(file); return; }
      if (/\.l3d$/i.test(file.name)) { await openProject(file); return; }
      if (/\.(png|jpe?g)$/i.test(file.name) || ['image/png', 'image/jpeg'].includes(file.type)) {
        const source = await decodeRaster(file);
        if (request === importSequence.current) setRaster(source);
        return;
      }
      if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') throw new Error('Выберите GLB, L3D, SVG, PNG или JPG.');
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

  return <div className="studio" data-mobile-panel={mobilePanel ?? undefined} data-mode={viewMode} data-timeline={timelineVisible}
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
      <div className="editor-modes" aria-label="Режим редактора">
        <button aria-pressed={viewMode === 'edit'} onClick={() => { setViewMode('edit'); setPreview(null); }}>Редактор</button>
        <button aria-pressed={viewMode === 'preview'} onClick={() => { setViewMode('preview'); setMobilePanel(null); setPreview(null); }}>Просмотр</button>
      </div>
      <input type="file" aria-label="Файл проекта" accept=".l3d,.glb" ref={projectField} hidden onChange={(event) => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
        if (file) void loadFile(file);
      }} />
      <div className="mobile-panel-tools">
        <IconButton label="Панель слоёв" pressed={mobilePanel === 'tools'} onClick={() => setMobilePanel(mobilePanel === 'tools' ? null : 'tools')}><Layers3 size={16} /></IconButton>
        <IconButton label="Панель настроек" pressed={mobilePanel === 'inspector'} onClick={() => setMobilePanel(mobilePanel === 'inspector' ? null : 'inspector')}><SlidersHorizontal size={16} /></IconButton>
      </div>
      <input type="file" aria-label="Выбрать изображение" accept=".glb,.svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg" ref={fileField} hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void loadFile(file);
        }} />
      <div className="topbar-end">
        <button className="secondary import-action" aria-label="Импорт" title="Открыть изображение или модель GLB" onClick={() => fileField.current?.click()}><ArrowDownToLine size={16} /><span>Импорт</span></button>
        <button className="secondary import-action" aria-label="Рендер кадра" title="Отрендерить текущий кадр в PNG" disabled={!effectiveLayers.some(layer => layer.visible)}
          onClick={() => {
            setPlay(0);
            setPreview(null);
            const view = host.current;
            const ratio = frameGuide ? frameRatios[frameGuide] : view?.clientHeight ? view.clientWidth / view.clientHeight : 16 / 9;
            setFrame({ project, time: timeRef.current, ratio });
          }}><Aperture size={16} /><span>Рендер</span></button>
        <button className="primary export-action" aria-label="Экспорт" title="Экспорт сцены" disabled={!effectiveLayers.some(({ visible }) => visible)}
          onClick={() => { setPlay(0); setPreview(null); setExportOpen('video'); }}><Download size={16} /><span>Экспорт</span></button>
      </div>
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
        {side === 'presets' && <PresetLibrary emptyScene={!project.layers.length} canAnimate={!!activeLayers.length} canAnimateSelected={canAnimateSelected} preview={showMotion}
          apply={(selection, options, all) => {
            const start = selection.type === 'template' ? 0 : time;
            setPlay(0); setPreview(null);
            const result = applyMotion(project, selection, options, all, start);
            if (result === project) { setError('Движение должно поместиться в 120 секунд. Сдвиньте начало или уменьшите длительность, задержку либо каскад.'); return; }
            setError(''); change(() => result);
            setCameraTrack(selection.id === 'orbit');
            setTimelineVisible(true);
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
            <IconButton label="Настроить свет" onClick={() => { setInspect('scene'); setMobilePanel('inspector'); }}><Sun size={17} /></IconButton>
            <IconButton label="Повернуть объект" pressed={gizmo === 'rotate'} disabled={!selected || selected.locked}
              onClick={() => setGizmo(gizmo === 'rotate' ? false : 'rotate')}><Rotate3D size={17} /></IconButton>
            <IconButton label={timelineVisible ? 'Свернуть таймлайн' : 'Показать таймлайн'} pressed={timelineVisible}
              onClick={() => setTimelineVisible(!timelineVisible)}><PanelBottom size={17} /></IconButton>
            <IconButton label="Дорожки камеры" pressed={cameraTrack} onClick={() => { setCameraTrack(!cameraTrack); setTimelineVisible(true); setInspect('scene'); }}><Video size={17} /></IconButton>
            <IconButton label="Сетка" pressed={grid} onClick={() => setGrid(!grid)}><Grid2X2 size={17} /></IconButton>
            <IconButton label="Гизмо перемещения" pressed={gizmo === 'translate'} onClick={() => setGizmo(gizmo === 'translate' ? false : 'translate')}><Move size={17} /></IconButton>
          </div>
        </div>
        <div className="viewport-host" ref={host} />
        {viewMode === 'edit' && !graphicsError && project.layers.length > 0 && <div className="orbit-hint">{gizmo === 'rotate' ? 'Тяните кольцо, чтобы повернуть объект' : 'Тяните фон, чтобы осмотреть модель'}</div>}
        {!!frameGuide && !graphicsError && viewMode === 'edit' && <div className="safe-area" aria-hidden="true">
          <div style={{ '--frame-aspect': frameRatios[frameGuide] } as CSSProperties}><i /></div>
        </div>}
        {!(previewPose || project).layers.length && <div className="empty-canvas">
          <Upload size={29} />
          <h2>Перетащите SVG, PNG или JPG</h2>
          <button className="secondary" onClick={() => fileField.current?.click()}>Выбрать файл</button>
        </div>}
        {graphicsError && <>
          <FallbackPreview project={previewPose || pose} />
          <div className="viewport-recovery">
            <span role="status">{graphicsError} Доступен упрощённый вид спереди.</span>
            <button className="secondary" onClick={() => resetGraphics(value => value + 1)}>Вернуть 3D</button>
          </div>
        </>}
        {(error || project.notices.length > 0) && <div className={'notice' + (error ? ' error' : '')} role={error ? 'alert' : 'status'}>
          <div>{error || project.notices.join(' ')}</div>
          {error && <IconButton label="Закрыть сообщение" onClick={() => setError('')}><X size={15} /></IconButton>}
        </div>}
        {viewMode === 'preview' && <div className="preview-transport">
          <button className="secondary" onClick={() => playback(play ? 0 : 1)} aria-label={play ? 'Пауза просмотра' : 'Воспроизвести просмотр'}>
            {play ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <input aria-label="Время просмотра" type="range" min={0} max={sceneTimeline.duration} step={1 / sceneTimeline.fps} value={time}
            onChange={(event) => { setPlay(0); seek(event.currentTarget.valueAsNumber); }} />
          <output>{time.toFixed(2)} с</output>
        </div>}
        <div className="canvas-footer">
          <div className="view-switch" aria-label="Ракурс камеры">
            {(Object.keys(angles) as CameraPreset[]).map((preset) =>
              <button key={preset} aria-pressed={project.camera.preset === preset} onClick={() => angle(preset)}>{angles[preset]}</button>)}
          </div>
          <select className="frame-guide-select" aria-label="Рамка кадра" value={frameGuide}
            onChange={(event) => setFrameGuide(event.currentTarget.value as keyof typeof frameRatios | '')}>
            <option value="">Рамка кадра</option>
            {Object.keys(frameRatios).map((ratio) => <option key={ratio}>{ratio}</option>)}
          </select>
        </div>
      </main>

      <aside className="inspector" aria-label="Инспектор">
        <div className="panel-tabs inspector-tabs">
          <button aria-pressed={inspect === 'layer'} onClick={() => setInspect('layer')}>Объект</button>
          <button aria-pressed={inspect === 'scene'} onClick={() => setInspect('scene')}>Сцена</button>
        </div>
        <div className="settings-scroll">
        {inspect === 'layer' && !selected && <p className="muted-empty">Выберите объект во вьюпорте или на панели слоёв.</p>}
        {inspect === 'layer' && selected && <div className="inspector-object"><span className="swatch" style={{ background: selected.color }} />{selected.name}</div>}
        {inspect === 'layer' && selected && (selected.locked ? <p className="muted-empty">Слой заблокирован.</p> : <LayerInspector key={selected.id} layer={selected} set={(patch) => editLayer(selected.id, patch)} />)}
        {inspect === 'layer' && selected && !selected.locked && project.layers.length > 1 &&
          <button className="secondary" title="Использовать выбранный слой как основание. Сдвигает соседние слои по Z."
            onClick={() => { setPlay(0); setPreview(null); change(current => placeDetailsOnFront(current, selected.id)); }}>Вынести детали вперёд</button>}
        {inspect === 'layer' && selected && !selected.locked && sceneTimeline.tracks.some(track => track.target === selected.id && track.property === 'opacity') &&
          <button className="secondary" onClick={() => updateTimeline(timeline => ({ ...timeline,
            tracks: timeline.tracks.filter(track => track.target !== selected.id || track.property !== 'opacity'),
          }))}>Убрать анимацию прозрачности</button>}
        {inspect === 'scene' && <Section title="Свет и камера" expanded>
          <label className="field"><span>Свет</span><select value={project.light} onChange={(event) => {
            const light = event.target.value as LightPreset;
            change((current) => ({ ...current, light }));
          }}>
            {Object.entries(lights).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          {([
            ['azimuth', 'Направление света', -180, 180, '°'],
            ['elevation', 'Высота света', -90, 90, '°'],
            ['strength', 'Сила света', 0, 300, '%'],
            ['fill', 'Заполняющий свет', 0, 200, '%'],
            ['studioAngle', 'Поворот отражений', -180, 180, '°'],
            ['reflections', 'Сила отражений', 0, 300, '%'],
            ['exposure', 'Экспозиция', 25, 200, '%'],
          ] as const).map(([key, label, min, max, unit]) => {
            const scale = unit === '%' ? 100 : 1;
            const value = Math.round(settings[key] * scale);
            return <label key={key} className="light-slider"><span>{label}</span><output>{value}{unit}</output>
              <input type="range" aria-label={label} min={min} max={max} value={value} aria-valuetext={value + unit}
                onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
                onChange={event => {
                  const next = { ...settings, [key]: event.currentTarget.valueAsNumber / scale };
                  setLightDraft(next);
                }}
                onPointerUp={() => { if (lightDraft) commitLight(lightDraft); }}
                onPointerCancel={() => setLightDraft(null)}
                onKeyUp={() => { if (lightDraft) commitLight(lightDraft); }}
                onBlur={() => { if (lightDraft) commitLight(lightDraft); }} /></label>;
          })}
          <label className="toggle-field"><input type="checkbox" checked={settings.shadows}
            onChange={event => commitLight({ ...settings, shadows: event.currentTarget.checked })} /> Тени от модели</label>
          <button className="secondary" disabled={!project.lighting} onClick={() => change(current => ({ ...current, lighting: undefined }))}>Сбросить настройки света</button>
          <label className="field"><span>Проекция</span><select value={project.camera.projection} onChange={(event) => {
            const projection = event.target.value as typeof project.camera.projection;
            editCamera({ projection, zoom: 1 });
          }}>
            <option value="perspective">Перспектива</option><option value="orthographic">Ортографическая</option>
          </select></label>
        </Section>}
        </div>
      </aside>
    </div>

    <Timeline project={project} target={cameraTrack ? cameraId : selected?.id ?? null} layerName={cameraTrack ? 'Камера' : selected?.name}
      disabled={!!selected?.locked && !cameraTrack} time={time} seek={seek} play={play} setPlay={playback}
      autoKey={autoKey} setAutoKey={setAutoKey} update={updateTimeline} />
    <footer className="statusbar"><span>{storageStatus || 'Локальный проект'}</span>
      <span>{effectiveLayers.filter((layer) => layer.visible).length} / {project.layers.length} видимых слоёв</span></footer>
    {frame && <ExportDialog project={frame.project} time={frame.time} renderRatio={frame.ratio} onRendering={setRendering} blender={async () => {
      const { downloadBlender } = await import('../export/blender');
      downloadBlender(project, frameGuide ? frameRatios[frameGuide] : 16 / 9);
    }} close={() => setFrame(null)} lottie={() => { setFrame(null); setExportOpen('lottie'); }} />}
    {exportOpen === 'video' && <ExportDialog project={project} time={time} onRendering={setRendering} blender={async () => {
      const { downloadBlender } = await import('../export/blender');
      downloadBlender(project, frameGuide ? frameRatios[frameGuide] : 16 / 9);
    }} close={() => setExportOpen(false)} lottie={() => setExportOpen('lottie')} />}
    {exportOpen === 'lottie' && <Suspense fallback={<div className="lottie-loading" role="status">Загрузка экспорта…</div>}>
      <LottieDialog project={project} time={time} close={() => setExportOpen(false)} video={() => setExportOpen('video')} />
    </Suspense>}
    {raster && <RasterDialog source={raster} onCancel={() => setRaster(null)} onApply={(layers) => {
      resetTime();
      change(() => ({ ...emptyProject, name: raster.name, layers }));
      select(layers[0].id);
      setRaster(null);
    }} />}
    {glb && <Suspense fallback={null}><GlbDialog file={glb} close={() => setGlb(null)} /></Suspense>}
    {dragging && <div className="drop-target"><Upload size={32} />Отпустите файл, чтобы открыть</div>}
  </div>;
}
