import { NextResponse } from "next/server";
import { deleteSession } from "@/app/lib/auth/session";

export async function POST(req: Request){
    const sessionId = req.headers
    .get("cookie")
    ?.split("; ")
    .find((c) => c.startsWith("session="))
    ?.split("=")[1];

    if (sessionId){
        await deleteSession(sessionId);
    }

    const response = NextResponse.json({ success: true });

    response.cookies.set("session", "", {
        httpOnly: true,
        expires: new Date(0),
        path: "/"
    });

    return response;
}