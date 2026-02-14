import { NextResponse } from "next/server";
import { query } from "@/app/lib/db";
import { verifyPassword } from "@/app/lib/auth/password";
import { createSession } from "@/app/lib/auth/session";

export async function POST(req: Request){
    try{
        const body = await req.json();
        const { email, password } = body;

        if(!email || !password){
            return NextResponse.json(
                { error: "Missing credentials" },
                { status: 400 }
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

        const sessionId = await createSession(user.id);

        const response = NextResponse.json({ success: true });

        response.cookies.set("session", sessionId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
        });

        return response;
    } 
    catch(err){
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}