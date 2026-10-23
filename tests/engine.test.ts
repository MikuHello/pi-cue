import assert from "node:assert/strict";
import { test } from "node:test";
import { CueEngine, type Clock, type Lifetime } from "../src/engine.ts";
import { defaults, type Settings } from "../src/data.ts";

function fixture(overrides: Partial<Settings> = {}) {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; callback(): void }>();
  const events: string[] = [];
  const lifetimes: Lifetime[] = [];
  const clock: Clock = { now: () => now, delay: (callback, delay) => { timers.set(++next, { at: now + delay, callback }); return next; }, cancel: (handle) => { timers.delete(handle as number); } };
  const engine = new CueEngine({ ...defaults, ...overrides } as Settings, {
    notify: async (cue, lifetime) => { if (lifetime.valid()) events.push(`notify:${cue.kind}:${cue.durationMs}:${cue.background}`); lifetimes.push(lifetime); },
    sound: async (lifetime) => { if (lifetime.valid()) events.push("sound"); lifetimes.push(lifetime); },
    marker: (marker) => { events.push(`marker:${marker}`); },
    diagnostic: (message) => { events.push(message); },
  }, clock);
  const advance = (delta: number) => { now += delta; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); } };
  return { engine, events, lifetimes, timers, advance };
}

test("retries and queued continuations settle once and final success replaces intermediate error", () => {
  const f = fixture();
  f.engine.start(); f.advance(500); f.engine.end("failure");
  f.engine.start(); f.advance(500); f.engine.end("success");
  f.engine.start(); f.advance(500); f.engine.end("success");
  assert.equal(f.events.filter((event) => event === "sound").length, 0);
  f.engine.settled(); f.engine.settled();
  assert.equal(f.events.filter((event) => event === "sound").length, 1);
  assert.deepEqual(f.events.filter((event) => event.startsWith("notify")), ["notify:success:1500:false"]);
});

test("focused completion plays once and leaving later does not replay completion", () => {
  const f = fixture();
  f.engine.focus("focused"); f.engine.start(); f.engine.end("success"); f.engine.settled(); f.engine.focus("unfocused");
  assert.equal(f.events.filter((event) => event === "sound").length, 1);
  assert.equal(f.events.filter((event) => event.startsWith("notify")).length, 0);
  assert.equal(f.events.includes("marker:completion"), false);
});

test("away threshold delays only notification and marker; focus and new work cancel the pending cue", () => {
  for (const cancel of ["focus", "start", "dispose", "disable"] as const) {
    const f = fixture({ minAwayMs: 3000 });
    f.engine.start(); f.advance(1000); f.engine.settled();
    assert.equal(f.events.filter((event) => event === "sound").length, 1);
    assert.equal(f.events.filter((event) => event.startsWith("notify")).length, 0);
    if (cancel === "focus") f.engine.focus("focused");
    if (cancel === "start") f.engine.start();
    if (cancel === "dispose") f.engine.dispose();
    if (cancel === "disable") f.engine.configure({ ...defaults, enabled: false });
    f.advance(5000);
    assert.equal(f.events.filter((event) => event.startsWith("notify")).length, 0);
    assert.equal(f.lifetimes.every((lifetime) => !lifetime.valid() && lifetime.signal.aborted), true);
  }
  const f = fixture({ minAwayMs: 3000 });
  f.engine.start(); f.advance(1000); f.engine.settled(); f.advance(2000);
  assert.equal(f.events.filter((event) => event === "sound").length, 1);
  assert.equal(f.events.filter((event) => event.startsWith("notify")).length, 1);
});

test("work threshold includes failures and aborts, never filters Ask, and unknown remains observed unknown", () => {
  for (const outcome of ["success", "failure", "abort"] as const) {
    const f = fixture({ minWorkMs: 5000, notifyOnAbort: true });
    f.engine.start(); f.advance(1000); f.engine.end(outcome); f.engine.settled();
    assert.equal(f.events.some((event) => event.startsWith("notify") || event === "sound"), false);
  }
  const f = fixture({ minWorkMs: 5000, notifyOnAsk: true });
  f.engine.ask("one", true);
  assert.equal(f.events.includes("notify:ask:0:false"), true);
  assert.equal(f.events.includes("sound"), false);
  assert.equal(f.engine.snapshot().observedFocus, "unknown");
  assert.equal(f.engine.snapshot().effectiveFocus, "unfocused");
});

test("multiple questionnaires end independently and reappearing markers do not resend", () => {
  const f = fixture({ notifyOnAsk: true, clearOnFocus: false });
  f.engine.start(); f.engine.settled();
  f.engine.ask("a", true); f.engine.ask("b", true); f.engine.ask("a", false);
  assert.equal(f.events.at(-1), "marker:ask");
  f.engine.focus("focused");
  assert.equal(f.events.at(-1), "marker:completion");
  f.engine.focus("unfocused");
  assert.equal(f.events.at(-1), "marker:ask");
  f.engine.ask("b", false);
  assert.equal(f.events.at(-1), "marker:completion");
  assert.equal(f.events.filter((event) => event.startsWith("notify:ask")).length, 2);
});

test("Ask waiting while focused notifies once only if still waiting on departure", () => {
  const f = fixture({ notifyOnAsk: true, minAwayMs: 3000 });
  f.engine.focus("focused"); f.engine.ask("a", true); f.advance(5000);
  assert.equal(f.events.some((event) => event.startsWith("notify")), false);
  f.engine.focus("unfocused"); f.advance(1000); f.engine.ask("a", false); f.advance(3000);
  assert.equal(f.events.some((event) => event.startsWith("notify")), false);
  f.engine.ask("b", true);
  assert.equal(f.events.filter((event) => event.startsWith("notify:ask")).length, 1);
});

test("channel toggles, unknown silent, and background wording decisions remain independent", () => {
  const f = fixture({ nativeNotification: false, markerEnabled: false });
  f.engine.start(); f.engine.settled();
  assert.equal(f.events.filter((event) => event === "sound").length, 1);
  assert.equal(f.events.some((event) => event.startsWith("notify")), false);
  const silent = fixture({ unknownFocusPolicy: "silent" });
  silent.engine.start(); silent.engine.settled();
  assert.equal(silent.events.some((event) => event === "sound" || event.startsWith("notify")), false);
  const background = fixture();
  background.engine.subagentStarted("one"); background.engine.start(); background.engine.settled();
  assert.equal(background.events.includes("notify:success:0:true"), true);
});

test("ending one Ask invalidates its asynchronous submission without cancelling another", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const delivered: string[] = [];
  const lifetimes: Lifetime[] = [];
  const engine = new CueEngine({ ...defaults, notifyOnAsk: true }, {
    notify: async (_cue, lifetime) => { const index = lifetimes.push(lifetime); await gate; if (lifetime.valid()) delivered.push(String(index)); },
    sound: async () => {}, marker: () => {}, diagnostic: () => {},
  });
  engine.ask("a", true); engine.ask("b", true); engine.ask("a", false);
  assert.equal(lifetimes[0].valid(), false);
  assert.equal(lifetimes[0].signal.aborted, true);
  assert.equal(lifetimes[1].valid(), true);
  release(); await gate; await Promise.resolve();
  assert.deepEqual(delivered, ["2"]);
});

test("unrelated settings and independent sound toggles retain delayed completion and Ask", () => {
  for (const kind of ["completion", "ask"] as const) {
    const settings = { ...defaults, minAwayMs: 3000, notifyOnAsk: true };
    const f = fixture(settings);
    if (kind === "completion") { f.engine.start(); f.engine.settled(); }
    else f.engine.ask("a", true);
    f.advance(1000);
    f.engine.configure({ ...settings, language: "zh-CN", soundEnabled: false });
    f.advance(2000);
    assert.equal(f.events.filter((event) => event.startsWith("notify")).length, 1);
    assert.equal(f.events.filter((event) => event === "sound").length, kind === "completion" ? 1 : 0);
  }
});

test("updating away threshold reschedules the remaining delay without replaying sound", () => {
  const f = fixture({ minAwayMs: 5000 });
  f.engine.start(); f.engine.settled(); f.advance(1000);
  f.engine.configure({ ...defaults, minAwayMs: 2000 });
  f.advance(1000);
  assert.equal(f.events.filter((event) => event.startsWith("notify")).length, 1);
  assert.equal(f.events.filter((event) => event === "sound").length, 1);
  const ask = fixture();
  ask.engine.ask("a", true);
  ask.engine.configure({ ...defaults, notifyOnAsk: true });
  assert.equal(ask.events.filter((event) => event.startsWith("notify:ask")).length, 1);
});

test("revoking event or channel eligibility permanently invalidates in-flight submissions", async () => {
  for (const [key, kind] of [["notifyWhenUnfocused", "success"], ["soundWhenUnfocused", "success"], ["notifyOnError", "failure"], ["notifyOnAbort", "abort"], ["subagentNotifications", "subagentSuccess"], ["subagentOnSuccess", "subagentSuccess"], ["subagentOnFailure", "subagentFailure"], ["enabled", "success"], ["nativeNotification", "success"], ["soundEnabled", "success"]]) {
    const settings = { ...defaults, notifyOnAbort: true, subagentNotifications: true };
    const f = fixture(settings);
    if (kind.startsWith("subagent")) f.engine.subagentCompleted("run", kind === "subagentSuccess" ? "success" : "failure", 1000);
    else { f.engine.start(); f.engine.end(kind as "success" | "failure" | "abort"); f.engine.settled(); }
    f.engine.configure({ ...settings, [key]: false });
    f.engine.configure(settings);
    const revoked = key.startsWith("sound") ? f.lifetimes[0] : key === "nativeNotification" || key === "notifyWhenUnfocused" ? f.lifetimes[1] : undefined;
    if (revoked) assert.equal(revoked.valid(), false, key);
    else assert.equal(f.lifetimes.every((lifetime) => !lifetime.valid()), true, key);
  }
});

test("reenabling a channel does not revive its old delayed cue or suppress another channel", () => {
  for (const key of ["nativeNotification", "notifyWhenUnfocused"]) {
    const settings = { ...defaults, minAwayMs: 3000 };
    const f = fixture(settings);
    f.engine.start(); f.engine.settled(); f.advance(1000);
    f.engine.configure({ ...settings, [key]: false });
    f.engine.configure(settings); f.advance(5000);
    assert.equal(f.events.some((event) => event.startsWith("notify")), false, key);
    assert.equal(f.events.includes("marker:completion"), true, key);
    assert.equal(f.events.filter((event) => event === "sound").length, 1, key);
  }
});

test("changing unknown-focus policy hides waiting markers without creating a second notification", () => {
  for (const policy of ["focused", "silent"]) {
    const f = fixture({ notifyOnAsk: true });
    f.engine.ask("a", true);
    assert.equal(f.events.at(-1), "marker:ask");
    f.engine.configure({ ...defaults, notifyOnAsk: true, unknownFocusPolicy: policy });
    assert.equal(f.events.at(-1), "marker:none");
    f.engine.configure({ ...defaults, notifyOnAsk: true });
    assert.equal(f.events.at(-1), "marker:ask");
    assert.equal(f.events.filter((event) => event.startsWith("notify:ask")).length, 1);
  }
});
