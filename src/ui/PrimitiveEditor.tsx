import { useRef, useState } from 'react';
import { makeLayer } from '../core/layers';
import type { Layer } from '../core/project';
import { combineShapes, primitiveNames, primitiveShape, textShapes, type BooleanOperation, type Primitive } from '../geometry/primitives';

const booleanNames: Record<BooleanOperation, string> = {
  union: 'Объединить', difference: 'Вычесть', intersection: 'Пересечь',
};

export function PrimitiveEditor({ layers, selected, onAdd, onCombine, onError }: {
  layers: Layer[]; selected?: Layer;
  onAdd: (layer: Layer) => void;
  onCombine: (first: string, second: string, layer: Layer) => void;
  onError: (message: string) => void;
}) {
  const [shape, setShape] = useState<Primitive | 'text'>('rectangle');
  const [sides, setSides] = useState(5);
  const [text, setText] = useState('');
  const [font, setFont] = useState('Noto-Sans');
  const [customFont, setCustomFont] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [selectedOperand, setOperand] = useState('');
  const [operation, setOperation] = useState<BooleanOperation>('union');
  const request = useRef(0);
  const addCurrent = useRef(onAdd);
  addCurrent.current = onAdd;
  const candidates = layers.filter((layer) => layer.id !== selected?.id && !layer.relief && !layer.solid && !layer.locked);
  const operand = candidates.find((layer) => layer.id === selectedOperand) ?? candidates[0];

  async function add() {
    if (shape !== 'text') {
      const layer = makeLayer(primitiveNames[shape], [primitiveShape(shape, sides)], '#96c9dc');
      if (shape === 'sphere') { layer.solid = 'sphere'; layer.depth = 2.3; layer.bevel = 0; }
      if (shape === 'cube') { layer.depth = 2; layer.bevel = 0; }
      if (shape === 'disc' || shape === 'plane') { layer.depth = 0.01; layer.bevel = 0; }
      onAdd(layer);
      return;
    }
    const id = ++request.current;
    setBusy(true);
    onError('');
    try {
      let data;
      if (font === 'custom') {
        if (!customFont || customFont.size > 8 * 1024 * 1024) throw new Error('Выберите файл шрифта TTF или OTF до 8 МБ.');
        data = await customFont.arrayBuffer();
      } else {
        const response = await fetch(import.meta.env.BASE_URL + 'fonts/' + font + '.ttf');
        if (!response.ok) throw new Error('Не удалось загрузить шрифт.');
        data = await response.arrayBuffer();
      }
      const value = text.trim();
      const shapes = await textShapes(value, data);
      if (id === request.current) addCurrent.current(makeLayer(value, shapes, '#d6f494'));
    } catch (error) {
      if (id === request.current) onError(error instanceof Error ? error.message : 'Не удалось построить текст.');
    } finally {
      if (id === request.current) setBusy(false);
    }
  }

  function combine() {
    if (!selected || !operand) return;
    try {
      const shapes = combineShapes(selected, operand, operation);
      onCombine(selected.id, operand.id, {
        ...makeLayer(booleanNames[operation], shapes, selected.color),
        parentId: selected.parentId, position: [0, 0, selected.position[2]], material: selected.material,
        depth: selected.depth, bevel: Math.min(selected.bevel, 0.035),
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Не удалось выполнить операцию.');
    }
  }

  return <>
    <details className="primitive-panel">
      <summary>Добавить фигуру</summary>
      <div className="section-fields">
        <label className="field"><span>Фигура</span><select value={shape} onChange={(event) => setShape(event.target.value as typeof shape)}>
          {Object.entries(primitiveNames).map(([kind, name]) => <option key={kind} value={kind}>{name}</option>)}
          <option value="text">Текст</option>
        </select></label>
        {(shape === 'polygon' || shape === 'star') && <label className="field"><span>{shape === 'star' ? 'Лучи' : 'Стороны'}</span>
          <select value={sides} onChange={(event) => setSides(Number(event.target.value))}>
            {Array.from({ length: 10 }, (_, index) => index + 3).map((count) => <option key={count}>{count}</option>)}
          </select></label>}
        {shape === 'text' && <>
          <label className="field"><span>Текст</span><input type="text" value={text} maxLength={32}
            onChange={(event) => setText(event.target.value)} /></label>
          <label className="field"><span>Шрифт</span><select value={font} onChange={(event) => setFont(event.target.value)}>
            <option value="Noto-Sans">Noto Sans</option><option value="DM-Sans">DM Sans</option><option value="custom">Свой шрифт</option>
          </select></label>
          {font === 'custom' && <input type="file" accept=".ttf,.otf" aria-label="Файл шрифта" onChange={(event) => setCustomFont(event.target.files?.[0])} />}
        </>}
        <button className="secondary" disabled={busy || (shape === 'text' && (!text.trim() || (font === 'custom' && !customFont)))}
          onClick={() => void add()}>{busy ? 'Подготовка…' : 'Добавить'}</button>
      </div>
    </details>
    {selected && !selected.locked && !selected.relief && !selected.solid && operand && <details className="primitive-panel">
      <summary>Операции с контурами</summary>
      <div className="section-fields">
        <label className="field"><span>Со слоем</span><select value={operand.id} onChange={(event) => setOperand(event.target.value)}>
          {candidates.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        <label className="field"><span>Операция</span><select value={operation} onChange={(event) => setOperation(event.target.value as BooleanOperation)}>
          {Object.entries(booleanNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
        </select></label>
        <button className="secondary" onClick={combine}>Применить</button>
      </div>
    </details>}
  </>;
}
