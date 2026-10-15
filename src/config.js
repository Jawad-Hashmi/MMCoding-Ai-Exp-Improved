import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

// Load project settings even when launched directly or from another directory.
// Existing process environment values take precedence.
export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
try {
  loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
