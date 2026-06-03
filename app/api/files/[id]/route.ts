import { NextRequest } from "next/server";
import { getSessionUser } from "@/app/lib/auth/session";
import { pool } from "@/app/lib/db/pool";
import { requireCsrf } from "@/app/lib/auth/csrf";
import { logError } from "@/app/lib/http/logging";

export async function DELETE(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
)   {
    try{
        const csrfError = requireCsrf(_req);
        if (csrfError) {
            return Response.json({ error: csrfError }, { status: 403 });
        }

        const userId = await getSessionUser();

        if(!userId){
            return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id: fileId } = await params;

        // Keep the MinIO object until trash retention permanently removes it.
        const result = await pool.query(
            `
            UPDATE files
            SET deleted_at = NOW()
            WHERE id = $1 AND owner_id = $2
              AND deleted_at IS NULL
            RETURNING id
            `,
            [fileId, userId]
        );

        if(result.rows.length === 0){
            return Response.json({ error: "File not found" }, { status: 404 });
        }

        return Response.json({ success: true });
    }
    catch(error: unknown){
        logError("files.delete.failed", { error: String(error) });
        return Response.json({ error: "Internal server error" }, { status: 500 });
    }
}
