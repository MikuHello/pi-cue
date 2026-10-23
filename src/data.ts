import { readFileSync } from "node:fs";

export type SettingValue = string | number | boolean;
export type Settings = Record<string, SettingValue>;
export type Metadata = {
  type: "boolean" | "integer" | "string";
  default: SettingValue;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  enum?: string[];
  const?: SettingValue;
  template?: boolean;
  multiline?: boolean;
};

export function readData<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), "utf8")) as T;
}

export type SoundPreset = { id: string; file: string | null; en: string; "zh-CN": string; source: string; license: string; description: { en: string; "zh-CN": string } };

export function parsePresets(value: unknown): SoundPreset[] {
  if (!Array.isArray(value) || value.length > 128) throw new Error("Sound catalog must contain at most 128 named sounds");
  const ids = new Set<string>();
  const files = new Set<string>();
  const names = Object.fromEntries(["en", "zh-CN"].map((language) => [language, new Set([readData<{ customSound: string }>("locales/" + language).customSound.trim().normalize("NFKC").toLowerCase()])])) as Record<string, Set<string>>;
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !/^[a-z][a-z0-9-]{0,47}$/.test(item.id) || item.id === "file" || ids.has(item.id)) throw new Error("Sound catalog IDs must be unique lowercase names; file is reserved");
    ids.add(item.id);
    if (item.id === "system" ? item.file !== null : typeof item.file !== "string" || !/^[a-z0-9][a-z0-9-]*\.wav$/.test(item.file) || files.has(item.file)) throw new Error("Named sound files must be unique WAV filenames inside assets");
    if (item.file) files.add(item.file);
    for (const [key, limit] of [["en", 64], ["zh-CN", 64], ["source", 2048], ["license", 2048]] as const) {
      if (typeof item[key] !== "string" || !item[key].trim() || item[key].length > limit || /[\x00-\x1f\x7f-\x9f]/.test(item[key])) throw new Error("Named sounds require plain bilingual names, source and license records");
    }
    for (const language of ["en", "zh-CN"]) {
      const name = item[language].trim().normalize("NFKC").toLowerCase();
      if (names[language].has(name)) throw new Error("Sound names must be unique in " + language + "; the custom sound label is reserved");
      names[language].add(name);
    }
    if (!item.description || ["en", "zh-CN"].some((language) => typeof item.description[language] !== "string" || item.description[language].length > 160 || /[\x00-\x1f\x7f-\x9f]/.test(item.description[language]))) throw new Error("Named sounds require short bilingual descriptions");
  }
  if (!ids.has("system") || !value.some((item) => item.id === "soft" && item.file === "soft.wav")) throw new Error("Sound catalog must retain system and the soft.wav fallback");
  return value as SoundPreset[];
}

export const presets = parsePresets(readData<unknown>("presets"));
export const metadata = readData<Record<string, Metadata>>("settings");
metadata.soundPreset.enum = [...presets.map((preset) => preset.id), "file"];
export const defaults: Settings = Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, value.default]));
export const templates = readData<Record<string, Record<string, string>>>("templates");
