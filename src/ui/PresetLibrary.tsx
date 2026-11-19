import { Play, Search, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { type Easing } from '../animation/easing';
import { presetDefaults, presetGraph, presets, templates, type PresetId, type PresetOptions, type TemplateId } from '../animation/presets';

export type PresetSelection = { type: 'preset'; id: PresetId } | { type: 'template'; id: TemplateId };
type Props = {
  emptyScene: boolean; canAnimate: boolean; canAnimateSelected: boolean;
  preview: (value: { selection: PresetSelection; options: PresetOptions; all: boolean } | null) => void;
  apply: (selection: PresetSelection, options: PresetOptions, all: boolean) => void;
};
const graphs = new Map((Object.keys(presets) as PresetId[]).map((id) => [id, presetGraph(id)]));
const categories = [...new Set(Object.values(presets).map(({ group }) => group))];
const presetOptions = [
  ['duration', 'Длина, с', 0.1, 20, 0.1], ['delay', 'Задержка, с', 0, 30, 0.05],
  ['intensity', 'Сила', 0, 3, 0.05], ['stagger', 'Каскад, с', 0, 5, 0.05],
] as const;
const easingOptions = {
  smooth: { kind: 'named', family: 'sine', direction: 'in-out' },
  exit: { kind: 'named', family: 'cubic', direction: 'out' },
  elastic: { kind: 'named', family: 'elastic', direction: 'out' },
  linear: { kind: 'linear' },
} satisfies Record<string, Easing>;

export function PresetLibrary({ emptyScene, canAnimate, canAnimateSelected, preview, apply }: Props) {
  const [selection, setSelection] = useState<PresetSelection>({ type: 'preset', id: 'fade' });
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(categories[0]);
  const [library, setLibrary] = useState<PresetSelection['type']>('preset');
  const [options, setOptions] = useState(presetDefaults);
  const [scope, setScope] = useState<'selected' | 'all'>('selected');
  const [easing, setEasing] = useState<keyof typeof easingOptions>('smooth');
  const all = scope === 'all';
  const canTarget = all ? canAnimate : canAnimateSelected;
  const eligible = (entry: PresetSelection) => canTarget || (entry.type === 'template' ? emptyScene : entry.id === 'orbit');
  const term = query.trim().toLocaleLowerCase('ru');
  const items = library === 'preset'
    ? (Object.entries(presets) as [PresetId, typeof presets[PresetId]][])
      .filter(([id, item]) => term ? [id, item.label, item.group].some((text) => text.toLocaleLowerCase('ru').includes(term)) : item.group === category)
      .map(([id, item]) => ({ name: item.label, entry: { type: 'preset', id } as const }))
    : (Object.entries(templates) as [TemplateId, typeof templates[TemplateId]][])
      .filter(([id, item]) => [id, item.label].some((text) => text.toLocaleLowerCase('ru').includes(term)))
      .map(([id, item]) => ({ name: item.label, entry: { type: 'template', id } as const }));
  const active = items.find(({ entry }) => entry.id === selection.id)?.entry ?? items[0]?.entry;

  function show(entry: PresetSelection) {
    if (eligible(entry)) preview({ selection: entry, options, all });
  }

  return <div className="preset-library">
    <div className="preset-tabs">
      <button type="button" aria-pressed={library === 'preset'} onClick={() => { setLibrary('preset'); setQuery(''); preview(null); }}>Движение</button>
      <button type="button" aria-pressed={library === 'template'} onClick={() => { setLibrary('template'); setQuery(''); preview(null); }}>Шаблоны</button>
    </div>
    <div className="preset-search"><Search size={14} aria-hidden="true" />
      <input aria-label="Поиск в библиотеке" placeholder={library === 'preset' ? 'Найти движение…' : 'Найти шаблон…'} value={query}
        onChange={(event) => { setQuery(event.currentTarget.value); preview(null); }} />
      {query && <button type="button" aria-label="Очистить поиск" onClick={(event) => {
        event.currentTarget.parentElement?.querySelector('input')?.focus(); setQuery(''); preview(null);
      }}><X size={14} /></button>}
    </div>
    {library === 'preset' && !term && <label className="preset-field"><span>Категория</span>
      <select value={category} onChange={(event) => { setCategory(event.currentTarget.value); preview(null); }}>
        {categories.map((item) => <option key={item}>{item}</option>)}
      </select></label>}
    <div className="preset-list">
      {items.map(({ name, entry }) => <button type="button" key={entry.id}
        aria-pressed={active?.id === entry.id} disabled={!eligible(entry)} title="Наведите для предпросмотра"
        onPointerEnter={(event) => { if (event.pointerType === 'mouse') show(entry); }} onPointerLeave={() => preview(null)}
        onClick={() => setSelection(entry)}>
        <svg viewBox="0 0 44 36" aria-hidden="true" className="preset-graph">
          <path d="M4 29H40" className="preset-grid" />
          <path d={graphs.get(entry.type === 'preset' ? entry.id : templates[entry.id].sequence[0])} className="preset-shape" />
        </svg>
        <span>{name}</span>
      </button>)}
    </div>
    {!active && <p role="status" className="preset-note">Совпадений нет. Попробуйте другое название.</p>}
    {active && <>
    {active.id !== 'orbit' && !(emptyScene && active.type === 'template') && <label className="preset-field"><span>Применить к</span>
      <select value={scope} onChange={(event) => { setScope(event.currentTarget.value as typeof scope); preview(null); }}>
        <option value="selected">Выбранному</option><option value="all">Всей сцене</option>
      </select></label>}
    {!eligible(active) && <p className="preset-note">{canAnimate ? 'Выберите доступный слой или укажите «Всей сцене».' : 'Для движения нужен видимый разблокированный слой.'}</p>}
    <details className="preset-options"><summary>Параметры пресета</summary><div className="preset-fields">
      {presetOptions.map(([key, label, min, max, step]) => <label className="preset-field" key={key}><span>{label}</span>
        <input type="number" min={min} max={max} step={step} defaultValue={options[key]}
          onBlur={(event) => {
            const raw = event.currentTarget.valueAsNumber;
            const value = Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : options[key];
            event.currentTarget.value = String(value);
            setOptions((previous) => ({ ...previous, [key]: value }));
          }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>)}
      <label className="preset-field"><span>Ось</span>
        <select value={options.direction} onChange={(event) => setOptions({ ...options, direction: event.currentTarget.value as PresetOptions['direction'] })}>
          {['x', 'y', 'z', '-x', '-y', '-z'].map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}
        </select></label>
      <label className="preset-field"><span>Порядок</span>
        <select value={options.order} onChange={(event) => setOptions({ ...options, order: event.currentTarget.value as PresetOptions['order'] })}>
          <option value="forward">По порядку</option><option value="center">От центра</option><option value="random">Случайно</option>
        </select></label>
      <label className="preset-field"><span>Кривая</span>
        <select value={easing} onChange={(event) => {
          const next = event.currentTarget.value as keyof typeof easingOptions;
          setEasing(next); setOptions({ ...options, easing: easingOptions[next] });
        }}>
          <option value="smooth">Мягкая</option><option value="exit">Плавный выход</option>
          <option value="elastic">Упругая</option><option value="linear">Линейная</option>
        </select></label>
    </div></details>
    <p className="preset-note">При пересечении заменяются ключи тех же свойств в диапазоне пресета.</p>
    <div className="preset-actions">
      <button type="button" className="secondary" disabled={!eligible(active)} onFocus={() => show(active)} onBlur={() => preview(null)}
        onPointerEnter={() => show(active)} onPointerLeave={() => preview(null)} onClick={() => show(active)} title="Предпросмотр">
        <Play size={14} /><span>Смотреть</span>
      </button>
      <button type="button" className="primary" disabled={!eligible(active)} onClick={() => {
        preview(null); apply(active, options, all);
      }}><Sparkles size={14} />Применить</button>
    </div></>}
  </div>;
}
