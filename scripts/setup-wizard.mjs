import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { normalizeStoragePath, renderSetupEnv, validateAdmin } from "./setup-wizard-core.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hostOs = process.env.ENDER_HOST_OS;
const hostRoot = process.env.ENDER_HOST_ROOT;
const mode = process.argv[2];
const port = Number(process.env.ENDER_SETUP_PORT ?? 4400);
const origin = `http://127.0.0.1:${port}`;
const alternateOrigin = `http://localhost:${port}`;
const token = mode === "web" ? randomBytes(24).toString("hex") : "";
const pendingEnv = path.join(project, "docker/.env.pending");
const pendingStorage = path.join(project, "docker/.setup-storage-path.pending");
const finalEnv = path.join(project, "docker/.env");
if (!hostRoot || !["windows", "linux"].includes(hostOs) || !["web", "cli"].includes(mode)) {
  throw new Error("The setup launcher must provide a host path, operating system, and web or cli mode.");
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid setup port.");
if (existsSync(finalEnv) || existsSync(pendingEnv) || existsSync(pendingStorage)) {
  throw new Error("Existing or unfinished setup detected. No configuration was changed.");
}
const defaultStorage = hostOs === "windows" ? path.win32.join(hostRoot, "enderchest-data") : path.posix.join(hostRoot, "enderchest-data");

function saveRequest(data) {
  const email = validateAdmin(data.email, data.password, data.confirmation);
  const storageRoot = normalizeStoragePath(data.storageRoot, hostOs);
  const template = readFileSync(path.join(project, "docker/env.example"), "utf8");
  const config = renderSetupEnv(template, { email, password: data.password, storageRoot });
  writeFileSync(pendingEnv, config, { flag: "wx", mode: 0o600 });
  writeFileSync(pendingStorage, storageRoot, { flag: "wx", mode: 0o600 });
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function page(error = "", email = "", storageRoot = defaultStorage) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Set up EnderChest</title><style>
  *{box-sizing:border-box}body{margin:0;font:15px system-ui,-apple-system,Segoe UI,sans-serif;color:#223344;background:#f7f9fa}header{height:68px;background:white;border-bottom:1px solid #dce4e9;display:flex;align-items:center;padding:0 max(24px,calc((100vw - 720px)/2));font-weight:700;font-size:18px;color:#1c5f9a}main{max-width:720px;margin:0 auto;padding:42px 24px 70px}h1{font-size:28px;margin:0 0 8px}p{color:#637482;line-height:1.55;margin:0 0 24px}.group{border-top:1px solid #dce4e9;padding-top:25px;margin-top:28px}h2{font-size:16px;margin:0 0 18px}label{display:block;font-size:13px;font-weight:600;margin:16px 0 7px}input{display:block;width:100%;height:43px;border:1px solid #bfcbd4;border-radius:5px;background:white;padding:0 12px;color:#223344;font:inherit}input:focus{outline:2px solid #4b9ad0;outline-offset:1px}.hint{font-size:12px;color:#637482;margin-top:7px}.error{background:#fff0ee;border:1px solid #e7a49d;color:#9c2b24;padding:12px;border-radius:5px;margin:18px 0}button{height:44px;padding:0 20px;border:0;border-radius:5px;background:#1c5f9a;color:white;font:inherit;font-weight:650;cursor:pointer;margin-top:26px}button:hover{background:#174d7e}.note{font-size:12px;margin-top:22px;color:#637482}@media(max-width:600px){main{padding-top:28px}h1{font-size:23px}}
  </style></head><body><header>EnderChest</header><main><h1>Set up your server</h1><p>Create the first administrator and choose where uploaded files live. This setup is local to this computer.</p>${error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : ""}<form method="post" action="/create"><input type="hidden" name="token" value="${token}"><section class="group"><h2>Administrator</h2><label for="email">Email address</label><input id="email" name="email" type="email" required autocomplete="username" value="${escapeHtml(email)}"><label for="password">Password</label><input id="password" name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password"><div class="hint">12 or more characters, using at least three of lowercase, uppercase, numbers and symbols.</div><label for="confirmation">Confirm password</label><input id="confirmation" name="confirmation" type="password" required autocomplete="new-password"></section><section class="group"><h2>File storage</h2><label for="storageRoot">Storage folder on this computer</label><input id="storageRoot" name="storageRoot" required value="${escapeHtml(storageRoot)}"><div class="hint">Choose a new or empty folder. Uploaded file bytes go here; database and storage metadata stay in persistent Docker volumes.</div></section><button type="submit">Create server</button></form><p class="note">Docker will build and start EnderChest after you submit. Keep the setup window open until it finishes. Internet access for family members is configured separately.</p></main></body></html>`;
}

async function readSecret(label) {
  if (!process.stdin.isTTY) throw new Error("Interactive terminal required for password entry.");
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const onData = chunk => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\r" || character === "\n") {
          process.stdin.off("data", onData);
          process.stdin.setRawMode(false);
          process.stdout.write("\n");
          process.stdin.pause();
          resolve(value);
          return;
        }
        if (character === "\u0003") {
          process.stdin.off("data", onData);
          process.stdin.setRawMode(false);
          process.stdout.write("\n");
          reject(new Error("Setup canceled."));
          return;
        }
        if (character === "\u007f" || character === "\b") value = Array.from(value).slice(0, -1).join("");
        else if (character >= " " && value.length < 128) value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

if (mode === "cli") {
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  let email;
  let answer;
  try {
    process.stdout.write("EnderChest first-run setup\n\n");
    email = await input.question("Admin email: ");
    answer = await input.question(`File storage folder [${defaultStorage}]: `);
  } finally { input.close(); }
  const password = await readSecret("Admin password (hidden): ");
  const confirmation = await readSecret("Confirm password (hidden): ");
  saveRequest({ email, password, confirmation, storageRoot: answer.trim() || defaultStorage });
  process.stdout.write("Settings created. The launcher will validate storage and start Docker.\n");
} else {
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (![new URL(origin).host, new URL(alternateOrigin).host].includes(req.headers.host)) { res.writeHead(403).end("Forbidden"); return; }
    if (req.method === "GET" && req.url === "/health") { res.writeHead(200).end("ok"); return; }
    if (req.method === "GET" && req.url === "/") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page()); return; }
    if (req.method !== "POST" || req.url !== "/create" || ![origin, alternateOrigin].includes(req.headers.origin)) {
      res.writeHead(404).end("Not found"); return;
    }
    let body = "";
    try {
      for await (const chunk of req) {
        body += chunk.toString("utf8");
        if (body.length > 16384) throw new Error("Form is too large.");
      }
      const form = new URLSearchParams(body);
      if (form.get("token") !== token) throw new Error("Setup form expired. Reload the page.");
      const data = Object.fromEntries(form);
      saveRequest(data);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end('<!doctype html><html lang="en"><meta charset="utf-8"><title>EnderChest setup</title><body style="font:16px system-ui;max-width:600px;margin:80px auto;padding:20px;color:#223344"><h1>Settings saved</h1><p>Return to the setup window while Docker starts EnderChest. This page can be closed.</p></body></html>');
      server.close();
    } catch (error) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(page(error.message, new URLSearchParams(body).get("email"), new URLSearchParams(body).get("storageRoot") || defaultStorage));
    }
  });
  server.listen(port, process.env.ENDER_SETUP_BIND ?? "0.0.0.0", () => process.stdout.write(`Setup wizard ready at ${origin}\n`));
  setTimeout(() => { server.close(); process.exitCode = 1; }, 30 * 60 * 1000).unref();
}
