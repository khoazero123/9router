import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    user: {
      email: "admin@9router.megavn.net",
      displayName: "9router Admin",
      userId: 1337
    }
  });
}

export async function GET() {
    return POST();
}
