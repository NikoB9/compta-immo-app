import { AccessConfigurationError } from "@/server/auth/cloudflare-access";
import { RequestAuthorizationError, withAuthenticatedActor } from "@/server/auth/authenticated-actor";
import { RequestBodyError, readUtf8Body } from "@/server/http/request-body";
import { appendAuditEvent, LedgerRequestError, requireOwnedWorkspace } from "@/server/ledger/repository";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: Request) {
  try {
    assertSameOriginJson(request);
    const body = await readJson(request);
    const workspaceId = body.workspaceId;
    const label = requiredText(body.label, 160, "Nom du bien");
    const addressLine1 = requiredText(body.addressLine1, 240, "Adresse");
    const addressLine2 = optionalText(body.addressLine2, 240, "Complément d’adresse");
    const postalCode = requiredText(body.postalCode, 24, "Code postal");
    const locality = requiredText(body.locality, 120, "Commune");

    const building = await withAuthenticatedActor(request, async (client, _identity, actorId) => {
      const ownedWorkspaceId = await requireOwnedWorkspace(client, workspaceId);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO app.building_address (
           workspace_id, label, address_line1, address_line2, postal_code, locality, country_code
         ) VALUES ($1, $2, $3, $4, $5, $6, 'FR') RETURNING id`,
        [ownedWorkspaceId, label, addressLine1, addressLine2, postalCode, locality],
      );
      const id = inserted.rows[0].id;
      await appendAuditEvent(client, ownedWorkspaceId, actorId, "building_created", id, {}, "building_address");
      return { id, workspace_id: ownedWorkspaceId, label, address_line1: addressLine1, address_line2: addressLine2, postal_code: postalCode, locality };
    });

    return json(building, 201);
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
  if ((error as { code?: string } | null)?.code === "23505") return json({ error: "Un bien identique est déjà enregistré." }, 409);
  console.error("Building creation failed.");
  return json({ error: "Le bien n’a pas pu être créé." }, 503);
}
