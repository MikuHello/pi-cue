import { StdinBuffer } from "@earendil-works/pi-tui";
import type { EventEmitter } from "node:events";
import type { Focus } from "./engine.ts";

export function observeFocus(onFocus: (value: Focus) => void, input: Pick<EventEmitter, "prependListener" | "removeListener"> = process.stdin): () => void {
  const buffer = new StdinBuffer();
  buffer.on("data", (sequence) => {
    if (sequence === "\x1b[I") onFocus("focused");
    if (sequence === "\x1b[O") onFocus("unfocused");
  });
  const receive = (data: string | Buffer) => { buffer.process(data); };
  input.prependListener("data", receive);
  return () => { input.removeListener("data", receive); buffer.destroy(); };
}
