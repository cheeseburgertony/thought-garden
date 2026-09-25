"use client";

import { useState } from "react";
import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronRight, CircleCheck, CircleDashed, CircleX, Copy, Ellipsis, ExternalLink, Lightbulb, MessageCircleQuestion, ShieldAlert, Sparkles, Swords, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import { actionLabels, type ThoughtAction, type ThoughtNode, type ThoughtNodeData, type VerificationStatus } from "@/lib/types";
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

const verificationLabels: Record<VerificationStatus, string> = {
  unverified: "未验证",
  confirmed: "已证实",
  refuted: "已否定",
};

const verificationIcons = {
  unverified: CircleDashed,
  confirmed: CircleCheck,
  refuted: CircleX,
};

function resizeEditor(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}

export default function ThoughtNodeView({ id, data, selected, sourcePosition, targetPosition }: NodeProps<ThoughtNode>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.text);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>(data.verification?.status ?? "unverified");
  const [verificationNote, setVerificationNote] = useState(data.verification?.note ?? "");
  const [verificationSourceUrl, setVerificationSourceUrl] = useState(data.verification?.sourceUrl ?? "");
  const [verificationError, setVerificationError] = useState("");
  const updateThought = useCanvasStore((state) => state.updateThought);
  const addThought = useCanvasStore((state) => state.addThought);
  const removeThoughts = useCanvasStore((state) => state.removeThoughts);
  const toggleBranch = useCanvasStore((state) => state.toggleBranch);
  const childCount = useCanvasStore((state) => state.edges.reduce((count, edge) => count + (edge.source === id && edge.target !== id ? 1 : 0), 0));
  const Icon = kindIcons[data.kind];
  const VerificationIcon = verificationIcons[data.verification?.status ?? "unverified"];
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

  function toggleVerification() {
    if (!verificationOpen) {
      setVerificationStatus(data.verification?.status ?? "unverified");
      setVerificationNote(data.verification?.note ?? "");
      setVerificationSourceUrl(data.verification?.sourceUrl ?? "");
      setVerificationError("");
    }
    setVerificationOpen(!verificationOpen);
  }

  function saveVerification() {
    const note = verificationNote.trim();
    const sourceUrl = verificationSourceUrl.trim();
    if (verificationStatus !== "unverified" && !note) {
      setVerificationError("标为已证实或已否定时，请写明验证说明。");
      return;
    }
    if (sourceUrl) {
      try {
        const url = new URL(sourceUrl);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported protocol");
      } catch {
        setVerificationError("来源链接需为有效的 http 或 https 地址。");
        return;
      }
    }
    const saved = useCanvasStore.getState().updateVerification(id, {
      status: verificationStatus,
      note,
      ...(sourceUrl ? { sourceUrl } : {}),
      updatedAt: new Date().toISOString(),
    });
    if (!saved) {
      setVerificationError("验证记录保存失败，请检查内容后重试。");
      return;
    }
    setVerificationOpen(false);
    setVerificationError("");
    toast.success("想法验证记录已保存");
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
        <Handle type="target" position={targetPosition ?? Position.Top} />
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
          {data.kind !== "question" && <button
            type="button"
            className={`verification-badge is-${data.verification?.status ?? "unverified"} nodrag nopan`}
            aria-label={`验证状态：${verificationLabels[data.verification?.status ?? "unverified"]}`}
            aria-expanded={verificationOpen}
            title="查看或更新验证记录"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); toggleVerification(); }}
          ><VerificationIcon size={12} />{verificationLabels[data.verification?.status ?? "unverified"]}</button>}
          {data.busy && <span className="mini-spinner" aria-hidden="true" />}
        </div>
        {data.kind !== "question" && verificationOpen && (
          <section className="thought-verification-panel nodrag nopan" aria-label="想法验证记录" onDoubleClick={(event) => event.stopPropagation()}>
            <div className="verification-panel-heading"><span>验证记录</span><small>{data.createdBy === "ai" ? "AI 生成的想法默认未验证" : "状态由你标记"}</small></div>
            <label className="verification-field"><span>判断状态</span><select className="nodrag" value={verificationStatus} onMouseDown={(event) => event.stopPropagation()} onChange={(event) => { setVerificationStatus(event.target.value as VerificationStatus); setVerificationError(""); }}>
              <option value="unverified">未验证</option><option value="confirmed">已证实</option><option value="refuted">已否定</option>
            </select></label>
            <label className="verification-field"><span>验证说明{verificationStatus !== "unverified" ? " · 必填" : ""}</span><textarea className="nodrag nowheel" rows={3} maxLength={1000} value={verificationNote} placeholder="记录证据、观察或否定原因…" onMouseDown={(event) => event.stopPropagation()} onChange={(event) => { setVerificationNote(event.target.value); setVerificationError(""); }} /></label>
            <label className="verification-field"><span>来源链接 · 可选</span><input className="nodrag" type="url" maxLength={2048} value={verificationSourceUrl} placeholder="https://…" onMouseDown={(event) => event.stopPropagation()} onChange={(event) => { setVerificationSourceUrl(event.target.value); setVerificationError(""); }} /></label>
            {verificationError && <p className="verification-error" role="alert">{verificationError}</p>}
            <div className="verification-panel-actions"><button type="button" className="verification-cancel nodrag" onMouseDown={(event) => event.stopPropagation()} onClick={() => setVerificationOpen(false)}>取消</button><button type="button" className="verification-save nodrag" onMouseDown={(event) => event.stopPropagation()} onClick={saveVerification}>保存验证</button></div>
            {data.verification?.updatedAt && <small className="verification-updated">更新于 {new Date(data.verification.updatedAt).toLocaleDateString("zh-CN")}</small>}
            {data.verification?.sourceUrl && <a className="verification-source" href={data.verification.sourceUrl} target="_blank" rel="noreferrer" onMouseDown={(event) => event.stopPropagation()}><ExternalLink size={12} />打开来源链接</a>}
          </section>
        )}
        <Handle type="source" position={sourcePosition ?? Position.Bottom} />
      </div>
    </>
  );
}
