import { create } from 'zustand';
import { emptyProject, type Layer, type Project } from './project';

type Editor = {
  project: Project;
  past: Project[];
  future: Project[];
  selectedId: string | null;
  select: (id: string) => void;
  change: (update: (project: Project) => Project) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  undo: () => void;
  redo: () => void;
};

function selection(project: Project, id: string | null) {
  return project.layers.some((layer) => layer.id === id) ? id : project.layers[0]?.id ?? null;
}

export function createEditor(project = emptyProject) {
  return create<Editor>((set, get) => ({
    project,
    past: [],
    future: [],
    selectedId: selection(project, null),
    select: (selectedId) => set({ selectedId }),
    change: (update) => set((state) => {
      const project = update(state.project);
      if (project === state.project) return state;
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
