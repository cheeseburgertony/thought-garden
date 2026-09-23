import type { ThoughtNode } from "@/lib/types";

const NODE_WIDTH = 254;
const NODE_HEIGHT = 128;
const CLEARANCE = 38;
const ALIGNMENT_TOLERANCE = 8;
type GuideSegment = { coordinate: number; start: number; end: number };

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
