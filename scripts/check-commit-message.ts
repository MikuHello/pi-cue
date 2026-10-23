import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const types = new Set(["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"]);
const gitmoji = new Set("🎨 ⚡ 🔥 🐛 🚑 ✨ 📝 🚀 💄 🎉 ✅ 🔒 🔐 🔖 🚨 🚧 💚 ⬇ ⬆ 📌 👷 📈 ♻ ➕ ➖ 🔧 🔨 🌐 ✏ 💩 ⏪ 🔀 📦 👽 🚚 📄 💥 🍱 ♿ 💡 🍻 💬 🗃 🔊 🔇 👥 🚸 🏗 📱 🤡 🥚 🙈 📸 ⚗ 🔍 🏷 🌱 🚩 🥅 💫 🗑 🛂 🩹 🧐 ⚰ 🧪 👔 🩺 🧱 🧑‍💻 💸 🧵 🦺 ✈ 🦖".split(" "));

export function commitMessageError(message: string): string | undefined {
  const normalized = message.replace(/\r\n/g, "\n").trim();
  const subject = normalized.split("\n")[0];
  if (!subject) return "A commit subject is required.";
  if ([...subject].length > 100) return "Keep the subject within 100 Unicode code points.";
  const match = /^([a-z]+)(?:\(([a-z0-9][a-z0-9._/-]*)\))?(!)?: ([^\s]+) (\S.*)$/.exec(subject);
  if (!match) return "Use type(scope)!: emoji summary; scope and ! are optional.";
  if (!types.has(match[1])) return "Use a project commit type listed in CONTRIBUTING.md.";
  const emoji = match[4].replace(/\uFE0F/g, "");
  if (!gitmoji.has(emoji)) return "Use one Unicode Gitmoji from gitmoji.dev, not a shortcode.";
  if (/[\t\x00-\x1f\x7f]/.test(subject)) return "Use plain text without control characters in the subject.";
  if (emoji === "💥" && !match[3] && !/^BREAKING(?: |-)CHANGE: \S.*$/m.test(normalized)) return "A breaking-change emoji also needs ! or a BREAKING CHANGE: footer.";
  return undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) {
    console.error("Usage: node scripts/check-commit-message.ts <message-file>");
    process.exitCode = 2;
  } else {
    try {
      const error = commitMessageError(readFileSync(process.argv[2], "utf8"));
      if (error) { console.error(error); process.exitCode = 1; }
      else console.log("Commit message format is valid.");
    } catch { console.error("Could not read the commit message file."); process.exitCode = 2; }
  }
}
