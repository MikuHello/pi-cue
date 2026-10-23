import { writeFileSync } from "node:fs";
import { metadata } from "../src/data.ts";

const properties = Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, Object.fromEntries(Object.entries(value).filter(([field]) => ["type", "default", "minimum", "maximum", "maxLength", "enum", "const"].includes(field)))]));
const schema = { $schema: "https://json-schema.org/draft/2020-12/schema", title: "pi-cue configuration v1", type: "object", required: ["schemaVersion", "settings"], properties: { schemaVersion: { const: 1 }, settings: { type: "object", properties, additionalProperties: true } }, additionalProperties: true };
writeFileSync(new URL("../data/config.schema.json", import.meta.url), `${JSON.stringify(schema, null, 2)}\n`);
