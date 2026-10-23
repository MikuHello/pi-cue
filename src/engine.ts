import type { Settings } from "./data.ts";

export type Focus = "focused" | "unfocused" | "unknown";
export type Result = "success" | "failure" | "abort";
export type Cue = { kind: string; durationMs: number; background: boolean };
export type Lifetime = { signal: AbortSignal; valid(): boolean };
export type Channels = {
  notify(cue: Cue, lifetime: Lifetime): Promise<void>;
  sound(lifetime: Lifetime): Promise<void>;
  marker(value: "ask" | "completion" | "none"): void;
  diagnostic(message: string): void;
};
export type Clock = { now(): number; delay(callback: () => void, milliseconds: number): unknown; cancel(handle: unknown): void };
export const systemClock: Clock = { now: () => performance.now(), delay: (callback, milliseconds) => setTimeout(callback, milliseconds), cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
type Pending = { handle: unknown; callback(): void };
type Ask = { notified: boolean; visible: boolean; controller: AbortController; pending?: Pending; ticket?: Ticket };
type Ticket = { controller: AbortController; allowed(): boolean };

export class CueEngine {
  observedFocus: Focus = "unknown";
  private settings: Settings;
  private active = true;
  private generation = 0;
  private controller = new AbortController();
  private pending = new Set<Pending>();
  private tickets = new Set<Ticket>();
  private startedAt: number | undefined;
  private awaySince: number | undefined;
  private result: Result = "success";
  private completion?: Ticket;
  private asks = new Map<string, Ask>();
  private background = new Set<string>();
  private channels: Channels;
  private clock: Clock;

  constructor(settings: Settings, channels: Channels, clock: Clock = systemClock) {
    this.settings = settings;
    this.channels = channels;
    this.clock = clock;
    this.awaySince = this.effectiveFocus() === "unfocused" ? clock.now() : undefined;
  }

  effectiveFocus(): Focus | "silent" {
    return this.observedFocus === "unknown" ? this.settings.unknownFocusPolicy as "unfocused" | "focused" | "silent" : this.observedFocus;
  }

  snapshot() {
    return { observedFocus: this.observedFocus, effectiveFocus: this.effectiveFocus(), awayMs: this.awaySince === undefined ? 0 : this.clock.now() - this.awaySince, waiting: this.asks.size, background: this.background.size, running: this.startedAt !== undefined, pending: this.pending.size };
  }

  configure(settings: Settings): void {
    const previous = this.effectiveFocus();
    const previousSettings = this.settings;
    this.settings = settings;
    const current = this.effectiveFocus();
    if (current !== previous) this.awaySince = current === "unfocused" ? this.clock.now() : undefined;
    if (!settings.enabled || current === "focused" && previous !== "focused" || current === "silent") this.cancelPending();
    for (const ticket of this.tickets) if (!ticket.allowed()) ticket.controller.abort();
    if (this.completion && !this.completion.allowed()) this.completion.controller.abort();
    if (!settings.enabled || !settings.markerEnabled || !settings.markWhenUnfocused) this.completion = undefined;
    if (current === "focused" && settings.clearOnFocus) this.completion = undefined;
    for (const ask of this.asks.values()) {
      if (!settings.notifyOnAsk || !settings.enabled) {
        ask.visible = false;
        if (previousSettings.notifyOnAsk && previousSettings.enabled) ask.notified = true;
        ask.controller.abort();
        if (ask.ticket) { ask.ticket.controller.abort(); this.tickets.delete(ask.ticket); ask.ticket = undefined; }
        if (ask.pending) this.cancelTimer(ask.pending);
        ask.pending = undefined;
      } else if (ask.controller.signal.aborted) ask.controller = new AbortController();
      if (current === "focused" || current === "silent") ask.visible = false;
    }
    if (previousSettings.minAwayMs !== settings.minAwayMs && current === "unfocused") {
      for (const timer of [...this.pending]) {
        this.cancelTimer(timer);
        this.reschedule(timer);
      }
    }
    if (settings.enabled && settings.notifyOnAsk && current === "unfocused") for (const [id, ask] of this.asks) this.scheduleAsk(id, ask);
    this.updateMarker();
  }

  focus(value: Focus): void {
    if (!this.active) return;
    const previous = this.effectiveFocus();
    this.observedFocus = value;
    const current = this.effectiveFocus();
    if (current !== previous) this.awaySince = current === "unfocused" ? this.clock.now() : undefined;
    if (current === "focused" || current === "silent") {
      this.cancelPending();
      if (current === "focused" && this.settings.clearOnFocus) this.completion = undefined;
      for (const ask of this.asks.values()) ask.visible = false;
    } else {
      for (const [id, ask] of this.asks) this.scheduleAsk(id, ask);
    }
    this.updateMarker();
  }

  start(): void {
    if (!this.active) return;
    if (this.startedAt !== undefined) return;
    this.cancelPending();
    this.startedAt = this.clock.now();
    this.result = "success";
    if (this.settings.clearOnStart) this.completion = undefined;
    this.updateMarker();
  }

  end(result: Result): void {
    if (this.startedAt !== undefined) this.result = result;
  }

  settled(aborted = false): void {
    if (!this.active || this.startedAt === undefined) return;
    const durationMs = this.clock.now() - this.startedAt;
    this.startedAt = undefined;
    const result = aborted ? "abort" : this.result;
    if ((result === "failure" && !this.settings.notifyOnError) || (result === "abort" && !this.settings.notifyOnAbort)) return;
    this.complete({ kind: result, durationMs, background: this.background.size > 0 });
  }

  subagentStarted(runId: string): void {
    this.background.add(runId);
  }

  subagentRemoved(runId: string): void { this.background.delete(runId); }

  subagentCompleted(runId: string, result: "success" | "failure", durationMs: number): void {
    this.background.delete(runId);
    if (!this.settings.subagentNotifications || (result === "success" ? !this.settings.subagentOnSuccess : !this.settings.subagentOnFailure)) return;
    this.complete({ kind: result === "success" ? "subagentSuccess" : "subagentFailure", durationMs, background: false });
  }

  ask(id: string, waiting: boolean): void {
    if (!this.active) return;
    if (!waiting) {
      const previous = this.asks.get(id);
      if (previous?.pending !== undefined) this.cancelTimer(previous.pending);
      previous?.controller.abort();
      if (previous?.ticket) { previous.ticket.controller.abort(); this.tickets.delete(previous.ticket); }
      this.asks.delete(id);
    } else if (!this.asks.has(id)) {
      const ask = { notified: false, visible: false, controller: new AbortController() };
      this.asks.set(id, ask);
      this.scheduleAsk(id, ask);
    }
    this.updateMarker();
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.cancelPending();
    this.asks.clear();
    this.background.clear();
    this.completion = undefined;
    this.channels.marker("none");
  }

  private lifetime(ticket?: Ticket, ask?: Ask): Lifetime {
    const generation = this.generation;
    const signal = AbortSignal.any([this.controller.signal, ...(ticket ? [ticket.controller.signal] : []), ...(ask ? [ask.controller.signal] : [])]);
    return { signal, valid: () => this.active && !!this.settings.enabled && this.generation === generation && !signal.aborted && (!ticket || ticket.allowed()) && (!ask || !!this.settings.notifyOnAsk && [...this.asks.values()].includes(ask)) };
  }

  private launch(operation: Promise<void>): void {
    void operation.catch(() => this.channels.diagnostic("channelFailure"));
  }

  private ticket(allowed: () => boolean): Ticket | undefined {
    if (!allowed()) return undefined;
    const ticket = { controller: new AbortController(), allowed };
    this.tickets.add(ticket);
    return ticket;
  }

  private notify(cue: Cue, ticket: Ticket | undefined, ask?: Ask): void {
    if (!ticket) return;
    const lifetime = this.lifetime(ticket, ask);
    if (!lifetime.valid()) { this.tickets.delete(ticket); return; }
    this.launch(this.channels.notify(cue, lifetime).finally(() => this.tickets.delete(ticket)));
  }

  private sound(ticket: Ticket | undefined): void {
    if (!ticket) return;
    const lifetime = this.lifetime(ticket);
    if (!lifetime.valid()) { this.tickets.delete(ticket); return; }
    this.launch(this.channels.sound(lifetime).finally(() => this.tickets.delete(ticket)));
  }

  private eligible(cue: Cue): boolean {
    if (!this.settings.enabled || cue.durationMs < Number(this.settings.minWorkMs)) return false;
    if (cue.kind === "failure") return !!this.settings.notifyOnError;
    if (cue.kind === "abort") return !!this.settings.notifyOnAbort;
    if (cue.kind === "subagentSuccess") return !!this.settings.subagentNotifications && !!this.settings.subagentOnSuccess;
    if (cue.kind === "subagentFailure") return !!this.settings.subagentNotifications && !!this.settings.subagentOnFailure;
    return true;
  }

  private complete(cue: Cue): void {
    if (!this.active || !this.settings.enabled || cue.durationMs < Number(this.settings.minWorkMs)) return;
    const focus = this.effectiveFocus();
    if (focus === "silent") return;
    const focused = focus === "focused";
    const notification = this.ticket(() => this.eligible(cue) && !!this.settings.nativeNotification && !!this.settings[focused ? "notifyWhenFocused" : "notifyWhenUnfocused"]);
    const marker = this.ticket(() => this.eligible(cue) && !focused && !!this.settings.markerEnabled && !!this.settings.markWhenUnfocused);
    this.sound(this.ticket(() => this.eligible(cue) && !!this.settings.soundEnabled && !!this.settings[focused ? "soundWhenFocused" : "soundWhenUnfocused"]));
    const send = () => {
      this.notify(cue, notification);
      if (marker && this.lifetime(marker).valid()) this.completion = marker;
      if (marker) this.tickets.delete(marker);
      this.updateMarker();
    };
    if (focused) send();
    else this.whenAway(send);
  }

  private scheduleAsk(id: string, ask: Ask): void {
    if (!this.settings.enabled || !this.settings.notifyOnAsk || this.effectiveFocus() !== "unfocused" || ask.pending !== undefined) return;
    const notification = !ask.notified ? this.ticket(() => !!this.settings.enabled && !!this.settings.notifyOnAsk && !!this.settings.nativeNotification && this.asks.get(id) === ask) : undefined;
    if (notification) ask.ticket = notification;
    ask.pending = this.whenAway(() => {
      ask.pending = undefined;
      if (!this.asks.has(id) || !this.settings.notifyOnAsk) return;
      ask.visible = true;
      if (!ask.notified) {
        ask.notified = true;
        this.notify({ kind: "ask", durationMs: 0, background: false }, notification, ask);
      }
      this.updateMarker();
    });
  }

  private whenAway(callback: () => void): Pending | undefined {
    const pending: Pending = { handle: undefined, callback };
    return this.reschedule(pending);
  }

  private reschedule(pending: Pending): Pending | undefined {
    const lifetime = this.lifetime();
    const remaining = Math.max(0, Number(this.settings.minAwayMs) - (this.clock.now() - (this.awaySince ?? this.clock.now())));
    if (!remaining) {
      if (lifetime.valid() && this.effectiveFocus() === "unfocused") pending.callback();
      return undefined;
    }
    pending.handle = this.clock.delay(() => {
      this.pending.delete(pending);
      if (lifetime.valid() && this.effectiveFocus() === "unfocused") pending.callback();
    }, remaining);
    this.pending.add(pending);
    return pending;
  }

  private cancelTimer(pending: Pending): void {
    this.clock.cancel(pending.handle);
    this.pending.delete(pending);
  }

  private cancelPending(): void {
    this.generation++;
    this.controller.abort();
    this.controller = new AbortController();
    for (const pending of this.pending) this.clock.cancel(pending.handle);
    this.pending.clear();
    for (const ticket of this.tickets) ticket.controller.abort();
    this.tickets.clear();
    for (const ask of this.asks.values()) ask.pending = undefined;
  }

  private updateMarker(): void {
    const enabled = this.active && this.settings.enabled && this.settings.markerEnabled;
    this.channels.marker(!enabled ? "none" : [...this.asks.values()].some((ask) => ask.visible) ? "ask" : this.completion && this.completion.allowed() && !this.completion.controller.signal.aborted ? "completion" : "none");
  }
}
