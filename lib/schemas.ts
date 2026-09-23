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

export const CanvasFileSchema = z.object({
  version: z.literal(1),
  nodes: z.array(ThoughtNodeSchema),
  edges: z.array(CanvasEdgeSchema),
  viewport: ViewportSchema,
  theme: z.enum(["light", "dark"]).optional(),
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
