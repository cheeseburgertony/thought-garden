import { create } from "zustand";
import type { CanvasEdge, CanvasSnapshot, CanvasSummary, ThoughtNode } from "@/lib/types";
import { getDescendantIds } from "@/lib/canvas-graph";
import type { Viewport } from "@xyflow/react";

type CanvasState = CanvasSnapshot & {
  theme: "light" | "dark";
  undoStack: CanvasSnapshot[];
  redoStack: CanvasSnapshot[];
  setNodes: (nodes: ThoughtNode[]) => void;
  setEdges: (edges: CanvasEdge[]) => void;
  setViewport: (viewport: Viewport) => void;
  setTheme: (theme: "light" | "dark") => void;
  setSummary: (summary: CanvasSummary | null) => void;
  checkpoint: () => void;
  addThought: (node: ThoughtNode, edge?: CanvasEdge) => void;
  addThoughts: (nodes: ThoughtNode[], edges: CanvasEdge[]) => void;
  updateThought: (id: string, text: string) => void;
  removeThoughts: (ids: string[]) => void;
  removeSelection: () => void;
  connect: (edge: CanvasEdge) => void;
  toggleBranch: (id: string) => void;
  importCanvas: (snapshot: CanvasSnapshot) => void;
  clearCanvas: () => void;
  undo: () => void;
  redo: () => void;
};

const emptySnapshot = (): CanvasSnapshot => ({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1.1 }, summary: null });

export const useCanvasStore = create<CanvasState>((set, get) => {
  const snapshot = (): CanvasSnapshot => {
    const { nodes, edges, viewport, summary } = get();
    return { nodes, edges, viewport, summary };
  };
  const checkpoint = () => set((state) => ({
    undoStack: [...state.undoStack.slice(-49), { nodes: state.nodes, edges: state.edges, viewport: state.viewport, summary: state.summary }],
    redoStack: [],
  }));

  return {
    ...emptySnapshot(),
    theme: "light",
    undoStack: [],
    redoStack: [],
    setNodes: (nodes) => set({ nodes }),
    setEdges: (edges) => set({ edges }),
    setViewport: (viewport) => set({ viewport }),
    setTheme: (theme) => set({ theme }),
    setSummary: (summary) => {
      checkpoint();
      set({ summary });
    },
    checkpoint,
    addThought: (node, edge) => {
      checkpoint();
      set((state) => ({ nodes: [...state.nodes, node], edges: edge ? [...state.edges, edge] : state.edges }));
    },
    addThoughts: (nodes, edges) => {
      if (!nodes.length) return;
      checkpoint();
      set((state) => ({ nodes: [...state.nodes, ...nodes], edges: [...state.edges, ...edges] }));
    },
    updateThought: (id, text) => {
      checkpoint();
      set((state) => ({ nodes: state.nodes.map((node) => node.id === id ? { ...node, data: { ...node.data, text } } : node) }));
    },
    removeThoughts: (ids) => {
      if (!ids.length) return;
      checkpoint();
      const remove = new Set(ids);
      set((state) => ({
        nodes: state.nodes.filter(({ id }) => !remove.has(id)),
        edges: state.edges.filter(({ source, target }) => !remove.has(source) && !remove.has(target)),
      }));
    },
    removeSelection: () => {
      const state = get();
      const selectedNodes = new Set(state.nodes.filter((node) => node.selected).map(({ id }) => id));
      const removedEdges = new Set(state.edges.filter((edge) =>
        edge.selected || selectedNodes.has(edge.source) || selectedNodes.has(edge.target),
      ).map(({ id }) => id));
      if (!selectedNodes.size && !removedEdges.size) return;
      checkpoint();
      set({
        nodes: state.nodes.filter(({ id }) => !selectedNodes.has(id)),
        edges: state.edges.filter(({ id }) => !removedEdges.has(id)),
      });
    },
    connect: (edge) => {
      const { edges } = get();
      if (edges.some((item) => item.source === edge.source && item.target === edge.target)) return;
      checkpoint();
      set({ edges: [...edges, edge] });
    },
    toggleBranch: (id) => {
      const state = get();
      const node = state.nodes.find((item) => item.id === id);
      if (!node || !state.edges.some((edge) => edge.source === id && edge.target !== id)) return;
      const collapsing = !node.data.collapsed;
      const descendants = collapsing ? getDescendantIds(id, state.edges) : new Set<string>();
      checkpoint();
      set({
        nodes: state.nodes.map((item) => item.id === id
          ? { ...item, data: { ...item.data, collapsed: collapsing } }
          : descendants.has(item.id) && item.selected ? { ...item, selected: false } : item),
        edges: descendants.size
          ? state.edges.map((edge) => descendants.has(edge.source) || descendants.has(edge.target)
            ? { ...edge, selected: false }
            : edge)
          : state.edges,
      });
    },
    importCanvas: (next) => {
      checkpoint();
      set({ ...next, undoStack: get().undoStack, redoStack: [] });
    },
    clearCanvas: () => {
      checkpoint();
      set({ ...emptySnapshot(), undoStack: get().undoStack, redoStack: [] });
    },
    undo: () => {
      const state = get();
      const previous = state.undoStack.at(-1);
      if (!previous) return;
      set({ ...previous, undoStack: state.undoStack.slice(0, -1), redoStack: [...state.redoStack, snapshot()] });
    },
    redo: () => {
      const state = get();
      const next = state.redoStack.at(-1);
      if (!next) return;
      set({ ...next, redoStack: state.redoStack.slice(0, -1), undoStack: [...state.undoStack, snapshot()] });
    },
  };
});
