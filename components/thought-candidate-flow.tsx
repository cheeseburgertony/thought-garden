"use client";

import { Position } from "@xyflow/react";
import { Leaf } from "lucide-react";
import { nanoid } from "nanoid";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { fanOutPositions } from "@/lib/canvas-layout";
import { getThoughtExpansionContext } from "@/lib/canvas-graph";
import { ExpandResponseSchema } from "@/lib/schemas";
import type { ThoughtAction, ThoughtNode } from "@/lib/types";
import type { ThoughtCandidate } from "@/components/thought-candidate-dialog";
import { useCanvasStore } from "@/store/canvas-store";

type CandidateReview = {
  generationId: string;
  parentId: string;
  parentText: string;
  action: ThoughtAction;
  candidates: ThoughtCandidate[];
};

function normalizeThoughtText(text: string) {
  return text.trim().toLocaleLowerCase();
}

function filterNewCandidates<T extends { text: string }>(candidates: T[], existingTexts: string[]) {
  const existing = new Set(existingTexts.map(normalizeThoughtText));
  return candidates.filter(({ text }) => {
    const normalized = normalizeThoughtText(text);
    if (!normalized || existing.has(normalized)) return false;
    existing.add(normalized);
    return true;
  });
}

function kindForAction(action: ThoughtAction, kind: ThoughtCandidate["kind"]) {
  if (action === "challenge") return "challenge";
  if (action === "risk") return "risk";
  return kind;
}

export function useThoughtCandidateFlow() {
  const [running, setRunning] = useState<string | null>(null);
  const [candidateReview, setCandidateReview] = useState<CandidateReview | null>(null);
  const [candidateError, setCandidateError] = useState("");

  const generateCandidates = useCallback(async (
    id: string,
    action: ThoughtAction,
    previousCandidates: string[] = [],
    isRegeneration = false,
  ) => {
    if (running) return;

    const state = useCanvasStore.getState();
    const current = state.nodes.find((node) => node.id === id);
    if (!current) return;

    const context = getThoughtExpansionContext(id, state.nodes, state.edges);
    if (!context) return;

    const excludedCandidates = [...new Set([
      ...(current.data.recentAiSuggestions ?? []),
      ...previousCandidates,
    ].map((text) => text.trim()).filter(Boolean))].slice(-12);

    setCandidateError("");
    setRunning(id);

    try {
      const response = await fetch("/api/ai/expand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, previousCandidates: excludedCandidates, ...context }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error
          : "这次没有生成候选，再试一次。";
        throw new Error(message);
      }

      const result = ExpandResponseSchema.parse(await response.json());
      const latestState = useCanvasStore.getState();
      const latestCurrent = latestState.nodes.find((node) => node.id === id);
      if (!latestCurrent) {
        toast.message("原想法已从画布移除，这批候选没有加入。");
        return;
      }

      const latestContext = getThoughtExpansionContext(id, latestState.nodes, latestState.edges);
      const existingTexts = [
        ...(latestContext?.children.map((node) => node.text) ?? []),
        ...excludedCandidates,
      ];
      const fresh = filterNewCandidates(result.nodes, existingTexts);

      if (!fresh.length) {
        if (isRegeneration) setCandidateError("暂时没有找到新的方向，可以换一种思考方式继续。");
        else toast.message("这些方向已经长出来了，换个动作继续探索。", { icon: <Leaf size={15} /> });
        return;
      }

      useCanvasStore.getState().rememberAiSuggestions(id, fresh.map(({ text }) => text));
      setCandidateReview({
        generationId: nanoid(),
        parentId: id,
        parentText: latestCurrent.data.text,
        action,
        candidates: fresh,
      });
    } catch (error) {
      console.error("[thought-garden] Could not generate thought candidates", error);
      const message = error instanceof Error ? error.message : "这次没有生成候选，再试一次。";
      if (isRegeneration) setCandidateError(message);
      else toast.error(message);
    } finally {
      setRunning(null);
    }
  }, [running]);

  const runAction = useCallback((id: string, action: ThoughtAction) => {
    void generateCandidates(id, action);
  }, [generateCandidates]);

  const regenerateCandidates = useCallback((previousCandidates: string[]) => {
    if (!candidateReview) return;
    void generateCandidates(candidateReview.parentId, candidateReview.action, previousCandidates, true);
  }, [candidateReview, generateCandidates]);

  const addCandidatesToCanvas = useCallback((candidates: ThoughtCandidate[]) => {
    if (!candidateReview) return;

    const state = useCanvasStore.getState();
    const current = state.nodes.find((node) => node.id === candidateReview.parentId);
    const context = current ? getThoughtExpansionContext(current.id, state.nodes, state.edges) : null;
    if (!current || !context) {
      toast.error("原想法已不在画布中，无法加入候选。");
      setCandidateReview(null);
      return;
    }

    const fresh = filterNewCandidates(candidates, context.children.map((node) => node.text));
    if (!fresh.length) {
      toast.message("所选想法为空，或与现有子节点重复。");
      return;
    }
    if (fresh.length < candidates.length) toast.message(`${candidates.length - fresh.length} 个重复想法已跳过。`);

    const direction = current.sourcePosition === Position.Right ? "LR" : "TB";
    const points = fanOutPositions(current, fresh.length, state.nodes, direction);
    const now = new Date().toISOString();
    const nextNodes: ThoughtNode[] = fresh.map((item, index) => ({
      id: nanoid(),
      type: "thought",
      position: points[index],
      sourcePosition: direction === "LR" ? Position.Right : Position.Bottom,
      targetPosition: direction === "LR" ? Position.Left : Position.Top,
      data: {
        text: item.text,
        kind: kindForAction(candidateReview.action, item.kind),
        depth: current.data.depth + 1,
        parentId: current.id,
        createdBy: "ai",
        verification: { status: "unverified", note: "", updatedAt: now },
      },
    }));
    const nextEdges = nextNodes.map((node) => ({ id: nanoid(), source: current.id, target: node.id, type: "default" as const }));

    useCanvasStore.getState().addThoughts(nextNodes, nextEdges);
    setCandidateReview(null);
    setCandidateError("");
    toast.success(`已加入 ${nextNodes.length} 个想法`);
  }, [candidateReview]);

  const closeCandidateReview = useCallback(() => {
    setCandidateReview(null);
    setCandidateError("");
  }, []);

  const clearRunning = useCallback(() => setRunning(null), []);

  return {
    running,
    candidateReview,
    candidateError,
    runAction,
    generateCandidates,
    regenerateCandidates,
    addCandidatesToCanvas,
    closeCandidateReview,
    clearRunning,
  };
}
