import { Position } from "@xyflow/react";
import type { CanvasEdge, ThoughtNode } from "@/lib/types";

const NODE_WIDTH = 254;
const NODE_HEIGHT = 128;
const CLEARANCE = 38;
const ALIGNMENT_TOLERANCE = 8;
const LAYOUT_GAP_X = 44;
const LAYOUT_GAP_Y = 48;
const ROOT_GAP = 64;
type GuideSegment = { coordinate: number; start: number; end: number };
type LayoutBranch = { id: string; children: LayoutBranch[]; leafCount: number; depth: number; maxDepth: number };
type LayoutDirection = "TB" | "LR";
type LayoutSize = { width: number; height: number };
type LayoutResult = { positions: Map<string, { x: number; y: number }>; width: number; height: number };

export function arrangeThoughtNodes(nodes: ThoughtNode[], edges: CanvasEdge[], viewport: LayoutSize = { width: 1400, height: 900 }): ThoughtNode[] {
  if (!nodes.length) return nodes;

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenBySource = new Map<string, string[]>();
  const incoming = new Set<string>();
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    childrenBySource.set(edge.source, [...(childrenBySource.get(edge.source) ?? []), edge.target]);
    incoming.add(edge.target);
  }

  const assigned = new Set<string>();
  const branchById = new Map<string, LayoutBranch>();
  const buildBranch = (id: string): LayoutBranch => {
    assigned.add(id);
    const children: LayoutBranch[] = [];
    for (const childId of childrenBySource.get(id) ?? []) {
      if (!assigned.has(childId)) children.push(buildBranch(childId));
    }
    const branch = { id, children, leafCount: 0, depth: 0, maxDepth: 0 };
    branchById.set(id, branch);
    return branch;
  };
  const roots: LayoutBranch[] = [];
  for (const node of nodes) {
    if (!incoming.has(node.id) && !assigned.has(node.id)) roots.push(buildBranch(node.id));
  }
  for (const node of nodes) {
    if (!assigned.has(node.id)) roots.push(buildBranch(node.id));
  }

  let maxNodeWidth = NODE_WIDTH;
  let maxNodeHeight = NODE_HEIGHT;
  const measure = (branch: LayoutBranch, depth: number): number => {
    branch.depth = depth;
    const node = byId.get(branch.id)!;
    maxNodeWidth = Math.max(maxNodeWidth, node.measured?.width ?? NODE_WIDTH);
    maxNodeHeight = Math.max(maxNodeHeight, node.measured?.height ?? NODE_HEIGHT);
    branch.leafCount = branch.children.reduce((count, child) => count + measure(child, depth + 1), 0) || 1;
    branch.maxDepth = branch.children.reduce((deepest, child) => Math.max(deepest, child.maxDepth), depth);
    return branch.leafCount;
  };
  for (const root of roots) measure(root, 0);

  const topDown = createLayout("TB");
  const leftToRight = createLayout("LR");
  const fitScale = (layout: LayoutResult) => Math.min(viewport.width / layout.width, viewport.height / layout.height);
  const direction: LayoutDirection = fitScale(leftToRight) > fitScale(topDown) ? "LR" : "TB";
  const layout = direction === "LR" ? leftToRight : topDown;

  return nodes.map((node) => {
    const position = layout.positions.get(node.id);
    if (!position) return node;
    return {
      ...node,
      position,
      sourcePosition: direction === "LR" ? Position.Right : Position.Bottom,
      targetPosition: direction === "LR" ? Position.Left : Position.Top,
    };
  });

  function createLayout(direction: LayoutDirection): LayoutResult {
    const positions = new Map<string, { x: number; y: number }>();
    if (direction === "TB") {
      const levelHeights: number[] = [];
      for (const node of nodes) {
        const branch = branchById.get(node.id);
        if (branch) levelHeights[branch.depth] = Math.max(levelHeights[branch.depth] ?? 0, node.measured?.height ?? NODE_HEIGHT);
      }
      const levelY: number[] = [0];
      for (let depth = 1; depth < levelHeights.length; depth += 1) {
        levelY[depth] = levelY[depth - 1] + levelHeights[depth - 1] + LAYOUT_GAP_Y;
      }
      const columnWidth = maxNodeWidth + LAYOUT_GAP_X;
      const place = (branch: LayoutBranch, left: number) => {
        let childLeft = left;
        for (const child of branch.children) {
          place(child, childLeft);
          childLeft += child.leafCount * columnWidth;
        }
        const node = byId.get(branch.id)!;
        const center = left + branch.leafCount * columnWidth / 2;
        positions.set(branch.id, { x: center - (node.measured?.width ?? NODE_WIDTH) / 2, y: levelY[branch.depth] });
      };
      let left = 0;
      let width = 0;
      let height = 0;
      for (const root of roots) {
        place(root, left);
        const rootWidth = root.leafCount * columnWidth;
        left += rootWidth + ROOT_GAP;
        width += rootWidth + (width ? ROOT_GAP : 0);
        height = Math.max(height, levelY[root.maxDepth] + levelHeights[root.maxDepth]);
      }
      return { positions, width, height };
    }

    const levelWidths: number[] = [];
    for (const node of nodes) {
      const branch = branchById.get(node.id);
      if (branch) levelWidths[branch.depth] = Math.max(levelWidths[branch.depth] ?? 0, node.measured?.width ?? NODE_WIDTH);
    }
    const levelX: number[] = [0];
    for (let depth = 1; depth < levelWidths.length; depth += 1) {
      levelX[depth] = levelX[depth - 1] + levelWidths[depth - 1] + LAYOUT_GAP_X;
    }
    const rowHeight = maxNodeHeight + LAYOUT_GAP_Y;
    const place = (branch: LayoutBranch, top: number) => {
      let childTop = top;
      for (const child of branch.children) {
        place(child, childTop);
        childTop += child.leafCount * rowHeight;
      }
      const node = byId.get(branch.id)!;
      const center = top + branch.leafCount * rowHeight / 2;
      positions.set(branch.id, { x: levelX[branch.depth], y: center - (node.measured?.height ?? NODE_HEIGHT) / 2 });
    };
    let top = 0;
    let width = 0;
    for (const root of roots) {
      place(root, top);
      top += root.leafCount * rowHeight + ROOT_GAP;
      width = Math.max(width, levelX[root.maxDepth] + levelWidths[root.maxDepth]);
    }
    return { positions, width, height: Math.max(0, top - ROOT_GAP) };
  }
}

export function alignThoughtNode(
  moving: ThoughtNode,
  nodes: ThoughtNode[],
  zoom: number,
): { position: { x: number; y: number }; guides: { horizontal?: GuideSegment; vertical?: GuideSegment } } {
  // ponytail: scan all nodes during drag (O(n)); add a spatial index only if large gardens lag.
  const others = nodes.filter((node) => node.id !== moving.id && !node.selected);
  const width = moving.measured?.width ?? NODE_WIDTH;
  const height = moving.measured?.height ?? 105;
  const xAnchors = [0, width / 2, width];
  const yAnchors = [0, height / 2, height];
  let xMatch: { delta: number; coordinate: number; distance: number; node: ThoughtNode } | undefined;
  let yMatch: { delta: number; coordinate: number; distance: number; node: ThoughtNode } | undefined;

  for (const node of others) {
    const otherWidth = node.measured?.width ?? NODE_WIDTH;
    const otherHeight = node.measured?.height ?? 105;
    const otherX = [node.position.x, node.position.x + otherWidth / 2, node.position.x + otherWidth];
    const otherY = [node.position.y, node.position.y + otherHeight / 2, node.position.y + otherHeight];

    for (const anchor of xAnchors) {
      for (const coordinate of otherX) {
        const delta = coordinate - (moving.position.x + anchor);
        const distance = Math.abs(delta) * zoom;
        if (distance <= ALIGNMENT_TOLERANCE && (!xMatch || distance < xMatch.distance)) {
          xMatch = { delta, coordinate, distance, node };
        }
      }
    }

    for (const anchor of yAnchors) {
      for (const coordinate of otherY) {
        const delta = coordinate - (moving.position.y + anchor);
        const distance = Math.abs(delta) * zoom;
        if (distance <= ALIGNMENT_TOLERANCE && (!yMatch || distance < yMatch.distance)) {
          yMatch = { delta, coordinate, distance, node };
        }
      }
    }
  }

  const position = {
    x: moving.position.x + (xMatch?.delta ?? 0),
    y: moving.position.y + (yMatch?.delta ?? 0),
  };
  const horizontalPeerX = yMatch?.node.position.x;
  const horizontalPeerRight = yMatch ? yMatch.node.position.x + (yMatch.node.measured?.width ?? NODE_WIDTH) : undefined;
  const movingRight = position.x + width;
  const verticalPeerY = xMatch?.node.position.y;
  const verticalPeerBottom = xMatch ? xMatch.node.position.y + (xMatch.node.measured?.height ?? 105) : undefined;
  const movingBottom = position.y + height;

  return {
    position,
    guides: {
      horizontal: yMatch && horizontalPeerX !== undefined && horizontalPeerRight !== undefined
        ? horizontalPeerRight <= position.x
          ? { coordinate: yMatch.coordinate, start: horizontalPeerRight, end: position.x }
          : movingRight <= horizontalPeerX
            ? { coordinate: yMatch.coordinate, start: movingRight, end: horizontalPeerX }
            : undefined
        : undefined,
      vertical: xMatch && verticalPeerY !== undefined && verticalPeerBottom !== undefined
        ? verticalPeerBottom <= position.y
          ? { coordinate: xMatch.coordinate, start: verticalPeerBottom, end: position.y }
          : movingBottom <= verticalPeerY
            ? { coordinate: xMatch.coordinate, start: movingBottom, end: verticalPeerY }
            : undefined
        : undefined,
    },
  };
}

export function fanOutPositions(
  parent: ThoughtNode,
  count: number,
  occupied: ThoughtNode[],
  direction: LayoutDirection = "TB",
): { x: number; y: number }[] {
  const center = (count - 1) / 2;
  const parentWidth = parent.measured?.width ?? NODE_WIDTH;
  const parentHeight = parent.measured?.height ?? NODE_HEIGHT;
  const positions = Array.from({ length: count }, (_, index) => direction === "LR"
    ? {
        x: parent.position.x + parentWidth + 64,
        y: parent.position.y + parentHeight / 2 - NODE_HEIGHT / 2 + (index - center) * (NODE_HEIGHT + CLEARANCE),
      }
    : {
        x: parent.position.x + (index - center) * (NODE_WIDTH + 64),
        y: parent.position.y + 190 + Math.abs(index - center) * 18,
      });
  const collides = (point: { x: number; y: number }) => occupied.some((node) => {
    const width = node.measured?.width ?? NODE_WIDTH;
    const height = node.measured?.height ?? NODE_HEIGHT;
    return point.x < node.position.x + width + CLEARANCE &&
      point.x + NODE_WIDTH + CLEARANCE > node.position.x &&
      point.y < node.position.y + height + CLEARANCE &&
      point.y + NODE_HEIGHT + CLEARANCE > node.position.y;
  });
  while (positions.some(collides)) {
    for (const position of positions) {
      if (direction === "LR") position.x += NODE_WIDTH + CLEARANCE;
      else position.y += NODE_HEIGHT + CLEARANCE;
    }
  }

  return positions;
}

export function demo(): void {
  const parent = {
    id: "root",
    type: "thought" as const,
    position: { x: 0, y: 0 },
    data: { text: "Idea", kind: "idea" as const, depth: 0, createdBy: "user" as const },
  };
  const positions = fanOutPositions(parent, 3, [parent]);
  if (positions.length !== 3 || new Set(positions.map(({ x, y }) => `${x}:${y}`)).size !== 3) {
    throw new Error("fanOutPositions must place each child separately");
  }
  const moved = alignThoughtNode({ ...parent, id: "moving", position: { x: 5, y: 4 } }, [parent], 1);
  if (moved.position.x !== 0 || moved.position.y !== 0 || moved.guides.horizontal || moved.guides.vertical) {
    throw new Error("alignThoughtNode must snap nearby nodes without drawing guides through them");
  }
  const adjacent = alignThoughtNode({ ...parent, id: "adjacent", position: { x: 300, y: 4 } }, [parent], 1);
  if (adjacent.position.y !== 0 || adjacent.guides.horizontal?.start !== 254 || adjacent.guides.horizontal.end !== 300) {
    throw new Error("alignThoughtNode must draw a guide in the gap between aligned nodes");
  }
}
