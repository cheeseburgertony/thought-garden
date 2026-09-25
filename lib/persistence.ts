import { nanoid } from "nanoid";
import {
  CanvasBoardSchema,
  CanvasFileSchema,
  ImportFileSchema,
  LegacyCanvasFileSchema,
  WorkspaceSchema,
} from "@/lib/schemas";
import type { z } from "zod";
import type {
  CanvasBoard,
  CanvasSnapshot,
  CanvasSummary,
  CanvasWorkspace,
  ThoughtNode,
} from "@/lib/types";

const LEGACY_STORAGE_KEY = "thought-garden-canvas-v1";
const WORKSPACE_STORAGE_KEY = "thought-garden-workspace-v2";

export const emptyCanvasSnapshot = (): CanvasSnapshot => ({
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1.1 },
  summaries: [],
  actions: [],
});

export function createCanvasBoard(name = "未命名画布", snapshot = emptyCanvasSnapshot()): CanvasBoard {
  const now = new Date().toISOString();
  return { id: nanoid(), name, createdAt: now, updatedAt: now, snapshot };
}

function normalizeNodes(nodes: ThoughtNode[]): ThoughtNode[] {
  return nodes.map((node) => ({ ...node, type: "thought" as const }));
}

function legacySummaryToHistory(
  summary: {
    conclusion: string;
    openQuestions: string[];
    nextAction: string;
    sourceNodeIds: string[];
    updatedAt: string;
  } | null | undefined,
  nodes: ThoughtNode[],
): CanvasSummary[] {
  if (!summary) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return [{
    id: nanoid(),
    createdAt: summary.updatedAt,
    updatedAt: summary.updatedAt,
    scope: { type: "all", nodeIds: nodes.map(({ id }) => id) },
    conclusion: summary.conclusion,
    openQuestions: summary.openQuestions,
    nextAction: summary.nextAction,
    sourceNodeIds: summary.sourceNodeIds,
    sourceSnapshots: summary.sourceNodeIds.map((id) => {
      const node = byId.get(id);
      return {
        id,
        text: node?.data.text ?? "",
        kind: node?.data.kind ?? "idea",
        verificationStatus: node?.data.verification?.status ?? "unverified",
      };
    }),
    verifiedEvidence: [],
    unverifiedAssumptions: [],
    refutedClaims: [],
  }];
}

function normalizeLegacyCanvas(file: z.infer<typeof LegacyCanvasFileSchema>): CanvasBoard {
  const nodes = normalizeNodes(file.nodes as ThoughtNode[]);
  const now = new Date().toISOString();
  return {
    id: nanoid(),
    name: "导入的画布",
    createdAt: now,
    updatedAt: now,
    snapshot: {
      nodes,
      edges: file.edges,
      viewport: file.viewport,
      summaries: legacySummaryToHistory(file.summary, nodes),
      actions: [],
    },
  };
}

function cloneBoardWithFreshReferences(board: CanvasBoard, name = board.name, id = nanoid()): CanvasBoard {
  const summaryIds = new Map(board.snapshot.summaries.map((summary) => [summary.id, nanoid()]));
  const actionIds = new Map(board.snapshot.actions.map((action) => [action.id, nanoid()]));
  const now = new Date().toISOString();
  const snapshot: CanvasSnapshot = {
    ...board.snapshot,
    nodes: normalizeNodes(board.snapshot.nodes as ThoughtNode[]).map((node) => ({ ...node, selected: false })),
    edges: board.snapshot.edges.map((edge) => ({ ...edge, selected: false })),
    summaries: board.snapshot.summaries.map((summary) => ({
      ...summary,
      id: summaryIds.get(summary.id)!,
      parentSummaryId: summary.parentSummaryId ? summaryIds.get(summary.parentSummaryId) : undefined,
      scope: { ...summary.scope, nodeIds: [...summary.scope.nodeIds] },
      sourceNodeIds: [...summary.sourceNodeIds],
      sourceSnapshots: summary.sourceSnapshots.map((source) => ({ ...source })),
      openQuestions: [...summary.openQuestions],
      verifiedEvidence: [...summary.verifiedEvidence],
      unverifiedAssumptions: [...summary.unverifiedAssumptions],
      refutedClaims: [...summary.refutedClaims],
    })),
    actions: board.snapshot.actions.map((action) => ({
      ...action,
      id: actionIds.get(action.id)!,
      sourceSummaryId: summaryIds.get(action.sourceSummaryId) ?? action.sourceSummaryId,
      position: { ...action.position },
    })),
  };
  return { id, name, createdAt: now, updatedAt: now, snapshot };
}

export function loadWorkspace(): { workspace: CanvasWorkspace; saveError?: string; canAutoSave: boolean } {
  let invalidWorkspaceFound = false;
  try {
    const rawWorkspace = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (rawWorkspace) {
      const parsed = WorkspaceSchema.safeParse(JSON.parse(rawWorkspace));
      if (parsed.success) return { workspace: parsed.data as CanvasWorkspace, canAutoSave: true };
      invalidWorkspaceFound = true;
      console.warn("Ignoring invalid Thought Garden workspace data", parsed.error);
    }
  } catch (error) {
    invalidWorkspaceFound = true;
    console.warn("Could not read Thought Garden workspace data", error);
  }

  try {
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const parsed = CanvasFileSchema.safeParse(JSON.parse(legacyRaw));
      if (parsed.success && parsed.data.version === 1) {
        const board = normalizeLegacyCanvas(parsed.data);
        const workspace: CanvasWorkspace = {
          version: 2,
          type: "workspace",
          activeCanvasId: board.id,
          theme: parsed.data.theme ?? "light",
          canvases: [board],
        };
        try {
          saveWorkspace(workspace);
          return { workspace, canAutoSave: true };
        } catch (error) {
          console.warn("Could not persist migrated Thought Garden data", error);
          return { workspace, saveError: "旧画布已打开，但迁移保存失败。请导出备份后检查浏览器存储空间。", canAutoSave: true };
        }
      }
      if (!parsed.success) console.warn("Ignoring invalid legacy Thought Garden canvas", parsed.error);
    }
  } catch (error) {
    console.warn("Could not migrate Thought Garden canvas", error);
    return { workspace: createEmptyWorkspace(), saveError: "旧画布无法写入新版存储，请先导出备份。", canAutoSave: true };
  }

  if (invalidWorkspaceFound) {
    return {
      workspace: createEmptyWorkspace(),
      saveError: "新版本地数据无法读取，自动保存已暂停。请先导入有效备份。",
      canAutoSave: false,
    };
  }
  return { workspace: createEmptyWorkspace(), canAutoSave: true };
}

export function createEmptyWorkspace(): CanvasWorkspace {
  const board = createCanvasBoard("我的画布");
  return { version: 2, type: "workspace", activeCanvasId: board.id, theme: "light", canvases: [board] };
}

export function saveWorkspace(workspace: CanvasWorkspace): void {
  const parsed = WorkspaceSchema.parse(workspace);
  const serialized = JSON.stringify(parsed);
  localStorage.setItem(WORKSPACE_STORAGE_KEY, serialized);
}

export function normalizeImportedFile(value: unknown):
  | { type: "canvas"; board: CanvasBoard; theme?: "light" | "dark" }
  | { type: "workspace"; workspace: CanvasWorkspace } {
  const parsed = ImportFileSchema.parse(value);
  if ("type" in parsed && parsed.type === "workspace") {
    const sourceWorkspace = parsed as unknown as CanvasWorkspace;
    const canvasIds = new Map(sourceWorkspace.canvases.map((board) => [board.id, nanoid()]));
    const canvases = sourceWorkspace.canvases.map((board) => cloneBoardWithFreshReferences(board, board.name, canvasIds.get(board.id)!));
    return {
      type: "workspace",
      workspace: {
        ...sourceWorkspace,
        canvases,
        activeCanvasId: canvasIds.get(sourceWorkspace.activeCanvasId) ?? canvases[0].id,
      },
    };
  }
  if (!("type" in parsed)) return { type: "canvas", board: normalizeLegacyCanvas(parsed), theme: parsed.theme };
  return {
    type: "canvas",
    board: cloneBoardWithFreshReferences(parsed.canvas as unknown as CanvasBoard, parsed.canvas.name),
    theme: parsed.theme,
  };
}

export function downloadCanvas(board: CanvasBoard, theme: "light" | "dark"): void {
  const canvas = CanvasBoardSchema.parse(board) as unknown as CanvasBoard;
  downloadJson({ version: 2, type: "canvas", canvas, theme }, `${safeFileName(board.name)}.thought-garden.json`);
}

export function downloadWorkspace(workspace: CanvasWorkspace): void {
  downloadJson(WorkspaceSchema.parse(workspace), `thought-garden-backup-${new Date().toISOString().slice(0, 10)}.json`);
}

function safeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80) || "thought-garden";
}

function downloadJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
