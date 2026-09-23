import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3002";
if (!/^http:\/\/localhost:3002\/?$/.test(base)) throw new Error("UI tests must target the isolated recovery stack on localhost:3002");
const email = process.env.TEST_ADMIN_EMAIL;
const password = process.env.TEST_ADMIN_PASSWORD;
if (!email || !password) throw new Error("TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD are required");
const chrome = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const errors = [];
const output = "backups/e2e-ui";
await mkdir(output, { recursive: true });

async function watch(page) {
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
}
async function login(page, account, secret) {
  await page.goto(`${base}/login`);
  await page.getByLabel("Email address").fill(account);
  await page.getByLabel("Password").fill(secret);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "My files" }).waitFor();
}
async function row(page, name) {
  const item = page.locator(".file-row").filter({ has: page.getByRole("button", { name, exact: true }) });
  await item.waitFor();
  return item;
}
async function menuAction(page, name, action) {
  const item = await row(page, name);
  const menu = item.locator("details.item-menu");
  if (!(await menu.evaluate(element => element.open))) await menu.locator("summary").click();
  await menu.getByRole("button", { name: action, exact: true }).click();
}
async function noHorizontalOverflow(page) {
  const state = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  assert.ok(state.document <= state.viewport + 1, `Horizontal overflow: ${JSON.stringify(state)}`);
}

try {
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const admin = await adminContext.newPage();
  await watch(admin);
  await login(admin, email, password);
  await admin.getByText("Loading files...").waitFor({ state: "hidden" });
  await noHorizontalOverflow(admin);
  await admin.screenshot({ path: `${output}/desktop-drive.png`, fullPage: true });

  const suffix = randomUUID().slice(0, 8);
  const folder = `UI test ${suffix}`;
  const filename = `sample-${suffix}.txt`;
  const renamed = `renamed-${suffix}.txt`;
  const contents = `EnderChest browser test ${suffix}\n`;
  await admin.getByRole("button", { name: "New folder" }).click();
  await admin.getByRole("dialog", { name: "create" }).getByRole("textbox", { name: "Name" }).fill(folder);
  await admin.getByRole("dialog", { name: "create" }).getByRole("button", { name: "Create" }).click();
  await row(admin, folder);
  await admin.locator('input[type="file"]').setInputFiles({ name: filename, mimeType: "text/plain", buffer: Buffer.from(contents) });
  await row(admin, filename);
  await menuAction(admin, filename, "Rename");
  await admin.getByRole("dialog", { name: "rename" }).getByRole("textbox", { name: "Name" }).fill(renamed);
  await admin.getByRole("dialog", { name: "rename" }).getByRole("button", { name: "Save" }).click();
  await row(admin, renamed);
  await (await row(admin, renamed)).getByRole("button", { name: renamed }).click();
  await admin.getByRole("dialog", { name: "preview" }).waitFor();
  await admin.getByRole("dialog", { name: "preview" }).getByTitle("Close").click();
  const downloadPromise = admin.waitForEvent("download");
  await (await row(admin, renamed)).getByTitle("Download").click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), renamed);
  await menuAction(admin, renamed, "Make a copy");
  await admin.getByRole("dialog", { name: "copy" }).getByRole("button", { name: "Copy" }).click();
  await row(admin, `Copy of ${renamed}`);
  await menuAction(admin, renamed, "Move");
  await admin.getByRole("dialog", { name: "move" }).getByLabel("Destination folder").selectOption({ label: `My files / ${folder}` });
  await admin.getByRole("dialog", { name: "move" }).getByRole("button", { name: "Move", exact: true }).click();
  await (await row(admin, folder)).getByRole("button", { name: folder }).click();
  await row(admin, renamed);
  await admin.getByLabel("Search files").fill(renamed);
  await admin.getByRole("heading", { name: "Search results" }).waitFor();
  await row(admin, renamed);
  await admin.getByTitle("Clear search").click();
  await menuAction(admin, renamed, "Move to trash");
  await admin.getByRole("dialog", { name: "delete" }).getByRole("button", { name: "Move to trash" }).click();
  await admin.getByRole("button", { name: "Trash", exact: true }).click();
  await (await row(admin, renamed)).getByTitle("Restore file").click();

  await admin.goto(`${base}/admin`);
  await admin.getByRole("heading", { name: "Users" }).waitFor();
  await noHorizontalOverflow(admin);
  await admin.screenshot({ path: `${output}/desktop-admin.png`, fullPage: true });
  await admin.getByRole("navigation", { name: "Administration" }).getByRole("button", { name: "Invitations" }).click();
  await admin.getByRole("button", { name: "New invitation" }).click();
  await admin.getByRole("status").filter({ hasText: "Invite created" }).waitFor();
  const invites = await (await admin.request.get(`${base}/api/admin/invite`)).json();
  const token = invites[0].token;
  assert.ok(token);

  const userEmail = `browser-${suffix}@example.invalid`;
  const userPassword = `BrowserTest-${randomUUID()}`;
  const userContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const user = await userContext.newPage();
  await watch(user);
  await user.goto(`${base}/register?invite=${token}`);
  await user.getByLabel("Email address").fill(userEmail);
  await user.getByLabel("Password").fill(userPassword);
  await user.getByRole("button", { name: "Create account" }).click();
  await user.getByRole("heading", { name: "My files" }).waitFor();
  await user.getByText("Loading files...").waitFor({ state: "hidden" });
  await noHorizontalOverflow(user);
  await user.screenshot({ path: `${output}/mobile-drive.png`, fullPage: true });
  await user.getByTitle("Open menu").click();
  await user.getByRole("button", { name: "Recent" }).click();
  await user.getByRole("heading", { name: "Recent", exact: true }).waitFor();
  await user.goto(`${base}/settings`);
  await noHorizontalOverflow(user);
  await user.screenshot({ path: `${output}/mobile-settings.png`, fullPage: true });
  const denied = await user.request.get(`${base}/api/admin/users`);
  assert.equal(denied.status(), 403);

  await admin.getByRole("navigation", { name: "Administration" }).getByRole("button", { name: "Users" }).click();
  const userRow = admin.locator(".admin-table tr").filter({ hasText: userEmail });
  await userRow.waitFor();
  await userRow.getByRole("button", { name: "Suspend" }).click();
  await userRow.getByRole("button", { name: "Activate" }).waitFor();
  await userRow.getByRole("button", { name: "Activate" }).click();
  await userRow.getByRole("button", { name: "Suspend" }).waitFor();
  await admin.getByRole("navigation", { name: "Administration" }).getByRole("button", { name: "Storage limits" }).click();
  await admin.getByLabel(`Quota for ${userEmail} in GB`).fill("2");
  await admin.locator(".admin-table tr").filter({ hasText: userEmail }).getByRole("button", { name: "Save" }).click();
  await admin.getByRole("status").filter({ hasText: "Quota updated" }).waitFor();
  await admin.getByRole("navigation", { name: "Administration" }).getByRole("button", { name: "Activity" }).click();
  await admin.getByRole("heading", { name: "Activity" }).waitFor();
  await admin.locator(".admin-table tbody tr").first().waitFor();

  const mobileAdminContext = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await adminContext.storageState() });
  const mobileAdmin = await mobileAdminContext.newPage();
  await watch(mobileAdmin);
  await mobileAdmin.goto(`${base}/admin`);
  await mobileAdmin.getByRole("heading", { name: "Users" }).waitFor();
  const mobileActions = mobileAdmin.locator(".admin-table tr").filter({ hasText: userEmail });
  await mobileActions.waitFor();
  assert.ok(await mobileActions.getByRole("button", { name: "Suspend" }).isVisible(), "Mobile user actions must be visible");
  await noHorizontalOverflow(mobileAdmin);
  await mobileAdmin.screenshot({ path: `${output}/mobile-admin.png`, fullPage: true });
  assert.deepEqual(errors, []);
  process.stdout.write(`UI acceptance passed. Screenshots: ${output}\n`);
} finally {
  await browser.close();
}
