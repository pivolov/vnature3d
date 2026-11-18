import {
  Aperture, ArrowDownToLine, Box, ChevronDown, Circle, Eye, EyeOff, FilePlus2, Grid2X2, Layers3,
  Move, Orbit, Redo2, Undo2, Upload, X,
} from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { createEditor } from '../core/editor';
import { cameraPositions, emptyProject, materials, type CameraPreset, type Layer, type LightPreset, type Vec3 } from '../core/project';
import { demos } from '../geometry/demos';
import { importSvg, maxSvgBytes } from '../geometry/svg';
import { mountViewport } from '../render/viewport';

const useEditor = createEditor({ ...emptyProject, ...importSvg(demos[0].svg), name: demos[0].name });
const angles = { studio: '3/4', front: 'Спереди', top: 'Сверху', iso: 'Изометрия' } as const;
const lights = { studio: 'Студия', soft: 'Мягкий', dramatic: 'Драматичный', neon: 'Неон' } as const;

function IconButton({ label, children, onClick, disabled, pressed }: {
  label: string; children: ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean;
}) {
  return <button className="icon-button" type="button" title={label} aria-label={label} aria-pressed={pressed}
    disabled={disabled} onClick={onClick}>{children}</button>;
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <details open><summary>{title}<ChevronDown size={14} /></summary><div className="section-fields">{children}</div></details>;
}

function LayerInspector({ layer }: { layer: Layer }) {
  const update = useEditor((state) => state.updateLayer);
  const set = (patch: Partial<Layer>) => update(layer.id, patch);
  function vector(field: 'position' | 'rotation', index: number, value: number) {
    const next: Vec3 = [...layer[field]];
    next[index] = field === 'rotation' ? value * Math.PI / 180 : value;
    set({ [field]: next });
  }

  return <>
    <Section title="Геометрия">
      <NumberField label="Глубина" value={layer.depth} min={0.01} max={3} step={0.05} onCommit={(depth) => set({ depth })} />
      <NumberField label="Фаска" value={layer.bevel} min={0} max={0.35} onCommit={(bevel) => set({ bevel })} />
      <NumberField label="Сегменты фаски" value={layer.bevelSegments} min={1} max={8} step={1}
        onCommit={(bevelSegments) => set({ bevelSegments })} />
    </Section>
    <Section title="Материал">
      <label className="field"><span>Пресет</span><select value={layer.material}
        onChange={(event) => set({ material: event.target.value as Layer['material'] })}>
        {Object.entries(materials).map(([value, material]) => <option key={value} value={value}>{material.label}</option>)}
      </select></label>
      <label className="field"><span>Цвет</span><span className="color-field">
        <input type="color" defaultValue={layer.material === 'gold' ? '#eec269' : layer.color} disabled={layer.material === 'gold'}
          onBlur={(event) => {
            if (event.target.value !== layer.color && layer.material !== 'gold') set({ color: event.target.value });
          }} key={layer.color + layer.material} />
        <span>{layer.material === 'gold' ? '#eec269' : layer.color}</span>
      </span></label>
    </Section>
    <Section title="Трансформация">
      <div className="vector-label">Положение</div>
      <div className="vector">{['X', 'Y', 'Z'].map((axis, index) =>
        <NumberField key={axis} label={axis} value={layer.position[index]} min={-10} max={10} step={0.05}
          onCommit={(value) => vector('position', index, value)} />)}</div>
      <div className="vector-label">Поворот, °</div>
      <div className="vector">{['X', 'Y', 'Z'].map((axis, index) =>
        <NumberField key={axis} label={axis} value={layer.rotation[index] * 180 / Math.PI} min={-360} max={360} step={1}
          onCommit={(value) => vector('rotation', index, value)} />)}</div>
    </Section>
  </>;
}

export function App() {
  const { project, selectedId, change, select, updateLayer, past, future, undo, redo } = useEditor();
  const selected = project.layers.find((layer) => layer.id === selectedId);
  const fileField = useRef<HTMLInputElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<ReturnType<typeof mountViewport> | null>(null);
  const importSequence = useRef(0);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [grid, setGrid] = useState(true);
  const [gizmo, setGizmo] = useState(false);
  const [error, setError] = useState('');
  const [graphicsError, setGraphicsError] = useState('');

  useEffect(() => {
    if (!host.current) return;
    try {
      viewport.current = mountViewport(host.current, {
        select,
        move: (id, position) => updateLayer(id, { position }),
        orbit: (position, target, zoom) => change((current) => ({
          ...current, camera: { ...current.camera, position, target, zoom },
        })),
      });
    } catch {
      setGraphicsError('Не удалось запустить WebGL. Проверьте аппаратное ускорение и перезагрузите страницу.');
    }
    return () => {
      viewport.current?.dispose();
      viewport.current = null;
    };
  }, [change, select, updateLayer]);

  useEffect(() => {
    viewport.current?.update(project, selectedId, grid, gizmo);
  }, [project, selectedId, grid, gizmo]);

  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
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

  function loadSource(name: string, svg: string) {
    const imported = importSvg(svg);
    change(() => ({ ...emptyProject, ...imported, name }));
    select(imported.layers[0].id);
    setError('');
  }

  async function loadFile(file: File) {
    const request = ++importSequence.current;
    try {
      if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') throw new Error('Выберите SVG-файл.');
      if (file.size > maxSvgBytes) throw new Error('SVG превышает 1 МБ. Упростите исходный файл.');
      const source = await file.text();
      if (request === importSequence.current) loadSource(file.name.replace(/\.svg$/i, ''), source);
    } catch (cause) {
      if (request === importSequence.current) setError(cause instanceof Error ? cause.message : 'Не удалось открыть файл.');
    }
  }

  function drop(event: DragEvent) {
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
    setError('');
    change(() => emptyProject);
  }

  function angle(preset: CameraPreset) {
    change((current) => ({ ...current, camera: { ...current.camera, preset, position: cameraPositions[preset], target: [0, 0, 0], zoom: 1 } }));
  }

  return <div className="studio"
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
      <div className="brand"><span className="brand-mark"><Box size={19} strokeWidth={2.3} /></span>Logo Studio</div>
      <div className="topbar-actions">
        <IconButton label="Новый проект" onClick={newProject}><FilePlus2 size={17} /></IconButton>
        <span className="divider" />
        <IconButton label="Отменить" disabled={!past.length} onClick={undo}><Undo2 size={17} /></IconButton>
        <IconButton label="Повторить" disabled={!future.length} onClick={redo}><Redo2 size={17} /></IconButton>
      </div>
      <input type="file" aria-label="Выбрать SVG" accept=".svg,image/svg+xml" ref={fileField} hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void loadFile(file);
        }} />
      <button className="primary" onClick={() => fileField.current?.click()}><ArrowDownToLine size={16} />Импорт SVG</button>
    </header>

    <div className="workspace">
      <aside className="sidebar" aria-label="Слои и примеры">
        <div className="panel-title"><Layers3 size={16} />Слои<span className="count">{project.layers.length}</span></div>
        <div className="layer-list">
          {project.layers.map((layer) => <div key={layer.id} className={'layer' + (layer.id === selectedId ? ' selected' : '')}>
            <button className="layer-label" aria-pressed={layer.id === selectedId} onClick={() => select(layer.id)}>
              <span className="swatch" style={{ backgroundColor: layer.material === 'gold' ? '#eec269' : layer.color }} />
              <span>{layer.name}</span>
            </button>
            <IconButton label={(layer.visible ? 'Скрыть ' : 'Показать ') + layer.name} onClick={() => updateLayer(layer.id, { visible: !layer.visible })}>
              {layer.visible ? <Eye size={15} /> : <EyeOff size={15} />}
            </IconButton>
          </div>)}
          {!project.layers.length && <p className="muted-empty">Импортируйте SVG или откройте пример.</p>}
        </div>
        <div className="demo-list">
          <h2>Примеры</h2>
          {demos.map((item, index) => {
            const Icon = [Orbit, ArrowDownToLine, Aperture][index];
            return <button key={item.name} onClick={() => demo(item)}><Icon size={16} />{item.name}</button>;
          })}
        </div>
      </aside>

      <main className="canvas-panel">
        <div className="canvas-header">
          <div className="document"><h1>{project.name}</h1><span>3D-вьюпорт</span></div>
          <div className="canvas-tools">
            <IconButton label="Сетка" pressed={grid} onClick={() => setGrid(!grid)}><Grid2X2 size={17} /></IconButton>
            <IconButton label="Гизмо перемещения" pressed={gizmo} onClick={() => setGizmo(!gizmo)}><Move size={17} /></IconButton>
          </div>
        </div>
        <div className="viewport-host" ref={host} />
        {!project.layers.length && !graphicsError && <div className="empty-canvas">
          <Upload size={29} />
          <h2>Перетащите SVG сюда</h2>
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
        <div className="panel-title"><Aperture size={16} />Инспектор</div>
        {selected && <LayerInspector key={selected.id} layer={selected} />}
        <Section title="Свет и камера">
          <label className="field"><span>Свет</span><select value={project.light} onChange={(event) => {
            const light = event.target.value as LightPreset;
            change((current) => ({ ...current, light }));
          }}>
            {Object.entries(lights).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label className="field"><span>Проекция</span><select value={project.camera.projection} onChange={(event) => {
            const projection = event.target.value as typeof project.camera.projection;
            change((current) => ({ ...current, camera: { ...current.camera, projection, zoom: 1 } }));
          }}>
            <option value="perspective">Перспектива</option><option value="orthographic">Ортографическая</option>
          </select></label>
        </Section>
      </aside>
    </div>

    <footer className="statusbar"><span><Circle size={7} fill="currentColor" />{graphicsError ? 'WebGL недоступен' : 'Локальный предпросмотр'}</span>
      <span>{project.layers.filter((layer) => layer.visible).length} / {project.layers.length} видимых слоёв</span></footer>
    {dragging && <div className="drop-target"><Upload size={32} />Отпустите SVG для импорта</div>}
  </div>;
}
