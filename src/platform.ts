import { lstat, readFile, stat } from "node:fs/promises";
import { release } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, resolve } from "node:path";
import { presets, type Settings } from "./data.ts";
import type { ConfigStore } from "./config.ts";
import type { Lifetime } from "./engine.ts";
import { runProcess, type Runner, type Delivery, type ProcessResult } from "./process.ts";
import { CueError, type Message } from "./messages.ts";

export type Platform = "macos" | "windows" | "linux" | "wsl" | "unsupported";
export function detectPlatform(platform = process.platform, kernel = release(), environment = process.env): Platform {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  if (platform === "linux") return /microsoft.*WSL2|WSL2.*microsoft|microsoft-standard/i.test(kernel) || /microsoft/i.test(kernel) && !!environment.WSL_DISTRO_NAME ? "wsl" : "linux";
  return "unsupported";
}

function gvariant(value: string): string { return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`; }
function script(name: string): string { return fileURLToPath(new URL(`../scripts/${name}`, import.meta.url)); }
function asset(name: string): string { return fileURLToPath(new URL(`../assets/${name}`, import.meta.url)); }

export function classifyNotification(result: ProcessResult): Delivery {
  if (!result.started) return "not-submitted";
  const output = result.output.trim();
  if (output === "submitted") return "submitted";
  if (output === "not-submitted" && !result.stopped) return "not-submitted";
  return "unknown";
}

export function validateWav(buffer: Buffer): void {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE" || buffer.readUInt32LE(4) + 8 !== buffer.length) throw new CueError("wavContainer");
  let format = false;
  let data = false;
  let alignment = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const length = buffer.readUInt32LE(offset + 4);
    const end = offset + 8 + length;
    if (end > buffer.length) throw new CueError("wavTruncated");
    const kind = buffer.toString("ascii", offset, offset + 4);
    if (kind === "fmt ") {
      if (length < 16 || buffer.readUInt16LE(offset + 8) !== 1) throw new CueError("wavPcm");
      const channels = buffer.readUInt16LE(offset + 10);
      const rate = buffer.readUInt32LE(offset + 12);
      const bits = buffer.readUInt16LE(offset + 22);
      alignment = channels * bits / 8;
      if (![1, 2].includes(channels) || ![8, 16].includes(bits) || rate < 8000 || rate > 96000 || buffer.readUInt16LE(offset + 20) !== alignment || buffer.readUInt32LE(offset + 16) !== rate * alignment) throw new CueError("wavFormat");
      format = true;
    }
    if (kind === "data") {
      if (!format || !length || length % alignment !== 0) throw new CueError("wavData");
      data = true;
    }
    offset = end + (length % 2);
  }
  if (!format || !data) throw new CueError("wavMissing");
}

export async function checkSoundFile(path: string): Promise<void> {
  const status = await stat(path);
  if (!status.isFile() || status.size > 20 * 1024 * 1024) throw new CueError("wavFile");
  validateWav(await readFile(path));
}

export async function checkSoundAsset(name: string, directory = dirname(asset("soft.wav"))): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]*\.wav$/.test(name)) throw new CueError("wavFile");
  const folder = await lstat(directory);
  const path = resolve(directory, name);
  const file = await lstat(path);
  if (!folder.isDirectory() || folder.isSymbolicLink() || !file.isFile() || file.isSymbolicLink()) throw new CueError("wavFile");
  await checkSoundFile(path);
  return path;
}

export function resolveSoundPath(store: ConfigStore, value = String(store.effective().soundFile)): string {
  if (isAbsolute(value)) return value;
  return resolve(dirname(store.configuration.path), value);
}

export class PlatformChannels {
  private run: Runner;
  private platform: Platform;
  private environment: NodeJS.ProcessEnv;
  diagnostics: Message[] = [];

  constructor(run: Runner = runProcess, platform = detectPlatform(), environment = process.env) {
    this.run = run;
    this.platform = platform;
    this.environment = environment;
  }

  record(key: string, values: Message["values"] = {}): void {
    this.diagnostics.push({ key, values });
    if (this.diagnostics.length > 32) this.diagnostics.shift();
  }

  async notify(title: string, body: string, backend: string, lifetime: Lifetime): Promise<Delivery> {
    if (!lifetime.valid()) return "not-submitted";
    if (this.environment.SSH_CONNECTION || this.environment.SSH_TTY) { this.record("notificationSsh"); return "not-submitted"; }
    const native = this.platform === "wsl" ? "windows" : this.platform;
    if (backend !== "auto" && backend !== native) { this.record("notificationPlatform"); return "not-submitted"; }
    let delivery: Delivery = "not-submitted";
    if (native === "macos") delivery = classifyNotification(await this.run("osascript", ["-l", "JavaScript", script("notify-macos.js"), title, body], lifetime));
    if (native === "windows") {
      const code = Buffer.from(await readFile(script("notify-windows.ps1"), "utf8"), "utf16le").toString("base64");
      if (lifetime.valid()) delivery = classifyNotification(await this.run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", code], lifetime, JSON.stringify({ title, body })));
    }
    if (native === "linux") delivery = await this.linuxNotify(title, body, lifetime);
    this.record("notificationResult", { backend: native, result: delivery });
    return delivery;
  }

  private async hostPath(path: string, lifetime: Lifetime): Promise<string | undefined> {
    if (this.platform !== "wsl") return path;
    const mapped = await this.run("wslpath", ["-w", path], lifetime);
    return mapped.code === 0 && !mapped.stopped && lifetime.valid() ? mapped.output.trim() || undefined : undefined;
  }

  private async linuxNotify(title: string, body: string, lifetime: Lifetime): Promise<Delivery> {
    if (!this.environment.DBUS_SESSION_BUS_ADDRESS || (!this.environment.DISPLAY && !this.environment.WAYLAND_DISPLAY)) { this.record("notificationDesktop"); return "not-submitted"; }
    const ownerResult = await this.run("gdbus", ["call", "--session", "--dest", "org.freedesktop.DBus", "--object-path", "/org/freedesktop/DBus", "--method", "org.freedesktop.DBus.GetNameOwner", "org.freedesktop.Notifications"], lifetime);
    if (!lifetime.valid() || ownerResult.code !== 0) return "not-submitted";
    const owner = ownerResult.output.match(/'(:[0-9]+\.[0-9]+)'/)?.[1];
    if (!owner) return "not-submitted";
    const base = ["call", "--session", "--dest", owner, "--object-path", "/org/freedesktop/Notifications", "--method"];
    const capability = await this.run("gdbus", [...base, "org.freedesktop.Notifications.GetCapabilities"], lifetime);
    if (!lifetime.valid() || capability.code !== 0 || !/'sound'/.test(capability.output)) { this.record("notificationSilence"); return "not-submitted"; }
    const plainBody = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const response = await this.run("gdbus", [...base, "org.freedesktop.Notifications.Notify", "--", "pi-cue", "0", "", gvariant(title), gvariant(plainBody), "[]", "{'suppress-sound': <true>}", "-1"], lifetime);
    if (!response.started) return "not-submitted";
    return response.code === 0 && !response.stopped && /uint32\s+\d+/.test(response.output) ? "submitted" : "unknown";
  }

  async sound(settings: Settings, file: string | undefined, lifetime: Lifetime): Promise<void> {
    if (!lifetime.valid() || this.environment.SSH_CONNECTION || this.environment.SSH_TTY) return;
    const preset = String(settings.soundPreset);
    let selected = file;
    let fallbackUsed = false;
    if (preset !== "system") {
      try {
        if (preset === "file") { if (!selected) throw new CueError("wavMissing"); await checkSoundFile(selected); }
        else {
          const name = presets.find((item) => item.id === preset)?.file;
          if (!name) throw new CueError("wavMissing");
          selected = await checkSoundAsset(name);
        }
      } catch {
        this.record("soundFallback"); fallbackUsed = true;
        try { selected = await checkSoundAsset("soft.wav"); }
        catch { this.record("soundResult", { result: "not-started" }); return; }
      }
    }
    if (!lifetime.valid()) return;
    let result = await this.play(preset === "system" ? undefined : selected, lifetime);
    if (result === "not-started" && !fallbackUsed && lifetime.valid()) {
      try { const fallback = await checkSoundAsset("soft.wav"); if (lifetime.valid()) result = await this.play(fallback, lifetime); }
      catch {}
    }
    this.record("soundResult", { result });
  }

  private async play(file: string | undefined, lifetime: Lifetime): Promise<"played" | "not-started" | "unknown"> {
    let result: ProcessResult;
    if (this.platform === "macos") result = await this.run("afplay", [file ?? "/System/Library/Sounds/Glass.aiff"], lifetime, undefined, 15000);
    else if (this.platform === "windows" || this.platform === "wsl") {
      const [helper, soundPath] = await Promise.all([readFile(script("sound-windows.ps1"), "utf8"), file ? this.hostPath(file, lifetime) : Promise.resolve(undefined)]);
      if ((file && !soundPath) || !lifetime.valid()) return "not-started";
      result = await this.run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(helper, "utf16le").toString("base64")], lifetime, JSON.stringify({ system: !file, path: soundPath }), 15000);
      if (result.output.trim() === "not-started" && !result.stopped) return "not-started";
      if (result.output.trim() === "played") return "played";
    } else if (this.platform === "linux") {
      result = file ? await this.run("paplay", [file], lifetime, undefined, 15000) : await this.run("canberra-gtk-play", ["-i", "complete"], lifetime, undefined, 15000);
      if (!result.started && file && lifetime.valid()) result = await this.run("aplay", ["-q", file], lifetime, undefined, 15000);
    } else return "not-started";
    return !result.started ? "not-started" : result.code === 0 && !result.stopped ? "played" : "unknown";
  }
}
