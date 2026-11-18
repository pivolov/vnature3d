import { create } from 'zustand';
import { cameraId } from '../animation/timeline';
import { treeItems } from './layers';
import { emptyProject, type Layer, type Project } from './project';

type Editor = {
  project: Project;
  past: Project[];
  future: Project[];
  selectedId: string | null;
  select: (id: string) => void;
  change: (update: (project: Project) => Project) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  restore: (project: Project) => void;
  undo: () => void;
  redo: () => void;
};

function selection(project: Project, id: string | null) {
  return treeItems(project).some(({ node }) => node.id === id) ? id : project.layers[0]?.id ?? project.groups?.[0]?.id ?? null;
}

export function createEditor(project = emptyProject) {
  return create<Editor>((set, get) => ({
    project,
    past: [],
    future: [],
    selectedId: selection(project, null),
    select: (selectedId) => set({ selectedId }),
    restore: (project) => set({ project, past: [], future: [], selectedId: selection(project, null) }),
    change: (update) => set((state) => {
      let project = update(state.project);
      if (project === state.project) return state;
      if (project.layers !== state.project.layers && project.timeline) {
        const ids = new Set(project.layers.map(({ id }) => id));
        const tracks = project.timeline.tracks.filter(({ target }) => target === cameraId || ids.has(target));
        if (tracks.length !== project.timeline.tracks.length) project = { ...project, timeline: { ...project.timeline, tracks } };
      }
      return { project, past: [...state.past.slice(-29), state.project], future: [], selectedId: selection(project, state.selectedId) };
    }),
    updateLayer: (id, patch) => get().change((project) => ({
      ...project,
      layers: project.layers.map((layer) => layer.id === id ? { ...layer, ...patch } : layer),
    })),
    undo: () => set((state) => {
      const project = state.past.at(-1);
      if (!project) return state;
      return { project, past: state.past.slice(0, -1), future: [state.project, ...state.future], selectedId: selection(project, state.selectedId) };
    }),
    redo: () => set((state) => {
      const [project, ...future] = state.future;
      if (!project) return state;
      return { project, past: [...state.past, state.project], future, selectedId: selection(project, state.selectedId) };
    }),
  }));
}
