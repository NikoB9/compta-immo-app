import { NextResponse, type NextRequest } from "next/server";
import {
  AccessConfigurationError,
  verifyCloudflareAccessToken,
} from "@/server/auth/cloudflare-access";

function deny(status: 401 | 503, message: string) {
  return new Response(message, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function proxy(request: NextRequest) {
  if (
    process.env.NODE_ENV === "development" &&
    process.env.CLOUDFLARE_ACCESS_BYPASS_LOCAL === "true"
  ) {
    return NextResponse.next();
  }

  try {
    const token = request.headers.get("cf-access-jwt-assertion");
    if (!token) return deny(401, "Authentication required.");

    const identity = await verifyCloudflareAccessToken(token);
    if (!identity) return deny(401, "Invalid authentication.");

    return NextResponse.next();
  } catch (error) {
    if (error instanceof AccessConfigurationError) {
      return deny(503, "Authentication is not configured.");
    }
    return deny(503, "Authentication could not be verified.");
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)"],
};
