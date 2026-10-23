import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { basename, join, resolve } from "node:path";
import { ConfigStore } from "./src/config.ts";
import { CueEngine, systemClock, type Clock } from "./src/engine.ts";
import { integrationMemory, IntegrationTracker, type IntegrationMemory } from "./src/integrations.ts";
import { detectPlatform, PlatformChannels, resolveSoundPath } from "./src/platform.ts";
import { notificationText } from "./src/text.ts";
import type { CuePanel } from "./src/panel.ts";
import { describeError, messageText } from "./src/messages.ts";

const memoryKey = Symbol.for("pi-cue.integration-memory.v1");
const ownerKey = Symbol.for("pi-subagents.completion-owner-id");
type Runtime = typeof globalThis & { [memoryKey]?: IntegrationMemory; [ownerKey]?: string };
export type ExtensionOptions = { terminal?: () => boolean; platform?: PlatformChannels; clock?: Clock; memory?: IntegrationMemory; personalDirectory?: string };

export async function personalDirectory(override?: string): Promise<string> {
  return resolve(override ?? (await import("@earendil-works/pi-coding-agent")).getAgentDir());
}

export function registerCue(pi: ExtensionAPI, options: ExtensionOptions = {}): void {
  const terminal = options.terminal ?? (() => !!process.stdin.isTTY && !!process.stdout.isTTY && process.env.TERM !== "dumb");
  const platform = options.platform ?? new PlatformChannels();
  const clock = options.clock ?? systemClock;
  const runtime = globalThis as Runtime;
  const memory = options.memory ?? (runtime[memoryKey] ??= integrationMemory());
  let activation = 0;
  let root: string | undefined;
  let current: { sessionId: string; context: ExtensionContext; store: ConfigStore; engine: CueEngine; tracker: IntegrationTracker } | undefined;
  let inputCleanup: (() => void) | undefined;
  let busCleanup: Array<() => void> = [];
  let panel: CuePanel | undefined;
  let closePanel: (() => void) | undefined;

  const valid = (context: ExtensionContext): boolean => !!current && context.mode === "tui" && terminal() && context.sessionManager.getSessionId() === current.sessionId;
  const stop = () => {
    activation++;
    panel?.dispose(); closePanel?.(); panel = undefined; closePanel = undefined;
    inputCleanup?.(); inputCleanup = undefined;
    for (const unsubscribe of busCleanup) unsubscribe();
    busCleanup = [];
    current?.tracker.dispose(); current?.engine.dispose(); current = undefined;
  };
  const observe = (event: string, handler: (payload: unknown) => void) => {
    busCleanup.push(pi.events.on(event, (payload) => {
      try { if (current && valid(current.context)) { handler(payload); panel?.refresh(); } }
      catch { platform.record("integrationMalformed"); }
    }));
  };

  pi.on("session_start", async (_event, context) => {
    stop();
    if (context.mode !== "tui" || !terminal()) return;
    const generation = activation;
    root ??= resolve(context.cwd);
    const personal = await personalDirectory(options.personalDirectory);
    const store = new ConfigStore(join(personal, "pi-cue.json"));
    await store.load();
    const { observeFocus } = await import("./src/focus.ts");
    if (generation !== activation) return;
    const sessionId = context.sessionManager.getSessionId();
    const engine = new CueEngine(store.effective(), {
      notify: async (cue, lifetime) => {
        if (!valid(context) || !lifetime.valid()) return;
        const settings = store.effective();
        const text = notificationText(settings, cue.kind, context.sessionManager.getSessionName() || basename(root!), cue.durationMs, cue.background);
        await platform.notify(text.title, text.body, String(settings.backend), lifetime);
      },
      sound: async (lifetime) => {
        if (!valid(context) || !lifetime.valid()) return;
        await platform.sound(store.effective(), resolveSoundPath(store), lifetime);
      },
      marker: () => {},
      diagnostic: (message) => platform.record(message),
    }, clock);
    const tracker = new IntegrationTracker(sessionId, context.sessionManager.getSessionFile() ?? sessionId, engine, memory, clock, () => runtime[ownerKey], (message) => platform.record(message));
    current = { sessionId, context, store, engine, tracker };
    inputCleanup = observeFocus((focus) => { if (valid(context)) engine.focus(focus); });
    observe("rpiv:ask-user:blocked", (payload) => tracker.ask(payload));
    observe("subagent:async-started", (payload) => tracker.started(payload));
    observe("subagent:async-complete", (payload) => tracker.completed(payload));
    platform.record("focusObserver");
  });
  pi.on("session_shutdown", stop);
  pi.on("agent_start", (_event, context) => { if (valid(context)) current!.engine.start(); });
  pi.on("agent_end", (event, context) => {
    if (!valid(context)) return;
    const message = event.messages.findLast((candidate) => candidate.role === "assistant");
    const reason = message && "stopReason" in message ? message.stopReason : undefined;
    current!.engine.end(reason === "error" ? "failure" : reason === "aborted" ? "abort" : "success");
  });
  pi.on("agent_settled", (event, context) => { if (valid(context)) current!.engine.settled(event.aborted); });
  pi.on("tool_execution_start", (event, context) => { if (valid(context)) current!.tracker.toolStarted(event.toolCallId, event.toolName); });
  pi.on("tool_execution_end", (event, context) => { if (valid(context)) current!.tracker.toolEnded(event.toolCallId); });
  pi.registerCommand("cue", {
    description: "pi-cue settings / 设置; /cue debug for checks / 排障",
    getArgumentCompletions: (prefix) => {
      const language = String(current?.store.effective().language ?? "en");
      const items = ["debug", "help"].filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value, description: messageText({ key: value === "debug" ? "commandDebug" : "commandHelp", values: {} }, language) }));
      return items.length ? items : null;
    },
    handler: async (args, context) => {
      if (!valid(context) || panel) return;
      const session = current!;
      const argument = args.trim();
      if (argument && argument !== "debug") {
        context.ui.notify(messageText({ key: "commandUsage", values: {} }, String(session.store.effective().language)), "info");
        return;
      }
      const generation = activation;
      const { CuePanel } = await import("./src/panel.ts");
      if (generation !== activation || !valid(context) || panel) return;
      let opened: CuePanel | undefined;
      const integrationStatus = () => Object.entries(session.tracker.status()).map(([integration, state]) => messageText({ key: "integrationState", values: { integration, state: state.recognized ? "recognized" : state.observed ? "unrecognized" : "notObserved", rejected: state.rejected } }, String(session.store.effective().language)));
      await context.ui.custom<void>((tui, theme, _keybindings, done) => {
        closePanel = () => done();
        panel = new CuePanel(session.store, tui, {
          changed: () => { if (generation === activation) session.engine.configure(session.store.effective()); },
          notify: async (settings, lifetime) => {
            const text = notificationText(settings, "success", "pi-cue test", 1234);
            return platform.notify(text.title, text.body, String(settings.backend), lifetime);
          },
          sound: (settings, lifetime, path) => platform.sound(settings, path, lifetime),
          diagnostics: () => {
            const state = session.engine.snapshot();
            const language = String(session.store.effective().language);
            return [...(detectPlatform() === "macos" ? [messageText({ key: "notificationMacCompatibility", values: {} }, language)] : []), messageText({ key: "focusSnapshot", values: { observed: state.observedFocus, effective: state.effectiveFocus, away: Math.round(state.awayMs), waiting: state.waiting, background: state.background, running: state.running, pending: state.pending } }, language), ...integrationStatus(), ...platform.diagnostics.map((message) => messageText(message, language)), ...(session.store.lastSaveError ? [describeError(session.store.lastSaveError, language)] : []), ...(session.store.configuration.error ? [describeError(session.store.configuration.error, language)] : [])];
          },
          close: () => { done(); },
        }, theme, argument === "debug" ? "debug" : "settings");
        opened = panel;
        return panel;
      }, { overlay: true, overlayOptions: { width: 68, maxHeight: "100%", anchor: "center", margin: { top: 1, bottom: 1, left: 0, right: 0 } } });
      (opened as CuePanel | undefined)?.dispose();
      if (panel === opened) { panel = undefined; closePanel = undefined; }
    },
  });
}

export default function (pi: ExtensionAPI): void { registerCue(pi); }
