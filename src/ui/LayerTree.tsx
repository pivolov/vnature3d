import { ChevronDown, ChevronLeft, ChevronRight, Copy, Eye, EyeOff, Folder, FolderPlus, GripVertical, Lock, Pencil, Trash2, Unlock } from 'lucide-react';
import { memo, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import { childrenOf, deleteNode, duplicateNode, moveNode, treeItems, updateNode, type TreeItem } from '../core/layers';
import type { Project } from '../core/project';

type Props = {
  project: Project;
  selectedId: string | null;
  change: (update: (project: Project) => Project) => void;
  select: (id: string) => void;
};

const dragType = 'application/x-logo-studio-layer';

export const LayerTree = memo(function LayerTree({ project, selectedId, change, select }: Props) {
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [rename, setRename] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(6);
  useLayoutEffect(() => {
    if (!list.current) return;
    const observer = new ResizeObserver(([entry]) => setPageSize(Math.max(1, Math.floor((entry.contentRect.height - 3) / 39))));
    observer.observe(list.current);
    return () => observer.disconnect();
  }, []);
  const selected = treeItems(project).find(({ node }) => node.id === selectedId);

  function group() {
    const id = crypto.randomUUID();
    change((current) => {
      const parentId = selected?.node.parentId;
      const groups = [...(current.groups ?? []), { id, parentId, name: 'Группа', visible: true }];
      const next = moveNode({ ...current, groups }, id, parentId, selected?.node.id);
      return selected ? moveNode(next, selected.node.id, id) : next;
    });
    select(id);
  }

  function allowDrop(event: DragEvent, target: string) {
    if (!event.dataTransfer.types.includes(dragType)) return;
    event.preventDefault();
    event.stopPropagation();
    setDropId(target);
  }

  function drop(event: DragEvent, parentId?: string, before?: string) {
    const id = event.dataTransfer.getData(dragType);
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    setDropId(null);
    change((current) => moveNode(current, id, parentId, before));
    if (parentId) setCollapsed((previous) => new Set([...previous].filter((entry) => entry !== parentId)));
  }

  function flatten(parentId?: string, depth = 0): Array<TreeItem & { depth: number }> {
    return childrenOf(project, parentId).flatMap((item) => [
      { ...item, depth }, ...(item.kind === 'group' && !collapsed.has(item.node.id) ? flatten(item.node.id, depth + 1) : []),
    ]);
  }
  const entries = flatten();
  const pages = Math.max(1, Math.ceil(entries.length / pageSize));
  const currentPage = Math.min(page, pages - 1);

  function rows() {
    return entries.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(({ node, kind, depth }) => <div key={node.id}>
      <div className={'layer tree-row' + (selectedId === node.id ? ' selected' : '') + (dropId === node.id ? ' drag-over' : '')}
        style={{ paddingInlineStart: Math.min(depth, 6) * 10 }}
        onDragOver={(event) => allowDrop(event, node.id)}
        onDrop={(event) => {
          if (kind === 'group' && !event.shiftKey) drop(event, node.id);
          else drop(event, node.parentId, node.id);
        }}>
        <span className="drag-grip" draggable title="Перетащите для перемещения. Shift — поставить перед группой."
          onDragStart={(event) => {
            event.dataTransfer.setData(dragType, node.id);
            event.dataTransfer.effectAllowed = 'move';
          }}
          onDragEnd={() => setDropId(null)}><GripVertical size={13} /></span>
        {kind === 'group' && <button className="tree-icon" aria-label={(collapsed.has(node.id) ? 'Развернуть ' : 'Свернуть ') + node.name}
          aria-expanded={!collapsed.has(node.id)} onClick={() => setCollapsed((previous) => {
            const next = new Set(previous);
            if (next.has(node.id)) next.delete(node.id);
            else next.add(node.id);
            return next;
          })}><ChevronDown size={13} /></button>}
        {rename === node.id ? <input className="rename-field" aria-label="Название слоя или группы" autoFocus defaultValue={node.name}
          onBlur={(event) => {
            const name = event.currentTarget.value.trim().slice(0, 80);
            if (name && name !== node.name) change((current) => updateNode(current, node.id, { name }));
            setRename(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              event.currentTarget.value = node.name;
              event.currentTarget.blur();
            }
          }} />
          : <button className="layer-label" aria-pressed={selectedId === node.id} onClick={() => select(node.id)} onDoubleClick={() => setRename(node.id)}>
            {kind === 'group' ? <Folder size={14} /> : <span className="swatch" style={{ backgroundColor: node.color }} />}
            <span>{node.name}</span>
          </button>}
        <button className="tree-icon" title={node.visible ? 'Скрыть' : 'Показать'} aria-label={(node.visible ? 'Скрыть ' : 'Показать ') + node.name}
          onClick={() => change((current) => updateNode(current, node.id, { visible: !node.visible }))}>
          {node.visible ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
      </div>
    </div>);
  }

  return <>
    <div className="tree-tools" aria-label="Действия со слоями">
      <button className="tree-icon" title="Создать группу" aria-label="Создать группу" onClick={group}><FolderPlus size={15} /></button>
      <button className="tree-icon" title="Переименовать" aria-label="Переименовать" disabled={!selected}
        onClick={() => { if (selected) setRename(selected.node.id); }}><Pencil size={14} /></button>
      <button className="tree-icon" title={selected?.node.locked ? 'Разблокировать' : 'Заблокировать'}
        aria-label={selected?.node.locked ? 'Разблокировать' : 'Заблокировать'} aria-pressed={!!selected?.node.locked} disabled={!selected}
        onClick={() => { if (selected) change((current) => updateNode(current, selected.node.id, { locked: !selected.node.locked })); }}>
        {selected?.node.locked ? <Lock size={14} /> : <Unlock size={14} />}
      </button>
      <button className="tree-icon" title="Дублировать" aria-label="Дублировать" disabled={!selected}
        onClick={() => { if (selected) change((current) => duplicateNode(current, selected.node.id)); }}><Copy size={14} /></button>
      <button className="tree-icon" title={selected?.kind === 'group' ? 'Разгруппировать' : 'Удалить слой'}
        aria-label={selected?.kind === 'group' ? 'Разгруппировать' : 'Удалить слой'} disabled={!selected}
        onClick={() => { if (selected) change((current) => deleteNode(current, selected.node.id)); }}><Trash2 size={14} /></button>
    </div>
    <div ref={list} className="layer-list tree-list" onDragOver={(event) => allowDrop(event, '')} onDrop={(event) => drop(event)}>
      {rows()}
      {!project.layers.length && !project.groups?.length && <p className="muted-empty">Импортируйте изображение или добавьте фигуру.</p>}
    </div>
    <div className="layer-page" onDragOver={(event) => allowDrop(event, '')} onDrop={(event) => drop(event)}>
      {dropId !== null && <div className={'tree-root-drop' + (!dropId ? ' drag-over' : '')}>В корень</div>}
      <button className="tree-icon" aria-label="Предыдущая страница слоёв" disabled={currentPage === 0}
        onClick={() => setPage(currentPage - 1)}><ChevronLeft size={14} /></button>
      <output>{currentPage + 1} / {pages}</output>
      <button className="tree-icon" aria-label="Следующая страница слоёв" disabled={currentPage >= pages - 1}
        onClick={() => setPage(currentPage + 1)}><ChevronRight size={14} /></button>
    </div>
  </>;
});
