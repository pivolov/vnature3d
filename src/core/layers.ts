import type { Layer, LayerGroup, Project, Shape } from './project';

export type TreeItem = { kind: 'layer'; node: Layer } | { kind: 'group'; node: LayerGroup };

export function treeItems(project: Project): TreeItem[] {
  return [
    ...project.layers.map((node): TreeItem => ({ kind: 'layer', node })),
    ...(project.groups ?? []).map((node): TreeItem => ({ kind: 'group', node })),
  ];
}

export function childrenOf(project: Project, parentId?: string) {
  return treeItems(project).filter(({ node }) => node.parentId === parentId)
    .sort((a, b) => (a.node.order ?? 0) - (b.node.order ?? 0));
}

export function isDescendant(project: Project, id: string, groupId: string) {
  const groups = new Map((project.groups ?? []).map((group) => [group.id, group]));
  let parent = treeItems(project).find(({ node }) => node.id === id)?.node.parentId;
  while (parent) {
    if (parent === groupId) return true;
    parent = groups.get(parent)?.parentId;
  }
  return false;
}

export function effectiveLayer(project: Project, layer: Layer) {
  let { visible, locked, parentId } = layer;
  while (parentId) {
    const group = project.groups?.find(({ id }) => id === parentId);
    if (!group) break;
    visible &&= group.visible;
    locked ||= group.locked;
    parentId = group.parentId;
  }
  return visible === layer.visible && locked === layer.locked ? layer : { ...layer, visible, locked };
}

export function updateNode(project: Project, id: string, patch: Partial<LayerGroup>) {
  return {
    ...project,
    layers: project.layers.map((layer) => layer.id === id ? { ...layer, ...patch } : layer),
    groups: project.groups?.map((group) => group.id === id ? { ...group, ...patch } : group),
  };
}

export function moveNode(project: Project, id: string, parentId?: string, before?: string) {
  if (id === parentId || id === before || (parentId && isDescendant(project, parentId, id))) return project;
  const siblings = childrenOf(project, parentId).map(({ node }) => node.id).filter((sibling) => sibling !== id);
  const index = before ? siblings.indexOf(before) : siblings.length;
  if (index < 0) return project;
  siblings.splice(index, 0, id);
  const orders = new Map(siblings.map((sibling, order) => [sibling, order]));
  const apply = <T extends Layer | LayerGroup>(node: T): T => {
    const order = orders.get(node.id);
    return order === undefined ? node : { ...node, parentId, order };
  };
  return { ...project, layers: project.layers.map(apply), groups: project.groups?.map(apply) };
}

export function duplicateNode(project: Project, id: string) {
  const source = treeItems(project).find(({ node }) => node.id === id);
  if (!source) return project;
  const ids = new Map<string, string>();
  const copy = <T extends Layer | LayerGroup>(node: T): T => {
    const duplicateId = crypto.randomUUID();
    ids.set(node.id, duplicateId);
    return { ...node, id: duplicateId, name: node.id === id ? node.name + ' — копия' : node.name,
      parentId: node.parentId ? ids.get(node.parentId) ?? node.parentId : undefined };
  };
  const groups = [...(project.groups ?? [])];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (group.id === id) {
      function copyGroup(node: LayerGroup) {
        groups.push(copy(node));
        project.groups?.filter(({ parentId }) => parentId === node.id).forEach(copyGroup);
      }
      copyGroup(group);
      break;
    }
  }
  const layers = [...project.layers];
  for (const layer of project.layers) {
    if (layer.id === id || (layer.parentId && ids.has(layer.parentId))) {
      const duplicate = copy(layer);
      if (layer.id === id) duplicate.position = [layer.position[0] + 0.2, layer.position[1] - 0.2, layer.position[2]];
      layers.push(duplicate);
    }
  }
  return { ...project, layers, groups };
}

export function deleteNode(project: Project, id: string) {
  const item = treeItems(project).find(({ node }) => node.id === id);
  if (!item) return project;
  const remaining: Project = {
    ...project,
    layers: project.layers.filter((layer) => layer.id !== id),
    groups: project.groups?.filter((group) => group.id !== id),
  };
  return item.kind === 'group' ? childrenOf(project, id).reduce(
    (next, { node }) => moveNode(next, node.id, item.node.parentId), remaining) : remaining;
}

export function makeLayer(name: string, shapes: Shape[], color: string): Layer {
  return {
    id: crypto.randomUUID(), name, shapes, color, material: 'clay', opacity: 1, visible: true,
    depth: 0.55, bevel: 0.045, bevelSegments: 6, position: [0, 0, 0], rotation: [0, 0, 0],
  };
}
