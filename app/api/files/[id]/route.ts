import { NextRequest, NextResponse } from "next/server";
import { minioClient } from "@/app/lib/minio";
import { getSessionUser } from "@/app/lib/auth/session";
import { pool } from "@/app/lib/db/pool";

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
)   {
    try{
        const userId = await getSessionUser();

        if(!userId){
            return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id: fileId } = await params;

        //Step 1: Get file from db
        const result = await pool.query(
            `
            SELECT object_key
            FROM files
            WHERE id = $1 AND owner_id = $2
            `,
            [fileId, userId]
        );

        if(result.rows.length === 0){
            return Response.json({ error: "File not found" }, { status: 404 });
        }

        const file = result.rows[0];

        //Step 2: Delete from MinIO
        await minioClient.removeObject("enderchest", file.object_key);

        //Step 3: Delete from postgres db
        await pool.query(
            `
            DELETE FROM files
            WHERE id = $1 AND owner_id = $2            
            `,
            [fileId, userId]
        );

        return Response.json({ success: true });
    }
    catch(err: any){
        return Response.json({ error: err.message });
    }
}