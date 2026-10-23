import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { PlatformChannels, classifyNotification, detectPlatform, validateWav } from "../src/platform.ts";
import { type ProcessResult, type Runner } from "../src/process.ts";
import { defaults } from "../src/data.ts";

function lifetime() { const controller = new AbortController(); return { controller, signal: controller.signal, valid: () => !controller.signal.aborted }; }
const succeeded = (output = ""): ProcessResult => ({ started: true, code: 0, stopped: false, output });

test("production notification path never repeats submitted or uncertain delivery", async () => {
  for (const first of ["submitted", "unknown", "not-submitted"] as const) {
    let calls = 0;
    const backend = new PlatformChannels(async () => { calls++; return succeeded(first); }, "macos", {});
    const result = await backend.notify("title", "body", "auto", lifetime());
    assert.equal(calls, 1);
    assert.equal(result, first);
  }
  assert.equal(classifyNotification({ ...succeeded(), stopped: true }), "unknown");
});

test("Linux notifications require sound capability and use a stable D-Bus owner", async () => {
  for (const sound of [false, true]) {
    const calls: string[][] = [];
    const run: Runner = async (_command, args) => { calls.push(args); return succeeded(calls.length === 1 ? "(':1.42',)" : calls.length === 2 ? sound ? "(['body', 'sound'],)" : "(['body'],)" : "(uint32 123,)"); };
    const backend = new PlatformChannels(run, "linux", { DISPLAY: ":0", DBUS_SESSION_BUS_ADDRESS: "fixture" });
    const result = await backend.notify("$(touch /tmp/never)", "'<&", "auto", lifetime());
    assert.equal(result, sound ? "submitted" : "not-submitted");
    assert.equal(calls.length, sound ? 3 : 2);
    if (sound) { assert.ok(calls[2].includes(":1.42")); assert.ok(calls[2].includes("{'suppress-sound': <true>}")); }
  }
});

test("cancellation after capability probing prevents actual external submission", async () => {
  const life = lifetime(); let calls = 0;
  const backend = new PlatformChannels(async () => { calls++; if (calls === 1) return succeeded("(':1.42',)"); life.controller.abort(); return succeeded("(['sound'],)"); }, "linux", { DISPLAY: ":0", DBUS_SESSION_BUS_ADDRESS: "fixture" });
  assert.equal(await backend.notify("title", "body", "auto", life), "not-submitted");
  assert.equal(calls, 2);
});

test("Windows uses static script and JSON data with an explicit silent toast", async () => {
  let argumentsSeen: string[] = []; let stdin = "";
  const backend = new PlatformChannels(async (_command, args, _life, input) => { argumentsSeen = args; stdin = input ?? ""; return succeeded("submitted"); }, "windows", {});
  const body = '$([System.IO.File]::WriteAllText("bad","x")) 中文';
  assert.equal(await backend.notify("quote'", body, "auto", lifetime()), "submitted");
  assert.equal(JSON.parse(stdin).body, body);
  const code = Buffer.from(argumentsSeen.at(-1)!, "base64").toString("utf16le");
  assert.ok(code.includes('<audio silent="true"/>')); assert.ok(!code.includes(body)); assert.ok(!argumentsSeen.includes("-ExecutionPolicy"));
});

test("WAV validation and sound fallback handle certainty without duplicate playback", async () => {
  const wav = await readFile(new URL("../assets/soft.wav", import.meta.url));
  assert.doesNotThrow(() => validateWav(wav));
  const compressed = Buffer.from(wav); compressed.writeUInt16LE(3, 20); assert.throws(() => validateWav(compressed), /PCM/);
  assert.throws(() => validateWav(wav.subarray(0, 40)));
  let calls = 0;
  const failed = new PlatformChannels(async () => { calls++; return { started: false, code: null, output: "", stopped: false }; }, "macos", {});
  await failed.sound({ ...defaults, soundPreset: "file" }, "/missing/pi-cue.wav", lifetime());
  assert.equal(calls, 1);
  calls = 0;
  const uncertain = new PlatformChannels(async () => { calls++; return { ...succeeded(), code: null, stopped: true }; }, "macos", {});
  await uncertain.sound({ ...defaults, soundPreset: "file" }, new URL("../assets/soft.wav", import.meta.url).pathname, lifetime());
  assert.equal(calls, 1);
});

test("WSL uses positive kernel evidence, never WT_SESSION alone; SSH stays local", async () => {
  assert.equal(detectPlatform("linux", "6.0-linux", { WT_SESSION: "x" }), "linux");
  assert.equal(detectPlatform("linux", "6.0-microsoft-standard-WSL2", { WSL_DISTRO_NAME: "Ubuntu" }), "wsl");
  assert.equal(detectPlatform("linux", "6.6.87.2-microsoft-standard-WSL2", {}), "wsl");
  let calls = 0;
  const backend = new PlatformChannels(async () => { calls++; return succeeded(); }, "linux", { SSH_TTY: "/dev/pts/1" });
  await backend.notify("title", "body", "auto", lifetime()); await backend.sound(defaults, undefined, lifetime());
  assert.equal(calls, 0);
});
