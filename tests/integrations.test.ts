import assert from "node:assert/strict";
import { test } from "node:test";
import { CueEngine, systemClock } from "../src/engine.ts";
import { IntegrationTracker, integrationMemory } from "../src/integrations.ts";
import { defaults } from "../src/data.ts";

function fixture(memory = integrationMemory(), sessionId = "session-a", owner = "owner") {
  const events: string[] = [];
  const engine = new CueEngine({ ...defaults, notifyOnAsk: true, subagentNotifications: true }, { notify: async (cue, life) => { if (life.valid()) events.push(cue.kind); }, sound: async () => {}, marker: () => {}, diagnostic: () => {} });
  const tracker = new IntegrationTracker(sessionId, `/sessions/${sessionId}.jsonl`, engine, memory, systemClock, () => owner, () => {});
  const start = { lifecycleArtifactVersion: 3, id: "run", sessionId: `/sessions/${sessionId}.jsonl`, completionOwnerId: owner };
  const end = { runId: "run", sessionId: start.sessionId, completionOwnerId: owner, success: true };
  return { tracker, events, engine, memory, start, end };
}

test("Ask requires matching native execution, ends per id, and rejects reuse across sessions", () => {
  const f = fixture();
  f.tracker.ask({ active: true, toolCallId: "a" });
  assert.deepEqual(f.events, []);
  f.tracker.toolStarted("a", "not_ask"); f.tracker.ask({ active: true, toolCallId: "a" });
  assert.deepEqual(f.events, []);
  f.tracker.toolStarted("a", "ask_user_question"); f.tracker.toolStarted("b", "ask_user_question");
  f.tracker.ask({ active: true, toolCallId: "a" }); f.tracker.ask({ active: true, toolCallId: "b" });
  assert.equal(f.engine.snapshot().waiting, 2);
  f.tracker.toolEnded("a"); assert.equal(f.engine.snapshot().waiting, 1);
  const other = fixture(f.memory, "session-b");
  other.tracker.toolStarted("a", "ask_user_question"); other.tracker.ask({ active: true, toolCallId: "a" });
  assert.deepEqual(other.events, []);
});

test("subagents require exact parent, owner and start; deduplicate and skip workflow/foreground events", () => {
  const f = fixture();
  f.tracker.completed(f.end); assert.deepEqual(f.events, []);
  f.tracker.started({ ...f.start, sessionId: "session-a" }); f.tracker.completed(f.end); assert.deepEqual(f.events, []);
  f.tracker.started({ ...f.start, completionOwnerId: "other" }); f.tracker.completed(f.end); assert.deepEqual(f.events, []);
  f.tracker.started(f.start); f.tracker.completed({ ...f.end, completionOwnerId: "other" }); assert.deepEqual(f.events, []);
  f.tracker.completed(f.end); f.tracker.completed(f.end);
  assert.deepEqual(f.events, ["subagentSuccess"]);
  for (const extra of [{ awaitedByWorkflow: true }, { source: "foreground" }]) {
    const other = fixture(); other.tracker.started(other.start); other.tracker.completed({ ...other.end, ...extra });
    assert.deepEqual(other.events, []); assert.equal(other.engine.snapshot().background, 0);
  }
});

test("uninterrupted in-flight completion survives main rounds; reload gaps and history never replay", () => {
  const f = fixture();
  f.tracker.started(f.start); f.engine.start(); f.engine.settled(); f.engine.start(); f.engine.settled(); f.tracker.completed(f.end);
  assert.equal(f.events.filter((event) => event === "subagentSuccess").length, 1);
  const original = fixture(); original.tracker.started(original.start); original.tracker.dispose(); original.engine.dispose();
  const reloaded = fixture(original.memory); reloaded.tracker.completed(reloaded.end); reloaded.tracker.started(reloaded.start); reloaded.tracker.completed(reloaded.end);
  assert.deepEqual(reloaded.events, []);
  const otherSession = fixture(original.memory, "session-b"); otherSession.tracker.completed(original.end);
  assert.deepEqual(otherSession.events, []);
});

test("ending delayed Ask instances releases all pending per-question resources", () => {
  const timers = new Map(); let next = 0;
  const engine = new CueEngine({ ...defaults, notifyOnAsk: true, minAwayMs: 3000 }, { notify: async () => {}, sound: async () => {}, marker: () => {}, diagnostic: () => {} }, { now: () => 0, delay: (fn) => { timers.set(++next, fn); return next; }, cancel: (id) => { timers.delete(id); } });
  for (let index = 0; index < 1000; index++) { engine.ask(String(index), true); engine.ask(String(index), false); }
  assert.equal(engine.snapshot().waiting, 0); assert.equal(engine.snapshot().pending, 0); assert.equal(timers.size, 0);
  assert.equal((engine as unknown as { tickets: Set<unknown> }).tickets.size, 0);
});

test("a closed questionnaire cannot reopen by replay while its native tool is still active", () => {
  const f = fixture();
  f.tracker.toolStarted("a", "ask_user_question"); f.tracker.toolStarted("b", "ask_user_question");
  f.tracker.ask({ toolCallId: "a", active: true }); f.tracker.ask({ toolCallId: "a", active: false });
  f.tracker.ask({ toolCallId: "a", active: true }); f.tracker.ask({ toolCallId: "a", active: false });
  f.tracker.ask({ toolCallId: "b", active: true });
  assert.equal(f.events.filter((event) => event === "ask").length, 2);
  assert.equal(f.engine.snapshot().waiting, 1);
});

test("integration recognition distinguishes unobserved, rejected, and verified protocol evidence", () => {
  const f = fixture();
  assert.deepEqual(f.tracker.status().ask, { observed: false, recognized: false, rejected: 0 });
  f.tracker.ask({ toolCallId: "foreign", active: true });
  assert.equal(f.tracker.status().ask.observed, true); assert.equal(f.tracker.status().ask.recognized, false);
  f.tracker.toolStarted("a", "ask_user_question"); f.tracker.ask({ toolCallId: "a", active: true });
  assert.equal(f.tracker.status().ask.recognized, true); assert.equal(f.tracker.status().ask.rejected, 1);
  f.tracker.started({ ...f.start, sessionId: "foreign" }); assert.equal(f.tracker.status().subagent.recognized, false);
  f.tracker.started(f.start); assert.equal(f.tracker.status().subagent.recognized, true);
});
