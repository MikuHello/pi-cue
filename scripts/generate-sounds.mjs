import { writeFileSync } from "node:fs";

for (const [name, frequencies] of Object.entries({ soft: [523.25, 659.25], bright: [659.25, 880, 1046.5] })) {
  const rate = 22050;
  const noteLength = 0.14;
  const samples = Math.floor(rate * noteLength * frequencies.length);
  const output = Buffer.alloc(44 + samples * 2);
  output.write("RIFF", 0); output.writeUInt32LE(output.length - 8, 4); output.write("WAVEfmt ", 8);
  output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(1, 22);
  output.writeUInt32LE(rate, 24); output.writeUInt32LE(rate * 2, 28); output.writeUInt16LE(2, 32); output.writeUInt16LE(16, 34);
  output.write("data", 36); output.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) {
    const time = index / rate;
    const note = Math.min(frequencies.length - 1, Math.floor(time / noteLength));
    const local = time - note * noteLength;
    const envelope = Math.min(1, local / 0.01) * Math.max(0, 1 - local / noteLength) ** 2;
    output.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequencies[note] * time) * envelope * 6000), 44 + index * 2);
  }
  writeFileSync(new URL(`../assets/${name}.wav`, import.meta.url), output);
}
