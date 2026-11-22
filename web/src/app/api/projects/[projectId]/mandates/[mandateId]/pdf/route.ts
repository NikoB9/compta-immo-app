import { AccessConfigurationError } from "@/server/auth/cloudflare-access";
import { RequestAuthorizationError, withAuthenticatedActor } from "@/server/auth/authenticated-actor";
import { mandateDataSha256, MANDATE_TEMPLATE_VERSION, renderMandatePdf, type MandatePdfData } from "@/server/mandate-pdf";
import { isUuid, LedgerRequestError } from "@/server/ledger/repository";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string; mandateId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { projectId, mandateId } = await params;
    if (!isUuid(projectId) || !isUuid(mandateId)) throw new LedgerRequestError("Mandat introuvable.", 404);
    const mandate = await withAuthenticatedActor(request, async (client) => {
      const result = await client.query<MandatePdfData>(
        `SELECT m.title, m.created_at::text AS "createdAt", m.content_sha256 AS "contentSha256",
                m.mandate_data AS "mandateData",
                COALESCE((SELECT json_agg(json_build_object(
                  'partyRole', s.party_role, 'signerEmail', s.signer_email, 'signerName', s.signer_name,
                  'consentText', s.consent_text, 'signedAt', s.signed_at,
                  'signatureImageDocumentId', s.signature_image_document_id
                ) ORDER BY s.signed_at)
                FROM app.project_mandate_signature s
                WHERE s.workspace_id = m.workspace_id AND s.mandate_id = m.id), '[]'::json) AS signatures
         FROM app.project_mandate m
         WHERE m.project_id = $1 AND m.id = $2`,
        [projectId, mandateId],
      );
      const row = result.rows[0];
      if (!row) throw new LedgerRequestError("Mandat introuvable dans ce chantier.", 404);
      const dataDigest = mandateDataSha256(row.mandateData);
      if (dataDigest !== row.contentSha256.trim()) throw new LedgerRequestError("Le contenu du mandat ne correspond plus à son empreinte enregistrée.", 409);
      return row;
    });

    const pdf = renderMandatePdf(mandate);
    const filename = `mandat-${mandateId.slice(0, 8)}-${MANDATE_TEMPLATE_VERSION}.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdf.byteLength),
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof LedgerRequestError || error instanceof RequestAuthorizationError) return json({ error: error.message }, error.status);
    if (error instanceof AccessConfigurationError) return json({ error: "Authentication is not configured." }, 503);
    console.error("Mandate PDF generation failed.");
    return json({ error: "Le PDF du mandat est indisponible." }, 503);
  }
}

function json(value: unknown, status: number) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}
