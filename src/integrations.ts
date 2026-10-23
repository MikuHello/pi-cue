import type { CueEngine, Clock } from "./engine.ts";

type Run = { sessionId: string; ownerId: string; startedAt: number; state: "active" | "gap" | "consumed" };
export type IntegrationMemory = { runs: Map<string, Run>; toolIds: Set<string> };
type Recognition = { observed: boolean; recognized: boolean; rejected: number; reason?: string };
export function integrationMemory(): IntegrationMemory { return { runs: new Map(), toolIds: new Set() }; }
const limit = 8192;
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function identity(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 4096; }

export class IntegrationTracker {
  private sessionId: string;
  private alias: string;
  private engine: CueEngine;
  private memory: IntegrationMemory;
  private clock: Clock;
  private owner: () => unknown;
  private diagnostic: (message: string) => void;
  private tools = new Set<string>();
  private active = true;
  private recognition = { ask: { observed: false, recognized: false, rejected: 0 } as Recognition, subagent: { observed: false, recognized: false, rejected: 0 } as Recognition };

  constructor(sessionId: string, alias: string, engine: CueEngine, memory: IntegrationMemory, clock: Clock, owner: () => unknown, diagnostic: (message: string) => void) {
    this.sessionId = sessionId; this.alias = alias; this.engine = engine; this.memory = memory; this.clock = clock; this.owner = owner; this.diagnostic = diagnostic;
  }

  status(): Record<"ask" | "subagent", Recognition> { return { ask: { ...this.recognition.ask }, subagent: { ...this.recognition.subagent } }; }

  private reject(kind: "ask" | "subagent", reason: string): void {
    const state = this.recognition[kind];
    state.observed = true; state.rejected = Math.min(1000000, state.rejected + 1); state.reason = reason;
    this.diagnostic(reason);
  }

  private recognize(kind: "ask" | "subagent"): void { this.recognition[kind].observed = true; this.recognition[kind].recognized = true; }

  toolStarted(toolCallId: string, toolName: string): void {
    if (!this.active || toolName !== "ask_user_question" || !identity(toolCallId)) return;
    if (this.memory.toolIds.has(toolCallId) || this.memory.toolIds.size >= limit) {
      this.tools.delete(toolCallId); this.engine.ask(toolCallId, false);
      this.reject("ask", "askReuse"); return;
    }
    this.memory.toolIds.add(toolCallId);
    this.tools.add(toolCallId);
  }

  toolEnded(toolCallId: string): void {
    if (!this.active) return;
    this.tools.delete(toolCallId);
    this.engine.ask(toolCallId, false);
  }

  ask(value: unknown): void {
    if (!this.active || !record(value) || !identity(value.toolCallId) || typeof value.active !== "boolean" || !this.tools.has(value.toolCallId)) { this.reject("ask", "askUnowned"); return; }
    this.recognize("ask");
    this.engine.ask(value.toolCallId, value.active);
    if (!value.active) this.tools.delete(value.toolCallId);
  }

  started(value: unknown): void {
    if (!this.active || !record(value) || value.lifecycleArtifactVersion !== 3 || !identity(value.id) || value.sessionId !== this.alias || !identity(value.completionOwnerId) || value.completionOwnerId !== this.owner()) { this.reject("subagent", "subagentStartUnowned"); return; }
    this.recognize("subagent");
    const key = JSON.stringify([this.sessionId, value.id]);
    if (this.memory.runs.has(key)) return;
    if (this.memory.runs.size >= limit) { this.reject("subagent", "subagentCapacity"); return; }
    this.memory.runs.set(key, { sessionId: this.sessionId, ownerId: value.completionOwnerId, startedAt: this.clock.now(), state: "active" });
    this.engine.subagentStarted(value.id);
  }

  completed(value: unknown): void {
    if (!this.active || !record(value)) return;
    const runId = value.runId ?? value.id;
    if (!identity(runId) || value.sessionId !== this.alias || !identity(value.completionOwnerId) || value.completionOwnerId !== this.owner() || (value.id !== undefined && value.id !== runId)) { this.reject("subagent", "subagentCompletionUnowned"); return; }
    const run = this.memory.runs.get(JSON.stringify([this.sessionId, runId]));
    if (!run || run.state !== "active" || run.ownerId !== value.completionOwnerId) { this.reject("subagent", "subagentGap"); return; }
    run.state = "consumed";
    if (value.awaitedByWorkflow === true || value.source === "foreground") { this.engine.subagentRemoved(runId); return; }
    if (typeof value.success !== "boolean") { this.engine.subagentRemoved(runId); this.reject("subagent", "subagentResult"); return; }
    this.engine.subagentCompleted(runId, value.success ? "success" : "failure", this.clock.now() - run.startedAt);
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    for (const run of this.memory.runs.values()) if (run.sessionId === this.sessionId && run.state === "active") run.state = "gap";
    this.tools.clear();
  }
}
