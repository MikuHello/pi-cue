import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { ConfigStore, parseConfig, validateSetting } from "../src/config.ts";
import { cleanText, notificationText, templateError } from "../src/text.ts";
import { defaults } from "../src/data.ts";
import { syncBuiltinESMExports } from "node:module";
import fsPromises from "node:fs/promises";

async function fixture() {
  await mkdir(resolve(".dev/tests"), { recursive: true });
  const directory = await mkdtemp(resolve(".dev/tests/config-"));
  const path = join(directory, "pi-cue.json");
  const store = new ConfigStore(path);
  await store.load();
  return { directory, path, store };
}

test("one configuration supplies settings and reset restores built-in defaults", async () => {
  const { directory, store, path } = await fixture();
  const legacy = join(directory, "old-project.json");
  const old = '{"schemaVersion":1,"settings":{"enabled":false,"soundEnabled":true}}';
  await writeFile(legacy, old);
  await store.save("soundEnabled", false);
  await store.load();
  assert.equal(store.effective().enabled, true);
  assert.equal(store.effective().soundEnabled, false);
  await store.reset();
  assert.equal(store.effective().soundEnabled, true);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")).settings, {});
  assert.equal(await readFile(legacy, "utf8"), old);
});

test("concurrent writers fail visibly without overwriting another process", async () => {
  const { path, store } = await fixture();
  const other = new ConfigStore(path);
  await other.load();
  await store.save("language", "zh-CN");
  await assert.rejects(other.save("soundEnabled", false), /changed in another process/);
  assert.equal(JSON.parse(await readFile(path, "utf8")).settings.language, "zh-CN");
  assert.equal(other.effective().soundEnabled, true);
});

test("corrupt and future configuration remains byte-for-byte protected", async () => {
  const { path, store } = await fixture();
  for (const raw of ["{broken", '{"schemaVersion":2,"settings":{}}', '{"settings":{}}', '{"schemaVersion":1,"settings":{"headlessNotifications":true}}']) {
    await writeFile(path, raw);
    await store.load();
    await assert.rejects(store.save("enabled", false), /Protected/);
    assert.equal(await readFile(path, "utf8"), raw);
  }
});

test("unknown fields round-trip and serial writes retain previous confirmed changes", async () => {
  const { path, store } = await fixture();
  await writeFile(path, '{"schemaVersion":1,"future":{"a":1},"settings":{"newKey":[1,2]}}');
  await store.load();
  await Promise.all([store.save("enabled", false), store.save("language", "zh-CN")]);
  const saved = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(saved.future, { a: 1 });
  assert.deepEqual(saved.settings.newKey, [1, 2]);
  assert.equal(saved.settings.enabled, false);
  assert.equal(saved.settings.language, "zh-CN");
  await store.reset();
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")).settings, { newKey: [1, 2] });
});

test("runtime validation rejects unsafe values and templates never evaluate code", () => {
  assert.throws(() => parseConfig('{"schemaVersion":1,"settings":{"minWorkMs":-1}}'));
  assert.ok(validateSetting("soundPreset", "shell"));
  assert.ok(validateSetting("markerPrefix", "\x1b]0;bad\x07"));
  assert.ok(templateError("{eval}"));
  assert.ok(templateError("{session"));
  const text = notificationText({ ...defaults, notificationTitle: "$(touch /tmp/bad) {session}" }, "failure", "\x1b]0;evil\x07name", 1200);
  assert.equal(text.title, "$(touch /tmp/bad) name");
  assert.match(text.body, /failed/);
  assert.equal(cleanText("a\x07\x1b[31mb"), "ab");
});

test("reload and saving serialize even when an old disk snapshot is delayed", async () => {
  const { store, path } = await fixture();
  await store.save("language", "en");
  const original = fsPromises.readFile;
  let release!: () => void;
  let read!: () => void;
  const paused = new Promise<void>((resolve) => { release = resolve; });
  const hasRead = new Promise<void>((resolve) => { read = resolve; });
  let blocked = false;
  fsPromises.readFile = (async (...args: Parameters<typeof original>) => {
    const result = await original(...args);
    if (args[0] === path && !blocked) {
      blocked = true;
      read();
      await paused;
    }
    return result;
  }) as typeof original;
  syncBuiltinESMExports();
  try {
    const loading = store.load();
    await hasRead;
    const saving = store.save("language", "zh-CN");
    release();
    await Promise.all([loading, saving]);
    assert.equal(store.effective().language, "zh-CN");
    assert.equal(JSON.parse(await original(path, "utf8")).settings.language, "zh-CN");
    await store.save("enabled", false);
  } finally {
    release();
    fsPromises.readFile = original;
    syncBuiltinESMExports();
  }
});

test("a replacement store waits for prior-session commits and retains failed-save evidence", async () => {
  const { store, path } = await fixture();
  const original = fsPromises.rename;
  let release!: () => void; let entered!: () => void;
  const paused = new Promise<void>((done) => { release = done; });
  const atRename = new Promise<void>((done) => { entered = done; });
  fsPromises.rename = async (...args) => { if (args[1] === path) { entered(); await paused; } await original(...args); };
  syncBuiltinESMExports();
  try {
    const saving = store.save("enabled", false); await atRename;
    const replacement = new ConfigStore(path);
    const loading = replacement.load(); release(); await Promise.all([saving, loading]);
    assert.equal(replacement.effective().enabled, false);
  } finally { release(); fsPromises.rename = original; syncBuiltinESMExports(); }
  await mkdir(`${path}.lock`);
  await assert.rejects(store.save("enabled", true), /busy/);
  const replacement = new ConfigStore(path); await replacement.load();
  assert.ok(replacement.lastSaveError);
});

test("confirmed asynchronous validation belongs to the transaction seen by replacement sessions", async () => {
  const { store, path } = await fixture();
  let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  const saving = store.save("soundFile", "soft.wav", async () => { await gate; });
  const replacement = new ConfigStore(path);
  const loading = replacement.load(); release(); await Promise.all([saving, loading]);
  assert.equal(replacement.effective().soundFile, "soft.wav");
  await assert.rejects(store.save("soundFile", "missing.wav", async () => { throw new Error("validation failed"); }));
  const next = new ConfigStore(path); await next.load();
  assert.ok(next.lastSaveError); assert.equal(next.effective().soundFile, "soft.wav");
});

test("UI language does not change default notifications or custom templates", () => {
  const en = { ...defaults, language: "en" };
  const zh = { ...defaults, language: "zh-CN" };
  for (const event of ["success", "failure", "abort", "ask", "subagentSuccess", "subagentFailure"]) {
    assert.deepEqual(notificationText(en, event, "session", 1234, true), notificationText(zh, event, "session", 1234, true));
  }
  const custom = { notificationTitle: "自定义 {session}", notificationBody: "完成 {duration}" };
  assert.deepEqual(notificationText({ ...en, ...custom }, "success", "same", 1234), notificationText({ ...zh, ...custom }, "success", "same", 1234));
  assert.equal(defaults.language, "en");
});

test("upgrading waits for matching legacy writes without importing legacy project errors", async () => {
  const directory = await mkdtemp(resolve(".dev/tests/upgrade-"));
  const path = join(directory, "pi-cue.json");
  const legacyKey = JSON.stringify([path, join(directory, "project.json")]);
  const queues = (globalThis as any)[Symbol.for("pi-cue.configuration-transactions.v1")] as Map<string, { tail: Promise<void>; error?: unknown }>;
  let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  queues.set(legacyKey, { tail: gate.then(() => writeFile(path, '{"schemaVersion":1,"settings":{"enabled":false}}')), error: new Error("Old project failure") });
  try {
    const store = new ConfigStore(path);
    let loaded = false;
    const loading = store.load().then(() => { loaded = true; });
    await new Promise((done) => setImmediate(done)); assert.equal(loaded, false);
    release(); await loading;
    assert.equal(store.effective().enabled, false); assert.equal(store.lastSaveError, undefined);
    assert.equal(JSON.parse(await readFile(path, "utf8")).settings.enabled, false);
  } finally { release(); queues.delete(legacyKey); queues.delete(path); }
});
