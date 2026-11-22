import { AccessConfigurationError } from "@/server/auth/cloudflare-access";
import { RequestAuthorizationError, withAuthenticatedActor } from "@/server/auth/authenticated-actor";
import { readUtf8Body, RequestBodyError } from "@/server/http/request-body";
import { appendAuditEvent, isUuid, LedgerRequestError, requireOwnedWorkspace } from "@/server/ledger/repository";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 16 * 1024;
type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { projectId } = await params;
    if (!isUuid(projectId)) throw new LedgerRequestError("Chantier introuvable.", 404);
    const body = await readJson(request);
    const supplierName = body.supplierName;
    if (typeof supplierName !== "string" || !supplierName.trim() || supplierName.length > 300 || supplierName.includes("\0")) {
      throw new LedgerRequestError("Le nom du fournisseur est invalide.", 422);
    }
    if (!Number.isSafeInteger(body.totalCents) || (body.totalCents as number) <= 0) {
      throw new LedgerRequestError("Le montant de la facture doit être positif et en centimes entiers.", 422);
    }
    if (!isUuid(body.documentId)) throw new LedgerRequestError("Ajoutez d'abord le fichier de la facture.", 422);
    const invoiceNumber = optionalText(body.invoiceNumber, 120, "Numéro de facture");
    const invoiceDate = body.invoiceDate == null || body.invoiceDate === "" ? null : body.invoiceDate;
    if (invoiceDate !== null && (typeof invoiceDate !== "string" || !validDate(invoiceDate))) {
      throw new LedgerRequestError("Date de facture invalide.", 422);
    }

    const invoice = await withAuthenticatedActor(request, async (client, _identity, actorId) => {
      const project = await client.query<{ workspace_id: string }>(
        `SELECT workspace_id FROM app.construction_project WHERE id = $1`, [projectId],
      );
      if (!project.rows[0]) throw new LedgerRequestError("Chantier introuvable.", 404);
      const workspaceId = await requireOwnedWorkspace(client, project.rows[0].workspace_id);
      const document = await client.query(
        `SELECT 1 FROM app.project_document
         WHERE workspace_id = $1 AND project_id = $2 AND document_id = $3`,
        [workspaceId, projectId, body.documentId],
      );
      if (!document.rows[0]) throw new LedgerRequestError("La facture doit être téléversée dans ce chantier.", 422);
      const duplicate = await client.query(
        `SELECT 1 FROM app.supplier_invoice WHERE workspace_id = $1 AND invoice_document_id = $2`,
        [workspaceId, body.documentId],
      );
      if (duplicate.rows.length) throw new LedgerRequestError("Ce fichier est déjà enregistré comme facture.", 409);
      const created = await client.query<{ id: string }>(
        `INSERT INTO app.supplier_invoice (
          workspace_id, supplier_name, invoice_number, invoice_date,
          invoice_total_cents, invoice_document_id, extraction_status
        ) VALUES ($1, $2, $3, $4, $5, $6, 'needs_review') RETURNING id`,
        [workspaceId, supplierName.trim(), invoiceNumber, invoiceDate, body.totalCents, body.documentId],
      );
      await appendAuditEvent(client, workspaceId, actorId, "project_invoice_created", created.rows[0].id, {
        amountCents: body.totalCents as number,
      }, "supplier_invoice");
      return { id: created.rows[0].id };
    });
    return json(invoice, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

function optionalText(value: unknown, max: number, label: string) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > max || value.includes("\0")) {
    throw new LedgerRequestError(`${label} invalide.`, 422);
  }
  return value.trim() || null;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
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

function errorResponse(error: unknown) {
  if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
  if (error instanceof LedgerRequestError) return json({ error: error.message }, error.status);
  if (error instanceof RequestAuthorizationError) return json({ error: error.message }, error.status);
  if (error instanceof AccessConfigurationError) return json({ error: "Authentication is not configured." }, 503);
  if ((error as { code?: string } | null)?.code === "23503") return json({ error: "Les références de facture sont invalides." }, 422);
  console.error("Project invoice request failed.");
  return json({ error: "La facture n'a pas pu être enregistrée." }, 503);
}
