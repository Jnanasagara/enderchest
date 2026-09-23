import busboy from "busboy";
import { createHash, randomUUID } from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { unlink } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

export type StagedUpload = {
  path: string;
  name: string;
  folderId: string;
  size: number;
  mimeType: string;
  checksum: string;
  stream: () => ReturnType<typeof createReadStream>;
  cleanup: () => Promise<void>;
};

export async function parseUpload(req: Request, maxBytes: number): Promise<StagedUpload> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data") || !req.body) throw new Error("Invalid upload");
  const length = Number(req.headers.get("content-length"));
  if (length > maxBytes + 65536) throw new Error("File too large");

  const path = join(tmpdir(), `enderchest-${randomUUID()}`);
  const hash = createHash("sha256");
  let name = "", folderId = "", mimeType = "application/octet-stream", size = 0;
  let fileTask: Promise<void> = Promise.resolve();
  let fileError: unknown = null;
  let invalid = "";
  let fileCount = 0;
  let fieldCount = 0;
  try {
    const parser = busboy({ headers: { "content-type": contentType }, limits: { files: 2, fields: 2, parts: 3, fileSize: maxBytes + 1, fieldSize: 128 } });
    parser.on("file", (field, input, info) => {
      fileCount++;
      if (field !== "file" || fileCount !== 1) { invalid = "Invalid upload"; input.resume(); return; }
      name = basename(info.filename.replace(/\\/g, "/")).trim();
      mimeType = info.mimeType || mimeType;
      input.on("data", (chunk: Buffer) => { size += chunk.length; hash.update(chunk); });
      input.on("limit", () => { invalid = "File too large"; });
      fileTask = pipeline(input, createWriteStream(path, { flags: "wx" })).catch(error => { fileError = error; });
    });
    parser.on("field", (field, value) => { fieldCount++; if (field === "folderId" && fieldCount === 1) folderId = value; else invalid = "Invalid upload"; });
    parser.on("filesLimit", () => { invalid = "Only one file is allowed"; });
    parser.on("fieldsLimit", () => { invalid = "Invalid upload"; });
    parser.on("partsLimit", () => { invalid = "Invalid upload"; });
    await pipeline(Readable.fromWeb(req.body as import("stream/web").ReadableStream), parser);
    await fileTask;
    if (fileError) throw fileError;
    if (size > maxBytes) throw new Error("File too large");
    if (invalid) throw new Error(invalid);
    if (fileCount !== 1 || !name || name.length > 255 || !folderId) throw new Error("A file and folder are required");
    return { path, name, folderId, size, mimeType, checksum: hash.digest("hex"), stream: () => createReadStream(path), cleanup: () => unlink(path) };
  } catch (error) {
    await fileTask.catch(() => {});
    await unlink(path).catch(() => {});
    throw error;
  }
}
