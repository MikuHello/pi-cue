import { spawn } from "node:child_process";
import type { Lifetime } from "./engine.ts";

export type ProcessResult = { started: boolean; code: number | null; output: string; stopped: boolean };
export type Runner = (command: string, args: string[], lifetime: Lifetime, input?: string, timeoutMs?: number) => Promise<ProcessResult>;

export const runProcess: Runner = (command, args, lifetime, input, timeoutMs = 5000) => new Promise((resolve) => {
  if (!lifetime.valid() || lifetime.signal.aborted) { resolve({ started: false, code: null, output: "", stopped: true }); return; }
  let started = false;
  let stopped = false;
  let output = "";
  let settled = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const stop = () => { stopped = true; child.kill(); killTimer ??= setTimeout(() => child.kill("SIGKILL"), 250); };
  const timer = setTimeout(stop, timeoutMs);
  const finish = (code: number | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    lifetime.signal.removeEventListener("abort", stop);
    resolve({ started, code, output, stopped });
  };
  lifetime.signal.addEventListener("abort", stop, { once: true });
  if (!lifetime.valid() || lifetime.signal.aborted) stop();
  child.once("spawn", () => { started = true; });
  child.stdout.on("data", (data: Buffer) => { if (output.length < 16384) output += data.toString().slice(0, 16384 - output.length); });
  child.stderr.resume();
  child.stdin.on("error", () => {});
  child.once("error", () => finish(null));
  child.once("close", (code) => finish(code));
  child.stdin.end(input);
});

export type Delivery = "submitted" | "not-submitted" | "unknown";
