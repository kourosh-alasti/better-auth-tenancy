import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";

export async function POST(request: Request) {
  const { slug, email, password } = (await request.json()) as {
    slug?: string;
    email?: string;
    password?: string;
  };

  if (!slug || !email || !password) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  try {
    const response = await auth.api.signInEmailTenant({
      body: { email, password },
      headers: new Headers({ "x-tenant-slug": slug }),
      returnHeaders: true,
    });

    const nextResponse = NextResponse.json({ success: true });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      nextResponse.headers.set("set-cookie", setCookie);
    }
    return nextResponse;
  } catch (error) {
    const code =
      error && typeof error === "object" && "body" in error
        ? (error as { body?: { code?: string } }).body?.code
        : undefined;
    return NextResponse.json({ error: code ?? "Sign in failed" }, { status: 401 });
  }
}
