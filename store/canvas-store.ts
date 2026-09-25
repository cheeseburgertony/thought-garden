import { create } from "zustand";
import { nanoid } from "nanoid";
import type {
  CanvasAction,
  CanvasBoard,
  CanvasEdge,
  CanvasSnapshot,
  CanvasSummary,
  CanvasWorkspace,
  ThoughtNode,
  ThoughtVerification,
} from "@/lib/types";
import { getDescendantIds } from "@/lib/canvas-graph";
import { createCanvasBoard, emptyCanvasSnapshot } from "@/lib/persistence";
import type { Viewport } from "@xyflow/react";

type CanvasEditSnapshot = Pick<CanvasSnapshot, "nodes" | "edges" | "viewport" | "actions">;

type CanvasState = CanvasSnapshot & {
  canvases: CanvasBoard[];
  activeCanvasId: string;
  theme: "light" | "dark";
  undoStack: CanvasEditSnapshot[];
  redoStack: CanvasEditSnapshot[];
  getWorkspace: () => CanvasWorkspace;
  hydrateWorkspace: (workspace: CanvasWorkspace) => void;
  createCanvas: (name?: string) => string;
  renameCanvas: (id: string, name: string) => void;
  duplicateCanvas: (id: string) => string | null;
  switchCanvas: (id: string) => void;
  importCanvas: (board: CanvasBoard) => void;
  mergeCanvases: (boards: CanvasBoard[], activeId: string) => void;
  setNodes: (nodes: ThoughtNode[]) => void;
  setEdges: (edges: CanvasEdge[]) => void;
  setViewport: (viewport: Viewport) => void;
  setTheme: (theme: "light" | "dark") => void;
  addSummary: (summary: CanvasSummary) => boolean;
  addAction: (action: CanvasAction) => void;
  updateAction: (id: string, patch: Partial<CanvasAction>) => boolean;
  updateVerification: (id: string, verification: ThoughtVerification) => void;
  checkpoint: () => void;
  addThought: (node: ThoughtNode, edge?: CanvasEdge) => void;
  addThoughts: (nodes: ThoughtNode[], edges: CanvasEdge[]) => void;
  updateThought: (id: string, text: string) => void;
  removeThoughts: (ids: string[]) => void;
  removeSelection: () => void;
  connect: (edge: CanvasEdge) => void;
  toggleBranch: (id: string) => void;
  clearCanvas: () => void;
  undo: () => void;
  redo: () => void;
};

const snapshotFromState = (state: CanvasState): CanvasSnapshot => ({
  nodes: state.nodes,
  edges: state.edges,
  viewport: state.viewport,
  summaries: state.summaries,
  actions: state.actions,
});
const editSnapshotFromState = (state: CanvasState): CanvasEditSnapshot => ({
  nodes: state.nodes,
  edges: state.edges,
  viewport: state.viewport,
  actions: state.actions,
});

function sameSummaryContent(left: CanvasSummary, right: CanvasSummary) {
  return JSON.stringify({
    scope: left.scope,
    conclusion: left.conclusion,
    openQuestions: left.openQuestions,
    nextAction: left.nextAction,
    sourceNodeIds: left.sourceNodeIds,
    verifiedEvidence: left.verifiedEvidence,
    unverifiedAssumptions: left.unverifiedAssumptions,
    refutedClaims: left.refutedClaims,
  }) === JSON.stringify({
    scope: right.scope,
    conclusion: right.conclusion,
    openQuestions: right.openQuestions,
    nextAction: right.nextAction,
    sourceNodeIds: right.sourceNodeIds,
    verifiedEvidence: right.verifiedEvidence,
    unverifiedAssumptions: right.unverifiedAssumptions,
    refutedClaims: right.refutedClaims,
  });
}

function cleanSelection(snapshot: CanvasSnapshot): CanvasSnapshot {
  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) => ({ ...node, selected: false })),
    edges: snapshot.edges.map((edge) => ({ ...edge, selected: false })),
  };
}

export const useCanvasStore = create<CanvasState>((set, get) => {
  const checkpoint = () => set((state) => ({
    undoStack: [...state.undoStack.slice(-49), editSnapshotFromState(state)],
    redoStack: [],
  }));

  const setSnapshot = (update: (snapshot: CanvasSnapshot) => CanvasSnapshot) => set((state) => {
    const next = update(snapshotFromState(state));
    const now = new Date().toISOString();
    return {
      ...next,
      canvases: state.canvases.map((canvas) => canvas.id === state.activeCanvasId
        ? { ...canvas, updatedAt: now, snapshot: next }
        : canvas),
    };
  });

  const activateCanvas = (state: CanvasState, canvas: CanvasBoard) => {
    const snapshot = cleanSelection(canvas.snapshot);
    return {
      ...snapshot,
      activeCanvasId: canvas.id,
      canvases: state.canvases.map((item) => item.id === state.activeCanvasId
        ? { ...item, snapshot: cleanSelection(snapshotFromState(state)) }
        : item.id === canvas.id ? { ...item, snapshot } : item),
      undoStack: [],
      redoStack: [],
    };
  };

  return {
    ...emptyCanvasSnapshot(),
    canvases: [],
    activeCanvasId: "",
    theme: "light",
    undoStack: [],
    redoStack: [],
    getWorkspace: () => {
      const state = get();
      const canvases = state.canvases.map((canvas) => canvas.id === state.activeCanvasId
        ? { ...canvas, snapshot: snapshotFromState(state) }
        : canvas);
      return { version: 2, type: "workspace", activeCanvasId: state.activeCanvasId, theme: state.theme, canvases };
    },
    hydrateWorkspace: (workspace) => {
      const activeCanvas = workspace.canvases.find((canvas) => canvas.id === workspace.activeCanvasId) ?? workspace.canvases[0];
      if (!activeCanvas) return;
      const snapshot = cleanSelection(activeCanvas.snapshot);
      set({
        ...snapshot,
        canvases: workspace.canvases.map((canvas) => canvas.id === activeCanvas.id ? { ...canvas, snapshot } : canvas),
        activeCanvasId: activeCanvas.id,
        theme: workspace.theme,
        undoStack: [],
        redoStack: [],
      });
    },
    createCanvas: (name = "未命名画布") => {
      const state = get();
      const currentSnapshot = snapshotFromState(state);
      const currentCanvas = state.canvases.find((canvas) => canvas.id === state.activeCanvasId);
      const canvas = createCanvasBoard(name);
      set({
        ...canvas.snapshot,
        canvases: [...state.canvases.map((item) => item.id === state.activeCanvasId && currentCanvas
          ? { ...currentCanvas, updatedAt: new Date().toISOString(), snapshot: currentSnapshot }
          : item), canvas],
        activeCanvasId: canvas.id,
        undoStack: [],
        redoStack: [],
      });
      return canvas.id;
    },
    renameCanvas: (id, name) => set((state) => ({
      canvases: state.canvases.map((canvas) => canvas.id === id
        ? { ...canvas, name: name.trim().slice(0, 80) || canvas.name, updatedAt: new Date().toISOString() }
        : canvas),
    })),
    duplicateCanvas: (id) => {
      const state = get();
      const source = id === state.activeCanvasId
        ? { ...state.canvases.find((canvas) => canvas.id === id)!, snapshot: snapshotFromState(state) }
        : state.canvases.find((canvas) => canvas.id === id);
      if (!source || state.canvases.length >= 100) return null;
      const now = new Date().toISOString();
      const copyId = nanoid();
      const summaryIds = new Map(source.snapshot.summaries.map((summary) => [summary.id, nanoid()]));
      const actionIds = new Map(source.snapshot.actions.map((action) => [action.id, nanoid()]));
      const copy: CanvasBoard = {
        id: copyId,
        name: `${source.name} 副本`.slice(0, 80),
        createdAt: now,
        updatedAt: now,
        snapshot: {
          ...cleanSelection(source.snapshot),
          summaries: source.snapshot.summaries.map((summary) => ({
            ...summary,
            id: summaryIds.get(summary.id)!,
            parentSummaryId: summary.parentSummaryId ? summaryIds.get(summary.parentSummaryId) : undefined,
            scope: { ...summary.scope, nodeIds: [...summary.scope.nodeIds] },
            sourceNodeIds: [...summary.sourceNodeIds],
            sourceSnapshots: summary.sourceSnapshots.map((item) => ({ ...item })),
            openQuestions: [...summary.openQuestions],
            verifiedEvidence: [...summary.verifiedEvidence],
            unverifiedAssumptions: [...summary.unverifiedAssumptions],
            refutedClaims: [...summary.refutedClaims],
          })),
          actions: source.snapshot.actions.map((action) => ({
            ...action,
            id: actionIds.get(action.id)!,
            sourceSummaryId: summaryIds.get(action.sourceSummaryId) ?? action.sourceSummaryId,
            position: { ...action.position },
          })),
        },
      };
      set((current) => ({ canvases: [...current.canvases.map((canvas) => canvas.id === current.activeCanvasId
        ? { ...canvas, snapshot: snapshotFromState(current) }
        : canvas), copy] }));
      return copyId;
    },
    switchCanvas: (id) => {
      const state = get();
      if (id === state.activeCanvasId) return;
      const canvas = state.canvases.find((item) => item.id === id);
      if (!canvas) return;
      set(activateCanvas(state, canvas));
    },
    importCanvas: (board) => {
      const state = get();
      if (state.canvases.length >= 100) return;
      const currentSnapshot = snapshotFromState(state);
      set({
        ...cleanSelection(board.snapshot),
        canvases: [...state.canvases.map((canvas) => canvas.id === state.activeCanvasId
          ? { ...canvas, snapshot: currentSnapshot }
          : canvas), board],
        activeCanvasId: board.id,
        undoStack: [],
        redoStack: [],
      });
    },
    mergeCanvases: (boards, activeId) => {
      const state = get();
      const available = Math.max(0, 100 - state.canvases.length);
      const imported = boards.slice(0, available);
      const target = imported.find((canvas) => canvas.id === activeId) ?? imported[0];
      if (!imported.length || !target) return;
      const currentSnapshot = snapshotFromState(state);
      const canvases = [...state.canvases.map((canvas) => canvas.id === state.activeCanvasId
        ? { ...canvas, snapshot: currentSnapshot }
        : canvas), ...imported];
      const targetSnapshot = cleanSelection(target.snapshot);
      set({
        ...targetSnapshot,
        canvases,
        activeCanvasId: target.id,
        undoStack: [],
        redoStack: [],
      });
    },
    setNodes: (nodes) => setSnapshot((snapshot) => ({ ...snapshot, nodes })),
    setEdges: (edges) => setSnapshot((snapshot) => ({ ...snapshot, edges })),
    setViewport: (viewport) => setSnapshot((snapshot) => ({ ...snapshot, viewport })),
    setTheme: (theme) => set({ theme }),
    addSummary: (summary) => {
      const state = get();
      const latest = state.summaries.at(-1);
      if (latest && sameSummaryContent(latest, summary)) return false;
      setSnapshot((snapshot) => ({ ...snapshot, summaries: [...snapshot.summaries, summary] }));
      return true;
    },
    addAction: (action) => {
      if (get().actions.some((item) => item.sourceSummaryId === action.sourceSummaryId)) return;
      checkpoint();
      setSnapshot((snapshot) => ({ ...snapshot, actions: [...snapshot.actions, action] }));
    },
    updateAction: (id, patch) => {
      const action = get().actions.find((item) => item.id === id);
      if (!action) return false;
      const next = { ...action, ...patch };
      if (next.status === "done" && !next.outcome.trim()) return false;
      checkpoint();
      setSnapshot((snapshot) => ({
        ...snapshot,
        actions: snapshot.actions.map((item) => item.id === id ? next : item),
      }));
      return true;
    },
    updateVerification: (id, verification) => {
      checkpoint();
      setSnapshot((snapshot) => ({
        ...snapshot,
        nodes: snapshot.nodes.map((node) => node.id === id
          ? { ...node, data: { ...node.data, verification } }
          : node),
      }));
    },
    checkpoint,
    addThought: (node, edge) => {
      checkpoint();
      setSnapshot((snapshot) => ({ ...snapshot, nodes: [...snapshot.nodes, node], edges: edge ? [...snapshot.edges, edge] : snapshot.edges }));
    },
    addThoughts: (nodes, edges) => {
      if (!nodes.length) return;
      checkpoint();
      setSnapshot((snapshot) => ({ ...snapshot, nodes: [...snapshot.nodes, ...nodes], edges: [...snapshot.edges, ...edges] }));
    },
    updateThought: (id, text) => {
      checkpoint();
      setSnapshot((snapshot) => ({ ...snapshot, nodes: snapshot.nodes.map((node) => node.id === id ? { ...node, data: { ...node.data, text } } : node) }));
    },
    removeThoughts: (ids) => {
      if (!ids.length) return;
      checkpoint();
      const remove = new Set(ids);
      setSnapshot((snapshot) => ({
        ...snapshot,
        nodes: snapshot.nodes.filter(({ id }) => !remove.has(id)),
        edges: snapshot.edges.filter(({ source, target }) => !remove.has(source) && !remove.has(target)),
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
      setSnapshot((snapshot) => ({
        ...snapshot,
        nodes: snapshot.nodes.filter(({ id }) => !selectedNodes.has(id)),
        edges: snapshot.edges.filter(({ id }) => !removedEdges.has(id)),
      }));
    },
    connect: (edge) => {
      const { edges } = get();
      if (edges.some((item) => item.source === edge.source && item.target === edge.target)) return;
      checkpoint();
      setSnapshot((snapshot) => ({ ...snapshot, edges: [...snapshot.edges, edge] }));
    },
    toggleBranch: (id) => {
      const state = get();
      const node = state.nodes.find((item) => item.id === id);
      if (!node || !state.edges.some((edge) => edge.source === id && edge.target !== id)) return;
      const collapsing = !node.data.collapsed;
      const descendants = collapsing ? getDescendantIds(id, state.edges) : new Set<string>();
      checkpoint();
      setSnapshot((snapshot) => ({
        ...snapshot,
        nodes: snapshot.nodes.map((item) => item.id === id
          ? { ...item, data: { ...item.data, collapsed: collapsing } }
          : descendants.has(item.id) && item.selected ? { ...item, selected: false } : item),
        edges: descendants.size
          ? snapshot.edges.map((edge) => descendants.has(edge.source) || descendants.has(edge.target)
            ? { ...edge, selected: false }
            : edge)
          : snapshot.edges,
      }));
    },
    clearCanvas: () => {
      checkpoint();
      setSnapshot(() => emptyCanvasSnapshot());
    },
    undo: () => {
      const state = get();
      const previous = state.undoStack.at(-1);
      if (!previous) return;
      const nextSnapshot = { ...snapshotFromState(state), ...previous };
      const now = new Date().toISOString();
      set({
        ...nextSnapshot,
        canvases: state.canvases.map((canvas) => canvas.id === state.activeCanvasId
          ? { ...canvas, updatedAt: now, snapshot: nextSnapshot }
          : canvas),
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, editSnapshotFromState(state)],
      });
    },
    redo: () => {
      const state = get();
      const next = state.redoStack.at(-1);
      if (!next) return;
      const nextSnapshot = { ...snapshotFromState(state), ...next };
      const now = new Date().toISOString();
      set({
        ...nextSnapshot,
        canvases: state.canvases.map((canvas) => canvas.id === state.activeCanvasId
          ? { ...canvas, updatedAt: now, snapshot: nextSnapshot }
          : canvas),
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [...state.undoStack, editSnapshotFromState(state)],
      });
    },
  };
});
