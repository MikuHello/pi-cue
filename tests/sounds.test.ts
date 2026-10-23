import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdir, mkdtemp, readFile, writeFile, symlink, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { addSound } from "../scripts/add-sound.ts";
import { parsePresets, presets } from "../src/data.ts";
import { checkSoundAsset } from "../src/platform.ts";

const extra = { id: "mellow", file: "mellow.wav", en: "Mellow", "zh-CN": "柔和音", source: "Original project synthesis for isolated testing", license: "Original test fixture", description: { en: "A soft test cue.", "zh-CN": "轻柔测试音效。" } };
async function fixture() {
  await mkdir(resolve(".dev/tests"), { recursive: true });
  const root = await mkdtemp(resolve(".dev/tests/sounds-"));
  await cp(resolve("data"), join(root, "data"), { recursive: true });
  await cp(resolve("assets"), join(root, "assets"), { recursive: true });
  return root;
}

test("sound names and IDs are unique, compatibility labels reserved, and assets cannot escape", async () => {
  for (const patch of [{ id: "soft" }, { en: " soft CHIME " }, { "zh-CN": "轻柔双音" }, { en: "Custom sound" }, { "zh-CN": "自定义音效" }, { file: "../outside.wav" }, { file: "/absolute.wav" }, { id: "../escape" }]) {
    assert.throws(() => parsePresets([...presets, { ...extra, ...patch }]));
  }
  const root = await fixture();
  const outside = join(root, "outside.wav");
  await cp(resolve("assets/soft.wav"), outside);
  await symlink(outside, join(root, "assets/escape.wav"));
  await assert.rejects(checkSoundAsset("escape.wav", join(root, "assets")));
  await assert.rejects(checkSoundAsset("../outside.wav", join(root, "assets")));
});

test("invalid audio and duplicate imports preserve the catalog and leave no new asset or lock", async () => {
  const root = await fixture();
  const input = join(root, "invalid.wav");
  await writeFile(input, "not a WAV");
  const original = await readFile(join(root, "data/presets.json"), "utf8");
  const { file: _file, ...metadata } = extra;
  await assert.rejects(addSound(root, { ...metadata, input }));
  assert.equal(await readFile(join(root, "data/presets.json"), "utf8"), original);
  await assert.rejects(access(join(root, "assets/mellow.wav")));
  await assert.rejects(access(join(root, "data/presets.json.lock")));
  await assert.rejects(addSound(root, { ...metadata, en: "Soft chime", input: resolve("assets/soft.wav") }), /unique/);
  assert.equal(await readFile(join(root, "data/presets.json"), "utf8"), original);
  await assert.rejects(access(join(root, "data/presets.json.lock")));
});

test("an imported named sound passes runtime and schema validation, picker save, reload and playback routing", async () => {
  const root = await fixture();
  const { file: _file, ...metadata } = extra;
  await addSound(root, { ...metadata, input: resolve("assets/soft.wav") });
  await cp(resolve("src"), join(root, "src"), { recursive: true });
  await mkdir(join(root, "scripts")); await mkdir(join(root, "cache")); await mkdir(join(root, "tmp"));
  await cp(resolve("scripts/generate-schema.mjs"), join(root, "scripts/generate-schema.mjs"));
  const environment = { ...process.env, NODE_COMPILE_CACHE: join(root, "cache"), TMPDIR: join(root, "tmp"), JITI_FS_CACHE: "false" };
  const generated = spawnSync(process.execPath, [join(root, "scripts/generate-schema.mjs")], { cwd: root, env: environment, encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  assert.ok(JSON.parse(await readFile(join(root, "data/config.schema.json"), "utf8")).properties.settings.properties.soundPreset.enum.includes("mellow"));
  await writeFile(join(root, "verify.ts"), [
    'import assert from "node:assert/strict";',
    'import { resolve } from "node:path";',
    'import { ConfigStore, validateSetting } from "./src/config.ts";',
    'import { CuePanel } from "./src/panel.ts";',
    'import { PlatformChannels, resolveSoundPath } from "./src/platform.ts";',
    'assert.equal(validateSetting("soundPreset", "mellow"), undefined);',
    'const path = resolve("pi-cue.json"); const store = new ConfigStore(path); await store.load();',
    'let changed; const saved = new Promise((done) => { changed = done; });',
    'const panel = new CuePanel(store, { terminal: { rows: 24 }, requestRender() {} }, { changed, sound: async () => {}, notify: async () => "submitted", diagnostics: () => [], close() {} });',
    'for (const key of ["\\u001b[D", "\\u001b[B", "\\u001b[B", "\\u001b[C", "\\u001b[B", " "]) panel.handleInput(key);',
    'assert.ok(panel.render(68).join("\\n").includes("Mellow"));',
    'for (let index = 0; index < 3; index++) panel.handleInput("\\u001b[B");',
    'panel.handleInput(" "); await saved; panel.dispose();',
    'const next = new ConfigStore(path); await next.load(); assert.equal(next.effective().soundPreset, "mellow");',
    'const calls = []; const backend = new PlatformChannels(async (command, args) => { calls.push({ command, args }); return { started: true, code: 0, stopped: false, output: "" }; }, "macos", {});',
    'await backend.sound(next.effective(), resolveSoundPath(next), { signal: new AbortController().signal, valid: () => true });',
    'assert.equal(calls.length, 1); assert.equal(calls[0].command, "afplay"); assert.equal(calls[0].args[0], resolve("assets/mellow.wav"));',
    'console.log(JSON.stringify({ saved: next.effective().soundPreset, asset: calls[0].args[0], externalPlayerWasStubbed: true }));',
  ].join("\n"));
  const result = spawnSync(process.execPath, [join(root, "verify.ts")], { cwd: root, env: environment, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const evidence = JSON.parse(result.stdout);
  assert.equal(evidence.saved, "mellow"); assert.equal(evidence.externalPlayerWasStubbed, true);
  await writeFile(join(root, "result.json"), JSON.stringify({ root, runtimeAndSchema: "passed", pickerAndReload: "passed", ...evidence }, null, 2));
});
