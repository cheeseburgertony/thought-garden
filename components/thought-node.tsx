"use client";

import { useState } from "react";
import { Handle, NodeToolbar, Position } from "@xyflow/react";
import { ChevronDown, ChevronRight, Copy, Ellipsis, Lightbulb, MessageCircleQuestion, ShieldAlert, Sparkles, Swords, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { actionLabels, type ThoughtAction, type ThoughtNodeData } from "@/lib/types";
import { useCanvasStore } from "@/store/canvas-store";

const actionButtons: { action: ThoughtAction; icon: typeof Sparkles }[] = [
  { action: "expand", icon: Sparkles },
  { action: "deep", icon: MessageCircleQuestion },
  { action: "challenge", icon: Swords },
  { action: "risk", icon: ShieldAlert },
];

const kindIcons = {
  idea: Lightbulb,
  question: MessageCircleQuestion,
  insight: Sparkles,
  risk: ShieldAlert,
  challenge: Swords,
};

const kindLabels = {
  idea: "想法",
  question: "问题",
  insight: "洞察",
  risk: "风险",
  challenge: "挑战",
} satisfies Record<ThoughtNodeData["kind"], string>;

function resizeEditor(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}

export default function ThoughtNodeView({ id, data, selected }: { id: string; data: ThoughtNodeData; selected?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.text);
  const updateThought = useCanvasStore((state) => state.updateThought);
  const addThought = useCanvasStore((state) => state.addThought);
  const removeThoughts = useCanvasStore((state) => state.removeThoughts);
  const toggleBranch = useCanvasStore((state) => state.toggleBranch);
  const childCount = useCanvasStore((state) => state.edges.reduce((count, edge) => count + (edge.source === id && edge.target !== id ? 1 : 0), 0));
  const Icon = kindIcons[data.kind];
  const kindLabel = data.depth === 0 && data.kind === "idea" ? "起点" : kindLabels[data.kind];

  function finishEdit(save: boolean) {
    if (save && draft.trim() && draft.trim() !== data.text) updateThought(id, draft.trim());
    else if (!save) setDraft(data.text);
    setEditing(false);
  }

  function duplicate() {
    const node = useCanvasStore.getState().nodes.find((item) => item.id === id);
    if (!node) return;
    const copyId = nanoid();
    addThought({ ...node, id: copyId, selected: false, position: { x: node.position.x + 300, y: node.position.y + 40 }, data: { ...node.data, onAction: undefined } });
  }

  return (
    <>
      <NodeToolbar position={Position.Top} offset={12} className="node-toolbar">
        {actionButtons.map(({ action, icon: ActionIcon }) => (
          <button key={action} className="node-action" onClick={() => data.onAction?.(id, action)} aria-label={actionLabels[action]}>
            <ActionIcon size={14} strokeWidth={1.8} />
            <span>{actionLabels[action]}</span>
          </button>
        ))}
        <details className="node-more-wrap">
          <summary className="node-more" aria-label="更多操作"><Ellipsis size={17} /></summary>
          <div className="node-more-menu">
            <button onClick={() => data.onAction?.(id, "perspective")}><Sparkles size={14} />换角度</button>
            <button onClick={() => { setDraft(data.text); setEditing(true); }}><Lightbulb size={14} />编辑</button>
            <button onClick={duplicate}><Copy size={14} />复制</button>
            <button className="danger-action" onClick={() => removeThoughts([id])}><Trash2 size={14} />删除</button>
          </div>
        </details>
      </NodeToolbar>
      <div
        className={`thought-node${selected ? " is-selected" : ""}${data.kind !== "idea" ? ` kind-${data.kind}` : ""}`}
        onDoubleClick={(event) => { event.stopPropagation(); setDraft(data.text); setEditing(true); }}
      >
        <Handle type="target" position={Position.Top} />
        <div className="thought-header">
          <div className="thought-kind"><Icon size={13} strokeWidth={1.8} /><span>{kindLabel}</span></div>
          {childCount > 0 && (
            <button
              type="button"
              className="branch-toggle nodrag nopan"
              title={data.collapsed ? `展开 ${childCount} 个子节点` : `收起 ${childCount} 个子节点`}
              aria-label={data.collapsed ? `展开 ${childCount} 个子节点` : `收起 ${childCount} 个子节点`}
              aria-expanded={!data.collapsed}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => { event.stopPropagation(); toggleBranch(id); }}
            >
              {data.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              <span className="branch-toggle-count">{childCount}</span>
            </button>
          )}
        </div>
        {editing ? (
          <textarea
            autoFocus
            ref={resizeEditor}
            rows={1}
            className="thought-editor nodrag nowheel"
            value={draft}
            onChange={(event) => { resizeEditor(event.currentTarget); setDraft(event.currentTarget.value); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); finishEdit(true); }
              if (event.key === "Escape") { event.preventDefault(); finishEdit(false); }
              event.stopPropagation();
            }}
            aria-label="编辑想法"
          />
        ) : <div className="thought-text">{data.text}</div>}
        <div className="thought-footer">
          {data.busy ? <span className="thinking-label"><span className="thinking-dot" />正在思考</span> : data.createdBy === "ai" ? <span>由 AI 生长</span> : null}
          {data.busy && <span className="mini-spinner" aria-hidden="true" />}
        </div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    </>
  );
}
