import { z } from "zod";
import { thoughtKinds } from "@/lib/types";

const PointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
const VerificationStatusSchema = z.enum(["unverified", "confirmed", "refuted"]);
const ThoughtVerificationSchema = z.object({
  status: VerificationStatusSchema,
  note: z.string().max(1000),
  sourceUrl: z.string().url().max(2048).optional(),
  updatedAt: z.string().datetime(),
}).superRefine((verification, context) => {
  if (verification.status !== "unverified" && !verification.note.trim()) {
    context.addIssue({ code: "custom", message: "A verification note is required for confirmed or refuted thoughts" });
  }
  if (verification.sourceUrl && !/^https?:\/\//i.test(verification.sourceUrl)) {
    context.addIssue({ code: "custom", message: "Verification links must use HTTP or HTTPS" });
  }
});

export const ThoughtNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("thought").optional(),
  position: PointSchema,
  sourcePosition: z.enum(["left", "right", "top", "bottom"]).optional(),
  targetPosition: z.enum(["left", "right", "top", "bottom"]).optional(),
  data: z.object({
    text: z.string().min(1).max(1600),
    kind: z.enum(thoughtKinds),
    depth: z.number().int().min(0),
    parentId: z.string().optional(),
    createdBy: z.enum(["user", "ai"]),
    collapsed: z.boolean().optional(),
    verification: ThoughtVerificationSchema.optional(),
  }),
});

export const CanvasEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
  type: z.string().optional(),
});

export const ViewportSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  zoom: z.number().finite().min(0.05).max(4),
});

const SummaryScopeSchema = z.object({
  type: z.enum(["all", "selected"]),
  nodeIds: z.array(z.string().min(1)),
});

const SummarySourceSnapshotSchema = z.object({
  id: z.string().min(1),
  text: z.string().max(1600),
  kind: z.enum(thoughtKinds),
  verificationStatus: VerificationStatusSchema,
});

export const CanvasSummarySchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  scope: SummaryScopeSchema,
  parentSummaryId: z.string().min(1).optional(),
  conclusion: z.string().trim().min(1).max(600),
  openQuestions: z.array(z.string().trim().min(1).max(180)).max(5),
  nextAction: z.string().trim().min(1).max(300),
  sourceNodeIds: z.array(z.string().min(1)).max(12),
  sourceSnapshots: z.array(SummarySourceSnapshotSchema).max(12),
  verifiedEvidence: z.array(z.string().trim().min(1).max(180)).max(5),
  unverifiedAssumptions: z.array(z.string().trim().min(1).max(180)).max(5),
  refutedClaims: z.array(z.string().trim().min(1).max(180)).max(5),
});

export const CanvasActionSchema = z.object({
  id: z.string().min(1),
  sourceSummaryId: z.string().min(1),
  text: z.string().trim().min(1).max(300),
  status: z.enum(["todo", "doing", "done"]),
  outcome: z.string().max(1200),
  position: PointSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
}).superRefine((action, context) => {
  if (action.status === "done" && !action.outcome.trim()) {
    context.addIssue({ code: "custom", message: "A completed action requires an outcome" });
  }
});

export const CanvasSnapshotSchema = z.object({
  nodes: z.array(ThoughtNodeSchema),
  edges: z.array(CanvasEdgeSchema),
  viewport: ViewportSchema,
  summaries: z.array(CanvasSummarySchema),
  actions: z.array(CanvasActionSchema),
}).superRefine((canvas, context) => {
  const ids = new Set(canvas.nodes.map(({ id }) => id));
  if (ids.size !== canvas.nodes.length) {
    context.addIssue({ code: "custom", message: "Node IDs must be unique" });
  }
  for (const edge of canvas.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      context.addIssue({ code: "custom", message: "Edges must reference existing nodes" });
    }
  }
});

export const CanvasBoardSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  snapshot: CanvasSnapshotSchema,
});

export const WorkspaceSchema = z.object({
  version: z.literal(2),
  type: z.literal("workspace"),
  activeCanvasId: z.string().min(1),
  theme: z.enum(["light", "dark"]),
  canvases: z.array(CanvasBoardSchema).min(1).max(100),
}).superRefine((workspace, context) => {
  const ids = new Set(workspace.canvases.map(({ id }) => id));
  if (ids.size !== workspace.canvases.length) {
    context.addIssue({ code: "custom", message: "Canvas IDs must be unique" });
  }
  if (!ids.has(workspace.activeCanvasId)) {
    context.addIssue({ code: "custom", message: "The active canvas must exist in the workspace" });
  }
});

const LegacySummarySchema = z.object({
  conclusion: z.string().trim().min(1).max(600),
  openQuestions: z.array(z.string().trim().min(1).max(180)).max(5),
  nextAction: z.string().trim().min(1).max(300),
  sourceNodeIds: z.array(z.string().min(1)).max(12),
  updatedAt: z.string().datetime(),
});

export const LegacyCanvasFileSchema = z.object({
  version: z.literal(1),
  nodes: z.array(ThoughtNodeSchema),
  edges: z.array(CanvasEdgeSchema),
  viewport: ViewportSchema,
  theme: z.enum(["light", "dark"]).optional(),
  summary: LegacySummarySchema.nullable().optional(),
}).superRefine((canvas, context) => {
  const ids = new Set(canvas.nodes.map(({ id }) => id));
  if (ids.size !== canvas.nodes.length) {
    context.addIssue({ code: "custom", message: "Node IDs must be unique" });
  }
  for (const edge of canvas.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      context.addIssue({ code: "custom", message: "Edges must reference existing nodes" });
    }
  }
});

export const CanvasExportFileSchema = z.object({
  version: z.literal(2),
  type: z.literal("canvas"),
  canvas: CanvasBoardSchema,
  theme: z.enum(["light", "dark"]).optional(),
});

export const CanvasFileSchema = z.union([LegacyCanvasFileSchema, CanvasExportFileSchema]);
export const ImportFileSchema = z.union([WorkspaceSchema, LegacyCanvasFileSchema, CanvasExportFileSchema]);

export const ExpandRequestSchema = z.object({
  action: z.enum(["expand", "deep", "challenge", "risk", "perspective"]),
  current: z.object({ id: z.string(), text: z.string().min(1).max(1600) }),
  parent: z.object({ id: z.string(), text: z.string() }).nullable(),
  siblings: z.array(z.string().max(1600)).max(80),
  children: z.array(z.string().max(1600)).max(80),
});

export const ExpandResponseSchema = z.object({
  nodes: z.array(z.object({
    text: z.string().trim().min(1).max(30),
    kind: z.enum(thoughtKinds),
  })).min(3).max(6),
});

export const SummarizeRequestSchema = z.object({
  nodes: z.array(z.object({
    id: z.string().min(1),
    text: z.string().trim().min(1).max(1600),
    kind: z.enum(thoughtKinds),
    depth: z.number().int().min(0),
    parentId: z.string().optional(),
    verification: ThoughtVerificationSchema.optional(),
  })).min(1).max(100),
  edges: z.array(z.object({
    source: z.string().min(1),
    target: z.string().min(1),
  })).max(200),
  completedActions: z.array(z.object({
    id: z.string().min(1),
    sourceSummaryId: z.string().min(1),
    text: z.string().trim().min(1).max(300),
    outcome: z.string().trim().min(1).max(1200),
  })).max(100).default([]),
}).superRefine((input, context) => {
  const ids = new Set(input.nodes.map(({ id }) => id));
  const totalCharacters = input.nodes.reduce((total, node) => total + node.text.length, 0);
  if (totalCharacters > 50_000) {
    context.addIssue({ code: "custom", message: "Thought text exceeds the summary limit" });
  }
  if (input.edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target))) {
    context.addIssue({ code: "custom", message: "Relationships must reference included thoughts" });
  }
});

export const SummarizeResponseSchema = z.object({
  conclusion: z.string().trim().min(1).max(600),
  openQuestions: z.array(z.string().trim().min(1).max(180)).max(5),
  nextAction: z.string().trim().min(1).max(300),
  sourceNodeIds: z.array(z.string().min(1)).min(1).max(12),
  verifiedEvidence: z.array(z.string().trim().min(1).max(180)).max(5).default([]),
  unverifiedAssumptions: z.array(z.string().trim().min(1).max(180)).max(5).default([]),
  refutedClaims: z.array(z.string().trim().min(1).max(180)).max(5).default([]),
});
