import type { CanvasEdge, ThoughtExpansionContext, ThoughtNode } from "@/lib/types";

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

export function getThoughtExpansionContext(
  currentId: string,
  nodes: ThoughtNode[],
  edges: CanvasEdge[],
): ThoughtExpansionContext | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parentsById = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of edges) {
    if (edge.source !== edge.target && byId.has(edge.source) && byId.has(edge.target)) {
      parentsById.get(edge.target)?.add(edge.source);
    }
  }
  for (const node of nodes) {
    if (node.data.parentId && byId.has(node.data.parentId)) parentsById.get(node.id)?.add(node.data.parentId);
  }

  const childrenById = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const [childId, parentIds] of parentsById) {
    for (const parentId of parentIds) childrenById.get(parentId)?.add(childId);
  }

  const current = byId.get(currentId);
  if (!current) return null;
  const directParents = parentsById.get(currentId) ?? new Set<string>();
  const ancestors: string[] = [];
  const roots: string[] = [];
  const visited = new Set([currentId]);
  const pending = [...directParents];
  let scanned = 0;
  while (pending.length && scanned < 512) {
    const id = pending.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    scanned += 1;
    const parentIds = parentsById.get(id) ?? new Set<string>();
    if (ancestors.length < 12) ancestors.push(id);
    if (!parentIds.size) roots.push(id);
    pending.push(...parentIds);
  }
  if (!directParents.size) roots.unshift(currentId);

  const siblings = new Set<string>();
  for (const parentId of directParents) {
    for (const childId of childrenById.get(parentId) ?? []) {
      if (childId !== currentId) siblings.add(childId);
    }
  }

  const toContextNode = (id: string) => {
    const node = byId.get(id)!;
    return {
      id,
      text: node.data.text,
      kind: node.data.kind,
      createdBy: node.data.createdBy,
      ...(node.data.verification ? {
        verification: {
          status: node.data.verification.status,
          note: node.data.verification.note.slice(0, 500),
        },
      } : {}),
    };
  };
  const mapContext = (ids: Iterable<string>, limit: number) => [...ids].slice(0, limit).map(toContextNode);

  return {
    current: toContextNode(currentId),
    roots: mapContext(roots, 4),
    ancestors: mapContext(ancestors, 12),
    parents: mapContext(directParents, 8),
    siblings: mapContext(siblings, 40),
    children: mapContext(childrenById.get(currentId) ?? [], 80),
  };
}
