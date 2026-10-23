import { templates, type Settings } from "./data.ts";
import { CueError } from "./messages.ts";

export function cleanText(value: string, limit = 4096): string {
  return [...value.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "").replace(/\r/g, "").replace(/\t/g, " ")].slice(0, limit).join("");
}

export function templateError(value: string): CueError | undefined {
  const tokens = value.match(/\{[^{}]*\}/g) ?? [];
  const unknown = tokens.find((token) => token !== "{session}" && token !== "{duration}");
  if (unknown) return new CueError("templatePlaceholder", { token: unknown });
  if (value.replace(/\{(?:session|duration)\}/g, "").match(/[{}]/)) return new CueError("templateBrace");
  return undefined;
}

export function renderTemplate(value: string, fields: { session?: string; duration?: string }, limit: number): string {
  return cleanText(value.replace(/\{(session|duration)\}/g, (_, key: "session" | "duration") => fields[key] ?? "—"), limit);
}

export function notificationText(settings: Settings, event: string, session: string, durationMs: number, background = false) {
  const language = templates.en;
  const duration = durationMs < 1000 ? `${Math.max(0, Math.round(durationMs))} ms` : `${(durationMs / 1000).toFixed(1)} s`;
  const fields = { session: session || "Pi", duration };
  const body = String(settings.notificationBody || language[event] || language.success);
  return {
    title: renderTemplate(String(settings.notificationTitle), fields, 128).replace(/\n/g, " "),
    body: renderTemplate(`${body}${background ? `\n${language.background}` : ""}`, fields, 1024),
  };
}
