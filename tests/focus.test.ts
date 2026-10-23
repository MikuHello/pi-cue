import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { observeFocus } from "../src/focus.ts";

test("passive focus observation parses split native reports without consuming or altering input", () => {
  const input = new EventEmitter(); const observed: string[] = []; const other: unknown[] = [];
  input.on("data", (data) => other.push(data));
  const stop = observeFocus((value) => observed.push(value), input);
  input.emit("data", "\x1b["); input.emit("data", "I"); input.emit("data", "\x1b[O"); input.emit("data", "q");
  assert.deepEqual(observed, ["focused", "unfocused"]); assert.equal(other.length, 4);
  stop(); assert.equal(input.listenerCount("data"), 1);
  input.emit("data", "\x1b[I"); assert.equal(observed.length, 2);
});

test("bracketed paste containing focus-shaped bytes never becomes focus evidence", () => {
  const input = new EventEmitter(); const observed: string[] = [];
  const stop = observeFocus((value) => observed.push(value), input);
  input.emit("data", "\x1b[200~hello\x1b["); input.emit("data", "I\x1b[Oworld\x1b[201~");
  assert.deepEqual(observed, []);
  input.emit("data", "\x1b[I"); assert.deepEqual(observed, ["focused"]); stop();
});

test("focus evidence is available before the host processes a key in the same input chunk", () => {
  const input = new EventEmitter(); let focus = "unknown"; let observedByHost = "unknown";
  input.on("data", () => { observedByHost = focus; });
  const stop = observeFocus((value) => { focus = value; }, input);
  input.emit("data", "\x1b[Oq");
  assert.equal(observedByHost, "unfocused"); stop();
});
