import { NextResponse } from "next/server";
import { requireCsrf } from "@/app/lib/auth/csrf";
import { deleteUserSessions, getSessionUser } from "@/app/lib/auth/session";
import {
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  getSessionCookieOptions,
  getCsrfCookieOptions,
} from "@/app/lib/auth/cookies";

export async function POST(req: Request) {
  const csrfError = requireCsrf(req);
  if (csrfError) {
    return NextResponse.json({ error: csrfError }, { status: 403 });
  }

  const userId = await getSessionUser();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await deleteUserSessions(userId);

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
