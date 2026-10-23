import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", (_event, context) => {
    setTimeout(() => {
      const cpu = process.cpuUsage();
      const started = performance.now();
      setTimeout(() => {
        const elapsedMs = performance.now() - started;
        const usage = process.cpuUsage(cpu);
        writeFileSync(join(process.env.PI_CUE_PROBE_DIR!, "idle.json"), JSON.stringify({ mode: context.mode, elapsedMs, userCpuMs: usage.user / 1000, systemCpuMs: usage.system / 1000, rssBytes: process.memoryUsage().rss, resources: process.getActiveResourcesInfo(), stdinDataListeners: process.stdin.listenerCount("data") }));
        context.shutdown();
      }, 1000);
    }, 300);
  });
}
