import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const name = `EnderChest-${version}`;
const destination = path.join(root, "site", "downloads");
const stage = mkdtempSync(path.join(os.tmpdir(), "enderchest-release-"));
const packageRoot = path.join(stage, name);
const files = [".dockerignore", "Dockerfile", "Setup-EnderChest.cmd", "Publish-EnderChest.cmd", "setup.sh", "publish.sh", "package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs", "tailwind.config.ts", "eslint.config.mjs", "global.d.ts", "readme.md"];
const directories = ["app", "docker", "docs", "migrations", "public", "scripts"];

function allowed(source) {
  const relative = path.relative(root, source).replaceAll("\\", "/");
  const base = path.basename(source);
  if (base.startsWith(".env") || base === ".setup-storage-path" || base.endsWith(".pending")) return false;
  if (relative.startsWith("scripts/generate-site-art") || relative.startsWith("scripts/build-release")) return false;
  if (base === "node_modules" || base === ".next" || base === "backups") return false;
  return true;
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

try {
  mkdirSync(packageRoot, { recursive: true });
  for (const file of files) {
    if (!existsSync(path.join(root, file))) throw new Error(`Required release file is missing: ${file}`);
    cpSync(path.join(root, file), path.join(packageRoot, file));
  }
  for (const directory of directories) {
    cpSync(path.join(root, directory), path.join(packageRoot, directory), { recursive: true, filter: allowed });
  }
  mkdirSync(destination, { recursive: true });
  const tarball = path.join(destination, `${name}.tar.gz`);
  const zipfile = path.join(destination, `${name}.zip`);
  run("tar", ["-czf", tarball, name], stage);
  if (process.platform === "win32") {
    const literal = value => value.replaceAll("'", "''");
    run("powershell", ["-NoProfile", "-Command", `Compress-Archive -LiteralPath '${literal(packageRoot)}' -DestinationPath '${literal(zipfile)}' -Force`]);
  } else {
    run("zip", ["-q", "-r", zipfile, name], stage);
  }
  const hashes = [tarball, zipfile].map(file => `${createHash("sha256").update(readFileSync(file)).digest("hex")}  ${path.basename(file)}`).join("\n") + "\n";
  writeFileSync(path.join(destination, "SHA256SUMS.txt"), hashes);
  const contents = readdirSync(packageRoot).sort();
  console.log(`Built ${name}: ${contents.join(", ")}`);
  console.log(hashes.trim());
} finally {
  const resolved = path.resolve(stage);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("enderchest-release-")) {
    rmSync(resolved, { recursive: true, force: true });
  }
}
