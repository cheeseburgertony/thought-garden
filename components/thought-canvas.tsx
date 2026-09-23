"use client";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnNodeDrag,
} from "@xyflow/react";
import { Command } from "cmdk";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Command as CommandIcon,
  Expand,
  Focus,
  Hand,
  Leaf,
  Link2,
  Moon,
  MousePointer2,
  Plus,
  Redo2,
  Search,
  ShieldAlert,
  Sparkles,
  Sun,
  Swords,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Toaster, toast } from "sonner";
import { alignThoughtNode, fanOutPositions } from "@/lib/canvas-layout";
import { downloadCanvas, loadCanvas, saveCanvas } from "@/lib/persistence";
import { CanvasFileSchema, ExpandResponseSchema } from "@/lib/schemas";
import type { ThoughtAction, ThoughtNode } from "@/lib/types";
import ThoughtNodeView from "@/components/thought-node";
import { useCanvasStore } from "@/store/canvas-store";

const nodeTypes = { thought: ThoughtNodeView };
type AlignmentGuideStyle = { left: number; top: number; width?: number; height?: number };
const examples = [
  "我想做一个 AI 产品",
  "未来三年我应该提升什么能力？",
  "怎样设计一个更好的个人知识系统？",
];

type Draft = { x: number; y: number; position: { x: number; y: number } };
type CanvasTool = "select" | "hand" | "connect";

const canvasTools = [
  { mode: "select", label: "选择", shortcut: "V", icon: MousePointer2 },
  { mode: "hand", label: "抓手", shortcut: "H", icon: Hand },
  { mode: "connect", label: "连线", shortcut: "C", icon: Link2 },
] as const;

function CanvasWorkspace() {
  const flow = useReactFlow<ThoughtNode>();
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const viewport = useCanvasStore((state) => state.viewport);
  const theme = useCanvasStore((state) => state.theme);
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isCommandOpen, setCommandOpen] = useState(false);
  const [isSearchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [toolMode, setToolMode] = useState<CanvasTool>("select");
  const [alignmentGuides, setAlignmentGuides] = useState<{ horizontal?: AlignmentGuideStyle; vertical?: AlignmentGuideStyle }>({});
  const canvasRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = loadCanvas();
    if (saved) useCanvasStore.setState(saved);
    const timer = window.setTimeout(() => setHydrated(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!hydrated) return;
    let timer: ReturnType<typeof setTimeout>;
    const unsubscribe = useCanvasStore.subscribe((state) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          saveCanvas({ nodes: state.nodes, edges: state.edges, viewport: state.viewport }, state.theme);
        } catch (error) {
          console.warn("Could not save Thought Garden canvas", error);
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
      const points = fanOutPositions(current, fresh.length, currentState.nodes);
      const nextNodes: ThoughtNode[] = fresh.map((item, index) => ({
        id: nanoid(),
        type: "thought",
        position: points[index],
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

  const flowNodes = useMemo(() => nodes.map((node) => ({
    ...node,
    data: { ...node.data, busy: running === node.id, onAction: runAction },
  })), [nodes, runAction, running]);
  const flowEdges = useMemo(() => edges.map((edge) => (
    edge.type === "smoothstep" ? { ...edge, type: "default" } : edge
  )), [edges]);
  const selectedNodeCount = nodes.filter((node) => node.selected).length;
  const hasSelection = selectedNodeCount > 0 || edges.some((edge) => edge.selected);
  const handleNodeDrag = useCallback<OnNodeDrag<ThoughtNode>>((_, node) => {
    const currentNodes = useCanvasStore.getState().nodes;
    const aligned = alignThoughtNode(node, currentNodes, flow.getViewport().zoom);
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

    if (aligned.position.x !== node.position.x || aligned.position.y !== node.position.y) {
      useCanvasStore.getState().setNodes(currentNodes.map((item) => (
        item.id === node.id ? { ...item, position: aligned.position } : item
      )));
    }
  }, [flow]);

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
    downloadCanvas({ nodes: state.nodes, edges: state.edges, viewport: state.viewport });
    toast.success("画布已导出");
  }, []);

  const clearCanvas = useCallback(() => {
    if (useCanvasStore.getState().nodes.length && !window.confirm("清空这张思维画布？此操作可以撤销。")) return;
    useCanvasStore.getState().clearCanvas();
    void flow.setViewport({ x: 0, y: 0, zoom: 1 });
  }, [flow]);

  const importFile = useCallback(async (file?: File) => {
    if (!file) return;
    try {
      const parsed = CanvasFileSchema.parse(JSON.parse(await file.text()));
      const next = {
        nodes: parsed.nodes.map((node) => ({ ...node, type: "thought" as const })),
        edges: parsed.edges,
        viewport: parsed.viewport,
      };
      useCanvasStore.getState().importCanvas(next);
      if (parsed.theme) useCanvasStore.getState().setTheme(parsed.theme);
      await flow.setViewport(next.viewport, { duration: 300 });
      toast.success("画布已导入");
    } catch (error) {
      console.error("[thought-garden] Invalid import file", error);
      toast.error("文件格式不正确，画布没有变化。");
    }
  }, [flow]);

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
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault(); setSearchOpen(false); setCommandOpen((open) => !open); return;
      }
      if (mod && event.key.toLowerCase() === "f") {
        event.preventDefault(); setCommandOpen(false); setSearchOpen(true); return;
      }
      if (typing || isCommandOpen || isSearchOpen) {
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
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isCommandOpen, isSearchOpen, openDraftAtCenter, redo, undo]);

  if (!hydrated) return <main className="app-loading" aria-label="正在打开思维花园"><span className="brand-mark"><Leaf size={19} /></span></main>;

  return (
    <main className="app-shell">
      <div
        className="canvas-viewport"
        data-tool={toolMode}
        ref={canvasRef}
        onDoubleClick={(event) => { if (toolMode === "select") openDraftAtPanePoint(event); }}
      >
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          defaultViewport={viewport}
          nodesDraggable={toolMode === "select"}
          nodesConnectable={toolMode !== "hand"}
          elementsSelectable={toolMode !== "hand"}
          zoomOnScroll={toolMode !== "hand" && hasSelection}
          panOnScroll={toolMode === "hand" || !hasSelection}
          onNodesChange={(changes: NodeChange<ThoughtNode>[]) => useCanvasStore.getState().setNodes(applyNodeChanges(changes, useCanvasStore.getState().nodes))}
          onEdgesChange={(changes: EdgeChange[]) => useCanvasStore.getState().setEdges(applyEdgeChanges(changes, useCanvasStore.getState().edges))}
          onConnect={(connection: Connection) => {
            const edge = addEdge({ ...connection, id: nanoid(), type: "default" }, useCanvasStore.getState().edges);
            if (edge.length !== useCanvasStore.getState().edges.length) useCanvasStore.getState().connect(edge.at(-1)!);
          }}
          onNodeDragStart={() => useCanvasStore.getState().checkpoint()}
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={() => setAlignmentGuides({})}
          onMoveEnd={(_, nextViewport) => useCanvasStore.getState().setViewport(nextViewport)}
          panOnDrag={toolMode === "hand"}
          selectionOnDrag={toolMode === "select"}
          selectionMode={SelectionMode.Partial}
          multiSelectionKeyCode="Shift"
          selectionKeyCode={toolMode === "select" ? "Shift" : null}
          deleteKeyCode={null}
          connectionLineType={ConnectionLineType.Bezier}
          connectionLineStyle={{ stroke: "var(--accent)", strokeWidth: 2, strokeDasharray: "4 5" }}
          connectionRadius={36}
          minZoom={0.2}
          maxZoom={2.2}
          defaultEdgeOptions={{ type: "default", style: { stroke: "var(--edge)", strokeWidth: 1.65 }, interactionWidth: 20 }}
        >
          <Background variant={BackgroundVariant.Dots} gap={25} size={1} color="var(--dot)" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>

        {alignmentGuides.vertical && <div className="alignment-guide is-vertical" style={alignmentGuides.vertical} />}
        {alignmentGuides.horizontal && <div className="alignment-guide is-horizontal" style={alignmentGuides.horizontal} />}

        <div className="canvas-toolbar" role="toolbar" aria-label="画布工具">
          {canvasTools.map(({ mode, label, shortcut, icon: Icon }) => (
            <button
              key={mode}
              type="button"
              className={`canvas-tool${toolMode === mode ? " is-active" : ""}`}
              aria-label={`${label}工具，快捷键 ${shortcut}`}
              aria-pressed={toolMode === mode}
              title={`${label}工具 · ${shortcut}`}
              onClick={() => { setToolMode(mode); setAlignmentGuides({}); }}
            >
              <Icon size={16} strokeWidth={1.8} />
              <span>{label}</span>
              <kbd>{shortcut}</kbd>
            </button>
          ))}
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
            <p className="eyebrow">A SPACE FOR YOUR THOUGHTS</p>
            <h1>Thought Garden</h1>
            <p className="empty-copy">种下一个想法，<br />看看它会长成什么。</p>
            <button className="primary-button" onClick={openDraftAtCenter}><Plus size={16} />写下第一个想法</button>
            <div className="examples">
              <span>或者从这里开始</span>
              {examples.map((example) => <button key={example} onClick={() => createThought(example, viewportCenter().position)}>{example}</button>)}
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
          <div className="brand-lockup"><span className="brand-mark"><Leaf size={17} strokeWidth={1.8} /></span><span>thought garden</span><span className="brand-divider" /><span className="brand-cn">思维花园</span></div>
          <div className="topbar-actions">
            <button className="icon-button" onClick={undo} title="撤销 ⌘Z" aria-label="撤销"><Undo2 size={16} /></button>
            <button className="icon-button" onClick={redo} title="重做 ⌘⇧Z" aria-label="重做"><Redo2 size={16} /></button>
            <span className="toolbar-divider" />
            <button className="icon-button" onClick={fitCanvas} title="适应画布" aria-label="适应画布"><Focus size={16} /></button>
            <button className="icon-button" onClick={exportFile} title="导出 JSON" aria-label="导出"><ArrowUpFromLine size={16} /></button>
            <button className="icon-button" onClick={() => importRef.current?.click()} title="导入 JSON" aria-label="导入"><ArrowDownToLine size={16} /></button>
            <span className="toolbar-divider" />
            <button className="icon-button theme-toggle" onClick={() => useCanvasStore.getState().setTheme(theme === "light" ? "dark" : "light")} title="切换主题" aria-label="切换主题">{theme === "light" ? <Moon size={16} /> : <Sun size={16} />}</button>
          </div>
        </header>

        <div className="canvas-hint">
          {toolMode === "select" ? <>拖空白框选 <span className="hint-dot">·</span> <kbd>Delete</kbd> 删除所选 <span className="hint-dot">·</span> <kbd>N</kbd> 新想法</> : toolMode === "hand" ? <>拖动画布平移 <span className="hint-dot">·</span> 双指滚动平移 <span className="hint-dot">·</span> 捏合缩放</> : <>拖动圆点连线 <span className="hint-dot">·</span> <kbd>V</kbd> 返回选择</>}
        </div>
        <div className="canvas-status"><span className="save-dot" />保存在此设备</div>
      </div>

      <input ref={importRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = ""; }} />

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
                <Command.Item onSelect={() => executeCommand("export")}><ArrowUpFromLine size={15} />导出画布</Command.Item>
                <Command.Item onSelect={() => executeCommand("import")}><ArrowDownToLine size={15} />导入画布</Command.Item>
                <Command.Item onSelect={() => executeCommand("clear")}><X size={15} />清空画布</Command.Item>
              </Command.Group>
              <Command.Group heading="AI 思考">
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

      <button className="search-launcher" onClick={() => setSearchOpen(true)} aria-label="搜索想法"><Search size={15} /><span>搜索</span><kbd>⌘ F</kbd></button>
      <Toaster position="bottom-center" theme={theme} closeButton={false} />
    </main>
  );
}

export default function ThoughtCanvas() {
  return <ReactFlowProvider><CanvasWorkspace /></ReactFlowProvider>;
}
