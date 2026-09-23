// Files are created only by /api/upload, which stores bytes and metadata together.
export async function POST() {
  return Response.json({ error: "Use /api/upload to create files" }, { status: 405 });
}
