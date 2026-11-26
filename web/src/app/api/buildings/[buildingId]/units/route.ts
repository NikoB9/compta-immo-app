import { AccessConfigurationError } from "@/server/auth/cloudflare-access";
import { RequestAuthorizationError, withAuthenticatedActor } from "@/server/auth/authenticated-actor";
import { RequestBodyError, readUtf8Body } from "@/server/http/request-body";
import { appendAuditEvent, isUuid, LedgerRequestError, requireOwnedWorkspace } from "@/server/ledger/repository";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 4 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ buildingId: string }> }) {
  try {
    assertSameOriginJson(request);
    const { buildingId } = await params;
    if (!isUuid(buildingId)) throw new LedgerRequestError("Bien invalide.", 422);
    const body = await readJson(request);
    const unitRef = requiredText(body.unitRef, 80, "Référence du lot");
    const description = optionalText(body.description, 300, "Description");

    const unit = await withAuthenticatedActor(request, async (client, _identity, actorId) => {
      const building = await client.query<{ id: string; workspace_id: string }>(
        "SELECT id, workspace_id FROM app.building_address WHERE id = $1",
        [buildingId],
      );
      if (!building.rows[0]) throw new LedgerRequestError("Bien introuvable.", 404);
      const workspaceId = await requireOwnedWorkspace(client, building.rows[0].workspace_id);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO app.unit (workspace_id, building_id, unit_ref, description)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [workspaceId, buildingId, unitRef, description],
      );
      const id = inserted.rows[0].id;
      await appendAuditEvent(client, workspaceId, actorId, "unit_created", id, { buildingId, unitRef }, "unit");
      return { id, workspace_id: workspaceId, building_id: buildingId, unit_ref: unitRef, description };
    });

    return json(unit, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

function requiredText(value: unknown, maxLength: number, label: string) {
  if (typeof value !== "string") throw new LedgerRequestError(`${label} invalide.`, 422);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || normalized.includes("\0")) {
    throw new LedgerRequestError(`${label} invalide.`, 422);
  }
  return normalized;
}

function optionalText(value: unknown, maxLength: number, label: string) {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, maxLength, label);
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

function assertSameOriginJson(request: Request) {
  const configuredUrl = process.env.APP_BASE_URL;
  let origin: string;
  try {
    if (!configuredUrl) throw new Error();
    origin = new URL(configuredUrl).origin;
  } catch {
    throw new AccessConfigurationError("Application origin is not configured.");
  }
  if (request.headers.get("origin") !== origin) throw new RequestAuthorizationError("Origine de requête non autorisée.", 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    throw new LedgerRequestError("Le contenu de la requête doit être en JSON.", 400);
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
  if ((error as { code?: string } | null)?.code === "23505") return json({ error: "Ce lot existe déjà pour ce bien." }, 409);
  console.error("Property unit creation failed.");
  return json({ error: "Le lot n’a pas pu être ajouté." }, 503);
}
