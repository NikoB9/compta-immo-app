import { parseAnnualLedgerCsv } from "../../../../../../packages/domain/src/annual-csv.js";
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

const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_JSON_BYTES = MAX_CSV_BYTES * 2 + 32 * 1024;
const MAX_IMPORT_ROWS = 5000;

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const year = body.year;
    if (!Number.isInteger(year) || (year as number) < 1900 || (year as number) > 2200) {
      throw new LedgerRequestError("Année fiscale invalide.", 422);
    }
    if (typeof body.csv !== "string" || new TextEncoder().encode(body.csv).byteLength > MAX_CSV_BYTES) {
      throw new LedgerRequestError("Le fichier CSV doit faire au plus 2 Mio.", 400);
    }
    if (typeof body.defaultBuildingId !== "string") {
      throw new LedgerRequestError("Adresse de rattachement manquante.", 422);
    }

    const preview = parseAnnualLedgerCsv(body.csv, { expectedTaxYear: year as number });
    if (!preview.canImport || preview.rows.length === 0) {
      return Response.json({
        error: "Le fichier contient des erreurs ou ne contient aucune écriture.",
        errors: preview.errors.slice(0, 50),
      }, { status: 422, headers: { "Cache-Control": "private, no-store" } });
    }
    if (preview.rows.length > MAX_IMPORT_ROWS) {
      throw new LedgerRequestError(`Un import ne peut pas dépasser ${MAX_IMPORT_ROWS} lignes.`, 400);
    }

    const inserted = await withAuthenticatedActor(request, async (client, _identity, actorId) => {
      const workspaceId = await requireOwnedWorkspace(client, body.workspaceId);
      for (const row of preview.rows) {
        const entry = parseLedgerEntry({
          ...row,
          buildingRef: row.buildingRef || body.defaultBuildingId,
        });
        await writeEntry(client, workspaceId, actorId, entry, "insert");
      }
      await appendAuditEvent(
        client,
        workspaceId,
        actorId,
        "ledger_csv_imported",
        null,
        { count: preview.rows.length },
      );
      return preview.rows.length;
    });

    return Response.json({ imported: inserted }, {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await readUtf8Body(request, MAX_JSON_BYTES);
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new LedgerRequestError("Corps JSON invalide.", 400);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof LedgerRequestError) throw error;
    throw new LedgerRequestError("Corps JSON invalide.", 400);
  }
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
  if (code === "23505") return json({ error: "Une ou plusieurs écritures existent déjà dans le registre." }, 409);
  if (code === "23503" || code === "23514") return json({ error: "Une adresse, un appartement ou un montant importé est invalide." }, 422);

  console.error("Annual ledger CSV import failed.");
  return json({ error: "L'import du registre comptable est indisponible." }, 503);
}
