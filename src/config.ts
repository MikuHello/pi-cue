import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { defaults, metadata, type Settings, type SettingValue } from "./data.ts";
import { templateError } from "./text.ts";
import { CueError } from "./messages.ts";

export type ConfigDocument = { schemaVersion: number; settings: Record<string, unknown>; [key: string]: unknown };
export type ConfigLayer = { path: string; document: ConfigDocument; fingerprint: string; error?: unknown };
const transactionKey = Symbol.for("pi-cue.configuration-transactions.v1");
type Transaction = { tail: Promise<void>; error?: unknown };
type TransactionRuntime = typeof globalThis & { [transactionKey]?: Map<string, Transaction> };
const runtime = globalThis as TransactionRuntime;
const transactions = runtime[transactionKey] ??= new Map<string, Transaction>();

function plain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateSetting(key: string, value: unknown): CueError | undefined {
  const item = metadata[key];
  if (!Object.hasOwn(metadata, key)) return new CueError("settingUnknown", { key });
  if (item.type === "integer" ? typeof value !== "number" || !Number.isSafeInteger(value) : typeof value !== item.type) return new CueError("settingType", { key, type: item.type });
  if (item.const !== undefined && value !== item.const) return new CueError("settingUnsupported", { key });
  if (typeof value === "number" && (value < (item.minimum ?? -Infinity) || value > (item.maximum ?? Infinity))) return new CueError("settingRange", { key });
  if (typeof value === "string") {
    if ([...value].length > (item.maxLength ?? Infinity)) return new CueError("settingLength", { key });
    if (item.enum && !item.enum.includes(value)) return new CueError("settingOption", { key });
    if (/[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(value) || (!item.multiline && /[\r\n]/.test(value))) return new CueError("settingControl", { key });
    if (item.template) return templateError(value);
  }
  return undefined;
}

export function parseConfig(raw: string): ConfigDocument {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new CueError("configJson"); }
  if (!plain(value) || value.schemaVersion !== 1 || !plain(value.settings)) throw new CueError("configEnvelope");
  for (const [key, candidate] of Object.entries(value.settings)) {
    if (Object.hasOwn(metadata, key)) {
      const error = validateSetting(key, candidate);
      if (error) throw error;
    }
  }
  return value as ConfigDocument;
}

function fingerprint(raw: string | undefined): string {
  return raw === undefined ? "missing" : createHash("sha256").update(raw).digest("hex");
}

async function readRaw(path: string): Promise<string | undefined> {
  try {
    const status = await lstat(path);
    if (!status.isFile() || status.isSymbolicLink() || status.size > 262144) throw new CueError("configFile");
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function loadLayer(path: string): Promise<ConfigLayer> {
  let raw: string | undefined;
  try {
    raw = await readRaw(path);
    return { path, document: raw === undefined ? { schemaVersion: 1, settings: {} } : parseConfig(raw), fingerprint: fingerprint(raw) };
  } catch (error) {
    return { path, document: { schemaVersion: 1, settings: {} }, fingerprint: fingerprint(raw), error };
  }
}

export class ConfigStore {
  configuration: ConfigLayer;
  private transaction: Transaction;
  private get queue(): Promise<void> { return this.transaction.tail; }
  private set queue(value: Promise<void>) { this.transaction.tail = value; }
  get lastSaveError(): unknown { return this.transaction.error; }

  constructor(path: string) {
    const key = path;
    const pending: Promise<void>[] = [];
    if (!transactions.has(key)) {
      for (const [legacyKey, transaction] of transactions) {
        try {
          const paths: unknown = JSON.parse(legacyKey);
          if (Array.isArray(paths) && paths.length === 2 && paths[0] === path) pending.push(transaction.tail.catch(() => {}));
        } catch {}
      }
    }
    this.transaction = transactions.get(key) ?? { tail: Promise.all(pending).then(() => {}) };
    transactions.set(key, this.transaction);
    this.configuration = { path, document: { schemaVersion: 1, settings: {} }, fingerprint: "missing" };
  }

  load(): Promise<void> {
    const task = this.queue.then(async () => {
      this.configuration = await loadLayer(this.configuration.path);
    });
    this.queue = task.catch(() => {});
    return task;
  }

  effective(): Settings {
    const result = { ...defaults };
    for (const [key, value] of Object.entries(this.configuration.document.settings)) if (Object.hasOwn(metadata, key)) result[key] = value as SettingValue;
    return result;
  }

  save(key: string, value: unknown, validate?: () => Promise<void>): Promise<void> {
    const error = validateSetting(key, value);
    if (error) { this.transaction.error = error; return Promise.reject(error); }
    return this.enqueue((document) => ({ ...document, settings: { ...document.settings, [key]: value } }), validate);
  }

  reset(): Promise<void> {
    return this.enqueue((document) => ({ ...document, settings: Object.fromEntries(Object.entries(document.settings).filter(([key]) => !Object.hasOwn(metadata, key))) }));
  }

  private enqueue(update: (document: ConfigDocument) => ConfigDocument, validate?: () => Promise<void>): Promise<void> {
    const task = this.queue.then(async () => { await validate?.(); await this.write(update); });
    this.queue = task.then(() => { this.transaction.error = undefined; }, (error) => { this.transaction.error = error; });
    return task;
  }

  private async write(update: (document: ConfigDocument) => ConfigDocument): Promise<void> {
    const layer = this.configuration;
    if (layer.error) throw new CueError("configProtected", {}, layer.error);
    const lock = `${layer.path}.lock`;
    const temporary = `${layer.path}.${randomUUID()}.tmp`;
    await mkdir(dirname(layer.path), { recursive: true });
    try {
      await mkdir(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new CueError("configBusy");
      throw error;
    }
    try {
      const current = await readRaw(layer.path);
      if (fingerprint(current) !== layer.fingerprint) throw new CueError("configConflict");
      const document = update(current === undefined ? { schemaVersion: 1, settings: {} } : parseConfig(current));
      const raw = `${JSON.stringify(document, null, 2)}\n`;
      if (Buffer.byteLength(raw) > 262144) throw new CueError("configSize");
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(raw);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, layer.path);
      this.configuration = { path: layer.path, document, fingerprint: fingerprint(raw) };
    } finally {
      await rm(temporary, { force: true });
      await rm(lock, { recursive: true, force: true });
    }
  }
}
