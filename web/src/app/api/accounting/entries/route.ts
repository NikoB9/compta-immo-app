import { AccessConfigurationError } from "@/server/auth/cloudflare-access";
import {
  RequestAuthorizationError,
  withAuthenticatedActor,
} from "@/server/auth/authenticated-actor";
import {
  appendAuditEvent,
  LedgerRequestError,
  parseLedgerEntry,
  requireOwnedWorkspace,
  writeEntry,
} from "@/server/ledger/repository";
import { readUtf8Body, RequestBodyError } from "@/server/http/request-body";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");
    const yearText = url.searchParams.get("year");
    const year = yearText && /^\d{4}$/.test(yearText) ? Number(yearText) : NaN;
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      throw new LedgerRequestError("Année fiscale invalide.", 422);
    }

    const entries = await withAuthenticatedActor(request, async (client) => {
      const ownerWorkspaceId = await requireOwnedWorkspace(client, workspaceId);
      const result = await client.query<{
        id: string;
        tax_year: number;
        occurred_on: string;
        entry_type: "income" | "expense";
        description: string;
        category_code: string | null;
        amount_cents: string;
        administrative_amount_cents: string;
        internal_only_cents: string;
        currency: "EUR";
        building_ref: string;
        unit_ref: string | null;
        document_ref: string | null;
        review_status: "needs_review" | "draft" | "confirmed" | "excluded";
        documents: Array<{ id: string; originalFilename: string }>;
      }>(
        `SELECT e.external_reference AS id, e.tax_year, e.occurred_on::text,
                e.entry_type, e.description, e.category_code_snapshot AS category_code,
                e.amount_cents::text, e.administrative_amount_cents::text,
                e.internal_only_cents::text, e.currency,
                e.building_id::text AS building_ref, u.unit_ref,
                e.document_reference_snapshot AS document_ref, e.review_status,
                COALESCE((
                  SELECT json_agg(json_build_object('id', d.id, 'originalFilename', d.original_filename) ORDER BY d.created_at)
                  FROM app.entry_document ed
                  JOIN app.stored_document d ON d.workspace_id = ed.workspace_id AND d.id = ed.document_id
                  WHERE ed.workspace_id = e.workspace_id AND ed.entry_id = e.id
                ), '[]'::json) AS documents
         FROM app.financial_entry e
         LEFT JOIN app.unit u ON u.workspace_id = e.workspace_id AND u.id = e.unit_id
         WHERE e.workspace_id = $1 AND e.tax_year = $2
         ORDER BY e.occurred_on, e.external_reference`,
        [ownerWorkspaceId, year],
      );

      return result.rows.map((row) => ({
        id: row.id,
        taxYear: row.tax_year,
        occurredOn: row.occurred_on,
        entryType: row.entry_type,
        description: row.description,
        categoryCode: row.category_code,
        amountCents: safeDatabaseCents(row.amount_cents),
        administrativeAmountCents: safeDatabaseCents(row.administrative_amount_cents),
        internalOnlyCents: safeDatabaseCents(row.internal_only_cents),
        currency: row.currency,
        buildingRef: row.building_ref,
        unitRef: row.unit_ref,
        documentRef: row.document_ref,
        documents: row.documents,
        reviewStatus: row.review_status,
      }));
    });

    return json(entries);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const workspaceId = body.workspaceId;
    const entry = parseLedgerEntry(body.entry);

    await withAuthenticatedActor(request, async (client, _identity, actorId) => {
      const ownerWorkspaceId = await requireOwnedWorkspace(client, workspaceId);
      await writeEntry(client, ownerWorkspaceId, actorId, entry, "insert");
    });

    return json({ id: entry.id }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await readJson(request);
    const entry = parseLedgerEntry(body.entry);

    await withAuthenticatedActor(request, async (client, _identity, actorId) => {
      const workspaceId = await requireOwnedWorkspace(client, body.workspaceId);
      await writeEntry(client, workspaceId, actorId, entry, "update");
    });

    return json({ id: entry.id });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await readJson(request);
    if (typeof body.id !== "string" || body.id.length < 1 || body.id.length > 128) {
      throw new LedgerRequestError("Identifiant d'écriture invalide.", 422);
    }

    await withAuthenticatedActor(request, async (client, _identity, actorId) => {
      const workspaceId = await requireOwnedWorkspace(client, body.workspaceId);
      const removed = await client.query<{ id: string }>(
        `DELETE FROM app.financial_entry
         WHERE workspace_id = $1 AND external_reference = $2
         RETURNING id`,
        [workspaceId, body.id],
      );
      if (!removed.rows[0]) throw new LedgerRequestError("Écriture introuvable.", 404);
      await appendAuditEvent(client, workspaceId, actorId, "ledger_entry_deleted", removed.rows[0].id);
    });

    return json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await readUtf8Body(request, MAX_BODY_BYTES);
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new LedgerRequestError("Corps JSON invalide.", 400);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof LedgerRequestError) throw error;
    throw new LedgerRequestError("Corps JSON invalide.", 400);
  }
}

function safeDatabaseCents(value: string) {
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("Stored accounting amount is outside the supported range.");
  }
  return cents;
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function errorResponse(error: unknown) {
  if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
  if (error instanceof LedgerRequestError) return json({ error: error.message }, error.status);
  if (error instanceof RequestAuthorizationError) return json({ error: error.message }, error.status);
  if (error instanceof AccessConfigurationError) return json({ error: "Authentication is not configured." }, 503);

  const code = (error as { code?: string } | null)?.code;
  if (code === "23505") return json({ error: "Une écriture avec cet identifiant existe déjà." }, 409);
  if (code === "23503" || code === "23514") return json({ error: "Les références ou montants de l'écriture sont invalides." }, 422);

  console.error("Accounting entry request failed.");
  return json({ error: "Le registre comptable est indisponible." }, 503);
}
