import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPublicConfig } from "./publish-config-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, "docker/.env");
const publicFile = path.join(root, "docker/.env.public");
if (!existsSync(envFile)) throw new Error("Run the EnderChest setup before publishing an instance.");
const previous = existsSync(publicFile) ? readFileSync(publicFile, "utf8") : "";
const next = renderPublicConfig(process.argv[2], process.argv.slice(3), previous);
const pending = `${publicFile}.pending-${process.pid}`;
writeFileSync(pending, next, { flag: "wx", mode: 0o600 });
renameSync(pending, publicFile);
process.stdout.write("Public configuration saved. Existing database and storage settings were not changed.\n");
