import { createHash } from "node:crypto";
import { AccessConfigurationError } from "@/server/auth/cloudflare-access";
import { RequestAuthorizationError, withAuthenticatedActor } from "@/server/auth/authenticated-actor";
import { readUtf8Body, RequestBodyError } from "@/server/http/request-body";
import { appendAuditEvent, isUuid, LedgerRequestError, requireOwnedWorkspace } from "@/server/ledger/repository";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 32 * 1024;
type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { projectId } = await params;
    if (!isUuid(projectId)) throw new LedgerRequestError("Chantier introuvable.", 404);
    const mandates = await withAuthenticatedActor(request, async (client, identity) => {
      const result = await client.query(
        `SELECT m.id, m.title, m.mandate_data AS "mandateData", m.content_sha256 AS "contentSha256",
                m.created_at AS "createdAt", m.updated_at AS "updatedAt",
                COALESCE((SELECT json_agg(json_build_object(
                  'partyRole', s.party_role, 'signerEmail', s.signer_email, 'signerName', s.signer_name,
                  'consentText', s.consent_text, 'contentSha256', s.content_sha256,
                  'signatureImageDocumentId', s.signature_image_document_id, 'signedAt', s.signed_at
                ) ORDER BY s.signed_at) FROM app.project_mandate_signature s WHERE s.mandate_id = m.id), '[]'::json) AS signatures
         FROM app.project_mandate m WHERE m.project_id = $1 ORDER BY m.created_at DESC, m.id`,
        [projectId],
      );
      return result.rows.map((mandate) => {
        const parties = (mandate.mandateData as { parties?: Record<string, { email?: string }> }).parties;
        const yourPartyRole = (["mandant", "mandataire"] as const).find((role) => parties?.[role]?.email?.toLowerCase() === identity.email.toLowerCase()) ?? null;
        return { ...mandate, yourPartyRole };
      });
    });
    return json(mandates);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { projectId } = await params;
    if (!isUuid(projectId)) throw new LedgerRequestError("Chantier introuvable.", 404);
    const body = await readJson(request);
    if (typeof body.title !== "string" || body.title.trim().length < 1 || body.title.trim().length > 200) {
      throw new LedgerRequestError("Le titre du mandat est invalide.", 422);
    }
    const mandateData = validateMandateData(body.mandateData);
    const contentSha256 = createHash("sha256").update(stableStringify(mandateData)).digest("hex");
    const mandate = await withAuthenticatedActor(request, async (client, _identity, actorId) => {
      const project = await client.query<{ workspace_id: string }>(
        "SELECT workspace_id FROM app.construction_project WHERE id = $1", [projectId],
      );
      const workspaceId = project.rows[0]?.workspace_id;
      if (!workspaceId) throw new LedgerRequestError("Chantier introuvable.", 404);
      await requireOwnedWorkspace(client, workspaceId);
      const inserted = await client.query(
        `INSERT INTO app.project_mandate (workspace_id, project_id, title, mandate_data, content_sha256, created_by)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         RETURNING id, title, mandate_data AS "mandateData", content_sha256 AS "contentSha256", created_at AS "createdAt"`,
        [workspaceId, projectId, body.title.trim(), JSON.stringify(mandateData), contentSha256, actorId],
      );
      await appendAuditEvent(client, workspaceId, actorId, "project_mandate_created", inserted.rows[0].id, { contentSha256 }, "project_mandate");
      return inserted.rows[0];
    });
    return json(mandate, 201);
  } catch (error) { return errorResponse(error); }
}

export function validateMandateData(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LedgerRequestError("Contenu du mandat invalide.", 422);
  const data = value as Record<string, unknown>;
  const parties = data.parties as Record<string, unknown> | undefined;
  const project = data.project as Record<string, unknown> | undefined;
  if (data.version !== 1 || !parties || !project || !isText(project.purpose, 1, 1000) || !isText(project.address, 1, 500)) {
    throw new LedgerRequestError("Les informations du mandat sont incomplètes.", 422);
  }
  for (const role of ["mandant", "mandataire"] as const) {
    const party = parties[role] as Record<string, unknown> | undefined;
    if (!party || !isText(party.name, 1, 200) || !isEmail(party.email) || !isText(party.address, 1, 500)) {
      throw new LedgerRequestError("Les deux parties doivent avoir un nom, une adresse et une adresse e-mail valides.", 422);
    }
  }
  if (!Number.isSafeInteger(data.amountLimitCents) || Number(data.amountLimitCents) <= 0
    || !Array.isArray(data.authorizedMaterials) || data.authorizedMaterials.length > 100
    || !data.authorizedMaterials.every((item) => isText(item, 1, 300))
    || !isText(data.terms, 1, 3000) || !isDate(data.effectiveOn) || !isDate(data.expiresOn)) {
    throw new LedgerRequestError("Le plafond, les matériaux, les conditions ou les dates du mandat sont invalides.", 422);
  }
  return {
    version: 1,
    parties: Object.fromEntries(["mandant", "mandataire"].map((role) => {
      const party = parties[role] as Record<string, string>;
      return [role, { name: party.name.trim(), email: party.email.trim().toLowerCase(), address: party.address.trim() }];
    })),
    project: { purpose: (project.purpose as string).trim(), address: (project.address as string).trim() },
    amountLimitCents: Number(data.amountLimitCents),
    authorizedMaterials: (data.authorizedMaterials as string[]).map((item) => item.trim()),
    terms: (data.terms as string).trim(),
    effectiveOn: data.effectiveOn,
    expiresOn: data.expiresOn,
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function isText(value: unknown, min: number, max: number): value is string { return typeof value === "string" && value.trim().length >= min && value.length <= max && !value.includes("\0"); }
function isEmail(value: unknown) { return isText(value, 3, 320) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function isDate(value: unknown) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)); }
async function readJson(request: Request) {
  const text = await readUtf8Body(request, MAX_BODY_BYTES);
  try { const value: unknown = JSON.parse(text); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; }
  catch { throw new LedgerRequestError("Corps JSON invalide.", 400); }
}
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } }); }
function errorResponse(error: unknown) {
  if (error instanceof RequestBodyError || error instanceof LedgerRequestError || error instanceof RequestAuthorizationError) return json({ error: error.message }, error.status);
  if (error instanceof AccessConfigurationError) return json({ error: "Authentication is not configured." }, 503);
  console.error("Mandate request failed.");
  return json({ error: "Les mandats sont indisponibles." }, 503);
}
