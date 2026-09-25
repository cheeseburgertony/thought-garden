import type { Edge, Node, Viewport } from "@xyflow/react";

export const thoughtKinds = ["idea", "question", "insight", "risk", "challenge"] as const;
export type ThoughtKind = (typeof thoughtKinds)[number];
export type ThoughtAction = "expand" | "deep" | "challenge" | "risk" | "perspective";
export type VerificationStatus = "unverified" | "confirmed" | "refuted";

export type ThoughtVerification = {
  status: VerificationStatus;
  note: string;
  sourceUrl?: string;
  updatedAt: string;
};

export type ThoughtNodeData = {
  text: string;
  kind: ThoughtKind;
  depth: number;
  parentId?: string;
  createdBy: "user" | "ai";
  collapsed?: boolean;
  verification?: ThoughtVerification;
  busy?: boolean;
  onAction?: (id: string, action: ThoughtAction) => void;
};

export type ThoughtNode = Node<ThoughtNodeData, "thought">;
export type CanvasEdge = Edge;

export type SummaryScope = {
  type: "all" | "selected";
  nodeIds: string[];
};

export type SummarySourceSnapshot = {
  id: string;
  text: string;
  kind: ThoughtKind;
  verificationStatus: VerificationStatus;
};

export type CanvasSummary = {
  id: string;
  createdAt: string;
  updatedAt: string;
  scope: SummaryScope;
  parentSummaryId?: string;
  conclusion: string;
  openQuestions: string[];
  nextAction: string;
  sourceNodeIds: string[];
  sourceSnapshots: SummarySourceSnapshot[];
  verifiedEvidence: string[];
  unverifiedAssumptions: string[];
  refutedClaims: string[];
};

export type CanvasActionStatus = "todo" | "doing" | "done";

export type CanvasAction = {
  id: string;
  sourceSummaryId: string;
  text: string;
  status: CanvasActionStatus;
  outcome: string;
  position: { x: number; y: number };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type CanvasSnapshot = {
  nodes: ThoughtNode[];
  edges: CanvasEdge[];
  viewport: Viewport;
  summaries: CanvasSummary[];
  actions: CanvasAction[];
};

export type CanvasBoard = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  snapshot: CanvasSnapshot;
};

export type CanvasWorkspace = {
  version: 2;
  type: "workspace";
  activeCanvasId: string;
  theme: "light" | "dark";
  canvases: CanvasBoard[];
};

export const actionLabels: Record<ThoughtAction, string> = {
  expand: "展开",
  deep: "深挖",
  challenge: "反驳",
  risk: "风险",
  perspective: "换角度",
};
