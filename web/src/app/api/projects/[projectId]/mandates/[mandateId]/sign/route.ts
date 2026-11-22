import { AccessConfigurationError } from "@/server/auth/cloudflare-access";
import { RequestAuthorizationError, withAuthenticatedActor } from "@/server/auth/authenticated-actor";
import { readUtf8Body, RequestBodyError } from "@/server/http/request-body";
import { appendAuditEvent, isUuid, LedgerRequestError } from "@/server/ledger/repository";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 8 * 1024;
const CONSENT = "Je confirme avoir lu ce mandat, en accepter les conditions et le signer électroniquement.";
type RouteContext = { params: Promise<{ projectId: string; mandateId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { projectId, mandateId } = await params;
    if (!isUuid(projectId) || !isUuid(mandateId)) throw new LedgerRequestError("Mandat introuvable.", 404);
    const body = await readJson(request);
    if (body.consent !== true || (body.partyRole !== "mandant" && body.partyRole !== "mandataire")
      || typeof body.signerName !== "string" || !body.signerName.trim() || body.signerName.length > 200
      || (body.signatureImageDocumentId !== null && body.signatureImageDocumentId !== undefined && !isUuid(body.signatureImageDocumentId))) {
      throw new LedgerRequestError("La confirmation ou les informations de signature sont invalides.", 422);
    }
    const partyRole = body.partyRole as "mandant" | "mandataire";
    const signerName = (body.signerName as string).trim();
    const signatureImageDocumentId = typeof body.signatureImageDocumentId === "string" ? body.signatureImageDocumentId : null;
    const result = await withAuthenticatedActor(request, async (client, identity, actorId) => {
      const query = await client.query<{
        id: string; workspace_id: string; project_id: string; title: string; content_sha256: string;
        mandate_data: { parties?: Record<string, { email?: string; name?: string }> };
      }>(
        `SELECT id, workspace_id, project_id, title, content_sha256, mandate_data
         FROM app.project_mandate WHERE id = $1 AND project_id = $2`, [mandateId, projectId],
      );
      const mandate = query.rows[0];
      if (!mandate) throw new LedgerRequestError("Mandat introuvable.", 404);
      const party = mandate.mandate_data.parties?.[partyRole];
      if (!party?.email || party.email.toLowerCase() !== identity.email.toLowerCase()) {
        throw new RequestAuthorizationError("Le compte authentifié ne correspond pas à l’e-mail de cette partie.", 403);
      }
      if (signatureImageDocumentId) {
        const linked = await client.query(
          `SELECT 1 FROM app.project_document WHERE project_id = $1 AND workspace_id = $2 AND document_id = $3`,
          [projectId, mandate.workspace_id, signatureImageDocumentId],
        );
        if (!linked.rows[0]) throw new LedgerRequestError("L’image de signature doit d’abord être ajoutée aux documents de ce chantier.", 422);
      }
      const inserted = await client.query(
        `INSERT INTO app.project_mandate_signature
          (workspace_id, project_id, mandate_id, party_role, signer_user_id, signer_email, signer_name,
           consent_text, content_sha256, signature_image_document_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, party_role AS "partyRole", signer_email AS "signerEmail", signer_name AS "signerName",
                   consent_text AS "consentText", content_sha256 AS "contentSha256",
                   signature_image_document_id AS "signatureImageDocumentId", signed_at AS "signedAt"`,
        [mandate.workspace_id, projectId, mandateId, partyRole, actorId, identity.email.toLowerCase(), signerName, CONSENT, mandate.content_sha256, signatureImageDocumentId],
      );
      await appendAuditEvent(client, mandate.workspace_id, actorId, "project_mandate_signed", mandateId, {
        partyRole, signerEmail: identity.email.toLowerCase(), contentSha256: mandate.content_sha256,
      }, "project_mandate");
      return inserted.rows[0];
    });
    return json(result, 201);
  } catch (error) { return errorResponse(error); }
}

async function readJson(request: Request) {
  const text = await readUtf8Body(request, MAX_BODY_BYTES);
  try { const value: unknown = JSON.parse(text); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; }
  catch { throw new LedgerRequestError("Corps JSON invalide.", 400); }
}
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } }); }
function errorResponse(error: unknown) {
  if (error instanceof RequestBodyError || error instanceof LedgerRequestError || error instanceof RequestAuthorizationError) return json({ error: error.message }, error.status);
  if (error instanceof AccessConfigurationError) return json({ error: "Authentication is not configured." }, 503);
  console.error("Mandate signature request failed.");
  return json({ error: "La signature du mandat n’a pas pu être enregistrée. Vérifiez que la partie n’a pas déjà signé." }, 503);
}
