"use client";

import { useState } from "react";
import { Check, LoaderCircle, RotateCcw, Sparkles, X } from "lucide-react";
import { actionLabels, type ThoughtAction, type ThoughtKind } from "@/lib/types";

export type ThoughtCandidate = { text: string; kind: ThoughtKind };

type ThoughtCandidateDialogProps = {
  action: ThoughtAction;
  parentText: string;
  candidates: ThoughtCandidate[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onRegenerate: (previousCandidates: string[]) => void;
  onConfirm: (candidates: ThoughtCandidate[]) => void;
};

const kindLabels: Record<ThoughtKind, string> = {
  idea: "想法",
  question: "问题",
  insight: "洞察",
  risk: "风险",
  challenge: "挑战",
};

export default function ThoughtCandidateDialog({
  action,
  parentText,
  candidates,
  busy,
  error,
  onClose,
  onRegenerate,
  onConfirm,
}: ThoughtCandidateDialogProps) {
  const [drafts, setDrafts] = useState(() => candidates.map((candidate) => ({ ...candidate, selected: true })));
  const selectedCount = drafts.filter((candidate) => candidate.selected && candidate.text.trim()).length;
  const allSelected = drafts.length > 0 && drafts.every((candidate) => candidate.selected);

  function toggleAll() {
    setDrafts((current) => current.map((candidate) => ({ ...candidate, selected: !allSelected })));
  }

  return (
    <div
      className="dialog-backdrop summary-dialog-backdrop candidate-dialog-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <section className="summary-dialog candidate-dialog" role="dialog" aria-modal="true" aria-labelledby="candidate-dialog-title">
        <header className="summary-dialog-header">
          <span className="summary-dialog-mark"><Sparkles size={17} /></span>
          <div>
            <h2 id="candidate-dialog-title">挑选要继续的想法</h2>
            <p>针对「{parentText}」· {actionLabels[action]}生成的候选</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭候选想法">
            <X size={17} />
          </button>
        </header>

        <div className="candidate-dialog-content">
          <div className="candidate-dialog-intro">
            <span>选择后才会加入画布</span>
            <button type="button" onClick={toggleAll} disabled={busy}>
              {allSelected ? "取消全选" : "全选"}
            </button>
          </div>
          <div className="candidate-list">
            {drafts.map((candidate, index) => (
              <div key={index} className={`candidate-item${candidate.selected ? " is-selected" : ""}`}>
                <button
                  type="button"
                  className="candidate-check"
                  aria-label={`${candidate.selected ? "取消选择" : "选择"}候选 ${index + 1}`}
                  aria-pressed={candidate.selected}
                  disabled={busy}
                  onClick={() => setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, selected: !item.selected } : item))}
                >
                  {candidate.selected && <Check size={13} />}
                </button>
                <div className="candidate-item-main">
                  <div className="candidate-item-meta"><span>候选 {String(index + 1).padStart(2, "0")}</span><span>{kindLabels[candidate.kind]}</span></div>
                  <textarea
                    autoFocus={index === 0}
                    rows={2}
                    maxLength={1600}
                    value={candidate.text}
                    aria-label={`编辑候选 ${index + 1}`}
                    disabled={busy}
                    onChange={(event) => setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))}
                  />
                </div>
              </div>
            ))}
          </div>
          {error && <p className="summary-error" role="alert">{error}</p>}
        </div>

        <footer className="summary-dialog-footer candidate-dialog-footer">
          <span className="candidate-selection-count">已选 {selectedCount} / {drafts.length}</span>
          <div className="summary-dialog-actions">
            <button
              type="button"
              className="summary-secondary-button"
              disabled={busy}
              onClick={() => onRegenerate(drafts.map(({ text }) => text.trim()).filter(Boolean))}
            >
              {busy ? <LoaderCircle size={14} className="summary-spinner" /> : <RotateCcw size={14} />}
              {busy ? "正在换一批" : "换一批"}
            </button>
            <button type="button" className="summary-primary-button" disabled={busy || selectedCount === 0} onClick={() => onConfirm(drafts.filter((candidate) => candidate.selected && candidate.text.trim()).map(({ text, kind }) => ({ text: text.trim(), kind })))}>
              <Check size={14} />加入画布{selectedCount ? ` · ${selectedCount}` : ""}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
