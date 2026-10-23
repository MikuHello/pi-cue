import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { TUI } from "@earendil-works/pi-tui";
import { ConfigStore } from "../src/config.ts";
import { CuePanel } from "../src/panel.ts";

const root = resolve(`.dev/performance/component-ux-${Date.now()}`);
await mkdir(root, { recursive: true });
const store = new ConfigStore(resolve(root, "pi-cue.json"));
await store.load();
let renders = 0;
const panel = new CuePanel(store, { terminal: { rows: 24 }, requestRender: () => { renders++; } } as unknown as TUI, { changed: () => {}, notify: async () => "not-submitted", sound: async () => {}, diagnostics: () => [], close: () => {} });
const durations: number[] = [];
for (let index = 0; index < 2000; index++) {
  const start = performance.now();
  panel.handleInput(index % 5 ? "\x1b[B" : "\t");
  panel.render(80);
  durations.push(performance.now() - start);
}
durations.sort((a, b) => a - b);
const before = renders;
await new Promise((done) => setTimeout(done, 1000));
const report = { layer: "Two-column Pi component input plus render, plain theme and fake requestRender sink; excludes terminal paint", artifacts: root, samples: durations.length, p50Ms: durations[1000], p95Ms: durations[1900], maxMs: durations.at(-1), idleRenderRequestsOver1000Ms: renders - before };
panel.dispose();
await writeFile(resolve(root, "result.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
