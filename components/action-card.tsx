"use client";

import { useRef } from "react";
import { ArrowUpRight, Check, Footprints, Save } from "lucide-react";
import { toast } from "sonner";
import type { ActionCardNode } from "@/lib/types";
import { useCanvasStore } from "@/store/canvas-store";
import type { NodeProps } from "@xyflow/react";

const statusLabels = { todo: "待开始", doing: "进行中", done: "已完成" } as const;

export default function ActionCardView({ data }: NodeProps<ActionCardNode>) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const outcomeRef = useRef<HTMLTextAreaElement>(null);
  const action = data.action;

  function saveAction(patch: { status?: ActionCardNode["data"]["action"]["status"] }) {
    const text = textRef.current?.value.trim() || action.text;
    const outcome = outcomeRef.current?.value.trim() ?? action.outcome;
    const ok = useCanvasStore.getState().updateAction(action.id, {
      ...patch,
      text,
      outcome,
      updatedAt: new Date().toISOString(),
      ...(patch.status === "done" ? { completedAt: new Date().toISOString() } : {}),
    });
    if (!ok) {
      toast.error("完成行动前，请先记录具体结果或观察。");
      return false;
    }
    return true;
  }

  return (
    <article className={`action-card nopan is-${action.status}`}>
      <header className="action-card-header">
        <span className="action-card-mark"><Footprints size={16} /></span>
        <span className="action-card-heading"><strong>下一步行动</strong><small>来自一份已保存的整理</small></span>
        <span className={`action-status is-${action.status}`}>{statusLabels[action.status]}</span>
      </header>

      <label className="action-card-field">
        <span>行动内容</span>
        <textarea
          key={`${action.id}-${action.updatedAt}-text`}
          ref={textRef}
          className="nodrag nowheel"
          defaultValue={action.text}
          maxLength={300}
          rows={2}
          aria-label="编辑行动内容"
          onMouseDown={(event) => event.stopPropagation()}
        />
      </label>

      <label className="action-card-field">
        <span>执行结果 / 观察</span>
        <textarea
          key={`${action.id}-${action.updatedAt}-outcome`}
          ref={outcomeRef}
          className="nodrag nowheel"
          defaultValue={action.outcome}
          maxLength={1200}
          rows={3}
          placeholder="完成后记录实际发生了什么…"
          aria-label="记录行动执行结果或观察"
          onMouseDown={(event) => event.stopPropagation()}
        />
      </label>

      <footer className="action-card-footer">
        <label className="action-status-control">
          <span>进度</span>
          <select
            className="nodrag"
            value={action.status}
            aria-label="行动进度"
            onMouseDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              if (saveAction({ status: event.target.value as ActionCardNode["data"]["action"]["status"] })) {
                toast.success("行动进度已更新");
              }
            }}
          >
            {Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <button type="button" className="action-save-button nodrag" onMouseDown={(event) => event.stopPropagation()} onClick={() => {
          if (saveAction({})) toast.success("行动记录已保存");
        }}>
          <Save size={13} />保存
        </button>
      </footer>

      <button type="button" className="action-source-link nodrag" disabled={!data.sourceAvailable} onMouseDown={(event) => event.stopPropagation()} onClick={() => data.onOpenSummary(action.sourceSummaryId)}>
        {data.sourceAvailable ? <>回看来源整理<ArrowUpRight size={13} /></> : "来源整理已不可用"}
      </button>
      {action.status === "done" && action.completedAt && <p className="action-completed-at"><Check size={12} />完成于 {new Date(action.completedAt).toLocaleDateString("zh-CN")}</p>}
    </article>
  );
}
