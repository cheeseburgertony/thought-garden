import { z } from "zod";
import { thoughtKinds } from "@/lib/types";

const PointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

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

export const CanvasSummarySchema = z.object({
  conclusion: z.string().trim().min(1).max(600),
  openQuestions: z.array(z.string().trim().min(1).max(180)).max(5),
  nextAction: z.string().trim().min(1).max(300),
  sourceNodeIds: z.array(z.string().min(1)).max(12),
  updatedAt: z.string().datetime(),
});

export const CanvasFileSchema = z.object({
  version: z.literal(1),
  nodes: z.array(ThoughtNodeSchema),
  edges: z.array(CanvasEdgeSchema),
  viewport: ViewportSchema,
  theme: z.enum(["light", "dark"]).optional(),
  summary: CanvasSummarySchema.nullable().optional(),
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
  })).min(1).max(100),
  edges: z.array(z.object({
    source: z.string().min(1),
    target: z.string().min(1),
  })).max(200),
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
});
