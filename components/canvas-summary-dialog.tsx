"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronLeft, CircleHelp, Compass, Footprints, Leaf, LoaderCircle, MousePointer2, Sparkles, Target, X } from "lucide-react";
import { nanoid } from "nanoid";
import { SummarizeRequestSchema, SummarizeResponseSchema } from "@/lib/schemas";
import type { CanvasEdge, CanvasSummary, ThoughtNode } from "@/lib/types";

type SummaryScope = "all" | "selected";
type DialogStage = "scope" | "loading" | "result";

type CanvasSummaryDialogProps = {
  nodes: ThoughtNode[];
  edges: CanvasEdge[];
  savedSummary: CanvasSummary | null;
  onClose: () => void;
  onSave: (summary: CanvasSummary) => void;
  onFocusNode: (id: string) => void;
};

function questionsFromText(text: string) {
  return text.split("\n").map((question) => question.trim()).filter(Boolean);
}

export default function CanvasSummaryDialog({
  nodes,
  edges,
  savedSummary,
  onClose,
  onSave,
  onFocusNode,
}: CanvasSummaryDialogProps) {
  const selectedNodes = useMemo(() => nodes.filter((node) => node.selected), [nodes]);
  const [scope, setScope] = useState<SummaryScope>(selectedNodes.length ? "selected" : "all");
  const [stage, setStage] = useState<DialogStage>(savedSummary ? "result" : "scope");
  const [draft, setDraft] = useState<CanvasSummary | null>(savedSummary);
  const [questionDraft, setQuestionDraft] = useState(savedSummary?.openQuestions.join("\n") ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const conclusionRef = useRef<HTMLTextAreaElement>(null);
  const questionsRef = useRef<HTMLTextAreaElement>(null);
  const actionRef = useRef<HTMLTextAreaElement>(null);

  const sourceNodes = useMemo(() => {
    if (!draft) return [];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return draft.sourceNodeIds.map((id) => byId.get(id)).filter((node): node is ThoughtNode => Boolean(node));
  }, [draft, nodes]);
  const questionCount = questionsFromText(questionDraft).length;
  const isDirty = Boolean(draft && savedSummary && (
    draft.conclusion !== savedSummary.conclusion ||
    draft.nextAction !== savedSummary.nextAction ||
    questionsFromText(questionDraft).join("\n") !== savedSummary.openQuestions.join("\n") ||
    draft.sourceNodeIds.join("\n") !== savedSummary.sourceNodeIds.join("\n") ||
    draft.verifiedEvidence.join("\n") !== savedSummary.verifiedEvidence.join("\n") ||
    draft.unverifiedAssumptions.join("\n") !== savedSummary.unverifiedAssumptions.join("\n") ||
    draft.refutedClaims.join("\n") !== savedSummary.refutedClaims.join("\n") ||
    draft.scope.type !== savedSummary.scope.type ||
    draft.scope.nodeIds.join("\n") !== savedSummary.scope.nodeIds.join("\n")
  ));

  useLayoutEffect(() => {
    const fields = [conclusionRef.current, questionsRef.current, actionRef.current]
      .filter((field): field is HTMLTextAreaElement => field !== null);
    const resizeFields = () => {
      for (const field of fields) {
        field.style.height = "auto";
        field.style.height = `${field.scrollHeight}px`;
      }
    };

    resizeFields();
    const observer = new ResizeObserver(resizeFields);
    for (const field of fields) observer.observe(field);
    return () => observer.disconnect();
  }, [stage, draft?.conclusion, questionDraft, draft?.nextAction]);

  async function generateSummary() {
    const includedNodes = scope === "selected" ? selectedNodes : nodes;
    const includedIds = new Set(includedNodes.map((node) => node.id));
    const request = SummarizeRequestSchema.safeParse({
      nodes: includedNodes.map((node) => ({
        id: node.id,
        text: node.data.text,
        kind: node.data.kind,
        depth: node.data.depth,
        parentId: node.data.parentId && includedIds.has(node.data.parentId) ? node.data.parentId : undefined,
        verification: node.data.verification,
      })),
      edges: edges
        .filter((edge) => includedIds.has(edge.source) && includedIds.has(edge.target))
        .slice(0, 200)
        .map(({ source, target }) => ({ source, target })),
      completedActions: [],
    });

    if (!request.success) {
      setError(includedNodes.length > 100
        ? "一次最多整理 100 个想法，请改为选择一个较小的范围。"
        : "这组想法暂时无法整理，请减少内容后重试。");
      return;
    }

    setError("");
    setBusy(true);
    setStage("loading");
    try {
      const response = await fetch("/api/ai/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.data),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = (body as { error?: unknown }).error;
        throw new Error(typeof message === "string" ? message : "整理失败，请稍后重试。");
      }

      const result = SummarizeResponseSchema.parse(body);
      const sourceNodeIds = result.sourceNodeIds.filter((id) => includedIds.has(id)).slice(0, 8);
      if (!sourceNodeIds.length) throw new Error("暂时无法对应到画布中的想法，请重新整理。");
      const now = new Date().toISOString();
      const byId = new Map(includedNodes.map((node) => [node.id, node]));
      setDraft({
        ...result,
        id: nanoid(),
        createdAt: now,
        updatedAt: now,
        scope: { type: scope, nodeIds: includedNodes.map(({ id }) => id) },
        sourceNodeIds,
        sourceSnapshots: sourceNodeIds.map((id) => {
          const node = byId.get(id)!;
          return {
            id,
            text: node.data.text,
            kind: node.data.kind,
            verificationStatus: node.data.verification?.status ?? "unverified",
          };
        }),
      });
      setQuestionDraft(result.openQuestions.join("\n"));
      setStage("result");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "整理失败，请稍后重试。");
      setStage("scope");
    } finally {
      setBusy(false);
    }
  }

  function saveDraft() {
    if (!draft || questionCount > 5 || !draft.conclusion.trim() || !draft.nextAction.trim()) return;
    onSave({
      ...draft,
      openQuestions: questionsFromText(questionDraft),
      updatedAt: new Date().toISOString(),
    });
  }

  function finishResult() {
    if (savedSummary && !isDirty) {
      onClose();
      return;
    }
    saveDraft();
  }

  function openSource(id: string) {
    if (draft && (!savedSummary || isDirty)) {
      if (questionCount > 5 || !draft.conclusion.trim() || !draft.nextAction.trim()) {
        setError("先修正整理内容，再打开引用的想法。");
        return;
      }
      setError("先保存整理结果，再打开引用的想法。");
      return;
    }
    onClose();
    onFocusNode(id);
  }

  return (
    <div
      className="dialog-backdrop summary-dialog-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <section className="summary-dialog" role="dialog" aria-modal="true" aria-labelledby="summary-dialog-title">
        <header className="summary-dialog-header">
          <span className="summary-dialog-mark"><Leaf size={17} /></span>
          <div>
            <h2 id="summary-dialog-title">思路整理</h2>
            <p>{stage === "result" ? "一份清晰、可继续推进的阶段梳理" : "从画布里提炼结论、疑问和行动"}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭思路整理">
            <X size={17} />
          </button>
        </header>

        <div className="summary-dialog-scroll" key={stage}>
        {stage === "scope" && (
          <div className="summary-scope-content">
            <div className="summary-intro">
              <span className="summary-intro-mark"><Sparkles size={15} /></span>
              <p>从一张画布或一组想法出发，提炼出<strong>当前判断、待验证的问题和下一步行动</strong>。</p>
            </div>
            <fieldset className="summary-scope-options">
              <legend>从哪里开始</legend>
              <label className={`summary-scope-option${scope === "all" ? " is-active" : ""}`}>
                <input type="radio" name="summary-scope" value="all" checked={scope === "all"} onChange={() => setScope("all")} />
                <span className="summary-scope-icon"><Compass size={17} /></span>
                <span className="summary-scope-copy"><strong>整张画布</strong><small>把所有相关想法放在一起看</small></span>
                <span className="summary-scope-count">{nodes.length} 个想法</span>
                <span className="summary-scope-check"><Check size={13} /></span>
              </label>
              <label className={`summary-scope-option${scope === "selected" ? " is-active" : ""}${selectedNodes.length ? "" : " is-disabled"}`}>
                <input
                  type="radio"
                  name="summary-scope"
                  value="selected"
                  checked={scope === "selected"}
                  disabled={!selectedNodes.length}
                  onChange={() => setScope("selected")}
                />
                <span className="summary-scope-icon"><MousePointer2 size={17} /></span>
                <span className="summary-scope-copy"><strong>选中的想法</strong><small>{selectedNodes.length ? "聚焦当前选区，生成更具体的总结" : "先在画布中选择想法"}</small></span>
                <span className="summary-scope-count">{selectedNodes.length ? `${selectedNodes.length} 个想法` : "未选择"}</span>
                <span className="summary-scope-check"><Check size={13} /></span>
              </label>
            </fieldset>
            {error && <p className="summary-error" role="alert">{error}</p>}
          </div>
        )}

        {stage === "loading" && (
          <div className="summary-loading" role="status" aria-live="polite">
            <LoaderCircle size={22} className="summary-spinner" />
            <strong>正在整理这组想法</strong>
            <span>提炼结论、待确认问题和下一步行动…</span>
          </div>
        )}

        {stage === "result" && draft && (
          <div className="summary-result-content">
            <div className="summary-result-kicker"><span>最终梳理</span><span>内容可以继续编辑</span></div>
            <label className="summary-field summary-field-conclusion">
              <span className="summary-field-heading">
                <span className="summary-field-icon"><Sparkles size={15} /></span>
                <span className="summary-field-title"><strong>结论</strong><small>这一阶段最值得保留的判断</small></span>
                <span className="summary-field-index">01</span>
              </span>
              <textarea
                ref={conclusionRef}
                value={draft.conclusion}
                maxLength={600}
                rows={3}
                onChange={(event) => setDraft({ ...draft, conclusion: event.target.value })}
                aria-label="编辑当前结论"
              />
            </label>
            <div className="summary-followups">
              <label className="summary-field summary-field-card">
                <span className="summary-field-heading">
                  <span className="summary-field-icon is-question"><CircleHelp size={15} /></span>
                  <span className="summary-field-title"><strong>待解决</strong><small>仍需验证或补充的关键问题</small></span>
                  <span className="summary-field-count">{questionCount}/5</span>
                </span>
                <textarea
                  ref={questionsRef}
                  value={questionDraft}
                  maxLength={900}
                  rows={Math.max(2, Math.min(5, questionCount || 2))}
                  onChange={(event) => setQuestionDraft(event.target.value)}
                  placeholder="例如：最关键的假设有数据支持吗？"
                  aria-label="编辑待确认的问题"
                />
                {questionCount > 5 && <small className="summary-error">最多保留 5 个问题。</small>}
              </label>
              <label className="summary-field summary-field-card">
                <span className="summary-field-heading">
                  <span className="summary-field-icon is-action"><Footprints size={15} /></span>
                  <span className="summary-field-title"><strong>行动</strong><small>从判断走向验证的下一步</small></span>
                  <span className="summary-field-index">03</span>
                </span>
                <textarea
                  ref={actionRef}
                  value={draft.nextAction}
                  maxLength={300}
                  rows={2}
                  onChange={(event) => setDraft({ ...draft, nextAction: event.target.value })}
                  aria-label="编辑下一步行动"
                />
              </label>
            </div>

            <div className="summary-sources">
              <div className="summary-sources-heading">
                <span className="summary-sources-mark"><Target size={14} /></span>
                <span><strong>想法依据</strong><small>点击引用可回到画布中的原节点</small></span>
                <span className="summary-sources-count">{sourceNodes.length}</span>
              </div>
              {sourceNodes.length ? (
                <div className="summary-source-list">
                  {sourceNodes.map((node, index) => (
                    <button
                      type="button"
                      className="summary-source-chip"
                      key={node.id}
                      title={`保存并定位到：${node.data.text}`}
                      onClick={() => openSource(node.id)}
                    >
                      <span className="summary-source-index">{String(index + 1).padStart(2, "0")}</span>
                      <span className="summary-source-text">{node.data.text}</span><ArrowUpRight size={13} />
                    </button>
                  ))}
                </div>
              ) : <p className="summary-no-sources">引用的想法已不在当前画布中。</p>}
            </div>

            {error && <p className="summary-error" role="alert">{error}</p>}
          </div>
        )}
        </div>

        {stage === "scope" && (
          <footer className="summary-dialog-footer summary-scope-footer">
            <p className="summary-privacy-note">原有想法不会被修改或删除。</p>
            <div className="summary-dialog-actions">
              {savedSummary && <button type="button" className="summary-secondary-button" onClick={() => { setStage("result"); setError(""); }}>返回上次整理</button>}
              <button type="button" className="summary-primary-button" onClick={() => void generateSummary()} disabled={busy || !nodes.length}>
                <Sparkles size={15} />开始整理
              </button>
            </div>
          </footer>
        )}

        {stage === "loading" && (
          <footer className="summary-dialog-footer summary-loading-footer">
            <p className="summary-privacy-note">整理过程中不会修改原有想法。</p>
          </footer>
        )}

        {stage === "result" && draft && (
          <footer className="summary-dialog-footer summary-result-footer">
            {savedSummary
              ? <p className="summary-updated">上次保存于 {new Date(savedSummary.updatedAt).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })}</p>
              : <p className="summary-updated">保存后可随时从画布工具栏继续查看</p>}
            <div className="summary-dialog-actions">
              <button type="button" className="summary-secondary-button" onClick={() => { setStage("scope"); setError(""); }}>
                <ChevronLeft size={14} />重新整理
              </button>
              <button type="button" className="summary-primary-button" onClick={finishResult} disabled={!draft.conclusion.trim() || !draft.nextAction.trim() || questionCount > 5}>
                <Check size={15} />{savedSummary && !isDirty ? "完成" : "保存整理结果"}
              </button>
            </div>
          </footer>
        )}
      </section>
    </div>
  );
}
