import { AccessConfigurationError } from "@/server/auth/cloudflare-access";
import { RequestAuthorizationError, withAuthenticatedActor } from "@/server/auth/authenticated-actor";
import { reconcileDebours } from "../../../../../../../packages/domain/src/reconcile-debours.js";
import { readUtf8Body, RequestBodyError } from "@/server/http/request-body";
import { appendAuditEvent, isUuid, LedgerRequestError, requireOwnedWorkspace } from "@/server/ledger/repository";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 16 * 1024;
const MOVEMENT_TYPES = ["advance", "supplier_payment", "reimbursement", "supplier_refund", "return"] as const;
type MovementType = typeof MOVEMENT_TYPES[number];

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { projectId } = await params;
    if (!isUuid(projectId)) throw new LedgerRequestError("Chantier introuvable.", 404);
    const data = await withAuthenticatedActor(request, async (client) => {
      const project = await client.query<{ id: string; workspace_id: string; name: string; status: string; can_edit: boolean }>(
        `SELECT p.id, p.workspace_id, p.name, p.status,
                app_private.owns_workspace(p.workspace_id) AS can_edit
         FROM app.construction_project p WHERE p.id = $1`,
        [projectId],
      );
      const projectRow = project.rows[0];
      if (!projectRow) throw new LedgerRequestError("Chantier introuvable.", 404);

      const movements = await client.query<{
        id: string;
        movement_type: MovementType;
        occurred_on: string;
        amount_cents: string;
        invoice_id: string | null;
        evidence_document_id: string | null;
        paid_in_cash: boolean;
        note: string | null;
        supplier_name: string | null;
        invoice_number: string | null;
        invoice_total_cents: string | null;
        invoice_document_id: string | null;
      }>(
        `SELECT m.id, m.movement_type, m.occurred_on::text, m.amount_cents::text,
                m.invoice_id, m.evidence_document_id, m.paid_in_cash, m.note,
                i.supplier_name, i.invoice_number, i.invoice_total_cents::text, i.invoice_document_id
         FROM app.project_movement m
         LEFT JOIN app.supplier_invoice i ON i.workspace_id = m.workspace_id AND i.id = m.invoice_id
         WHERE m.workspace_id = $1 AND m.project_id = $2
         ORDER BY m.occurred_on DESC, m.created_at DESC, m.id`,
        [projectRow.workspace_id, projectId],
      );
      const projectInvoices = await client.query<{ id: string; supplier_name: string; invoice_number: string | null; invoice_date: string | null; invoice_total_cents: string; invoice_document_id: string; extraction_status: "needs_review" | "confirmed" }>(
        `SELECT i.id, i.supplier_name, i.invoice_number, i.invoice_date::text,
                i.invoice_total_cents::text, i.invoice_document_id, i.extraction_status
         FROM app.supplier_invoice i
         JOIN app.project_document d ON d.workspace_id = i.workspace_id AND d.document_id = i.invoice_document_id
         WHERE d.project_id = $1 AND i.workspace_id = $2
         ORDER BY i.invoice_date DESC NULLS LAST, i.created_at DESC, i.id`,
        [projectId, projectRow.workspace_id],
      );
      const invoiceMap = new Map<string, { id: string; totalCents: number }>();
      const invoices = projectInvoices.rows.map((invoice) => {
        invoiceMap.set(invoice.id, { id: invoice.id, totalCents: safeCents(invoice.invoice_total_cents) });
        return {
          id: invoice.id,
          supplierName: invoice.supplier_name,
          invoiceNumber: invoice.invoice_number,
          invoiceDate: invoice.invoice_date,
          totalCents: safeCents(invoice.invoice_total_cents),
          documentId: invoice.invoice_document_id,
          extractionStatus: invoice.extraction_status,
        };
      });
      const rows = movements.rows.map((movement) => {
        if (movement.invoice_id && movement.invoice_total_cents) {
          invoiceMap.set(movement.invoice_id, { id: movement.invoice_id, totalCents: safeCents(movement.invoice_total_cents) });
        }
        return {
          id: movement.id,
          movementType: movement.movement_type,
          occurredOn: movement.occurred_on,
          amountCents: safeCents(movement.amount_cents),
          invoiceId: movement.invoice_id,
          evidenceDocumentId: movement.evidence_document_id,
          paidInCash: movement.paid_in_cash,
          note: movement.note,
          supplierName: movement.supplier_name,
          invoiceNumber: movement.invoice_number,
          invoiceTotalCents: movement.invoice_total_cents ? safeCents(movement.invoice_total_cents) : null,
          invoiceDocumentId: movement.invoice_document_id,
        };
      });
      const summary = reconcileDebours({
        advances: amounts(rows, "advance"),
        reimbursements: amounts(rows, "reimbursement"),
        supplierRefunds: amounts(rows, "supplier_refund"),
        returns: amounts(rows, "return"),
        invoices: [...invoiceMap.values()],
        supplierPayments: rows.filter((row) => row.movementType === "supplier_payment")
          .map((row) => ({ amountCents: row.amountCents, invoiceId: row.invoiceId })),
      });
      return { project: projectRow, invoices, movements: rows, summary };
    });
    return json(data);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { projectId } = await params;
    if (!isUuid(projectId)) throw new LedgerRequestError("Chantier introuvable.", 404);
    const body = await readJson(request);
    const movement = parseMovement(body);
    const result = await withAuthenticatedActor(request, async (client, _identity, actorId) => {
      const project = await client.query<{ workspace_id: string }>(
        `SELECT workspace_id FROM app.construction_project WHERE id = $1`, [projectId],
      );
      if (!project.rows[0]) throw new LedgerRequestError("Chantier introuvable.", 404);
      const workspaceId = await requireOwnedWorkspace(client, project.rows[0].workspace_id);

      if (movement.invoiceId) {
        const invoice = await client.query<{ id: string; invoice_total_cents: string }>(
          `SELECT i.id, i.invoice_total_cents::text
           FROM app.supplier_invoice i
           JOIN app.project_document d
             ON d.workspace_id = i.workspace_id AND d.document_id = i.invoice_document_id
           WHERE i.workspace_id = $1 AND i.id = $2 AND d.project_id = $3
           FOR UPDATE OF i`,
          [workspaceId, movement.invoiceId, projectId],
        );
        if (!invoice.rows[0]) throw new LedgerRequestError("Facture introuvable dans cet espace.", 404);
        const attachedElsewhere = await client.query(
          `SELECT 1 FROM app.project_movement
           WHERE workspace_id = $1 AND invoice_id = $2 AND project_id <> $3 LIMIT 1`,
          [workspaceId, movement.invoiceId, projectId],
        );
        if (attachedElsewhere.rows.length) throw new LedgerRequestError("Cette facture est déjà rattachée à un autre chantier.", 409);
        const allocated = await client.query<{ total: string }>(
          `SELECT (
             COALESCE((SELECT SUM(amount_cents) FROM app.invoice_payment WHERE workspace_id = $1 AND invoice_id = $2), 0)
             + COALESCE((SELECT SUM(amount_cents) FROM app.project_movement WHERE workspace_id = $1 AND invoice_id = $2 AND movement_type = 'supplier_payment'), 0)
           )::text AS total`,
          [workspaceId, movement.invoiceId],
        );
        if (BigInt(allocated.rows[0].total) + BigInt(movement.amountCents) > BigInt(invoice.rows[0].invoice_total_cents)) {
          throw new LedgerRequestError("Le paiement dépasserait le total de la facture.", 409);
        }
      }
      if (movement.evidenceDocumentId) {
        const document = await client.query(
          `SELECT id FROM app.stored_document WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, movement.evidenceDocumentId],
        );
        if (!document.rows[0]) throw new LedgerRequestError("Justificatif introuvable dans cet espace.", 404);
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO app.project_movement (
          workspace_id, project_id, movement_type, occurred_on, amount_cents, invoice_id,
          evidence_document_id, paid_in_cash, note, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [workspaceId, projectId, movement.type, movement.occurredOn, movement.amountCents,
          movement.invoiceId, movement.evidenceDocumentId, movement.paidInCash, movement.note, actorId],
      );
      await appendAuditEvent(client, workspaceId, actorId, "project_movement_created", inserted.rows[0].id, {
        movementType: movement.type,
        amountCents: movement.amountCents,
      }, "project_movement");
      return { id: inserted.rows[0].id };
    });
    return json(result, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

function amounts(rows: Array<{ movementType: MovementType; amountCents: number }>, type: MovementType) {
  return rows.filter((row) => row.movementType === type).map(({ amountCents }) => ({ amountCents }));
}

function parseMovement(body: Record<string, unknown>) {
  if (!MOVEMENT_TYPES.includes(body.type as MovementType)) throw new LedgerRequestError("Type de mouvement invalide.", 422);
  const type = body.type as MovementType;
  if (typeof body.occurredOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.occurredOn)) {
    throw new LedgerRequestError("Date de mouvement invalide.", 422);
  }
  const date = new Date(`${body.occurredOn}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== body.occurredOn) {
    throw new LedgerRequestError("Date de mouvement invalide.", 422);
  }
  if (!Number.isSafeInteger(body.amountCents) || (body.amountCents as number) <= 0) {
    throw new LedgerRequestError("Le montant doit être positif et en centimes entiers.", 422);
  }
  const invoiceId = body.invoiceId == null || body.invoiceId === "" ? null : body.invoiceId;
  if (invoiceId !== null && !isUuid(invoiceId)) throw new LedgerRequestError("Référence de facture invalide.", 422);
  if (invoiceId && type !== "supplier_payment") throw new LedgerRequestError("Seul un paiement fournisseur peut être relié à une facture.", 422);
  const evidenceDocumentId = body.evidenceDocumentId == null || body.evidenceDocumentId === "" ? null : body.evidenceDocumentId;
  if (evidenceDocumentId !== null && !isUuid(evidenceDocumentId)) throw new LedgerRequestError("Référence de justificatif invalide.", 422);
  const paidInCash = body.paidInCash === true;
  if (body.paidInCash !== undefined && typeof body.paidInCash !== "boolean") throw new LedgerRequestError("Mode de paiement invalide.", 422);
  if (paidInCash && evidenceDocumentId) throw new LedgerRequestError("Un paiement liquide n'a pas de preuve de virement.", 422);
  if (body.note != null && (typeof body.note !== "string" || body.note.length > 1000 || body.note.includes("\0"))) {
    throw new LedgerRequestError("La note est invalide.", 422);
  }
  return {
    type,
    occurredOn: body.occurredOn,
    amountCents: body.amountCents as number,
    invoiceId: invoiceId as string | null,
    evidenceDocumentId: evidenceDocumentId as string | null,
    paidInCash,
    note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
  };
}

function safeCents(value: string) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Stored debours amount is outside the supported range.");
  return amount;
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
  if ((error as { code?: string } | null)?.code === "23503") return json({ error: "Les références du mouvement sont invalides." }, 422);
  console.error("Project debours request failed.");
  return json({ error: "Le suivi des débours est indisponible." }, 503);
}
