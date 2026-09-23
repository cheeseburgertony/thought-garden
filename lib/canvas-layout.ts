import type { CanvasEdge, ThoughtNode } from "@/lib/types";

const NODE_WIDTH = 254;
const NODE_HEIGHT = 128;
const CLEARANCE = 38;
const ALIGNMENT_TOLERANCE = 8;
const LAYOUT_GAP_X = 44;
const LAYOUT_GAP_Y = 48;
const ROOT_GAP = 64;
const ROW_STAGGER = (NODE_WIDTH + LAYOUT_GAP_X) / 2;
type GuideSegment = { coordinate: number; start: number; end: number };
type LayoutBranch = {
  id: string;
  children: LayoutBranch[];
  rows: LayoutBranch[][];
  width: number;
  height: number;
  nodeWidth: number;
  nodeHeight: number;
};

export function arrangeThoughtNodes(nodes: ThoughtNode[], edges: CanvasEdge[], maxRowWidth = 1400): ThoughtNode[] {
  if (!nodes.length) return nodes;
  const layoutWidth = Math.max(NODE_WIDTH, maxRowWidth);

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenBySource = new Map<string, string[]>();
  const incoming = new Set<string>();
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    childrenBySource.set(edge.source, [...(childrenBySource.get(edge.source) ?? []), edge.target]);
    incoming.add(edge.target);
  }

  const assigned = new Set<string>();
  const buildBranch = (id: string): LayoutBranch => {
    assigned.add(id);
    const children: LayoutBranch[] = [];
    for (const childId of childrenBySource.get(id) ?? []) {
      if (!assigned.has(childId)) children.push(buildBranch(childId));
    }
    const node = byId.get(id)!;
    return {
      id,
      children,
      rows: [],
      width: node.measured?.width ?? NODE_WIDTH,
      height: node.measured?.height ?? NODE_HEIGHT,
      nodeWidth: node.measured?.width ?? NODE_WIDTH,
      nodeHeight: node.measured?.height ?? NODE_HEIGHT,
    };
  };
  const roots: LayoutBranch[] = [];
  for (const node of nodes) {
    if (!incoming.has(node.id) && !assigned.has(node.id)) roots.push(buildBranch(node.id));
  }
  for (const node of nodes) {
    if (!assigned.has(node.id)) roots.push(buildBranch(node.id));
  }

  const measure = (branch: LayoutBranch) => {
    for (const child of branch.children) measure(child);

    let row: LayoutBranch[] = [];
    let rowWidth = 0;
    for (const child of branch.children) {
      const nextWidth = rowWidth + (row.length ? LAYOUT_GAP_X : 0) + child.width;
      if (row.length && nextWidth > layoutWidth) {
        branch.rows.push(row);
        row = [];
        rowWidth = 0;
      }
      rowWidth += (row.length ? LAYOUT_GAP_X : 0) + child.width;
      row.push(child);
    }
    if (row.length) branch.rows.push(row);

    const rowWidths = branch.rows.map((items, index) => (
      items.reduce((width, child) => width + child.width, LAYOUT_GAP_X * (items.length - 1)) + (index % 2 ? ROW_STAGGER : 0)
    ));
    const rowHeights = branch.rows.map((items) => Math.max(...items.map((child) => child.height)));
    branch.width = Math.max(branch.nodeWidth, ...rowWidths);
    branch.height = branch.nodeHeight + (branch.rows.length
      ? LAYOUT_GAP_Y + rowHeights.reduce((height, rowHeight, index) => height + rowHeight + (index ? LAYOUT_GAP_Y : 0), 0)
      : 0);
  };
  for (const root of roots) measure(root);

  const positions = new Map<string, { x: number; y: number }>();
  const placeBranch = (branch: LayoutBranch, left: number, top: number) => {
    positions.set(branch.id, { x: left + (branch.width - branch.nodeWidth) / 2, y: top });
    let rowTop = top + branch.nodeHeight + LAYOUT_GAP_Y;
    for (const [rowIndex, row] of branch.rows.entries()) {
      const rowOffset = rowIndex % 2 ? ROW_STAGGER : 0;
      const rowWidth = row.reduce((width, child) => width + child.width, LAYOUT_GAP_X * (row.length - 1));
      let childLeft = left + (branch.width - rowWidth - rowOffset) / 2 + rowOffset;
      const rowHeight = Math.max(...row.map((child) => child.height));
      for (const child of row) {
        placeBranch(child, childLeft, rowTop);
        childLeft += child.width + LAYOUT_GAP_X;
      }
      rowTop += rowHeight + LAYOUT_GAP_Y;
    }
  };

  const rootRows: LayoutBranch[][] = [];
  let rootRow: LayoutBranch[] = [];
  let rootRowWidth = 0;
  for (const root of roots) {
    const nextWidth = rootRowWidth + (rootRow.length ? ROOT_GAP : 0) + root.width;
    if (rootRow.length && nextWidth > layoutWidth) {
      rootRows.push(rootRow);
      rootRow = [];
      rootRowWidth = 0;
    }
    rootRowWidth += (rootRow.length ? ROOT_GAP : 0) + root.width;
    rootRow.push(root);
  }
  if (rootRow.length) rootRows.push(rootRow);

  let rowTop = 0;
  for (const row of rootRows) {
    let rootLeft = 0;
    const rowHeight = Math.max(...row.map((root) => root.height));
    for (const root of row) {
      placeBranch(root, rootLeft, rowTop);
      rootLeft += root.width + ROOT_GAP;
    }
    rowTop += rowHeight + ROOT_GAP;
  }

  return nodes.map((node) => {
    const position = positions.get(node.id);
    return position ? { ...node, position } : node;
  });
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
): { x: number; y: number }[] {
  const center = (count - 1) / 2;
  const placed: { x: number; y: number }[] = [];

  for (let index = 0; index < count; index += 1) {
    const x = parent.position.x + (index - center) * (NODE_WIDTH + 64);
    let y = parent.position.y + 190 + Math.abs(index - center) * 18;
    const collides = (point: { x: number; y: number }) => [...occupied, ...placed.map((position, i) => ({
      id: `placed-${i}`,
      type: "thought" as const,
      position,
      data: parent.data,
    }))].some((node) =>
      Math.abs(node.position.x - point.x) < NODE_WIDTH + CLEARANCE &&
      Math.abs(node.position.y - point.y) < NODE_HEIGHT + CLEARANCE,
    );

    while (collides({ x, y })) y += NODE_HEIGHT + CLEARANCE;
    placed.push({ x, y });
  }

  return placed;
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
