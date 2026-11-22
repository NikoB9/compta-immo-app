import { createHash } from "node:crypto";
import { AccessConfigurationError } from "@/server/auth/cloudflare-access";
import {
  RequestAuthorizationError,
  withAuthenticatedActor,
} from "@/server/auth/authenticated-actor";
import { PrivateDocumentError, readPrivateDocument } from "@/server/documents/private-store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { documentId } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(documentId)) {
      throw new PrivateDocumentError("Document introuvable.", 404);
    }
    const result = await withAuthenticatedActor(request, async (client) => {
      const metadata = await client.query<{
        workspace_id: string;
        object_key: string;
        original_filename: string;
        media_type: string;
        byte_size: string;
        sha256: string;
      }>(
        `SELECT workspace_id, object_key, original_filename, media_type,
                byte_size::text, sha256
         FROM app.stored_document WHERE id = $1`,
        [documentId],
      );
      const document = metadata.rows[0];
      if (!document) throw new PrivateDocumentError("Document introuvable.", 404);
      if (!new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]).has(document.media_type)) {
        throw new PrivateDocumentError("Type de document non pris en charge.", 415);
      }

      const bytes = await readPrivateDocument(document.object_key);
      const expectedSize = Number(document.byte_size);
      const actualHash = createHash("sha256").update(bytes).digest("hex");
      if (bytes.byteLength !== expectedSize || actualHash !== document.sha256.trim()) {
        throw new PrivateDocumentError("Le document est incomplet ou son intégrité est compromise.", 503);
      }

      return { document, bytes };
    });

    const dispositionName = encodeURIComponent(result.document.original_filename)
      .replaceAll("'", "%27")
      .replaceAll("(", "%28")
      .replaceAll(")", "%29");
    return new Response(new Uint8Array(result.bytes), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename*=UTF-8''${dispositionName}`,
        "Content-Length": String(result.bytes.byteLength),
        "Content-Security-Policy": "default-src 'none'; sandbox; style-src 'unsafe-inline'; frame-ancestors 'self'",
        "Content-Type": result.document.media_type,
        "Cross-Origin-Resource-Policy": "same-origin",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof PrivateDocumentError) return json({ error: error.message }, error.status);
    if (error instanceof RequestAuthorizationError) return json({ error: error.message }, error.status);
    if (error instanceof AccessConfigurationError) return json({ error: "Authentication is not configured." }, 503);

    console.error("Private document preview failed.");
    return json({ error: "Le document est indisponible." }, 503);
  }
}

function json(value: unknown, status: number) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
