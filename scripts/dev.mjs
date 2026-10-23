import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directories = Object.fromEntries(["pi-agent", "sessions", "tmp", "node-cache", "npm-cache", "cache", "workspace"].map((name) => [name, resolve(root, ".dev", name)]));
for (const directory of Object.values(directories)) mkdirSync(directory, { recursive: true });
const child = spawn(process.execPath, [resolve(root, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"), "-ne", "-e", resolve(root, "index.ts"), "-ns", "-np", "--no-themes", "--no-mcp", "-nc", "--session-dir", directories.sessions, ...process.argv.slice(2)], {
  cwd: directories.workspace,
  stdio: "inherit",
  env: { ...process.env, PI_CODING_AGENT_DIR: directories["pi-agent"], PI_CODING_AGENT_SESSION_DIR: directories.sessions, TMPDIR: directories.tmp, TMP: directories.tmp, TEMP: directories.tmp, XDG_CACHE_HOME: directories.cache, NODE_COMPILE_CACHE: directories["node-cache"], npm_config_cache: directories["npm-cache"], npm_config_update_notifier: "false", JITI_FS_CACHE: "false", PI_TELEMETRY: "0", PI_OFFLINE: "1" },
});
child.on("exit", (code) => { process.exitCode = code ?? 1; });
