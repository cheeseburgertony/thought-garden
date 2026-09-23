import { create } from "zustand";
import type { CanvasEdge, CanvasSnapshot, ThoughtNode } from "@/lib/types";
import type { Viewport } from "@xyflow/react";

type CanvasState = CanvasSnapshot & {
  theme: "light" | "dark";
  undoStack: CanvasSnapshot[];
  redoStack: CanvasSnapshot[];
  setNodes: (nodes: ThoughtNode[]) => void;
  setEdges: (edges: CanvasEdge[]) => void;
  setViewport: (viewport: Viewport) => void;
  setTheme: (theme: "light" | "dark") => void;
  checkpoint: () => void;
  addThought: (node: ThoughtNode, edge?: CanvasEdge) => void;
  addThoughts: (nodes: ThoughtNode[], edges: CanvasEdge[]) => void;
  updateThought: (id: string, text: string) => void;
  removeThoughts: (ids: string[]) => void;
  connect: (edge: CanvasEdge) => void;
  removeEdges: (ids: string[]) => void;
  importCanvas: (snapshot: CanvasSnapshot) => void;
  clearCanvas: () => void;
  undo: () => void;
  redo: () => void;
};

const emptySnapshot = (): CanvasSnapshot => ({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });

export const useCanvasStore = create<CanvasState>((set, get) => {
  const snapshot = (): CanvasSnapshot => {
    const { nodes, edges, viewport } = get();
    return { nodes, edges, viewport };
  };
  const checkpoint = () => set((state) => ({
    undoStack: [...state.undoStack.slice(-49), { nodes: state.nodes, edges: state.edges, viewport: state.viewport }],
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
    connect: (edge) => {
      const { edges } = get();
      if (edges.some((item) => item.source === edge.source && item.target === edge.target)) return;
      checkpoint();
      set({ edges: [...edges, edge] });
    },
    removeEdges: (ids) => {
      if (!ids.length) return;
      checkpoint();
      const remove = new Set(ids);
      set((state) => ({ edges: state.edges.filter(({ id }) => !remove.has(id)) }));
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
