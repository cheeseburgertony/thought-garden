"use client";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  useViewport,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnNodeDrag,
} from "@xyflow/react";
import { Command } from "cmdk";
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Command as CommandIcon,
  Copy,
  Expand,
  FileInput,
  FileJson,
  FileOutput,
  Focus,
  Hand,
  ImageDown,
  Leaf,
  ListChecks,
  Link2,
  MessageCircleQuestion,
  Moon,
  MousePointer2,
  PanelsTopLeft,
  Pencil,
  Plus,
  Redo2,
  Search,
  ShieldAlert,
  Sparkles,
  Sun,
  Swords,
  Trash2,
  Undo2,
  Workflow,
  X,
} from "lucide-react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Toaster, toast } from "sonner";
import { alignThoughtNode, arrangeThoughtNodes, fanOutPositions } from "@/lib/canvas-layout";
import { getDescendantIds, getHiddenNodeIds } from "@/lib/canvas-graph";
import { downloadCanvas, downloadWorkspace, loadWorkspace, normalizeImportedFile, saveWorkspace } from "@/lib/persistence";
import { ExpandResponseSchema } from "@/lib/schemas";
import { actionLabels, type CanvasBoard, type CanvasSummary, type ThoughtAction, type ThoughtNode } from "@/lib/types";
import CanvasSummaryDialog from "@/components/canvas-summary-dialog";
import ThoughtNodeView from "@/components/thought-node";
import { useCanvasStore } from "@/store/canvas-store";

const nodeTypes = { thought: ThoughtNodeView };
const INITIAL_SINGLE_NODE_ZOOM = 1.15;
type AlignmentGuideStyle = { left: number; top: number; width?: number; height?: number };
const examples = [
  { topic: "产品探索", text: "我想做一个 AI 产品" },
  { topic: "个人成长", text: "未来三年我应该提升什么能力？" },
  { topic: "知识管理", text: "怎样设计一个更好的个人知识系统？" },
];

type Draft = { x: number; y: number; position: { x: number; y: number } };
type CanvasTool = "select" | "hand" | "connect";
type CollapsedBranchDrag = {
  id: string;
  origin: { x: number; y: number };
  positions: Map<string, { x: number; y: number }>;
};

const canvasTools = [
  { mode: "select", label: "操作", icon: MousePointer2 },
  { mode: "hand", label: "抓手", icon: Hand },
  { mode: "connect", label: "连线", icon: Link2 },
] as const;
const thoughtGuides: { action: ThoughtAction; icon: typeof Sparkles; description: string }[] = [
  { action: "expand", icon: Sparkles, description: "围绕当前想法发散，生成相关方向和子问题。" },
  { action: "deep", icon: MessageCircleQuestion, description: "追问原因、前提和细节，把模糊想法挖具体。" },
  { action: "challenge", icon: Swords, description: "寻找反例和假设漏洞，检查想法是否站得住。" },
  { action: "risk", icon: ShieldAlert, description: "识别实施阻碍、失败方式和潜在代价。" },
  { action: "perspective", icon: Sparkles, description: "切换用户、团队或反对者视角重新审视。" },
];

function CanvasBackground() {
  const { zoom } = useViewport();
  const scale = Math.max(zoom, 0.2);
  return <Background variant={BackgroundVariant.Dots} gap={25 / scale} size={1.5 / scale} color="var(--dot)" />;
}

function CanvasWorkspace() {
  const flow = useReactFlow<ThoughtNode>();
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const viewport = useCanvasStore((state) => state.viewport);
  const theme = useCanvasStore((state) => state.theme);
  const canvases = useCanvasStore((state) => state.canvases);
  const activeCanvasId = useCanvasStore((state) => state.activeCanvasId);
  const summaries = useCanvasStore((state) => state.summaries);
  const summary = summaries.at(-1) ?? null;
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "error">("saved");
  const [saveMessage, setSaveMessage] = useState("保存在此设备");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isCommandOpen, setCommandOpen] = useState(false);
  const [isSearchOpen, setSearchOpen] = useState(false);
  const [isSummaryOpen, setSummaryOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [toolMode, setToolMode] = useState<CanvasTool>("select");
  const [guideOpen, setGuideOpen] = useState(false);
  const [canvasMenuOpen, setCanvasMenuOpen] = useState(false);
  const [canvasSearch, setCanvasSearch] = useState("");
  const [renamingCanvasId, setRenamingCanvasId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [spacePanActive, setSpacePanActive] = useState(false);
  const [alignmentGuides, setAlignmentGuides] = useState<{ horizontal?: AlignmentGuideStyle; vertical?: AlignmentGuideStyle }>({});
  const activeToolMode = spacePanActive ? "hand" : toolMode;
  const canvasRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<HTMLDetailsElement>(null);
  const canvasMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const saveFailureShown = useRef(false);
  const canAutoSave = useRef(true);
  const viewportRef = useRef(viewport);
  const initialSingleNodeViewApplied = useRef(false);
  const collapsedBranchDrag = useRef<CollapsedBranchDrag | null>(null);

  const activeCanvas = canvases.find((canvas) => canvas.id === activeCanvasId);
  const visibleCanvases = useMemo(() => {
    const term = canvasSearch.trim().toLocaleLowerCase();
    return [...canvases]
      .filter((canvas) => !term || canvas.name.toLocaleLowerCase().includes(term))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [canvases, canvasSearch]);

  useEffect(() => {
    const { workspace, saveError, canAutoSave: canSave } = loadWorkspace();
    canAutoSave.current = canSave;
    useCanvasStore.getState().hydrateWorkspace(workspace);
    const timer = window.setTimeout(() => {
      if (saveError) {
        setSaveStatus("error");
        setSaveMessage(saveError);
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => { viewportRef.current = viewport; }, [viewport]);

  useEffect(() => {
    if (!hydrated || !activeCanvasId) return;
    initialSingleNodeViewApplied.current = false;
    void flow.setViewport(viewportRef.current, { duration: 0 });
  }, [activeCanvasId, flow, hydrated]);

  useEffect(() => {
    if (!canvasMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !canvasMenuRef.current?.contains(event.target)) setCanvasMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [canvasMenuOpen]);

  useEffect(() => {
    if (renamingCanvasId) renameInputRef.current?.focus();
  }, [renamingCanvasId]);

  useEffect(() => {
    if (!hydrated || initialSingleNodeViewApplied.current) return;
    initialSingleNodeViewApplied.current = true;
    const state = useCanvasStore.getState();
    if (state.nodes.length !== 1 || state.viewport.zoom >= 1) return;

    const node = state.nodes[0];
    const centerX = node.position.x + (node.measured?.width ?? 254) / 2;
    const centerY = node.position.y + (node.measured?.height ?? 105) / 2;
    void flow.setCenter(centerX, centerY, { zoom: INITIAL_SINGLE_NODE_ZOOM, duration: 0 }).then(() => {
      useCanvasStore.getState().setViewport(flow.getViewport());
    });
  }, [flow, hydrated]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const nextTheme = theme === "light" ? "dark" : "light";
    const root = document.documentElement;
    const applyTheme = () => {
      root.dataset.theme = nextTheme;
      useCanvasStore.getState().setTheme(nextTheme);
    };

    if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      applyTheme();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.style.setProperty("--theme-reveal-x", `${x}px`);
    root.style.setProperty("--theme-reveal-y", `${y}px`);
    root.style.setProperty("--theme-reveal-radius", `${radius}px`);
    document.startViewTransition(applyTheme);
  };

  useEffect(() => {
    if (!hydrated) return;
    let timer: ReturnType<typeof setTimeout>;
    if (canAutoSave.current) {
      try {
        saveWorkspace(useCanvasStore.getState().getWorkspace());
        saveFailureShown.current = false;
        window.setTimeout(() => {
          setSaveStatus("saved");
          setSaveMessage("保存在此设备");
        }, 0);
      } catch (error) {
        console.warn("Could not save Thought Garden workspace", error);
        saveFailureShown.current = true;
        window.setTimeout(() => {
          setSaveStatus("error");
          setSaveMessage("保存失败，请检查浏览器存储空间并导出备份。");
          toast.error("保存失败，请检查浏览器存储空间并导出备份。");
        }, 0);
      }
    }
    const unsubscribe = useCanvasStore.subscribe((state) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!canAutoSave.current) return;
        try {
          saveWorkspace(state.getWorkspace());
          saveFailureShown.current = false;
          setSaveStatus("saved");
          setSaveMessage("保存在此设备");
        } catch (error) {
          console.warn("Could not save Thought Garden canvas", error);
          setSaveStatus("error");
          setSaveMessage("保存失败，请检查浏览器存储空间并导出备份。");
          if (!saveFailureShown.current) {
            toast.error("保存失败，请检查浏览器存储空间并导出备份。");
            saveFailureShown.current = true;
          }
        }
      }, 400);
    });
    return () => { clearTimeout(timer); unsubscribe(); };
  }, [hydrated]);

  useEffect(() => {
    if (draft) draftRef.current?.focus();
  }, [draft]);

  const createThought = useCallback((text: string, point: { x: number; y: number }) => {
    const node: ThoughtNode = {
      id: nanoid(),
      type: "thought",
      position: { x: point.x - 127, y: point.y - 48 },
      data: { text, kind: "idea", depth: 0, createdBy: "user" },
    };
    useCanvasStore.getState().addThought(node);
    setDraft(null);
  }, []);

  const viewportCenter = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    return { screen: { x, y }, position: flow.screenToFlowPosition({ x, y }) };
  }, [flow]);

  const loadExampleGarden = useCallback(() => {
    const center = viewportCenter().position;
    const rootId = nanoid();
    const root: ThoughtNode = {
      id: rootId,
      type: "thought",
      position: { x: center.x - 127, y: center.y - 48 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: { text: "怎样更扎实地学会一项新技能？", kind: "idea", depth: 0, createdBy: "user" },
    };
    const branches = [
      { text: "先把目标设成看得见的成果", kind: "insight" as const },
      { text: "每天的练习怎么做到足够小？", kind: "question" as const },
      { text: "如何确认自己真的学会了？", kind: "question" as const },
    ];
    const branchPositions = fanOutPositions(root, branches.length, [root]);
    const branchNodes: ThoughtNode[] = branches.map((branch, index) => ({
      id: nanoid(),
      type: "thought",
      position: branchPositions[index],
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: { ...branch, depth: 1, parentId: rootId, createdBy: "ai" },
    }));
    const nextQuestions = ["能独立完成真实任务吗？", "隔一周还能复现关键步骤吗？"];
    const nextPositions = fanOutPositions(branchNodes[2], nextQuestions.length, [root, ...branchNodes]);
    const nextNodes: ThoughtNode[] = nextQuestions.map((text, index) => ({
      id: nanoid(),
      type: "thought",
      position: nextPositions[index],
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: { text, kind: "question", depth: 2, parentId: branchNodes[2].id, createdBy: "ai" },
    }));
    const edges = [
      ...branchNodes.map((node) => ({ id: nanoid(), source: rootId, target: node.id })),
      ...nextNodes.map((node) => ({ id: nanoid(), source: branchNodes[2].id, target: node.id })),
    ];

    useCanvasStore.getState().addThoughts([root, ...branchNodes, ...nextNodes], edges);
    window.requestAnimationFrame(() => { void flow.fitView({ padding: 0.28, minZoom: 0.78, duration: 500 }); });
    toast.message("示例画布已载入，可以拖动、编辑或撤销。", { icon: <Leaf size={15} />, position: "top-center" });
  }, [flow, viewportCenter]);

  const openDraftAtCenter = useCallback(() => {
    const center = viewportCenter();
    const rect = canvasRef.current?.getBoundingClientRect();
    setDraft({
      position: center.position,
      x: rect ? rect.width / 2 : window.innerWidth / 2,
      y: rect ? rect.height / 2 : window.innerHeight / 2,
    });
  }, [viewportCenter]);

  const runAction = useCallback(async (id: string, action: ThoughtAction) => {
    if (running) return;
    const state = useCanvasStore.getState();
    const current = state.nodes.find((node) => node.id === id);
    if (!current) return;
    const parent = current.data.parentId
      ? state.nodes.find((node) => node.id === current.data.parentId)
      : undefined;
    const siblings = state.nodes.filter((node) =>
      node.id !== id && node.data.parentId === current.data.parentId,
    ).slice(0, 80).map((node) => node.data.text);
    const children = state.nodes.filter((node) => node.data.parentId === id).slice(0, 80).map((node) => node.data.text);
    setRunning(id);

    try {
      const response = await fetch("/api/ai/expand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          current: { id, text: current.data.text },
          parent: parent ? { id: parent.id, text: parent.data.text } : null,
          siblings,
          children,
        }),
      });
      if (!response.ok) throw new Error("AI request failed");
      const result = ExpandResponseSchema.parse(await response.json());
      const currentState = useCanvasStore.getState();
      const existing = new Set(children.map((text) => text.trim().toLocaleLowerCase()));
      const fresh = result.nodes.filter((node) => !existing.has(node.text.trim().toLocaleLowerCase()));
      if (!fresh.length) {
        toast.message("这些方向已经长出来了，换个动作继续探索。", { icon: <Leaf size={15} /> });
        return;
      }
      const direction = current.sourcePosition === Position.Right ? "LR" : "TB";
      const points = fanOutPositions(current, fresh.length, currentState.nodes, direction);
      const nextNodes: ThoughtNode[] = fresh.map((item, index) => ({
        id: nanoid(),
        type: "thought",
        position: points[index],
        sourcePosition: direction === "LR" ? Position.Right : Position.Bottom,
        targetPosition: direction === "LR" ? Position.Left : Position.Top,
        data: {
          text: item.text,
          kind: action === "challenge" ? "challenge" : action === "risk" ? "risk" : item.kind,
          depth: current.data.depth + 1,
          parentId: id,
          createdBy: "ai",
        },
      }));
      const nextEdges = nextNodes.map((node) => ({
        id: nanoid(), source: id, target: node.id, type: "default" as const,
      }));
      useCanvasStore.getState().addThoughts(nextNodes, nextEdges);
    } catch (error) {
      console.error("[thought-garden] Could not grow thought", error);
      toast.error("这次没有长出来，再试一次。");
    } finally {
      setRunning(null);
    }
  }, [running]);

  const hiddenNodeIds = useMemo(() => getHiddenNodeIds(nodes, edges), [nodes, edges]);
  const flowNodes = useMemo(() => nodes.map((node) => ({
    ...node,
    hidden: hiddenNodeIds.has(node.id),
    data: { ...node.data, busy: running === node.id, onAction: runAction },
  })), [hiddenNodeIds, nodes, runAction, running]);
  const compactConnections = nodes.length - hiddenNodeIds.size >= 14;
  const flowEdges = useMemo(() => edges.map((edge) => ({
    ...edge,
    hidden: hiddenNodeIds.has(edge.source) || hiddenNodeIds.has(edge.target),
    ...(edge.type === "smoothstep" ? { type: "default" } : {}),
    ...(compactConnections ? {
      style: { ...edge.style, stroke: edge.style?.stroke ?? "var(--edge)", strokeWidth: 1.2, opacity: 0.62 },
    } : {}),
  })), [compactConnections, edges, hiddenNodeIds]);
  const selectedNodeCount = nodes.filter((node) => node.selected).length;
  const hasSelection = selectedNodeCount > 0 || edges.some((edge) => edge.selected);
  const alignDraggedNode = useCallback((node: ThoughtNode) => {
    const currentNodes = useCanvasStore.getState().nodes;
    const branch = collapsedBranchDrag.current?.id === node.id ? collapsedBranchDrag.current : null;
    const alignmentNodes = branch
      ? currentNodes.filter((item) => !branch.positions.has(item.id))
      : currentNodes;
    const aligned = alignThoughtNode(node, alignmentNodes, flow.getViewport().zoom);

    if (branch) {
      const delta = { x: aligned.position.x - branch.origin.x, y: aligned.position.y - branch.origin.y };
      useCanvasStore.getState().setNodes(currentNodes.map((item) => {
        if (item.id === node.id) return { ...item, position: aligned.position };
        const origin = branch.positions.get(item.id);
        return origin ? { ...item, position: { x: origin.x + delta.x, y: origin.y + delta.y } } : item;
      }));
    } else if (aligned.position.x !== node.position.x || aligned.position.y !== node.position.y) {
      useCanvasStore.getState().setNodes(currentNodes.map((item) => (
        item.id === node.id ? { ...item, position: aligned.position } : item
      )));
    }

    return aligned;
  }, [flow]);

  const handleNodeDrag = useCallback<OnNodeDrag<ThoughtNode>>((_, node) => {
    const aligned = alignDraggedNode(node);
    const bounds = canvasRef.current?.getBoundingClientRect();

    if (bounds) {
      const horizontalStart = aligned.guides.horizontal && flow.flowToScreenPosition({
        x: aligned.guides.horizontal.start,
        y: aligned.guides.horizontal.coordinate,
      });
      const horizontalEnd = aligned.guides.horizontal && flow.flowToScreenPosition({
        x: aligned.guides.horizontal.end,
        y: aligned.guides.horizontal.coordinate,
      });
      const verticalStart = aligned.guides.vertical && flow.flowToScreenPosition({
        x: aligned.guides.vertical.coordinate,
        y: aligned.guides.vertical.start,
      });
      const verticalEnd = aligned.guides.vertical && flow.flowToScreenPosition({
        x: aligned.guides.vertical.coordinate,
        y: aligned.guides.vertical.end,
      });
      setAlignmentGuides({
        horizontal: horizontalStart && horizontalEnd ? {
          left: horizontalStart.x - bounds.left,
          top: horizontalStart.y - bounds.top,
          width: horizontalEnd.x - horizontalStart.x,
        } : undefined,
        vertical: verticalStart && verticalEnd ? {
          left: verticalStart.x - bounds.left,
          top: verticalStart.y - bounds.top,
          height: verticalEnd.y - verticalStart.y,
        } : undefined,
      });
    } else {
      setAlignmentGuides({});
    }

  }, [alignDraggedNode, flow]);
  const handleNodeDragStop = useCallback<OnNodeDrag<ThoughtNode>>((_, node) => {
    setAlignmentGuides({});
    alignDraggedNode(node);
    collapsedBranchDrag.current = null;
  }, [alignDraggedNode]);

  const openDraftAtPanePoint = useCallback((event: ReactMouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(".react-flow__pane")) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    const point = { x: event.clientX, y: event.clientY };
    const localX = point.x - (rect?.left ?? 0);
    const localY = point.y - (rect?.top ?? 0);
    setDraft({
      position: flow.screenToFlowPosition(point),
      x: rect ? Math.min(Math.max(localX, 168), Math.max(168, rect.width - 168)) : localX,
      y: rect ? Math.max(40, Math.min(localY, rect.height - 30)) : localY,
    });
  }, [flow]);

  const fitCanvas = useCallback(() => { void flow.fitView({ padding: 0.3, duration: 450 }); }, [flow]);
  const organizeCanvas = useCallback(() => {
    const state = useCanvasStore.getState();
    if (!state.nodes.length) return;
    const organized = arrangeThoughtNodes(state.nodes, state.edges, {
      width: canvasRef.current?.clientWidth ?? window.innerWidth,
      height: canvasRef.current?.clientHeight ?? window.innerHeight,
    });
    if (organized.some((node, index) => (
      node.position.x !== state.nodes[index].position.x ||
      node.position.y !== state.nodes[index].position.y ||
      node.sourcePosition !== state.nodes[index].sourcePosition ||
      node.targetPosition !== state.nodes[index].targetPosition
    ))) {
      state.checkpoint();
      state.setNodes(organized);
    }
    window.requestAnimationFrame(() => { void flow.fitView({ padding: 0.18, duration: 450 }); });
  }, [flow]);
  const getSelectedNode = useCallback(() => useCanvasStore.getState().nodes.find((node) => node.selected), []);
  const undo = useCallback(() => {
    useCanvasStore.getState().undo();
    void flow.setViewport(useCanvasStore.getState().viewport, { duration: 250 });
  }, [flow]);
  const redo = useCallback(() => {
    useCanvasStore.getState().redo();
    void flow.setViewport(useCanvasStore.getState().viewport, { duration: 250 });
  }, [flow]);
  const exportFile = useCallback(() => {
    const state = useCanvasStore.getState();
    const board = state.canvases.find((canvas) => canvas.id === state.activeCanvasId);
    if (!board) return;
    downloadCanvas({ ...board, snapshot: { nodes: state.nodes, edges: state.edges, viewport: state.viewport, summaries: state.summaries, actions: state.actions } }, state.theme);
    toast.success("画布已导出");
  }, []);
  const exportAllCanvases = useCallback(() => {
    downloadWorkspace(useCanvasStore.getState().getWorkspace());
    toast.success("全部画布已备份");
  }, []);
  const exportImage = useCallback(async () => {
    const flowElement = canvasRef.current?.querySelector<HTMLElement>(".react-flow");
    if (!flowElement) return;

    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(flowElement, {
        backgroundColor: getComputedStyle(flowElement).backgroundColor,
        cacheBust: true,
        pixelRatio: 2,
        filter: (element) => ![
          "react-flow__controls",
          "react-flow__attribution",
          "react-flow__handle",
          "node-toolbar",
        ].some((className) => element.classList?.contains(className)),
      });
      const link = document.createElement("a");
      link.download = "thought-garden.png";
      link.href = dataUrl;
      link.click();
      toast.success("画布图片已导出");
    } catch (error) {
      console.error("[thought-garden] Could not export canvas image", error);
      toast.error("图片导出失败，请重试。");
    }
    exportMenuRef.current?.removeAttribute("open");
  }, []);

  const clearCanvas = useCallback(() => {
    const state = useCanvasStore.getState();
    if ((state.nodes.length || state.summaries.length || state.actions.length) && !window.confirm("清空这张思维画布？此操作可以撤销。")) return;
    useCanvasStore.getState().clearCanvas();
    void flow.setViewport({ x: 0, y: 0, zoom: 1 });
  }, [flow]);

  const resetCanvasUi = useCallback(() => {
    setDraft(null);
    setSearch("");
    setCanvasSearch("");
    setCanvasMenuOpen(false);
    setSummaryOpen(false);
    setCommandOpen(false);
    setSearchOpen(false);
    setRunning(null);
    setAlignmentGuides({});
    initialSingleNodeViewApplied.current = false;
  }, []);

  const importFile = useCallback(async (file?: File) => {
    if (!file) return;
    try {
      const imported = normalizeImportedFile(JSON.parse(await file.text()));
      const state = useCanvasStore.getState();
      if (imported.type === "workspace") {
        if (state.canvases.length + imported.workspace.canvases.length > 100) {
          toast.error("画布数量达到上限，请先整理现有画布后再导入。");
          return;
        }
        resetCanvasUi();
        canAutoSave.current = true;
        state.mergeCanvases(imported.workspace.canvases, imported.workspace.activeCanvasId);
        toast.success(`已合并导入 ${imported.workspace.canvases.length} 张画布`);
      } else {
        if (state.canvases.length >= 100) {
          toast.error("画布数量达到上限，请先整理现有画布后再导入。");
          return;
        }
        resetCanvasUi();
        canAutoSave.current = true;
        state.importCanvas(imported.board);
        if (imported.theme) state.setTheme(imported.theme);
        toast.success("已作为新画布导入，原画布保持不变");
      }
    } catch (error) {
      console.error("[thought-garden] Invalid import file", error);
      toast.error("文件格式不正确，画布没有变化。");
    }
  }, [resetCanvasUi]);

  const searchResults = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return term ? nodes.filter((node) => node.data.text.toLocaleLowerCase().includes(term)).slice(0, 12) : [];
  }, [nodes, search]);

  const selectSearchResult = useCallback((node: ThoughtNode) => {
    useCanvasStore.getState().setNodes(useCanvasStore.getState().nodes.map((item) => ({ ...item, selected: item.id === node.id })));
    void flow.setCenter(node.position.x + 127, node.position.y + 52, { zoom: 1.1, duration: 500 });
    setSearchOpen(false);
    setSearch("");
  }, [flow]);

  const saveSummary = useCallback((nextSummary: CanvasSummary) => {
    const added = useCanvasStore.getState().addSummary(nextSummary);
    setSummaryOpen(false);
    toast.success(added ? "整理结果已保存" : "相同内容已保存过，本次没有重复记录");
  }, []);
  const createCanvas = useCallback(() => {
    resetCanvasUi();
    useCanvasStore.getState().createCanvas();
    setCanvasMenuOpen(false);
  }, [resetCanvasUi]);
  const beginRenameCanvas = useCallback((canvas: CanvasBoard) => {
    setRenamingCanvasId(canvas.id);
    setRenameDraft(canvas.name);
  }, []);
  const commitRenameCanvas = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (renamingCanvasId && renameDraft.trim()) {
      useCanvasStore.getState().renameCanvas(renamingCanvasId, renameDraft);
    }
    setRenamingCanvasId(null);
    setRenameDraft("");
  }, [renameDraft, renamingCanvasId]);
  const duplicateCanvas = useCallback((id: string) => {
    const duplicateId = useCanvasStore.getState().duplicateCanvas(id);
    if (!duplicateId) {
      toast.error("画布数量已达到上限。");
      return;
    }
    resetCanvasUi();
    useCanvasStore.getState().switchCanvas(duplicateId);
    setCanvasMenuOpen(false);
    toast.success("画布副本已创建");
  }, [resetCanvasUi]);
  const switchCanvas = useCallback((id: string) => {
    resetCanvasUi();
    useCanvasStore.getState().switchCanvas(id);
    setCanvasMenuOpen(false);
  }, [resetCanvasUi]);

  const focusSummarySource = useCallback((id: string) => {
    const state = useCanvasStore.getState();
    const byId = new Map(state.nodes.map((node) => [node.id, node]));
    const parents = new Map<string, string[]>();
    for (const edge of state.edges) parents.set(edge.target, [...(parents.get(edge.target) ?? []), edge.source]);
    for (const node of state.nodes) {
      if (node.data.parentId) parents.set(node.id, [...(parents.get(node.id) ?? []), node.data.parentId]);
    }
    const ancestors = new Set<string>();
    const pending = [...(parents.get(id) ?? [])];
    while (pending.length) {
      const parentId = pending.pop()!;
      if (ancestors.has(parentId) || !byId.has(parentId)) continue;
      ancestors.add(parentId);
      pending.push(...(parents.get(parentId) ?? []));
    }
    state.setNodes(state.nodes.map((node) => ({
      ...node,
      selected: node.id === id,
      data: ancestors.has(node.id) && node.data.collapsed ? { ...node.data, collapsed: false } : node.data,
    })));
    const node = byId.get(id);
    if (node) {
      void flow.setCenter(
        node.position.x + (node.measured?.width ?? 254) / 2,
        node.position.y + (node.measured?.height ?? 105) / 2,
        { zoom: 1.1, duration: 500 },
      );
    }
  }, [flow]);

  const executeCommand = useCallback((command: string) => {
    setCommandOpen(false);
    switch (command) {
      case "new": openDraftAtCenter(); break;
      case "fit": fitCanvas(); break;
      case "expand": { const node = getSelectedNode(); if (node) void runAction(node.id, "expand"); break; }
      case "deep": { const node = getSelectedNode(); if (node) void runAction(node.id, "deep"); break; }
      case "challenge": { const node = getSelectedNode(); if (node) void runAction(node.id, "challenge"); break; }
      case "risk": { const node = getSelectedNode(); if (node) void runAction(node.id, "risk"); break; }
      case "delete": useCanvasStore.getState().removeSelection(); break;
      case "summary": setSummaryOpen(true); break;
      case "export": exportFile(); break;
      case "import": importRef.current?.click(); break;
      case "clear": clearCanvas(); break;
      default: break;
    }
  }, [clearCanvas, exportFile, fitCanvas, getSelectedNode, openDraftAtCenter, runAction]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const typing = target instanceof HTMLElement && (
        target.matches("input, textarea, [contenteditable=true]") || target.isContentEditable
      );
      const mod = event.metaKey || event.ctrlKey;
      const interactive = target instanceof HTMLElement && target.closest("button, a, [role=button]");
      if (isSummaryOpen) return;
      if (canvasMenuOpen && event.key === "Escape") { setCanvasMenuOpen(false); return; }
      if (event.code === "Space" && !event.repeat && !typing && !interactive && !isCommandOpen && !isSearchOpen && !mod && !event.altKey) {
        event.preventDefault();
        setSpacePanActive(true);
        return;
      }
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault(); setSearchOpen(false); setCommandOpen((open) => !open); return;
      }
      if (mod && event.key.toLowerCase() === "f") {
        event.preventDefault(); setCommandOpen(false); setSearchOpen(true); return;
      }
      if (typing || isCommandOpen || isSearchOpen || canvasMenuOpen) {
        if (event.key === "Escape") { setCommandOpen(false); setSearchOpen(false); setDraft(null); }
        return;
      }
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if (mod && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return; }
      if (event.key.toLowerCase() === "n") { event.preventDefault(); openDraftAtCenter(); return; }
      if (!mod && !event.altKey) {
        const tool = event.key.toLowerCase();
        if (tool === "v") { setToolMode("select"); return; }
        if (tool === "h") { setToolMode("hand"); return; }
        if (tool === "c") { setToolMode("connect"); return; }
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        useCanvasStore.getState().removeSelection();
      }
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") setSpacePanActive(false);
    }
    function onBlur() {
      setSpacePanActive(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [canvasMenuOpen, isCommandOpen, isSearchOpen, isSummaryOpen, openDraftAtCenter, redo, undo]);

  if (!hydrated) return <main className="app-loading" aria-label="正在打开思维花园"><span className="brand-mark"><Leaf size={19} /></span></main>;

  return (
    <main className="app-shell">
      <div
        className="canvas-viewport"
        data-tool={activeToolMode}
        ref={canvasRef}
        onDoubleClick={(event) => { if (activeToolMode === "select") openDraftAtPanePoint(event); }}
      >
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          defaultViewport={viewport}
          nodesDraggable={activeToolMode === "select"}
          nodesConnectable={activeToolMode !== "hand"}
          elementsSelectable={activeToolMode !== "hand"}
          zoomOnScroll={activeToolMode !== "hand" && hasSelection}
          panOnScroll={activeToolMode === "hand" || !hasSelection}
          onNodesChange={(changes: NodeChange<ThoughtNode>[]) => useCanvasStore.getState().setNodes(applyNodeChanges(changes, useCanvasStore.getState().nodes))}
          onEdgesChange={(changes: EdgeChange[]) => useCanvasStore.getState().setEdges(applyEdgeChanges(changes, useCanvasStore.getState().edges))}
          onConnect={(connection: Connection) => {
            const edge = addEdge({ ...connection, id: nanoid(), type: "default" }, useCanvasStore.getState().edges);
            if (edge.length !== useCanvasStore.getState().edges.length) useCanvasStore.getState().connect(edge.at(-1)!);
          }}
          onNodeDragStart={(_, node) => {
            const state = useCanvasStore.getState();
            state.checkpoint();
            const descendants = node.data.collapsed ? getDescendantIds(node.id, state.edges) : new Set<string>();
            const positions = new Map(state.nodes
              .filter((item) => descendants.has(item.id))
              .map((item) => [item.id, item.position]));
            collapsedBranchDrag.current = positions.size
              ? { id: node.id, origin: node.position, positions }
              : null;
          }}
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={handleNodeDragStop}
          onMoveEnd={(_, nextViewport) => useCanvasStore.getState().setViewport(nextViewport)}
          panOnDrag={activeToolMode === "hand"}
          panActivationKeyCode={null}
          selectionOnDrag={activeToolMode === "select"}
          selectionMode={SelectionMode.Partial}
          multiSelectionKeyCode="Shift"
          selectionKeyCode={activeToolMode === "select" ? "Shift" : null}
          deleteKeyCode={null}
          connectionLineType={ConnectionLineType.Bezier}
          connectionLineStyle={{ stroke: "var(--accent)", strokeWidth: 2, strokeDasharray: "4 5" }}
          connectionRadius={36}
          minZoom={0.2}
          maxZoom={2.2}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: "default", style: { stroke: "var(--edge)", strokeWidth: 1.65 }, interactionWidth: 20 }}
        >
          <CanvasBackground />
          <Controls showInteractive={false} position="bottom-right" />
          <div className="canvas-hint">
            {spacePanActive ? <>临时抓手 <span className="hint-dot">·</span> 拖动画布平移 <span className="hint-dot">·</span> 松开空格恢复工具</> : toolMode === "select" ? <>拖节点移动 <span className="hint-dot">·</span> 拖空白框选 <span className="hint-dot">·</span> <kbd>Shift</kbd> 多选 <span className="hint-dot">·</span> 拖连接点连线 <span className="hint-dot">·</span> <kbd>空格</kbd> 临时抓手</> : toolMode === "hand" ? <>拖动画布平移 <span className="hint-dot">·</span> 双指平移 <span className="hint-dot">·</span> 捏合缩放 <span className="hint-dot">·</span> <kbd>V</kbd> 返回操作</> : <>拖动连接点连线 <span className="hint-dot">·</span> <kbd>V</kbd> 返回操作</>}
          </div>
        </ReactFlow>

        <aside className={`guide-sidebar${guideOpen ? " is-open" : ""} nopan nodrag`} aria-label="使用指南">
          {guideOpen ? (
            <section className="guide-panel" id="thought-guide-panel" aria-labelledby="thought-guide-title">
              <header className="guide-panel-header">
                <div className="guide-panel-heading">
                  <span className="guide-panel-mark"><Leaf size={15} /></span>
                  <div><strong id="thought-guide-title">使用指南</strong><span>让想法从不同方向生长</span></div>
                </div>
                <button type="button" className="guide-toggle is-close" onClick={() => setGuideOpen(false)} aria-label="收起使用指南" aria-expanded={true} title="收起使用指南">
                  <ChevronLeft size={17} />
                </button>
              </header>
              <div className="guide-intro">
                <strong>这个项目是做什么的？</strong>
                <p>思维花园是一张 AI 驱动的无限思维画布。从一个问题或念头出发，逐步展开分支、连接想法。</p>
                <strong>它想解决什么？</strong>
                <p>减少灵感散落难回看、思考停在第一层、观点关系不清的问题，也帮你补充反例与风险。</p>
              </div>
              <div className="guide-list">
                {thoughtGuides.map(({ action, icon: Icon, description }) => (
                  <article className="guide-item" key={action}>
                    <div className="guide-label"><Icon size={14} /><strong>{actionLabels[action]}</strong></div>
                    <p>{description}</p>
                  </article>
                ))}
              </div>
            </section>
          ) : (
            <button type="button" className="guide-toggle is-open" onClick={() => setGuideOpen(true)} aria-label="展开使用指南" aria-expanded={false} title="使用指南">
              <ChevronRight size={18} />
            </button>
          )}
        </aside>

        {alignmentGuides.vertical && <div className="alignment-guide is-vertical" style={alignmentGuides.vertical} />}
        {alignmentGuides.horizontal && <div className="alignment-guide is-horizontal" style={alignmentGuides.horizontal} />}

        <div className="canvas-toolbar" role="toolbar" aria-label="画布工具">
          {canvasTools.map(({ mode, label, icon: Icon }) => (
            <button
              key={mode}
              type="button"
              className={`canvas-tool${activeToolMode === mode ? " is-active" : ""}`}
              aria-label={`${label}工具`}
              aria-pressed={activeToolMode === mode}
              title={`${label}工具`}
              onClick={() => { setToolMode(mode); setAlignmentGuides({}); }}
            >
              <Icon size={16} strokeWidth={1.8} />
              <span>{label}</span>
            </button>
          ))}
          <span className="toolbar-divider" />
          <button
            type="button"
            className="canvas-tool"
            aria-label="一键整理画布"
            title="一键整理节点并适应画布"
            disabled={!nodes.length}
            onClick={organizeCanvas}
          >
            <Workflow size={16} strokeWidth={1.8} />
            <span>整理</span>
          </button>
          <button
            type="button"
            className={`canvas-tool${summary ? " has-summary" : ""}`}
            aria-label={summary ? "查看思路整理结果" : "整理思路"}
            title={summary ? "查看思路整理结果" : "从想法中提炼结论和下一步"}
            disabled={!nodes.length && !summary}
            onClick={() => setSummaryOpen(true)}
          >
            <ListChecks size={16} strokeWidth={1.8} />
            <span>{summary ? "查看总结" : "思路整理"}</span>
          </button>
          {selectedNodeCount > 0 && (
            <>
              <span className="toolbar-divider" />
              <button
                type="button"
                className="canvas-tool is-danger"
                aria-label={`删除 ${selectedNodeCount} 个选中节点`}
                title={`删除 ${selectedNodeCount} 个选中节点 · Delete`}
                onClick={() => useCanvasStore.getState().removeSelection()}
              >
                <Trash2 size={15} strokeWidth={1.8} />
                <span>删除 {selectedNodeCount}</span>
              </button>
            </>
          )}
        </div>

        {nodes.length === 0 && !draft && (
          <section className="empty-state">
            <div className="empty-orbit"><span /><span /><span /><Leaf size={21} /></div>
            <p className="eyebrow">从一个念头开始</p>
            <h1>让想法，长成一张思考地图</h1>
            <p className="empty-copy">写下一个困惑，再沿着问题、风险和新视角继续探索。</p>
            <button className="primary-button" onClick={openDraftAtCenter}><Plus size={16} />写下第一个想法</button>
            <div className="examples">
              <span>也可以从一个问题开始</span>
              <div className="example-grid">
                {examples.map(({ topic, text }) => (
                  <button className="example-card" key={topic} onClick={() => createThought(text, viewportCenter().position)}>
                    <span>{topic}</span>
                    <strong>{text}</strong>
                  </button>
                ))}
              </div>
              <button type="button" className="example-tour" onClick={loadExampleGarden}>
                <Workflow size={16} />浏览示例画布<ChevronRight size={16} />
              </button>
            </div>
          </section>
        )}

        {draft && (
          <form
            className="quick-entry"
            style={{ left: draft.x, top: draft.y }}
            onSubmit={(event) => { event.preventDefault(); const text = draftRef.current?.value.trim(); if (text) createThought(text, draft.position); }}
            onKeyDown={(event) => { if (event.key === "Escape") setDraft(null); event.stopPropagation(); }}
          >
            <input ref={draftRef} maxLength={1600} placeholder="写下一个想法…" aria-label="写下一个想法" />
            <button type="submit" aria-label="创建想法"><ArrowDownToLine size={17} /></button>
            <span>Enter 创建 · Esc 取消</span>
          </form>
        )}

        <header className="topbar">
          <div className="brand-lockup">
            <span className="brand-mark"><Leaf size={17} strokeWidth={1.8} /></span>
            <span className="brand-en">thought garden</span>
            <span className="brand-divider" />
            <span className="brand-cn">思维花园</span>
            <span className="brand-divider" />
            <div className="canvas-switcher nopan nodrag" ref={canvasMenuRef}>
              <button
                type="button"
                className="canvas-switcher-trigger"
                aria-expanded={canvasMenuOpen}
                aria-haspopup="dialog"
                onClick={() => setCanvasMenuOpen((open) => !open)}
                title="切换画布"
              >
                <PanelsTopLeft size={14} />
                <span>{activeCanvas?.name ?? "我的画布"}</span>
                <ChevronDown size={13} />
              </button>
              {canvasMenuOpen && (
                <section className="canvas-switcher-menu" role="dialog" aria-label="画布管理">
                  <header className="canvas-switcher-heading">
                    <strong>你的画布</strong>
                    <span>{canvases.length}/100</span>
                  </header>
                  <label className="canvas-switcher-search">
                    <Search size={14} />
                    <input value={canvasSearch} onChange={(event) => setCanvasSearch(event.target.value)} placeholder="搜索画布" aria-label="搜索画布" />
                  </label>
                  <div className="canvas-switcher-list">
                    {visibleCanvases.map((canvas) => (
                      <div className={`canvas-switcher-row${canvas.id === activeCanvasId ? " is-active" : ""}`} key={canvas.id}>
                        {renamingCanvasId === canvas.id ? (
                          <form className="canvas-rename-form" onSubmit={commitRenameCanvas}>
                            <input ref={renameInputRef} value={renameDraft} maxLength={80} onChange={(event) => setRenameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setRenamingCanvasId(null); } }} aria-label="画布名称" />
                            <button type="submit" disabled={!renameDraft.trim()} aria-label="保存画布名称"><Check size={14} /></button>
                          </form>
                        ) : (
                          <>
                            <button type="button" className="canvas-switcher-choice" onClick={() => switchCanvas(canvas.id)}>
                              <span className="canvas-switcher-name">{canvas.name}</span>
                              <small>{canvas.snapshot.nodes.length} 个想法 · {new Date(canvas.updatedAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} 更新</small>
                            </button>
                            <div className="canvas-switcher-actions">
                              <button type="button" onClick={() => beginRenameCanvas(canvas)} aria-label={`重命名${canvas.name}`} title="重命名"><Pencil size={13} /></button>
                              <button type="button" onClick={() => duplicateCanvas(canvas.id)} aria-label={`复制${canvas.name}`} title="复制画布"><Copy size={13} /></button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                    {!visibleCanvases.length && <p className="canvas-switcher-empty">没有找到匹配的画布。</p>}
                  </div>
                  <button type="button" className="canvas-switcher-create" onClick={createCanvas} disabled={canvases.length >= 100}>
                    <Plus size={15} />新建画布
                  </button>
                </section>
              )}
            </div>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" onClick={undo} data-tooltip="撤销 · ⌘Z" aria-label="撤销"><Undo2 size={16} /></button>
            <button className="icon-button" onClick={redo} data-tooltip="重做 · ⌘⇧Z" aria-label="重做"><Redo2 size={16} /></button>
            <span className="toolbar-divider" />
            <button className="icon-button" onClick={fitCanvas} data-tooltip="适应画布" aria-label="适应画布"><Focus size={16} /></button>
            <button className="icon-button search-launcher" onClick={() => setSearchOpen(true)} data-tooltip="搜索想法 · ⌘F" aria-label="搜索想法"><Search size={16} /></button>
            <span className="toolbar-divider" />
            <details className="export-menu-wrap" ref={exportMenuRef}>
              <summary className="icon-button export-menu-trigger" data-tooltip="导出 JSON 或 PNG" aria-label="导出 JSON 或 PNG">
                <FileOutput size={15} />
              </summary>
              <div className="export-menu" role="menu" aria-label="导出格式">
                <button className="export-menu-item" role="menuitem" onClick={() => { exportFile(); exportMenuRef.current?.removeAttribute("open"); }}>
                  <FileJson size={16} /><span>JSON 文件<small>备份或恢复画布</small></span>
                </button>
                <button className="export-menu-item" role="menuitem" onClick={() => { exportAllCanvases(); exportMenuRef.current?.removeAttribute("open"); }}>
                  <PanelsTopLeft size={16} /><span>备份全部画布<small>导出整个工作区</small></span>
                </button>
                <button className="export-menu-item" role="menuitem" onClick={() => { void exportImage(); }}>
                  <ImageDown size={16} /><span>PNG 图片<small>下载当前视图</small></span>
                </button>
              </div>
            </details>
            <button className="icon-button file-action" onClick={() => importRef.current?.click()} data-tooltip="导入 JSON 文件" aria-label="导入"><FileInput size={15} /></button>
            <span className="toolbar-divider" />
            <button className="icon-button theme-toggle" onClick={toggleTheme} data-tooltip="切换主题" aria-label="切换主题">{theme === "light" ? <Moon size={16} /> : <Sun size={16} />}</button>
          </div>
        </header>

        <div className={`canvas-status${saveStatus === "error" ? " is-error" : ""}`} role="status">
          <span className="save-dot" />{saveMessage}
        </div>
      </div>

      <input ref={importRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = ""; }} />

      {isSummaryOpen && (
        <CanvasSummaryDialog
          nodes={nodes}
          edges={edges}
          summaries={summaries}
          savedSummary={summary}
          onClose={() => setSummaryOpen(false)}
          onSave={saveSummary}
          onFocusNode={focusSummarySource}
        />
      )}

      {isCommandOpen && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCommandOpen(false); }}>
          <Command.Dialog open onOpenChange={setCommandOpen} label="命令菜单" className="command-dialog">
            <div className="dialog-searchline"><CommandIcon size={17} /><Command.Input autoFocus placeholder="想做些什么？" /></div>
            <Command.List>
              <Command.Empty>没有匹配的命令。</Command.Empty>
              <Command.Group heading="画布">
                <Command.Item onSelect={() => executeCommand("new")}><Plus size={15} />新建想法<span>⌘ N</span></Command.Item>
                <Command.Item onSelect={() => executeCommand("fit")}><Focus size={15} />适应画布<span>F</span></Command.Item>
                <Command.Item onSelect={() => executeCommand("delete")}><X size={15} />删除选中节点<span>⌫</span></Command.Item>
                <Command.Item onSelect={() => executeCommand("export")}><FileOutput size={15} />导出 JSON</Command.Item>
                <Command.Item onSelect={() => executeCommand("import")}><FileInput size={15} />导入 JSON</Command.Item>
                <Command.Item onSelect={() => executeCommand("clear")}><X size={15} />清空画布</Command.Item>
              </Command.Group>
              <Command.Group heading="AI 思考">
                <Command.Item onSelect={() => executeCommand("summary")}><ListChecks size={15} />整理思路</Command.Item>
                <Command.Item onSelect={() => executeCommand("expand")}><Expand size={15} />展开所选想法</Command.Item>
                <Command.Item onSelect={() => executeCommand("deep")}><Sparkles size={15} />深挖所选想法</Command.Item>
                <Command.Item onSelect={() => executeCommand("challenge")}><Swords size={15} />反驳所选想法</Command.Item>
                <Command.Item onSelect={() => executeCommand("risk")}><ShieldAlert size={15} />寻找风险</Command.Item>
              </Command.Group>
            </Command.List>
            <div className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 执行</span><button onClick={() => setCommandOpen(false)}><kbd>esc</kbd> 关闭</button></div>
          </Command.Dialog>
        </div>
      )}

      {isSearchOpen && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setSearchOpen(false); setSearch(""); } }}>
          <section className="search-dialog" role="dialog" aria-modal="true" aria-label="搜索想法">
            <div className="dialog-searchline"><Search size={17} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setSearchOpen(false); setSearch(""); } }} placeholder="在画布中搜索…" /></div>
            <div className="search-results">
              {search.trim() && searchResults.length === 0 && <p className="no-results">没有找到相关想法。</p>}
              {searchResults.map((node) => (
                <button key={node.id} className="search-result" onClick={() => selectSearchResult(node)}>
                  <span><Sparkles size={14} /></span><span>{node.data.text}</span><Check size={14} />
                </button>
              ))}
            </div>
            <div className="command-footer"><span>{searchResults.length} 个想法</span><button onClick={() => { setSearchOpen(false); setSearch(""); }}><kbd>esc</kbd> 关闭</button></div>
          </section>
        </div>
      )}

      <Toaster position="bottom-center" theme={theme} closeButton={false} offset={{ top: 64 }} mobileOffset={{ top: 64 }} />
    </main>
  );
}

export default function ThoughtCanvas() {
  return <ReactFlowProvider><CanvasWorkspace /></ReactFlowProvider>;
}
