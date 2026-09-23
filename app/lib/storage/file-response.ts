import { Readable } from "node:stream";

export type DownloadFile = { name: string; mime_type: string; size_bytes: string };

export function fileResponse(file: DownloadFile, stream: Readable, inline = false): Response {
  const previewMime = file.mime_type === "application/pdf" || file.mime_type === "text/plain" || /^image\/(png|jpeg|gif|webp)$/.test(file.mime_type);
  const disposition = inline && previewMime ? "inline" : "attachment";
  const safeName = file.name.replace(/[\r\n"\\]/g, "_");
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": file.mime_type || "application/octet-stream",
      "Content-Length": file.size_bytes,
      "Content-Disposition": `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    },
  });
}
