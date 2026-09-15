import { ACCESS_COOKIE, ACCESS_TTL_SECONDS, createAccessToken, verifyAccessCode } from "@/server/access-token";
import { errorResponse, readJson } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await readJson(request, 2048);
    if (!verifyAccessCode(body.code)) throw new Error("unauthorized");
    const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
    return Response.json({ ok: true }, { headers: {
      "Cache-Control": "no-store",
      "Set-Cookie": `${ACCESS_COOKIE}=${createAccessToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ACCESS_TTL_SECONDS}${secure ? "; Secure" : ""}`,
    } });
  } catch (error) { return errorResponse(error); }
}
