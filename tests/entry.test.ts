import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { personalDirectory, registerCue } from "../index.ts";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { PlatformChannels } from "../src/platform.ts";
import { integrationMemory } from "../src/integrations.ts";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

test("print, JSON, RPC, and invalid terminal modes install no reminder observers or side effects", async () => {
  for (const [mode, tty] of [["print", true], ["json", true], ["rpc", true], ["tui", false]] as const) {
    const handlers = new Map<string, (event: any, context: ExtensionContext) => any>();
    let command: any; let listeners = 0; let calls = 0;
    const pi = { on: (name: string, handler: any) => { handlers.set(name, handler); }, registerCommand: (_name: string, definition: any) => { command = definition; }, events: { on: () => { listeners++; return () => {}; } } } as unknown as ExtensionAPI;
    registerCue(pi, { terminal: () => tty, platform: new PlatformChannels(async () => { calls++; return { started: true, code: 0, stopped: false, output: "submitted" }; }), memory: integrationMemory() });
    const context = { mode, hasUI: true, sessionManager: { getSessionId: () => "session" }, ui: { custom: () => { calls++; }, onTerminalInput: () => { listeners++; } } } as unknown as ExtensionContext;
    await handlers.get("session_start")!({}, context);
    for (const event of ["agent_start", "agent_end", "agent_settled", "tool_execution_start", "tool_execution_end"]) await handlers.get(event)!({}, context);
    await command.handler("", context); await command.handler("debug", context); await handlers.get("session_shutdown")!({}, context);
    assert.equal(calls, 0, mode); assert.equal(listeners, 0, mode);
  }
});

test("native TUI registers then releases passive stdin and integration subscriptions", async () => {
  await mkdir(resolve(".dev/tests"), { recursive: true });
  const directory = await mkdtemp(resolve(".dev/tests/entry-"));
  const handlers = new Map<string, (event: any, context: ExtensionContext) => any>();
  let listeners = 0;
  const pi = { on: (name: string, handler: any) => { handlers.set(name, handler); }, registerCommand: () => {}, events: { on: () => { listeners++; return () => { listeners--; }; } } } as unknown as ExtensionAPI;
  registerCue(pi, { terminal: () => true, personalDirectory: directory, memory: integrationMemory() });
  const context = { mode: "tui", cwd: directory, sessionManager: { getSessionId: () => "session", getSessionFile: () => undefined, getSessionName: () => "fixture" } } as unknown as ExtensionContext;
  const before = process.stdin.listenerCount("data");
  for (let index = 0; index < 20; index++) {
    await handlers.get("session_start")!({}, context);
    assert.equal(process.stdin.listenerCount("data"), before + 1); assert.equal(listeners, 3);
    await handlers.get("session_shutdown")!({}, context);
    assert.equal(process.stdin.listenerCount("data"), before); assert.equal(listeners, 0);
  }
});

test("personal paths use Pi normalization without reading or writing credential files", async () => {
  const before = process.env.PI_CODING_AGENT_DIR;
  try {
    for (const value of ["~/pi-cue-path-fixture", pathToFileURL(resolve(".dev/path-fixture")).href, ".dev/relative-agent"]) {
      process.env.PI_CODING_AGENT_DIR = value;
      const path = await personalDirectory();
      assert.equal(path, value.startsWith("~") ? resolve(homedir(), "pi-cue-path-fixture") : value.startsWith("file:") ? resolve(".dev/path-fixture") : resolve(value));
    }
  } finally { if (before === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = before; }
});

test("legacy project files are neither read nor applied by the running extension", { timeout: 3000 }, async () => {
  const directory = await mkdtemp(resolve(".dev/tests/entry-single-"));
  const personal = resolve(directory, "agent");
  const workspace = resolve(directory, "workspace");
  const legacy = resolve(workspace, ".pi/pi-cue.json");
  await mkdir(personal); await mkdir(resolve(workspace, ".pi"), { recursive: true });
  await writeFile(resolve(personal, "pi-cue.json"), '{"schemaVersion":1,"settings":{"nativeNotification":false,"soundPreset":"soft"}}');
  for (const old of ['{"schemaVersion":1,"settings":{"enabled":false}}', '{broken']) {
    await writeFile(legacy, old);
    const handlers = new Map<string, (event: any, context: ExtensionContext) => any>();
    const pi = { on: (name: string, handler: any) => { handlers.set(name, handler); }, registerCommand: () => {}, events: { on: () => () => {} } } as unknown as ExtensionAPI;
    let calls = 0; let legacyReads = 0;
    let played!: () => void;
    const playback = new Promise<void>((done) => { played = done; });
    const original = fsPromises.readFile;
    fsPromises.readFile = (async (...args: Parameters<typeof original>) => { if (args[0] === legacy) legacyReads++; return original(...args); }) as typeof original;
    syncBuiltinESMExports();
    const context = { mode: "tui", cwd: workspace, sessionManager: { getSessionId: () => "single", getSessionFile: () => undefined, getSessionName: () => "fixture" } } as unknown as ExtensionContext;
    try {
      registerCue(pi, { terminal: () => true, personalDirectory: personal, memory: integrationMemory(), platform: new PlatformChannels(async () => { calls++; played(); return { started: true, code: 0, stopped: false, output: "" }; }, "macos", {}) });
      await handlers.get("session_start")!({}, context);
      await handlers.get("agent_start")!({}, context);
      await handlers.get("agent_end")!({ messages: [{ role: "assistant", stopReason: "stop" }] }, context);
      await handlers.get("agent_settled")!({ aborted: false }, context);
      await playback;
      assert.equal(calls, 1); assert.equal(legacyReads, 0);
    } finally {
      await handlers.get("session_shutdown")!({}, context);
      fsPromises.readFile = original; syncBuiltinESMExports();
    }
    assert.equal(await readFile(legacy, "utf8"), old);
  }
});

test("cue and cue debug route to separate passive panels with localized help and completion", async () => {
  for (const language of ["en", "zh-CN"]) {
    const directory = await mkdtemp(resolve(".dev/tests/entry-debug-"));
    await writeFile(resolve(directory, "pi-cue.json"), JSON.stringify({ schemaVersion: 1, settings: { language } }));
    const original = await readFile(resolve(directory, "pi-cue.json"), "utf8");
    const handlers = new Map<string, (event: any, context: ExtensionContext) => any>();
    let command: any; let calls = 0; let opened = 0;
    const messages: string[] = []; const screens: string[] = []; const diagnostics: string[] = [];
    const pi = { on: (name: string, handler: any) => { handlers.set(name, handler); }, registerCommand: (_name: string, definition: any) => { command = definition; }, events: { on: () => () => {} } } as unknown as ExtensionAPI;
    const context = { mode: "tui", cwd: directory, sessionManager: { getSessionId: () => "debug", getSessionFile: () => undefined, getSessionName: () => "fixture" }, ui: {
      notify: (message: string) => messages.push(message),
      custom: (factory: any) => new Promise<void>((done) => {
        opened++;
        const panel = factory({ terminal: { rows: 16 }, requestRender: () => {} }, undefined, undefined, done);
        screens.push(panel.render(40).join("\n"));
        if (opened === 2) {
          for (let index = 0; index < 3; index++) panel.handleInput("\x1b[B");
          panel.handleInput("\r"); diagnostics.push(panel.render(100).join("\n")); panel.handleInput("\x1b");
        }
        panel.handleInput("\x1b");
      }),
    } } as unknown as ExtensionContext;
    registerCue(pi, { terminal: () => true, personalDirectory: directory, memory: integrationMemory(), platform: new PlatformChannels(async () => { calls++; return { started: true, code: 0, stopped: false, output: "submitted" }; }) });
    try {
      await handlers.get("session_start")!({}, context);
      assert.deepEqual(command.getArgumentCompletions("d").map((item: any) => item.value), ["debug"]);
      assert.deepEqual(command.getArgumentCompletions("h").map((item: any) => item.value), ["help"]);
      assert.equal(command.getArgumentCompletions("debug unknown"), null);
      assert.match(command.getArgumentCompletions("d")[0].description, language === "en" ? /manual/ : /手动/);
      for (const args of ["help", "--help", "unknown"]) await command.handler(args, context);
      assert.equal(opened, 0); assert.equal(messages.length, 3);
      assert.ok(messages.every((message) => message.includes("/cue debug")));
      for (const args of ["", " debug ", ""]) await command.handler(args, context);
      assert.equal(opened, 3);
      for (const screen of [screens[0], screens[2]]) {
        assert.match(screen, language === "en" ? /Auto reminders/ : /自动提醒/);
        assert.doesNotMatch(screen, /Tests|Diagnostics|Troubleshooting|测试|诊断|排障/);
      }
      assert.match(screens[1], language === "en" ? /Troubleshooting/ : /排障/);
      assert.doesNotMatch(screens[1], /│|General|Auto reminders|常规|自动提醒/);
      if (process.platform === "darwin") assert.match(diagnostics[0], language === "en" ? /compatibility API; display is unverified/ : /兼容接口尝试通知，显示未验证/);
      assert.equal(calls, 0); assert.equal(await readFile(resolve(directory, "pi-cue.json"), "utf8"), original);
    } finally { await handlers.get("session_shutdown")!({}, context); }
  }
});
