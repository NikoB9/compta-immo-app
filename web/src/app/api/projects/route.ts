import { AccessConfigurationError } from "@/server/auth/cloudflare-access";
import { RequestAuthorizationError, withAuthenticatedActor } from "@/server/auth/authenticated-actor";
import { readUtf8Body, RequestBodyError } from "@/server/http/request-body";
import { appendAuditEvent, LedgerRequestError, isUuid, requireOwnedWorkspace } from "@/server/ledger/repository";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 16 * 1024;

export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    if (workspaceId && !isUuid(workspaceId)) throw new LedgerRequestError("Espace de travail invalide.", 422);
    const projects = await withAuthenticatedActor(request, async (client) => {
      const result = await client.query<{
        id: string;
        workspace_id: string;
        building_id: string;
        name: string;
        status: "active" | "closed" | "archived";
        can_edit: boolean;
      }>(
        `SELECT p.id, p.workspace_id, p.building_id, p.name, p.status,
                app_private.owns_workspace(p.workspace_id) AS can_edit
         FROM app.construction_project p
         WHERE ($1::uuid IS NULL OR p.workspace_id = $1)
         ORDER BY p.created_at DESC, p.id`,
        [workspaceId || null],
      );
      return result.rows;
    });
    return json(projects);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    if (!isUuid(body.workspaceId) || !isUuid(body.buildingId)) {
      throw new LedgerRequestError("Espace de travail ou adresse invalide.", 422);
    }
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 200 || body.name.includes("\0")) {
      throw new LedgerRequestError("Le nom du chantier est invalide.", 422);
    }
    const name = body.name.trim();

    const project = await withAuthenticatedActor(request, async (client, _identity, actorId) => {
      const workspaceId = await requireOwnedWorkspace(client, body.workspaceId);
      const building = await client.query<{ id: string }>(
        `SELECT id FROM app.building_address WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, body.buildingId],
      );
      if (!building.rows[0]) throw new LedgerRequestError("Adresse introuvable dans cet espace.", 404);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO app.construction_project (workspace_id, building_id, name)
         VALUES ($1, $2, $3) RETURNING id`,
        [workspaceId, body.buildingId, name],
      );
      await appendAuditEvent(client, workspaceId, actorId, "project_created", inserted.rows[0].id, {}, "construction_project");
      return { id: inserted.rows[0].id, workspace_id: workspaceId, building_id: body.buildingId, name, status: "active", can_edit: true };
    });
    return json(project, 201);
  } catch (error) {
    return errorResponse(error);
  }
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
  console.error("Project request failed.");
  return json({ error: "Les chantiers sont indisponibles." }, 503);
}
