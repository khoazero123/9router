import { NextResponse } from "next/server";
import { validateApiKey } from "@/lib/db/repos/apiKeysRepo";

export async function POST(request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Invalid authorization header" }, { status: 401 });
  }
  const key = authHeader.substring(7);
  const isValid = await validateApiKey(key);
  if (!isValid) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  // Return the key itself as the access token
  return NextResponse.json({
    accessToken: key,
    refreshToken: key
  });
}
