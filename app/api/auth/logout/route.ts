import { NextResponse } from "next/server";
import { deleteSession } from "@/app/lib/auth/session";
import { requireCsrf } from "@/app/lib/auth/csrf";
import {
    SESSION_COOKIE_NAME,
    CSRF_COOKIE_NAME,
    getSessionCookieOptions,
    getCsrfCookieOptions,
} from "@/app/lib/auth/cookies";
import { getCookieValue } from "@/app/lib/http/request";

export async function POST(req: Request){
    const csrfError = requireCsrf(req);
    if (csrfError) {
        return NextResponse.json({ error: csrfError }, { status: 403 });
    }

    const sessionId = getCookieValue(req, SESSION_COOKIE_NAME);

    if (sessionId){
        await deleteSession(sessionId);
    }

    const response = NextResponse.json({ success: true });

    response.cookies.set(SESSION_COOKIE_NAME, "", {
        ...getSessionCookieOptions(),
        expires: new Date(0),
    });
    response.cookies.set(CSRF_COOKIE_NAME, "", {
        ...getCsrfCookieOptions(),
        expires: new Date(0),
    });

    return response;
}