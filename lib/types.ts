import type { Edge, Node, Viewport } from "@xyflow/react";

export const thoughtKinds = ["idea", "question", "insight", "risk", "challenge"] as const;
export type ThoughtKind = (typeof thoughtKinds)[number];
export type ThoughtAction = "expand" | "deep" | "challenge" | "risk" | "perspective";

export type ThoughtNodeData = {
  text: string;
  kind: ThoughtKind;
  depth: number;
  parentId?: string;
  createdBy: "user" | "ai";
  collapsed?: boolean;
  busy?: boolean;
  onAction?: (id: string, action: ThoughtAction) => void;
};

export type ThoughtNode = Node<ThoughtNodeData, "thought">;
export type CanvasEdge = Edge;

export type CanvasSummary = {
  conclusion: string;
  openQuestions: string[];
  nextAction: string;
  sourceNodeIds: string[];
  updatedAt: string;
};

export type CanvasSnapshot = {
  nodes: ThoughtNode[];
  edges: CanvasEdge[];
  viewport: Viewport;
  summary: CanvasSummary | null;
};

export const actionLabels: Record<ThoughtAction, string> = {
  expand: "展开",
  deep: "深挖",
  challenge: "反驳",
  risk: "风险",
  perspective: "换角度",
};
