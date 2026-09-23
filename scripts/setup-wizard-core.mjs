import { randomBytes } from "node:crypto";
import path from "node:path";

export function normalizeStoragePath(value, hostOs) {
  if (typeof value !== "string" || !value.trim() || /[\r\n\0]/.test(value)) throw new Error("Choose a valid storage folder.");
  const input = value.trim();
  if (hostOs === "windows") {
    if (!/^[a-zA-Z]:[\\/]/.test(input)) throw new Error("Choose an absolute drive path such as D:\\EnderChest.");
    const result = path.win32.normalize(input).replaceAll("\\", "/").replace(/\/$/, "");
    if (/^[a-zA-Z]:$/.test(result)) throw new Error("Choose a folder, not the drive root.");
    return result;
  }
  if (hostOs !== "linux") throw new Error("Unsupported host operating system.");
  if (!path.posix.isAbsolute(input)) throw new Error("Choose an absolute path such as /srv/enderchest.");
  const result = path.posix.normalize(input).replace(/\/$/, "") || "/";
  if (result === "/") throw new Error("Choose a folder, not the filesystem root.");
  return result;
}

export function validateAdmin(emailValue, password, confirmation) {
  const email = String(emailValue ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("Enter a valid admin email address.");
  if (typeof password !== "string" || password.length < 12 || password.length > 128 || /[\r\n\0]/.test(password)) {
    throw new Error("Use a password between 12 and 128 characters without line breaks.");
  }
  const groups = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(rule => rule.test(password)).length;
  if (groups < 3) throw new Error("Use at least three of lowercase, uppercase, numbers, and symbols.");
  if (password !== confirmation) throw new Error("The passwords do not match.");
  return email;
}

function literal(value) {
  if (/[\r\n\0]/.test(value)) throw new Error("Configuration values cannot contain line breaks.");
  return `'${value.replaceAll("'", "\\'")}'`;
}

export function renderSetupEnv(template, { email, password, storageRoot }) {
  const values = new Map([
    ["POSTGRES_PASSWORD", randomBytes(32).toString("hex")],
    ["S3_ACCESS_KEY_ID", `GK${randomBytes(16).toString("hex")}`],
    ["S3_SECRET_ACCESS_KEY", randomBytes(32).toString("hex")],
    ["GARAGE_RPC_SECRET", randomBytes(32).toString("hex")],
    ["MAINTENANCE_TOKEN", randomBytes(32).toString("hex")],
    ["BOOTSTRAP_ADMIN_EMAIL", literal(email)],
    ["BOOTSTRAP_ADMIN_PASSWORD", literal(password)],
    ["DOMAIN", ""],
    ["S3_PUBLIC_DOMAIN", ""],
  ]);
  const seen = new Set();
  const output = template.split(/\r?\n/).map(line => {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (!match || !values.has(match[1])) return line;
    seen.add(match[1]);
    return `${match[1]}=${values.get(match[1])}`;
  });
  for (const name of values.keys()) if (!seen.has(name)) throw new Error(`Missing ${name} in docker/env.example`);
  output.push(`ENDER_STORAGE_ROOT=${literal(storageRoot)}`, "ENDER_SETUP_VERSION=1");
  return output.join("\n").replace(/\n*$/, "\n");
}
