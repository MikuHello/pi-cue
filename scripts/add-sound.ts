import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { parsePresets, type SoundPreset } from "../src/data.ts";
import { checkSoundAsset, validateWav } from "../src/platform.ts";

type SoundInput = Omit<SoundPreset, "file"> & { input: string };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function addSound(root: string, input: SoundInput): Promise<void> {
  const directory = resolve(root, "assets");
  const dataDirectory = resolve(root, "data");
  const manifest = resolve(dataDirectory, "presets.json");
  const lock = manifest + ".lock";
  const temporary = manifest + "." + randomUUID() + ".tmp";
  const destination = resolve(directory, input.id + ".wav");
  let created = false;
  let committed = false;
  for (const path of [directory, dataDirectory]) {
    const status = await lstat(path);
    if (!status.isDirectory() || status.isSymbolicLink()) throw new Error("Sound catalog directories must be real directories");
  }
  for (const name of [input.en, input["zh-CN"]]) if (visibleWidth(name) > 20) throw new Error("Sound names must fit within 20 terminal cells");
  await mkdir(lock);
  try {
    const status = await lstat(manifest);
    if (!status.isFile() || status.isSymbolicLink() || status.size > 262144) throw new Error("Sound catalog must be a regular file at most 256 KiB");
    const original = await readFile(manifest, "utf8");
    const presets = parsePresets(JSON.parse(original));
    const { input: source, ...metadata } = input;
    const next = parsePresets([...presets, { ...metadata, file: input.id + ".wav" }]);
    const sourceStatus = await lstat(source);
    if (!sourceStatus.isFile() || sourceStatus.isSymbolicLink() || sourceStatus.size > 20 * 1024 * 1024) throw new Error("Input must be a regular PCM WAV file at most 20 MiB");
    const bytes = await readFile(source);
    validateWav(bytes);
    for (const preset of presets) if (preset.file) await checkSoundAsset(preset.file, directory);
    const output = await open(destination, "wx", 0o644);
    created = true;
    try { await output.writeFile(bytes); await output.sync(); } finally { await output.close(); }
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(next, null, 2) + "\n"); await file.sync(); } finally { await file.close(); }
    if (hash(await readFile(manifest, "utf8")) !== hash(original)) throw new Error("Sound catalog changed; reload it before retrying");
    await rename(temporary, manifest);
    committed = true;
  } finally {
    if (created && !committed) await rm(destination, { force: true });
    await rm(temporary, { force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    file: { type: "string" }, id: { type: "string" }, "name-en": { type: "string" }, "name-zh": { type: "string" },
    source: { type: "string" }, license: { type: "string" }, "description-en": { type: "string" }, "description-zh": { type: "string" },
  } });
  for (const key of ["file", "id", "name-en", "name-zh", "source", "license"] as const) if (!values[key]) throw new Error("Required sound import option: --" + key);
  await addSound(fileURLToPath(new URL("..", import.meta.url)), {
    input: resolve(values.file!), id: values.id!, en: values["name-en"]!, "zh-CN": values["name-zh"]!, source: values.source!, license: values.license!,
    description: { en: values["description-en"] ?? "", "zh-CN": values["description-zh"] ?? "" },
  });
  console.log("Added sound " + values.id + ". Regenerate the schema, then reload Pi to select it.");
}
