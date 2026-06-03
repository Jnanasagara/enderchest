import { NextResponse } from "next/server";
import { query } from "@/app/lib/db";
import { verifyPassword } from "@/app/lib/auth/password";
import { createSession, deleteSession } from "@/app/lib/auth/session";
import { normalizeEmail, isValidEmail } from "@/app/lib/auth/validation";
import {
    getSessionCookieOptions,
    getCsrfCookieOptions,
    SESSION_COOKIE_NAME,
    CSRF_COOKIE_NAME,
} from "@/app/lib/auth/cookies";
import { createCsrfToken } from "@/app/lib/auth/csrf";
import { checkRateLimit } from "@/app/lib/auth/rate-limit";
import { getClientIp, getCookieValue, readJsonBody } from "@/app/lib/http/request";
import { logError } from "@/app/lib/http/logging";

export async function POST(req: Request){
    try{
        const parsed = await readJsonBody<{ email?: string; password?: string }>(req, {
            maxBytes: 8 * 1024,
        });

        if (parsed.error) {
            return NextResponse.json({ error: parsed.error }, { status: 400 });
        }

        const email = parsed.value?.email ? normalizeEmail(parsed.value.email) : "";
        const password = parsed.value?.password ?? "";

        if(!email || !password){
            return NextResponse.json(
                { error: "Missing credentials" },
                { status: 400 }
            );
        }

        if (!isValidEmail(email)) {
            return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
        }

        const ip = getClientIp(req);
        const rateKey = `login:${ip}:${email}`;
        const maxAttempts = Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 5);
        const windowMs = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS ?? 10 * 60 * 1000);
        const blockMs = Number(process.env.LOGIN_RATE_LIMIT_BLOCK_MS ?? 15 * 60 * 1000);
        const rate = await checkRateLimit(rateKey, maxAttempts, windowMs, blockMs);

        if (!rate.allowed) {
            return NextResponse.json(
                { error: "Too many login attempts" },
                { status: 429, headers: rate.retryAfterSeconds ? { "Retry-After": String(rate.retryAfterSeconds) } : undefined }
            );
        }

        const users = await query<{
            id: string;
            password_hash: string;
            status: string;
        }>(
            `
            SELECT id, password_hash, status
            FROM users
            WHERE email = $1
            `,
            [email]
        );

        if(users.length === 0){
            return NextResponse.json(
                { error: "Invalid credentials" },
                { status: 401 }
            );
        }

        const user = users[0];

        if(user.status !== "active"){
            return NextResponse.json(
                { error: "Account inactive" },
                { status: 403 }
            );
        }
        
        const valid = await verifyPassword(password, user.password_hash);

        if(!valid){
            return NextResponse.json(
                { error: "Invalid credentials" },
                { status: 401 }
            );
        }

        const existingSession = getCookieValue(req, SESSION_COOKIE_NAME);
        if (existingSession) {
            await deleteSession(existingSession);
        }

        const sessionId = await createSession(user.id);
        const csrfToken = createCsrfToken();

        const response = NextResponse.json({ success: true });

        response.cookies.set(SESSION_COOKIE_NAME, sessionId, getSessionCookieOptions());
        response.cookies.set(CSRF_COOKIE_NAME, csrfToken, getCsrfCookieOptions());

        return response;
    } 
    catch (error) {
        logError("login.failed", { error: String(error) });
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
