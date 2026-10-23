import { Box, Editor, Input, SelectList, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type Focusable, type SelectListTheme, type TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigStore } from "./config.ts";
import { defaults, metadata, presets, readData, type Settings } from "./data.ts";
import { resolveSoundPath } from "./platform.ts";
import { cleanText, notificationText } from "./text.ts";
import type { Lifetime } from "./engine.ts";
import { describeError } from "./messages.ts";

type Locale = Record<string, unknown> & { labels: Record<string, string>; values: Record<string, string>; categories: Record<string, string>; help: Record<string, string>; categoryHelp: Record<string, string>; debugActions: Record<string, string> };
const locales = { en: readData<Locale>("locales/en"), "zh-CN": readData<Locale>("locales/zh-CN") };
type PanelActions = { changed(): void; notify(settings: Settings, lifetime: Lifetime): Promise<string>; sound(settings: Settings, lifetime: Lifetime, path: string): Promise<void>; diagnostics(): string[]; close(): void };
type Category = "general" | "notifications" | "sound" | "behavior" | "integrations" | "tests";
type Edit = { key: string; control: Input | Editor };
type PanelTheme = Pick<Theme, "fg" | "bg" | "getBgAnsi" | "bold">;
const plainTheme: PanelTheme = { fg: (_color, text) => text, bg: (_color, text) => text, getBgAnsi: () => "", bold: (text) => text };
const categories: Category[] = ["general", "notifications", "sound", "behavior", "integrations"];
const rows: Record<Category, string[]> = {
  general: ["enabled", "language", "reload", "reset"],
  notifications: ["nativeNotification", "backend", "notifyWhenFocused", "notifyWhenUnfocused", "notificationTitle", "notificationBody"],
  sound: ["soundEnabled", "soundPreset", "previewSound", "soundWhenFocused", "soundWhenUnfocused"],
  behavior: ["notifyOnError", "notifyOnAbort", "minWorkMs", "minAwayMs", "unknownFocusPolicy"],
  integrations: ["notifyOnAsk", "subagentNotifications", "subagentOnSuccess", "subagentOnFailure"],
  tests: ["testNotification", "previewSound", "previewText", "diagnostics"],
};

export class CuePanel implements Component, Focusable {
  private store: ConfigStore;
  private tui: TUI;
  private actions: PanelActions;
  private theme: PanelTheme;
  private surface: Box;
  private category: Category = "general";
  private view: "settings" | "debug";
  private positions = { ...Object.fromEntries(categories.map((category) => [category, 0])), tests: 0 } as Record<Category, number>;
  private pane: "categories" | "settings" = "settings";
  private edit?: Edit;
  private options?: { key: string; values: string[]; index: number };
  private confirm?: number;
  private detail?: { title: string; text: string; offset: number };
  private message = "";
  private messageKind: "success" | "error" | "muted" = "muted";
  private busy = false;
  private disposed = false;
  private previewController?: AbortController;
  private previewOperation: Promise<void> = Promise.resolve();
  private operations = new AbortController();
  private cached?: { width: number; height: number; lines: string[] };
  private _focused = false;

  constructor(store: ConfigStore, tui: TUI, actions: PanelActions, theme: PanelTheme = plainTheme, view: "settings" | "debug" = "settings") {
    this.store = store;
    this.tui = tui;
    this.actions = actions;
    this.theme = theme;
    this.view = view;
    if (view === "debug") this.category = "tests";
    this.surface = new Box(1, 1, (text) => this.theme.bg("customMessageBg", text.replace(/\x1b\[(?:0)?m/g, (reset) => reset + this.theme.getBgAnsi("customMessageBg"))));
    this.surface.addChild({ render: (width) => this.renderBody(width), invalidate: () => { this.cached = undefined; } });
  }

  get focused(): boolean { return this._focused; }
  set focused(value: boolean) { this._focused = value; if (this.edit) this.edit.control.focused = value; }
  private locale(): Locale { return locales[this.store.effective().language === "zh-CN" ? "zh-CN" : "en"]; }
  private text(key: string): string { return String(this.locale()[key] ?? key); }
  private label(key: string): string { return (this.view === "debug" ? this.locale().debugActions[key] : undefined) ?? this.locale().labels[key] ?? this.text(key); }
  private value(value: unknown): string { return typeof value === "boolean" ? this.text(value ? "on" : "off") : value === "" ? this.text("empty") : this.locale().values[String(value)] ?? cleanText(String(value)).replace(/\n/g, " ↵ "); }
  private soundName(id: string): string {
    if (id === "file") return this.text("customSound");
    const preset = presets.find((item) => item.id === id);
    return this.locale().values[id] ?? preset?.[this.store.effective().language === "zh-CN" ? "zh-CN" : "en"] ?? id;
  }
  private displayedValue(key: string): string {
    if (!Object.hasOwn(metadata, key)) return "";
    const value = this.store.effective()[key];
    if (key === "soundPreset") return this.soundName(String(value));
    if (key === "minWorkMs" || key === "minAwayMs") return value === 0 ? this.text("noMinimum") : String(value) + " ms";
    if (key === "notificationTitle" || key === "notificationBody") return this.text(value === defaults[key] ? "defaultText" : "customText");
    return this.value(value);
  }
  private listTheme(active: boolean, category = false): SelectListTheme {
    return {
      selectedPrefix: (text) => this.theme.fg(active ? "accent" : "customMessageText", text),
      selectedText: (text) => active ? this.theme.fg("accent", text) : category ? this.theme.bold(this.theme.fg("customMessageText", text.replace(/^→ /, "• "))) : text.replace(/^→ /, "  "),
      description: (text) => this.theme.fg("customMessageText", text),
      scrollInfo: (text) => this.theme.fg("customMessageText", text),
      noMatch: (text) => this.theme.fg("customMessageText", text),
    };
  }
  private list(items: Array<{ value: string; label: string }>, index: number, width: number, height: number, active: boolean, category = false): string[] {
    const visible = Math.max(1, Math.min(items.length, height - (items.length > height ? 1 : 0)));
    const list = new SelectList(items, visible, this.listTheme(active, category));
    list.setSelectedIndex(index);
    return list.render(width + 2).map((line) => truncateToWidth(line, width));
  }

  invalidate(): void { this.cached = undefined; this.edit?.control.invalidate(); this.surface.invalidate(); }
  refresh(): void { if (!this.disposed) { this.invalidate(); this.tui.requestRender(); } }
  private lifetime(): Lifetime { return { signal: this.operations.signal, valid: () => !this.disposed && !this.operations.signal.aborted }; }
  private feedback(message: string, kind: "success" | "error" | "muted" = "muted"): void { this.message = message; this.messageKind = kind; }
  private failure(): unknown { return this.store.lastSaveError || this.store.configuration.error; }
  private help(): string {
    if (this.view === "debug") return "";
    if (this.edit) return metadata[this.edit.key].type === "integer" ? this.text("durationHelp") : "";
    if (this.options || this.confirm !== undefined || this.detail) return "";
    return this.pane === "categories" ? this.locale().categoryHelp[this.category] ?? "" : this.locale().help[rows[this.category][this.positions[this.category]]] ?? "";
  }
  private showDetail(title: string, text: string): void { this.detail = { title, text, offset: 0 }; }
  render(width: number): string[] { return this.surface.render(width); }

  private renderBody(width: number): string[] {
    const height = Math.max(10, (this.tui.terminal.rows || 24) - 4);
    if (this.cached?.width === width && this.cached.height === height) return this.cached.lines;
    const failure = this.view === "settings" ? this.failure() : undefined;
    const status = this.busy ? this.text("saving") : this.message || (failure ? this.text("failed") + ": " + describeError(failure, String(this.store.effective().language)) : "");
    const statusColor = this.busy ? "customMessageText" : failure || this.messageKind === "error" ? "error" : this.messageKind === "muted" ? "customMessageText" : this.messageKind;
    const wrappedStatus = status && !this.detail ? wrapTextWithAnsi(status, width) : [];
    const statusLines = wrappedStatus.length > 2 ? [wrappedStatus[0], truncateToWidth(wrappedStatus.slice(1).join(" "), width)] : wrappedStatus;
    const hint = this.text(this.edit ? metadata[this.edit.key].multiline ? "multilineHint" : "editHint" : this.options ? this.options.key === "soundPreset" ? "soundHint" : "optionHint" : this.detail ? this.view === "debug" ? "debugDetailHint" : "detailHint" : this.confirm !== undefined ? "confirmHint" : this.view === "debug" ? "debugHint" : "menuHint");
    const title = this.edit ? this.label(this.edit.key) : this.detail?.title ?? (this.confirm !== undefined ? this.text("confirmReset") : this.text(this.view === "debug" ? "debugTitle" : "panelTitle"));
    const footer = wrapTextWithAnsi(hint, width);
    const help = !this.busy && (this.edit?.control instanceof Input || !failure && this.messageKind !== "error" && statusLines.length < 2) ? this.help() : "";
    const wrappedHelp = help ? wrapTextWithAnsi(help, width) : [];
    const helpLines = wrappedHelp.length > 2 ? [wrappedHelp[0], truncateToWidth(wrappedHelp.slice(1).join(" "), width)] : wrappedHelp;
    const contentHeight = height - 2 - statusLines.length - helpLines.length - footer.length;
    const leftWidth = width < 60 ? 11 : 16;
    const rightWidth = this.view === "debug" ? width : Math.max(8, width - leftWidth - 3);
    const left = this.view === "debug" ? [] : this.list(categories.map((value) => ({ value, label: this.locale().categories[value] })), categories.indexOf(this.category), leftWidth, Math.max(1, contentHeight), this.pane === "categories", true);
    let right: string[];
    if (this.edit) right = this.edit.control.render(rightWidth);
    else if (this.options) {
      const saved = String(this.store.effective()[this.options.key]);
      right = this.list(this.options.values.map((value) => ({ value, label: (value === saved ? "✓ " : "  ") + (this.options!.key === "soundPreset" ? this.soundName(value) : this.value(value)) })), this.options.index, rightWidth, contentHeight, this.pane === "settings");
    } else if (this.confirm !== undefined) right = this.list(["cancel", "reset"].map((value) => ({ value, label: this.text(value) })), this.confirm, rightWidth, contentHeight, this.pane === "settings");
    else if (this.detail) {
      const wrapped = cleanText(this.detail.text).split("\n").flatMap((line) => wrapTextWithAnsi(line, rightWidth));
      this.detail.offset = Math.min(this.detail.offset, Math.max(0, wrapped.length - contentHeight));
      right = wrapped.slice(this.detail.offset, this.detail.offset + contentHeight);
    } else {
      const contentWidth = rightWidth - 2;
      const items = rows[this.category].map((key) => {
        const value = this.displayedValue(key);
        const label = this.label(key);
        const valueWidth = Math.min(visibleWidth(value), Math.max(1, contentWidth - 8));
        const remaining = Math.max(1, contentWidth - valueWidth - (value ? 2 : 0));
        const name = truncateToWidth(label, remaining);
        const valueColumn = rightWidth >= 40 ? Math.min(22, remaining + 2) : contentWidth - valueWidth;
        return { value: key, label: value ? name + " ".repeat(Math.max(2, valueColumn - visibleWidth(name))) + truncateToWidth(value, valueWidth) : name };
      });
      right = this.list(items, this.positions[this.category], rightWidth, contentHeight, this.pane === "settings");
    }
    const grid: string[] = [];
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      const first = truncateToWidth(left[index] ?? "", leftWidth);
      grid.push(this.view === "debug" ? right[index] ?? "" : first + " ".repeat(Math.max(0, leftWidth - visibleWidth(first))) + this.theme.fg("borderMuted", " │ ") + (right[index] ?? ""));
    }
    const lines = [this.theme.bold(this.theme.fg("accent", truncateToWidth(title, width))), "", ...grid, ...statusLines.map((line) => this.theme.fg(statusColor, line)), ...helpLines.map((line) => this.theme.fg("customMessageText", line)), ...footer.map((line) => this.theme.fg("customMessageText", line))];
    const safe = lines.map((line) => truncateToWidth(line.replace(/\t/g, " "), width));
    this.cached = { width, height, lines: safe };
    return safe;
  }

  handleInput(data: string): void {
    if (this.disposed) return;
    if (this.edit) {
      if (matchesKey(data, "escape")) { this.edit = undefined; this.feedback(this.text("cancelled")); }
      else if (!this.busy) {
        if (this.edit.control instanceof Editor && matchesKey(data, "ctrl+s")) this.saveEdit(this.edit.control.getText());
        else if (this.edit.control instanceof Editor && matchesKey(data, "enter")) this.edit.control.handleInput("\n");
        else this.edit.control.handleInput(data);
      }
      this.refresh(); return;
    }
    if (matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
      if (this.view === "settings") this.pane = matchesKey(data, "left") ? "categories" : matchesKey(data, "right") ? "settings" : this.pane === "settings" ? "categories" : "settings";
      this.refresh(); return;
    }
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      if (this.options || this.confirm !== undefined || this.detail) {
        this.options = undefined; this.confirm = undefined; this.detail = undefined; this.pane = "settings"; this.message = "";
      } else this.close();
      this.refresh(); return;
    }
    if (this.busy) return;
    const direction = matchesKey(data, "up") ? -1 : matchesKey(data, "down") ? 1 : 0;
    const confirm = matchesKey(data, "enter") || matchesKey(data, "space");
    if (this.pane === "categories") {
      if (direction) {
        const next = categories[(categories.indexOf(this.category) + direction + categories.length) % categories.length];
        if (next !== this.category) { this.category = next; this.options = undefined; this.confirm = undefined; this.detail = undefined; this.message = ""; }
      } else if (confirm) this.pane = "settings";
    } else if (this.options) {
      if (direction) this.options.index = (this.options.index + direction + this.options.values.length) % this.options.values.length;
      else if (confirm) {
        const { key, values, index } = this.options;
        void this.change(async () => { await this.store.save(key, values[index]); this.options = undefined; });
      } else if (matchesKey(data, "p") && this.options.key === "soundPreset") this.preview({ ...this.store.effective(), soundPreset: this.options.values[this.options.index] });
    } else if (this.confirm !== undefined) {
      if (direction) this.confirm = this.confirm === 0 ? 1 : 0;
      else if (confirm) {
        const reset = this.confirm === 1; this.confirm = undefined;
        if (reset) void this.change(() => this.store.reset(), "resetDone");
      }
    } else if (this.detail) {
      if (confirm) this.detail = undefined;
      else if (direction) this.detail.offset = Math.max(0, this.detail.offset + direction);
      else if (matchesKey(data, "pageDown")) this.detail.offset += 10;
      else if (matchesKey(data, "pageUp")) this.detail.offset = Math.max(0, this.detail.offset - 10);
    } else {
      const items = rows[this.category];
      if (direction) this.positions[this.category] = (this.positions[this.category] + direction + items.length) % items.length;
      else if (confirm) this.activate(items[this.positions[this.category]]);
      else if (matchesKey(data, "d") && this.failure()) this.showDetail(this.text("failed"), describeError(this.failure(), String(this.store.effective().language)));
    }
    this.refresh();
  }

  private activate(key: string): void {
    const item = metadata[key];
    if (item) {
      const value = this.store.effective()[key];
      if (item.type === "boolean") { void this.change(() => this.store.save(key, !value)); return; }
      if (item.enum) {
        const values = key === "soundPreset" ? item.enum.filter((id) => id !== "file" || !!this.store.effective().soundFile) : item.enum;
        this.options = { key, values, index: Math.max(0, values.indexOf(String(value))) };
      } else {
        const control = item.multiline ? new Editor(this.tui, { borderColor: (text) => this.theme.fg("borderMuted", text), selectList: this.listTheme(true) }) : new Input();
        control.focused = this.focused;
        if (control instanceof Editor) { control.setText(String(value)); control.disableSubmit = true; }
        else { control.setValue(String(value)); control.onSubmit = (text) => this.saveEdit(text); }
        this.edit = { key, control };
      }
      this.message = "";
      return;
    }
    if (key === "previewSound") this.preview(this.store.effective());
    if (key === "previewText") this.showDetail(this.label(key), ["success", "failure", "abort", "ask", "subagentSuccess", "subagentFailure"].map((kind) => {
      const result = notificationText(this.store.effective(), kind, this.text("exampleSession"), 12345);
      return this.text("event." + kind) + ": " + result.title + "\n" + result.body;
    }).join("\n\n"));
    if (key === "diagnostics") this.showDetail(this.label(key), [this.text("markerUnavailable"), this.text("headlessInfo"), ...this.actions.diagnostics()].join("\n\n"));
    if (key === "reset") this.confirm = 0;
    if (key === "reload") void this.change(() => this.store.load(), "reloaded");
    if (key === "testNotification") void this.testNotification();
  }

  private saveEdit(value: string): void {
    if (!this.edit) return;
    const key = this.edit.key;
    void this.change(async () => {
      await this.store.save(key, metadata[key].type === "integer" ? (/^\d+$/.test(value) ? Number(value) : NaN) : value);
      this.edit = undefined;
    });
  }
  private async change(operation: () => Promise<void>, successKey = "saved"): Promise<void> {
    this.busy = true; this.message = ""; this.refresh();
    try {
      await operation();
      this.actions.changed();
      if (!this.disposed) this.feedback(this.text(successKey), "success");
    } catch (error) { this.feedback(this.text("failed") + ": " + describeError(error, String(this.store.effective().language)), "error"); }
    finally { this.busy = false; this.refresh(); }
  }
  private preview(settings: Settings): void {
    this.previewController?.abort();
    const controller = new AbortController();
    this.previewController = controller;
    const lifetime = { signal: AbortSignal.any([controller.signal, this.operations.signal]), valid: () => !this.disposed && !controller.signal.aborted };
    const path = resolveSoundPath(this.store, String(settings.soundFile));
    this.previewOperation = this.previewOperation.catch(() => {}).then(async () => {
      if (!lifetime.valid()) return;
      try { await this.actions.sound(settings, lifetime, path); if (lifetime.valid()) this.feedback(this.text("previewed"), "success"); }
      catch { if (lifetime.valid()) this.feedback(this.text("unsupported"), "error"); }
      this.refresh();
    });
  }
  private async testNotification(): Promise<void> {
    try {
      const result = await this.actions.notify(this.store.effective(), this.lifetime());
      if (!this.disposed) this.feedback(this.text(result === "submitted" ? "notificationSubmitted" : result === "not-submitted" ? "notificationNotSubmitted" : "notificationUnknown"), "muted");
    } catch { this.feedback(this.text("unsupported"), "error"); }
    this.refresh();
  }
  private close(): void { this.dispose(); this.actions.close(); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.operations.abort(); this.previewController?.abort();
    this.cached = undefined; this.edit = undefined; this.options = undefined; this.detail = undefined;
    this.surface.clear();
  }
}
