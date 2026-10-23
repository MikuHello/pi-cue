import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { commitMessageError } from "../scripts/check-commit-message.ts";

test("project commit format accepts optional scope, Unicode Gitmoji and breaking markers", () => {
  for (const message of ["feat(panel): ✨ add sound previews", "docs: 📝 clarify setup", "refactor(engine): ♻️ separate cancellation", "chore(dev): 🧑‍💻 improve local setup", "feat(config)!: 💥 require an envelope", "feat(config): 💥 require an envelope\n\nBREAKING CHANGE: old files need migration", "fix: 🐛 repair playback\r\n\r\nDescribe the cause."]) assert.equal(commitMessageError(message), undefined, message);
});

test("project commit format rejects malformed, empty, unmarked breaking and non-Gitmoji subjects", () => {
  for (const message of ["", "✨ feat: add a cue", "feat: add a cue", "fix(cue): 🐛", "unknown: ✨ add a cue", "Feat: ✨ add a cue", "feat(sound preview): ✨ add a cue", "docs: :memo: explain setup", "chore: 🐈 add a cat", "feat: 💥 remove compatibility", "fix: 🐛 bad\tsummary", "docs: 📝 " + "a".repeat(100)]) assert.ok(commitMessageError(message), message);
});

test("standalone checker returns useful exit codes without needing a Git repository", async () => {
  await mkdir(resolve(".dev/tests"), { recursive: true });
  const directory = await mkdtemp(resolve(".dev/tests/commit-message-"));
  const file = join(directory, "message.txt");
  const script = resolve("scripts/check-commit-message.ts");
  await writeFile(file, "docs(readme): 📝 improve setup guide\n");
  assert.equal(spawnSync(process.execPath, [script, file]).status, 0);
  await writeFile(file, "not a valid subject\n");
  assert.equal(spawnSync(process.execPath, [script, file]).status, 1);
  assert.equal(spawnSync(process.execPath, [script, join(directory, "missing")]).status, 2);
  assert.equal(spawnSync(process.execPath, [script]).status, 2);
});
