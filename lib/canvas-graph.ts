import type { CanvasEdge, ThoughtNode } from "@/lib/types";

function indexChildren(edges: CanvasEdge[]) {
  const children = new Map<string, string[]>();
  for (const edge of edges) children.set(edge.source, [...(children.get(edge.source) ?? []), edge.target]);
  return children;
}

function collectDescendants(rootId: string, children: Map<string, string[]>) {
  const visited = new Set([rootId]);
  const descendants = new Set<string>();
  const pending = [...(children.get(rootId) ?? [])];
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    descendants.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return descendants;
}

export function getDescendantIds(rootId: string, edges: CanvasEdge[]) {
  return collectDescendants(rootId, indexChildren(edges));
}

export function getHiddenNodeIds(nodes: ThoughtNode[], edges: CanvasEdge[]) {
  const children = indexChildren(edges);
  const hidden = new Set<string>();
  for (const node of nodes) {
    if (!node.data.collapsed) continue;
    for (const id of collectDescendants(node.id, children)) hidden.add(id);
  }
  return hidden;
}
