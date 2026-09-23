import { CanvasFileSchema } from "@/lib/schemas";
import type { CanvasEdge, CanvasSnapshot, CanvasSummary, ThoughtNode } from "@/lib/types";

const STORAGE_KEY = "thought-garden-canvas-v1";

export function loadCanvas(): (CanvasSnapshot & { theme: "light" | "dark" }) | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const result = CanvasFileSchema.safeParse(JSON.parse(raw));
    if (!result.success) {
      console.warn("Ignoring invalid saved Thought Garden canvas", result.error);
      return null;
    }
    return {
      nodes: result.data.nodes.map((node) => ({ ...node, type: "thought" })) as ThoughtNode[],
      edges: result.data.edges as CanvasEdge[],
      viewport: result.data.viewport,
      summary: (result.data.summary as CanvasSummary | null | undefined) ?? null,
      theme: result.data.theme ?? "light",
    };
  } catch (error) {
    console.warn("Could not load Thought Garden canvas", error);
    return null;
  }
}

export function saveCanvas(snapshot: CanvasSnapshot, theme: "light" | "dark"): void {
  const file = {
    version: 1,
    nodes: snapshot.nodes.map(({ id, position, sourcePosition, targetPosition, data }) => ({
      id,
      type: "thought" as const,
      position,
      sourcePosition,
      targetPosition,
      data: {
        text: data.text,
        kind: data.kind,
        depth: data.depth,
        parentId: data.parentId,
        createdBy: data.createdBy,
        collapsed: data.collapsed,
      },
    })),
    edges: snapshot.edges.map(({ id, source, target, sourceHandle, targetHandle, type }) => ({
      id, source, target, sourceHandle, targetHandle, type,
    })),
    viewport: snapshot.viewport,
    summary: snapshot.summary,
    theme,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(file));
}

export function downloadCanvas(snapshot: CanvasSnapshot): void {
  const nodes = snapshot.nodes.map(({ id, position, sourcePosition, targetPosition, data }) => ({
    id,
    type: "thought" as const,
    position,
    sourcePosition,
    targetPosition,
    data: {
      text: data.text,
      kind: data.kind,
      depth: data.depth,
      parentId: data.parentId,
      createdBy: data.createdBy,
      collapsed: data.collapsed,
    },
  }));
  const blob = new Blob([JSON.stringify({ version: 1, nodes, edges: snapshot.edges, viewport: snapshot.viewport, summary: snapshot.summary }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "thought-garden.json";
  link.click();
  URL.revokeObjectURL(url);
}
