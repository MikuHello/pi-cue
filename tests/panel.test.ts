import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFile, mkdir, mkdtemp, readFile, access, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { CURSOR_MARKER, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { ConfigStore } from "../src/config.ts";
import { CuePanel } from "../src/panel.ts";
import { CueEngine } from "../src/engine.ts";
import { metadata, readData, type Settings } from "../src/data.ts";

async function fixture(options: { rows?: number; settings?: Record<string, unknown>; onChange?: (store: ConfigStore) => void; finishPreview?: boolean; theme?: ConstructorParameters<typeof CuePanel>[3]; view?: "settings" | "debug" } = {}) {
  await mkdir(resolve(".dev/tests"), { recursive: true });
  const directory = await mkdtemp(resolve(".dev/tests/panel-"));
  const path = join(directory, "pi-cue.json");
  const store = new ConfigStore(path);
  await store.load();
  for (const [key, value] of Object.entries(options.settings ?? {})) await store.save(key, value);
  let closed = 0; let renders = 0; let changes = 0; let previews = 0; let active = 0; let maxActive = 0;
  const sounds: Array<{ settings: Settings; path: string }> = [];
  const notifications: Settings[] = [];
  let onChange: (() => void) | undefined;
  const terminal = { rows: options.rows ?? 24 };
  const panel = new CuePanel(store, { terminal, requestRender: () => { renders++; } } as unknown as TUI, {
    changed: () => { changes++; options.onChange?.(store); onChange?.(); onChange = undefined; },
    close: () => { closed++; }, notify: async (settings) => { notifications.push(settings); return "submitted"; }, diagnostics: () => ["fixture diagnostics"],
    sound: async (settings, life, soundPath) => {
      sounds.push({ settings, path: soundPath }); previews++; active++; maxActive = Math.max(active, maxActive);
      if (!options.finishPreview) await new Promise<void>((done) => { if (life.signal.aborted) done(); else life.signal.addEventListener("abort", () => done(), { once: true }); });
      active--;
    },
  }, options.theme, options.view);
  panel.focused = true;
  return { panel, store, path, directory, terminal, sounds, notifications, state: () => ({ closed, renders, changes, previews, active, maxActive }), saved: () => new Promise<void>((done) => { onChange = done; }) };
}
const plain = (value: string) => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b_[^\x07]*\x07/g, "");
const text = (panel: CuePanel, width = 68) => panel.render(width).map(plain).join("\n");
const tick = () => new Promise<void>((done) => setImmediate(done));
const down = (panel: CuePanel, count = 1) => { for (let index = 0; index < count; index++) panel.handleInput("\x1b[B"); };
const type = (panel: CuePanel, value: string) => { for (const char of value) panel.handleInput(char === "\n" ? "\r" : char); };
const selected = (panel: CuePanel) => panel.render(100).map(plain).map((line) => (line.includes("│") ? line.split("│")[1] : line).trimStart()).find((line) => line?.startsWith("→ "))?.slice(2).trimEnd();
function category(panel: CuePanel, label: string): void {
  panel.handleInput("\x1b[D");
  for (let index = 0; index < 6; index++) {
    if (panel.render(100).map(plain).some((line) => line.split("│")[0].trim() === "→ " + label)) { panel.handleInput("\x1b[C"); return; }
    down(panel);
  }
  assert.fail("Could not reach category " + label);
}
function select(panel: CuePanel, label: string): void {
  panel.handleInput("\x1b[C");
  for (let index = 0; index < 30; index++) {
    const line = selected(panel);
    if (line === label || line?.startsWith(label + "  ")) return;
    down(panel);
  }
  assert.fail("Could not reach " + label + ": " + text(panel));
}
function choose(panel: CuePanel, label: string, key = "\r"): void { select(panel, label); panel.handleInput(key); }

test("five daily categories expose controls without debugging tools, scope or paths", async () => {
  const f = await fixture();
  assert.match(text(f.panel), /Auto reminders\s+On/);
  assert.doesNotMatch(text(f.panel), /Personal|Project|More settings|WAV|pi-cue.json|Tests|Test notification|Diagnostics/);
  const labels = readData<{ labels: Record<string, string> }>("locales/en").labels;
  const reached = new Set<string>();
  for (const name of ["General", "Alerts", "Sound", "Behavior", "Add-ons"]) {
    category(f.panel, name);
    for (let count = 0; count < 12; count++) {
      const line = selected(f.panel);
      for (const [key, label] of Object.entries(labels)) if (line === label || line?.startsWith(label + "  ")) reached.add(key);
      down(f.panel);
    }
  }
  const hidden = new Set(["soundFile", "markerEnabled", "markWhenUnfocused", "markerPrefix", "clearOnFocus", "clearOnStart", "headlessNotifications"]);
  assert.deepEqual([...reached].sort(), Object.keys(metadata).filter((key) => !hidden.has(key)).sort());
  assert.equal(f.state().changes, 0); await assert.rejects(access(f.path)); f.panel.dispose();
});

test("Left and Right only move focus and preserve category rows and pending sound choices", async () => {
  const f = await fixture();
  f.panel.handleInput("\x1b[D"); f.panel.handleInput("\x1b[D"); assert.equal(f.state().closed, 0);
  f.panel.handleInput(" "); assert.match(selected(f.panel) ?? "", /^Auto reminders/); assert.equal(f.state().changes, 0);
  category(f.panel, "Sound"); choose(f.panel, "Sound");
  down(f.panel); const candidate = selected(f.panel); assert.match(candidate ?? "", /Soft chime/);
  f.panel.handleInput("\x1b[D"); f.panel.handleInput("p"); await tick();
  assert.equal(f.state().previews, 0); f.panel.handleInput("\r");
  assert.equal(selected(f.panel), candidate); assert.equal(f.store.effective().soundPreset, "system"); assert.equal(f.state().changes, 0);
  f.panel.handleInput("\x1b[C"); assert.equal(selected(f.panel), candidate);
  f.panel.handleInput("\x1b[D"); f.panel.handleInput(" ");
  assert.equal(selected(f.panel), candidate); assert.equal(f.store.effective().soundPreset, "system");
  const saved = f.saved(); f.panel.handleInput(" "); await saved;
  assert.equal(f.store.effective().soundPreset, "soft");
  category(f.panel, "General"); category(f.panel, "Sound");
  assert.match(selected(f.panel) ?? "", /^Sound\s+Soft chime/);
  choose(f.panel, "Sound"); down(f.panel);
  f.panel.handleInput("\x1b[D"); down(f.panel); f.panel.handleInput("\x1b[A"); f.panel.handleInput("\x1b[C");
  assert.match(selected(f.panel) ?? "", /^Sound\s+Soft chime/);
  assert.equal(f.state().closed, 0); assert.equal(f.state().previews, 0); f.panel.dispose();
});

test("Enter and Space are equivalent for toggles and candidates without left-column fall-through", async () => {
  for (const key of ["\r", " "]) {
    const f = await fixture();
    f.panel.handleInput("\x1b[D"); f.panel.handleInput(key);
    assert.equal(f.store.effective().enabled, true); assert.equal(f.state().changes, 0);
    const toggle = f.saved(); f.panel.handleInput(key); await toggle;
    assert.equal(f.store.effective().enabled, false);
    const language = readData<{ labels: Record<string, string> }>("locales/en").labels.language;
    choose(f.panel, language, key); down(f.panel);
    f.panel.handleInput("\x1b[D"); f.panel.handleInput(key);
    assert.equal(f.store.effective().language, "en");
    const save = f.saved(); f.panel.handleInput(key); await save;
    assert.equal(f.store.effective().language, "zh-CN"); assert.match(text(f.panel), /常规|界面语言/);
    f.panel.dispose();
  }
});

test("confirmation retains its selection across columns and requires its own explicit activation", async () => {
  const f = await fixture({ settings: { enabled: false } });
  choose(f.panel, "Restore defaults"); down(f.panel);
  f.panel.handleInput("\x1b[D"); f.panel.handleInput(" ");
  assert.equal(f.store.effective().enabled, false); assert.match(selected(f.panel) ?? "", /Restore defaults/);
  f.panel.handleInput("\x1b[D"); f.panel.handleInput("\x1b[C");
  assert.match(selected(f.panel) ?? "", /Restore defaults/); assert.equal(f.state().changes, 0);
  const saved = f.saved(); f.panel.handleInput(" "); await saved;
  assert.equal(f.store.effective().enabled, true); assert.match(text(f.panel), /Defaults restored/);
  choose(f.panel, "Restore defaults"); f.panel.handleInput("\x1b"); assert.equal(f.state().closed, 0);
  f.panel.dispose();
});

test("text editors keep spaces, q and arrow semantics, with explicit single and multiline confirmation", async () => {
  const f = await fixture();
  category(f.panel, "Alerts"); choose(f.panel, "Title");
  type(f.panel, " q "); f.panel.handleInput("\x1b[D"); type(f.panel, "x");
  assert.equal(f.state().closed, 0); assert.equal(f.state().changes, 0);
  const title = f.saved(); f.panel.handleInput("\r"); await title;
  assert.match(String(f.store.effective().notificationTitle), / qx /);
  choose(f.panel, "Message"); type(f.panel, "first\nsecond q ");
  f.panel.handleInput("\x1b[D"); f.panel.handleInput(" ");
  assert.equal(f.state().changes, 1);
  const body = f.saved(); f.panel.handleInput("\x13"); await body;
  assert.match(String(f.store.effective().notificationBody), /first\nsecond q/);
  choose(f.panel, "Message"); type(f.panel, "discard"); f.panel.handleInput("\x1b");
  assert.equal(f.state().changes, 2); assert.equal(f.state().closed, 0); f.panel.dispose();
});

test("legacy custom sounds remain named and previewable without exposing their path", async () => {
  const f = await fixture({ settings: { soundPreset: "file", soundFile: "custom.wav" }, finishPreview: true });
  await copyFile(new URL("../assets/soft.wav", import.meta.url), join(f.directory, "custom.wav"));
  category(f.panel, "Sound"); choose(f.panel, "Sound");
  assert.match(text(f.panel), /✓ Custom sound/); assert.doesNotMatch(text(f.panel), /custom.wav|WAV|Local file/);
  f.panel.handleInput("p"); await tick();
  assert.equal(f.sounds[0].settings.soundPreset, "file");
  assert.equal(f.sounds[0].path, join(f.directory, "custom.wav"));
  assert.equal(f.state().changes, 0); f.panel.dispose();
});

test("browsing never plays or saves and preview replacement leaves at most one active operation", async () => {
  const f = await fixture();
  category(f.panel, "Sound"); choose(f.panel, "Sound"); down(f.panel);
  assert.equal(f.state().previews, 0); await assert.rejects(access(f.path));
  f.panel.handleInput("p"); await tick(); f.panel.handleInput("p"); await tick();
  assert.equal(f.state().maxActive, 1); assert.equal(f.state().changes, 0);
  assert.equal(f.sounds.at(-1)?.settings.soundPreset, "soft"); assert.equal(f.store.effective().soundPreset, "system");
  f.panel.dispose(); await tick(); assert.equal(f.state().active, 0);
});

test("explicit tests use the single visible configuration without changing its saved values", async () => {
  const colors: string[] = [];
  const f = await fixture({ view: "debug", finishPreview: true, theme: { fg: (color, text) => { colors.push(color); return text; }, bg: (_color, text) => text, getBgAnsi: () => "", bold: (text) => text }, settings: { soundPreset: "bright", backend: "linux", notificationTitle: "Custom {session}", enabled: false } });
  const original = await readFile(f.path, "utf8");
  choose(f.panel, "Send test notification"); await tick();
  colors.length = 0;
  assert.match(text(f.panel), /Send attempted; display cannot be confirmed/);
  assert.ok(!colors.includes("success"));
  choose(f.panel, "Play current sound"); await tick();
  assert.equal(f.notifications[0].backend, "linux"); assert.equal(f.notifications[0].notificationTitle, "Custom {session}");
  assert.equal(f.sounds[0].settings.soundPreset, "bright"); assert.equal(f.state().changes, 0);
  assert.equal(await readFile(f.path, "utf8"), original); f.panel.dispose();
});

test("conflicts remain visible, preserve files, and reload does not pretend to save", async () => {
  const f = await fixture();
  const changed = JSON.stringify({ schemaVersion: 1, settings: { language: "en", enabled: false } });
  await writeFile(f.path, changed);
  f.panel.handleInput(" ");
  for (let index = 0; index < 30 && !f.store.lastSaveError; index++) await tick();
  await tick();
  assert.match(text(f.panel), /Could not save/); assert.doesNotMatch(text(f.panel), /\bSaved\b/);
  assert.equal(await readFile(f.path, "utf8"), changed);
  f.panel.handleInput("d"); assert.match(text(f.panel), /changed in another process/);
  f.panel.handleInput("\x1b[D"); assert.equal(f.state().closed, 0); f.panel.handleInput("\x1b[C"); f.panel.handleInput(" ");
  const reloaded = f.saved(); choose(f.panel, "Reload settings"); await reloaded;
  assert.equal(f.store.effective().enabled, false); assert.match(text(f.panel), /Settings reloaded/);
  assert.equal(await readFile(f.path, "utf8"), changed); f.panel.dispose();
});

test("confirmed saves finish and apply even when the main panel closes while they are pending", async () => {
  const events: string[] = [];
  let engine: CueEngine;
  const f = await fixture({ onChange: (store) => engine.configure(store.effective()) });
  engine = new CueEngine(f.store.effective(), { notify: async () => { events.push("notify"); }, sound: async () => { events.push("sound"); }, marker: () => {}, diagnostic: () => {} });
  const original = f.store.save.bind(f.store);
  let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  f.store.save = async (...args) => { await gate; await original(...args); };
  const saved = f.saved(); f.panel.handleInput(" "); f.panel.handleInput("\x1b[D");
  assert.equal(f.state().closed, 0); f.panel.handleInput("\x1b");
  assert.equal(f.state().closed, 1); release(); await saved;
  engine.start(); engine.settled(); assert.equal(f.store.effective().enabled, false); assert.deepEqual(events, []); engine.dispose();
});

test("idle rendering stays cached and short layouts keep both columns and selected rows", async () => {
  const f = await fixture();
  const before = f.state().renders; const first = f.panel.render(68);
  assert.deepEqual(f.panel.render(68), first); await new Promise((done) => setTimeout(done, 30));
  assert.equal(f.state().renders, before);
  f.terminal.rows = 16; category(f.panel, "Alerts");
  for (let index = 0; index < 6; index++) {
    const lines = f.panel.render(40);
    assert.ok(lines.length <= 14); assert.ok(lines.every((line) => visibleWidth(line) <= 40));
    assert.match(lines.map(plain).join("\n"), /General[\s\S]*Add-ons/);
    assert.ok(lines.some((line) => line.includes("→"))); down(f.panel);
  }
  f.panel.dispose();
});

test("short multiline errors preserve the active line, cursor, feedback and correction path", async () => {
  const body = [...Array.from({ length: 19 }, (_, index) => "line " + index), "ENDMARK"].join("\n");
  const f = await fixture({ rows: 16, settings: { notificationBody: body } });
  category(f.panel, "Alerts"); choose(f.panel, "Message");
  down(f.panel, 20); f.panel.handleInput("\x05"); type(f.panel, " {bad}");
  f.panel.handleInput("\x13");
  for (let index = 0; index < 30 && !f.store.lastSaveError; index++) await tick();
  await tick(); const failed = f.panel.render(40);
  assert.ok(failed.length <= 14); assert.ok(failed.every((line) => visibleWidth(line) <= 40));
  assert.match(failed.map(plain).join("\n"), /ENDMARK \{bad\}/);
  assert.ok(failed.some((line) => line.includes(CURSOR_MARKER)));
  assert.match(failed.map(plain).join("\n"), /Could not save/); assert.match(failed.map(plain).join("\n"), /Esc/);
  for (let index = 0; index < 20; index++) f.panel.handleInput("\x1b[A");
  assert.match(text(f.panel, 40), /line 0/); assert.ok(f.panel.render(40).some((line) => line.includes(CURSOR_MARKER)));
  down(f.panel, 20); f.panel.handleInput("\x05");
  for (let index = 0; index < 6; index++) f.panel.handleInput("\x7f");
  const saved = f.saved(); f.panel.handleInput("\x13"); await saved;
  assert.equal(f.store.effective().notificationBody, body); f.panel.dispose();
});

test("the themed surface fills cells and restores background after clipped text", async () => {
  const background = "\x1b[48;5;59m";
  const f = await fixture({ theme: {
    fg: (_color, text) => "\x1b[36m" + text + "\x1b[39m",
    bg: (_color, text) => background + text + "\x1b[49m",
    getBgAnsi: () => background,
    bold: (text) => "\x1b[1m" + text + "\x1b[22m",
  } });
  choose(f.panel, "Restore defaults");
  const lines = f.panel.render(24);
  assert.ok(lines.some((line) => line.includes("\x1b[0m")));
  for (const line of lines) {
    assert.equal(visibleWidth(line), 24);
    assert.ok(line.startsWith(background)); assert.ok(line.endsWith("\x1b[49m"));
    for (const match of line.matchAll(/\x1b\[0m/g)) assert.ok(line.slice(match.index! + match[0].length).startsWith(background));
  }
  f.panel.dispose();
});

test("context help follows the focused category or setting and remains complete on short screens", async () => {
  for (const language of ["en", "zh-CN"]) {
    const locale = readData<{ labels: Record<string, string>; categories: Record<string, string>; help: Record<string, string>; categoryHelp: Record<string, string> }>("locales/" + language);
    const f = await fixture({ rows: 16, settings: { language } });
    const original = await readFile(f.path, "utf8");
    category(f.panel, locale.categories.behavior);
    for (const key of ["notifyOnError", "notifyOnAbort", "minWorkMs", "minAwayMs", "unknownFocusPolicy"]) {
      select(f.panel, locale.labels[key]);
      const lines = f.panel.render(40);
      assert.ok(lines.length <= 14); assert.ok(lines.every((line) => visibleWidth(line) <= 40));
      assert.ok(lines.map(plain).join("").replace(/\s/g, "").includes(locale.help[key].replace(/\s/g, "")));
      assert.ok(lines.some((line) => line.includes("→")));
    }
    f.panel.handleInput("\x1b[D");
    assert.ok(text(f.panel, 40).replace(/\s/g, "").includes(locale.categoryHelp.behavior.replace(/\s/g, "")));
    assert.ok(!text(f.panel, 40).replace(/\s/g, "").includes(locale.help.unknownFocusPolicy.replace(/\s/g, "")));
    f.panel.handleInput("\x1b[C");
    assert.ok(text(f.panel, 68).replace(/\s/g, "").includes(locale.help.unknownFocusPolicy.replace(/\s/g, "")));
    assert.equal(await readFile(f.path, "utf8"), original); assert.equal(f.state().changes, 0); f.panel.dispose();
  }
});

test("duration editors retain units, no-limit guidance, errors and their cursor within short screens", async () => {
  for (const language of ["en", "zh-CN"]) {
    const locale = readData<{ labels: Record<string, string>; categories: Record<string, string>; durationHelp: string; failed: string }>("locales/" + language);
    const f = await fixture({ rows: 16, settings: { language } });
    category(f.panel, locale.categories.behavior); choose(f.panel, locale.labels.minWorkMs);
    assert.ok(text(f.panel, 40).includes(locale.durationHelp));
    type(f.panel, "invalid"); f.panel.handleInput("\r");
    for (let index = 0; index < 30 && !f.store.lastSaveError; index++) await tick();
    await tick(); const lines = f.panel.render(40);
    assert.ok(lines.length <= 14); assert.ok(lines.every((line) => visibleWidth(line) <= 40));
    assert.ok(lines.some((line) => line.includes(CURSOR_MARKER)));
    assert.ok(lines.map(plain).join("\n").includes(locale.failed));
    assert.ok(lines.map(plain).join("\n").includes(locale.durationHelp));
    assert.equal(f.store.effective().minWorkMs, 0); assert.equal(f.state().changes, 0); f.panel.dispose();
  }
});

test("standalone troubleshooting stays passive while browsing and closes without exposing settings", async () => {
  for (const language of ["en", "zh-CN"]) {
    const locale = readData<{ help: Record<string, string>; debugTitle: string; debugActions: Record<string, string> }>("locales/" + language);
    const f = await fixture({ rows: 16, view: "debug", settings: { language } });
    const original = await readFile(f.path, "utf8");
    assert.match(text(f.panel, 40), new RegExp(locale.debugTitle));
    assert.doesNotMatch(text(f.panel, 40), /│|General|Auto reminders|常规|自动提醒/);
    for (const key of ["\x1b[D", "\x1b[C", "\t", "\x1b[Z"]) f.panel.handleInput(key);
    assert.equal(selected(f.panel), locale.debugActions.testNotification);
    for (const key of ["testNotification", "previewSound", "previewText", "diagnostics"] as const) {
      select(f.panel, locale.debugActions[key]);
      assert.doesNotMatch(text(f.panel, 40), /do not|不改|unverified|兼容接口/);
      assert.ok(f.panel.render(40).length <= 9);
      assert.ok(f.panel.render(40).length <= 14);
    }
    choose(f.panel, locale.debugActions.diagnostics); assert.match(text(f.panel), /fixture diagnostics/);
    f.panel.handleInput("\x1b"); assert.equal(f.state().closed, 0);
    assert.match(text(f.panel, 40), new RegExp(locale.debugTitle));
    choose(f.panel, locale.debugActions.previewText); f.panel.handleInput("q"); assert.equal(f.state().closed, 0);
    f.panel.handleInput(language === "en" ? "\x1b" : "q"); assert.equal(f.state().closed, 1);
    assert.equal(f.notifications.length, 0); assert.equal(f.sounds.length, 0); assert.equal(f.state().changes, 0);
    assert.equal(await readFile(f.path, "utf8"), original); f.panel.dispose();
  }
});
