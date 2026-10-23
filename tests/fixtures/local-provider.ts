import { writeFileSync } from "node:fs";
import { join } from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
  const events: string[] = [];
  const externalCalls: string[] = [];
  let requests = 0;
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = ((command: string, ...args: unknown[]) => {
    if (/^(?:osascript|afplay|powershell\.exe|gdbus|paplay|aplay|canberra-gtk-play|wslpath)$/.test(command)) { externalCalls.push(command); writeFileSync(join(process.env.PI_CUE_PROBE_DIR!, "external-calls.json"), JSON.stringify(externalCalls)); throw new Error("Unexpected reminder process in headless probe"); }
    return Reflect.apply(originalSpawn, childProcess, [command, ...args]);
  }) as typeof childProcess.spawn;
  syncBuiltinESMExports();
  pi.registerProvider("pi-cue-local", {
    baseUrl: "http://127.0.0.1/unused",
    apiKey: "unused-local-fixture",
    api: "pi-cue-local-api",
    models: [{ id: "fixture", name: "Local deterministic fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 128 }],
    streamSimple(model) {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const call = requests++ === 0;
        const output: AssistantMessage = { role: "assistant", content: call ? [{ type: "toolCall", id: "headless-questionnaire", name: "ask_user_question", arguments: {} }] : [{ type: "text", text: "Local fixture complete" }], api: model.api, provider: model.provider, model: model.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: call ? "toolUse" : "stop", timestamp: Date.now() };
        stream.push({ type: "start", partial: output });
        if (!call) {
          stream.push({ type: "text_start", contentIndex: 0, partial: output });
          stream.push({ type: "text_delta", contentIndex: 0, delta: "Local fixture complete", partial: output });
          stream.push({ type: "text_end", contentIndex: 0, content: "Local fixture complete", partial: output });
        }
        stream.push({ type: "done", reason: call ? "toolUse" : "stop", message: output });
        stream.end(output);
      });
      return stream;
    },
  });
  pi.registerTool({
    name: "ask_user_question", label: "Local probe", description: "Local protocol probe without user interaction", parameters: { type: "object", properties: {} } as any,
    async execute(toolCallId, _params, _signal, _update, context) {
      const owner = "local-probe-owner";
      (globalThis as any)[Symbol.for("pi-subagents.completion-owner-id")] = owner;
      const sessionId = context.sessionManager.getSessionFile() ?? context.sessionManager.getSessionId();
      events.push("probe_ask_blocked"); pi.events.emit("rpiv:ask-user:blocked", { toolCallId, active: true });
      pi.events.emit("rpiv:ask-user:blocked", { toolCallId, active: false });
      events.push("probe_subagent_events"); pi.events.emit("subagent:async-started", { lifecycleArtifactVersion: 3, id: "probe-run", sessionId, completionOwnerId: owner });
      pi.events.emit("subagent:async-complete", { runId: "probe-run", sessionId, completionOwnerId: owner, success: true });
      return { content: [{ type: "text", text: "Protocol probe complete" }], details: {} };
    },
  });
  pi.on("agent_start", () => { events.push("agent_start"); });
  pi.on("tool_execution_start", () => { events.push("tool_execution_start"); });
  pi.on("tool_execution_end", () => { events.push("tool_execution_end"); });
  pi.on("agent_end", () => { events.push("agent_end"); });
  pi.on("agent_settled", (_event, context) => {
    events.push("agent_settled");
    writeFileSync(join(process.env.PI_CUE_PROBE_DIR!, "trace.json"), JSON.stringify({ mode: context.mode, hasUI: context.hasUI, stdinTTY: !!process.stdin.isTTY, stdoutTTY: !!process.stdout.isTTY, events, externalCalls }));
    if (context.mode === "rpc") setTimeout(() => context.shutdown(), 10);
  });
}
