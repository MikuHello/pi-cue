import { readData } from "./data.ts";

export type Message = { key: string; values: Record<string, string | number | boolean> };
const messages = readData<Record<string, Record<string, string>>>("messages");

export function messageText(message: Message, language = "en"): string {
  const template = messages[message.key]?.[language] ?? messages[message.key]?.en ?? message.key;
  return template.replace(/\{([^{}]+)\}/g, (_match, key: string) => {
    const value = String(message.values[key] ?? "—");
    return messages[`value.${value}`]?.[language] ?? value;
  });
}

export class CueError extends Error {
  readonly detail: Message;
  override readonly cause?: unknown;
  constructor(key: string, values: Message["values"] = {}, cause?: unknown) {
    const detail = { key, values };
    super(messageText({ key, values: { ...values, ...(cause ? { reason: describeError(cause) } : {}) } }));
    this.detail = detail;
    this.cause = cause;
  }
}

export function describeError(error: unknown, language = "en"): string {
  if (error instanceof CueError) return messageText({ key: error.detail.key, values: { ...error.detail.values, ...(error.cause ? { reason: describeError(error.cause, language) } : {}) } }, language);
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.name : "unknown";
  return messageText({ key: "filesystem", values: { code } }, language);
}
