import "server-only";

import type { PoolClient } from "pg";

const SAFE_INTEGER_MAX = Number.MAX_SAFE_INTEGER;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LedgerEntry = {
  id: string;
  taxYear: number;
  occurredOn: string;
  entryType: "income" | "expense";
  description: string;
  categoryCode: string | null;
  amountCents: number;
  administrativeAmountCents: number;
  internalOnlyCents: number;
  currency: "EUR";
  buildingRef: string;
  unitRef: string | null;
  documentRef: string | null;
  reviewStatus: "needs_review" | "draft" | "confirmed" | "excluded";
};

export class LedgerRequestError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 422) {
    super(message);
    this.name = "LedgerRequestError";
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function parseLedgerEntry(value: unknown): LedgerEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LedgerRequestError("L'écriture doit être un objet.", 400);
  }

  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || row.id.length < 1 || row.id.length > 128 || row.id.includes("\0")) {
    throw new LedgerRequestError("Identifiant d'écriture invalide.", 422);
  }
  const taxYear = row.taxYear;
  if (!Number.isInteger(taxYear) || (taxYear as number) < 1900 || (taxYear as number) > 2200) {
    throw new LedgerRequestError("Année fiscale invalide.", 422);
  }
  if (typeof row.occurredOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.occurredOn)) {
    throw new LedgerRequestError("Date invalide.", 422);
  }
  const occurred = new Date(`${row.occurredOn}T00:00:00.000Z`);
  if (!Number.isFinite(occurred.getTime()) || occurred.toISOString().slice(0, 10) !== row.occurredOn || Number(row.occurredOn.slice(0, 4)) !== taxYear) {
    throw new LedgerRequestError("La date doit appartenir à l'année fiscale sélectionnée.", 422);
  }
  if (row.entryType !== "income" && row.entryType !== "expense") {
    throw new LedgerRequestError("Type d'écriture invalide.", 422);
  }
  if (typeof row.description !== "string" || !row.description.trim() || row.description.length > 2000 || row.description.includes("\0")) {
    throw new LedgerRequestError("Libellé invalide.", 422);
  }
  if (row.currency !== "EUR") {
    throw new LedgerRequestError("Seules les écritures en EUR sont acceptées.", 422);
  }
  const amountCents = safeCents(row.amountCents, "Montant total");
  const administrativeAmountCents = safeCents(row.administrativeAmountCents, "Montant administratif", true);
  const internalOnlyCents = safeCents(row.internalOnlyCents, "Frais internes", true);
  if (amountCents <= 0 || administrativeAmountCents + internalOnlyCents !== amountCents) {
    throw new LedgerRequestError("Le total doit être égal aux parts administrative et interne.", 422);
  }
  const categoryCode = optionalText(row.categoryCode, 80, "Code de catégorie");
  const buildingRef = row.buildingRef;
  if (!isUuid(buildingRef)) throw new LedgerRequestError("Adresse du bien invalide.", 422);

  return {
    id: row.id,
    taxYear: taxYear as number,
    occurredOn: row.occurredOn,
    entryType: row.entryType,
    description: row.description.trim(),
    categoryCode,
    amountCents,
    administrativeAmountCents,
    internalOnlyCents,
    currency: "EUR",
    buildingRef,
    unitRef: optionalText(row.unitRef, 200, "Référence d'appartement"),
    documentRef: optionalText(row.documentRef, 200, "Référence de document"),
    reviewStatus: "needs_review",
  };
}

function safeCents(value: unknown, label: string, allowZero = false) {
  if (!Number.isSafeInteger(value) || (value as number) < (allowZero ? 0 : 1) || (value as number) > SAFE_INTEGER_MAX) {
    throw new LedgerRequestError(`${label} invalide.`, 422);
  }
  return value as number;
}

function optionalText(value: unknown, maxLength: number, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > maxLength || value.includes("\0")) {
    throw new LedgerRequestError(`${label} invalide.`, 422);
  }
  return value;
}

export async function requireOwnedWorkspace(client: PoolClient, workspaceId: unknown) {
  if (!isUuid(workspaceId)) throw new LedgerRequestError("Espace de travail invalide.", 422);
  const result = await client.query(
    "SELECT id FROM app.workspace WHERE id = $1 AND app_private.owns_workspace(id)",
    [workspaceId],
  );
  if (!result.rowCount) throw new LedgerRequestError("Espace de travail introuvable.", 404);
  return workspaceId;
}

export async function resolveEntryLocation(
  client: PoolClient,
  workspaceId: string,
  buildingRef: unknown,
  unitRef: unknown,
) {
  if (!isUuid(buildingRef)) throw new LedgerRequestError("Adresse du bien invalide.", 422);
  const building = await client.query(
    "SELECT id FROM app.building_address WHERE workspace_id = $1 AND id = $2",
    [workspaceId, buildingRef],
  );
  if (!building.rowCount) throw new LedgerRequestError("Adresse inconnue dans cet espace de travail.", 422);

  const normalizedUnitRef = optionalText(unitRef, 200, "Référence d'appartement");
  if (!normalizedUnitRef) return { buildingId: buildingRef, unitId: null };

  const unit = await client.query<{ id: string }>(
    "SELECT id FROM app.unit WHERE workspace_id = $1 AND building_id = $2 AND unit_ref = $3",
    [workspaceId, buildingRef, normalizedUnitRef],
  );
  if (!unit.rows[0]) throw new LedgerRequestError("Appartement inconnu pour cette adresse.", 422);
  return { buildingId: buildingRef, unitId: unit.rows[0].id };
}

export async function writeEntry(
  client: PoolClient,
  workspaceId: string,
  actorId: string,
  entry: LedgerEntry,
  mode: "insert" | "update",
) {
  const { buildingId, unitId } = await resolveEntryLocation(
    client,
    workspaceId,
    entry.buildingRef,
    entry.unitRef,
  );

  if (mode === "insert") {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO app.financial_entry (
        workspace_id, building_id, unit_id, external_reference, category_code_snapshot,
        document_reference_snapshot, tax_year, occurred_on, entry_type, description,
        amount_cents, administrative_amount_cents, internal_only_cents, currency,
        review_status, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'EUR', 'needs_review', $14
      ) RETURNING id`,
      [workspaceId, buildingId, unitId, entry.id, entry.categoryCode, entry.documentRef,
        entry.taxYear, entry.occurredOn, entry.entryType, entry.description,
        entry.amountCents, entry.administrativeAmountCents, entry.internalOnlyCents, actorId],
    );
    await appendAuditEvent(client, workspaceId, actorId, "ledger_entry_created", inserted.rows[0].id);
    return inserted.rows[0].id;
  }

  const updated = await client.query<{ id: string }>(
    `UPDATE app.financial_entry SET
       building_id = $3, unit_id = $4, category_code_snapshot = $5,
       document_reference_snapshot = $6, tax_year = $7, occurred_on = $8,
       entry_type = $9, description = $10, amount_cents = $11,
       administrative_amount_cents = $12, internal_only_cents = $13,
       review_status = 'needs_review', updated_at = now()
     WHERE workspace_id = $1 AND external_reference = $2
     RETURNING id`,
    [workspaceId, entry.id, buildingId, unitId, entry.categoryCode, entry.documentRef,
      entry.taxYear, entry.occurredOn, entry.entryType, entry.description,
      entry.amountCents, entry.administrativeAmountCents, entry.internalOnlyCents],
  );
  if (!updated.rows[0]) throw new LedgerRequestError("Écriture introuvable.", 404);
  await appendAuditEvent(client, workspaceId, actorId, "ledger_entry_updated", updated.rows[0].id);
  return updated.rows[0].id;
}

export async function appendAuditEvent(
  client: PoolClient,
  workspaceId: string,
  actorId: string,
  action: string,
  entityId: string | null,
  details: Record<string, number | string | boolean | null> = {},
  entityType = "financial_entry",
) {
  await client.query(
    `INSERT INTO app.audit_event (workspace_id, actor_user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [workspaceId, actorId, action, entityType, entityId, JSON.stringify(details)],
  );
}
