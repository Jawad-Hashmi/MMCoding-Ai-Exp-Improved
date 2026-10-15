import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const sourceDirectory = new URL("./", import.meta.url);
const hash = createHash("sha256");
for (const filename of readdirSync(sourceDirectory).filter((name) => name.endsWith(".js")).sort()) {
  hash.update(filename);
  hash.update(readFileSync(new URL(filename, sourceDirectory)));
}

// Captured once at process startup so logs identify the code actually loaded.
export const runtime = Object.freeze({
  processId: process.pid,
  startedAt: new Date().toISOString(),
  sourceVersion: hash.digest("hex").slice(0, 12),
});
