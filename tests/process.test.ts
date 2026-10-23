import assert from "node:assert/strict";
import { test } from "node:test";
import { runProcess } from "../src/process.ts";

test("process arguments remain data and captured output is bounded", async () => {
  const controller = new AbortController();
  const life = { signal: controller.signal, valid: () => !controller.signal.aborted };
  const text = '$(touch /tmp/pi-cue-never) "; 中文';
  const result = await runProcess(process.execPath, ["-e", "process.stdout.write(process.argv[1])", text], life);
  assert.equal(result.output, text); assert.equal(result.code, 0);
  const huge = await runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(100000))"], life);
  assert.equal(huge.output.length, 16384);
});

test("invalid lifetime does not spawn and abort terminates an active child promptly", async () => {
  const controller = new AbortController();
  const life = { signal: controller.signal, valid: () => !controller.signal.aborted };
  controller.abort();
  assert.equal((await runProcess(process.execPath, ["-e", "process.exit(7)"], life)).started, false);
  const active = new AbortController();
  const started = performance.now();
  const pending = runProcess(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setTimeout(()=>{},10000)"], { signal: active.signal, valid: () => !active.signal.aborted });
  setTimeout(() => active.abort(), 80);
  const result = await pending;
  assert.equal(result.stopped, true); assert.ok(performance.now() - started < 2000);
});
