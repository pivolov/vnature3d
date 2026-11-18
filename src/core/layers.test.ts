import { expect, it } from 'vitest';
import { emptyProject, type Project } from './project';
import { deleteNode, duplicateNode, effectiveLayer, makeLayer, moveNode } from './layers';

it('prevents cycles, inherits lock and visibility, and keeps contents on ungrouping', () => {
  const layer = makeLayer('Icon', [], '#fff');
  const project: Project = { ...emptyProject, layers: [layer], groups: [
    { id: 'parent', name: 'Parent', visible: false, locked: true },
    { id: 'child', name: 'Child', visible: true, parentId: 'parent' },
  ] };
  const next = moveNode(project, layer.id, 'child');
  expect(moveNode(next, 'parent', 'child')).toBe(next);
  expect(effectiveLayer(next, next.layers[0])).toMatchObject({ visible: false, locked: true });
  const duplicated = duplicateNode(next, 'parent');
  expect(duplicated.groups).toHaveLength(4);
  expect(duplicated.layers).toHaveLength(2);
  const ungrouped = deleteNode(next, 'child');
  expect(ungrouped.layers[0].parentId).toBe('parent');
});
