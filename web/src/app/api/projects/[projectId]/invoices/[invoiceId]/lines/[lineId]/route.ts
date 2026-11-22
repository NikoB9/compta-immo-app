import { AccessConfigurationError } from "@/server/auth/cloudflare-access";
import { RequestAuthorizationError, withAuthenticatedActor } from "@/server/auth/authenticated-actor";
import { RequestBodyError, readUtf8Body } from "@/server/http/request-body";
import { appendAuditEvent, isUuid, LedgerRequestError, requireOwnedWorkspace } from "@/server/ledger/repository";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 16 * 1024;
type RouteContext = { params: Promise<{ projectId: string; invoiceId: string; lineId: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { projectId, invoiceId, lineId } = await params;
    if (!isUuid(projectId) || !isUuid(invoiceId) || !isUuid(lineId)) throw new LedgerRequestError("Ligne de facture introuvable.", 404);
    const line = parseBody(await readJson(request));
    const saved = await withAuthenticatedActor(request, async (client, _identity, actorId) => {
      const project = await client.query<{ workspace_id: string }>("SELECT workspace_id FROM app.construction_project WHERE id = $1", [projectId]);
      if (!project.rows[0]) throw new LedgerRequestError("Chantier introuvable.", 404);
      const workspaceId = await requireOwnedWorkspace(client, project.rows[0].workspace_id);
      const invoice = await client.query(
        `SELECT i.id FROM app.supplier_invoice i
         JOIN app.project_document d ON d.workspace_id = i.workspace_id AND d.document_id = i.invoice_document_id
         WHERE i.workspace_id = $1 AND d.project_id = $2 AND i.id = $3
         FOR UPDATE OF i`,
        [workspaceId, projectId, invoiceId],
      );
      if (!invoice.rows[0]) throw new LedgerRequestError("Facture introuvable dans ce chantier.", 404);
      const updated = await client.query(
        `UPDATE app.invoice_line_item SET
          description = $4, quantity = $5, unit = $6, unit_price_cents = $7,
          amount_basis = $8, tax_rate_basis_points = $9, tax_amount_cents = $10,
          line_total_cents = $11, review_status = $12,
          reviewed_by = CASE WHEN $12 = 'confirmed' THEN $13::uuid ELSE NULL END,
          reviewed_at = CASE WHEN $12 = 'confirmed' THEN now() ELSE NULL END,
          updated_at = now()
         WHERE workspace_id = $1 AND invoice_id = $2 AND id = $3
         RETURNING id, review_status`,
        [workspaceId, invoiceId, lineId, line.description, line.quantity, line.unit,
          line.unitPriceCents, line.amountBasis, line.taxRateBasisPoints, line.taxAmountCents,
          line.lineTotalCents, line.reviewStatus, actorId],
      );
      if (!updated.rows[0]) throw new LedgerRequestError("Ligne de facture introuvable.", 404);
      await appendAuditEvent(client, workspaceId, actorId, "invoice_line_item_updated", lineId, {
        reviewStatus: line.reviewStatus,
        amountCents: line.lineTotalCents,
      }, "invoice_line_item");
      return updated.rows[0];
    });
    return json(saved);
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
    if (error instanceof LedgerRequestError) return json({ error: error.message }, error.status);
    if (error instanceof RequestAuthorizationError) return json({ error: error.message }, error.status);
    if (error instanceof AccessConfigurationError) return json({ error: "Authentication is not configured." }, 503);
    console.error("Invoice line correction failed.");
    return json({ error: "La ligne de facture n’a pas pu être enregistrée." }, 503);
  }
}

function parseBody(body: Record<string, unknown>) {
  if (typeof body.description !== "string" || !body.description.trim() || body.description.length > 500 || body.description.includes("\0")) {
    throw new LedgerRequestError("Désignation invalide.", 422);
  }
  const quantity = body.quantity == null || body.quantity === "" ? null : String(body.quantity);
  if (quantity !== null && (!/^\d{1,12}(?:\.\d{1,6})?$/.test(quantity) || Number(quantity) <= 0)) {
    throw new LedgerRequestError("Quantité invalide.", 422);
  }
  const unit = optionalText(body.unit, 50, "Unité");
  const amountBasis = body.amountBasis;
  if (amountBasis !== "before_tax" && amountBasis !== "after_tax" && amountBasis !== "unknown") {
    throw new LedgerRequestError("Base de montant invalide.", 422);
  }
  const reviewStatus = body.reviewStatus;
  if (reviewStatus !== "needs_review" && reviewStatus !== "confirmed" && reviewStatus !== "excluded") {
    throw new LedgerRequestError("État de revue invalide.", 422);
  }
  const taxRateBasisPoints = body.taxRateBasisPoints == null || body.taxRateBasisPoints === "" ? null : body.taxRateBasisPoints;
  if (taxRateBasisPoints !== null && (!Number.isInteger(taxRateBasisPoints) || (taxRateBasisPoints as number) < 0 || (taxRateBasisPoints as number) > 10000)) {
    throw new LedgerRequestError("Taux de taxe invalide.", 422);
  }
  return {
    description: body.description.trim(), quantity, unit,
    unitPriceCents: optionalCents(body.unitPriceCents, "Prix unitaire"),
    amountBasis, taxRateBasisPoints: taxRateBasisPoints as number | null,
    taxAmountCents: optionalCents(body.taxAmountCents, "Montant de taxe"),
    lineTotalCents: optionalCents(body.lineTotalCents, "Total de ligne"), reviewStatus,
  };
}

function optionalCents(value: unknown, label: string) {
  if (value == null || value === "") return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new LedgerRequestError(`${label} invalide.`, 422);
  return value as number;
}

function optionalText(value: unknown, maxLength: number, label: string) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > maxLength || value.includes("\0")) throw new LedgerRequestError(`${label} invalide.`, 422);
  return value.trim() || null;
}

async function readJson(request: Request) {
  const text = await readUtf8Body(request, MAX_BODY_BYTES);
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new LedgerRequestError("Corps JSON invalide.", 400);
  }
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}
