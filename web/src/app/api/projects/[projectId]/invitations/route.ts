import { randomBytes, createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { AccessConfigurationError } from "@/server/auth/cloudflare-access";
import { RequestAuthorizationError, withAuthenticatedActor } from "@/server/auth/authenticated-actor";
import { RequestBodyError, readUtf8Body } from "@/server/http/request-body";
import { appendAuditEvent, isUuid, LedgerRequestError, requireOwnedWorkspace } from "@/server/ledger/repository";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 8 * 1024;
type RouteContext = { params: Promise<{ projectId: string }> };

class InvitationLinkConfigurationError extends Error {}

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { projectId } = await params;
    if (!isUuid(projectId)) throw new LedgerRequestError("Chantier introuvable.", 404);
    const invitations = await withAuthenticatedActor(request, async (client) => {
      await ownerProjectWorkspace(client, projectId);
      const result = await client.query<{ id: string; email: string; expires_at: string; accepted_at: string | null; created_at: string; user_id: string | null }>(
        `SELECT i.id, i.email, i.expires_at::text, i.accepted_at::text, i.created_at::text, m.user_id
         FROM app.project_invitation i
         LEFT JOIN app.project_membership m ON m.project_id = i.project_id AND m.user_id = i.accepted_user_id
         WHERE i.project_id = $1
         ORDER BY i.created_at DESC LIMIT 100`,
        [projectId],
      );
      return result.rows.map((row) => ({ id: row.id, email: row.email, expiresAt: row.expires_at, acceptedAt: row.accepted_at, createdAt: row.created_at, userId: row.user_id }));
    });
    return json({ invitations });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { projectId } = await params;
    if (!isUuid(projectId)) throw new LedgerRequestError("Chantier introuvable.", 404);
    const body = await readJson(request);
    const email = parseEmail(body.email);
    const invitation = await withAuthenticatedActor(request, async (client, _identity, actorId) => {
      const workspaceId = await ownerProjectWorkspace(client, projectId);
      await client.query(
        `DELETE FROM app.project_invitation
         WHERE project_id = $1 AND accepted_at IS NULL AND expires_at <= now()`,
        [projectId],
      );
      const member = await client.query(
        `SELECT 1 FROM app.project_membership m
         JOIN app.user_account u ON u.id = m.user_id
         WHERE m.project_id = $1 AND lower(u.email) = $2 LIMIT 1`,
        [projectId, email],
      );
      if (member.rows.length) throw new LedgerRequestError("Cette adresse a déjà accès à ce chantier.", 409);
      const pending = await client.query(
        `SELECT 1 FROM app.project_invitation
         WHERE project_id = $1 AND lower(email) = $2 AND accepted_at IS NULL AND expires_at > now() LIMIT 1`,
        [projectId, email],
      );
      if (pending.rows.length) throw new LedgerRequestError("Une invitation active existe déjà pour cette adresse.", 409);

      const token = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
      const result = await client.query<{ id: string; expires_at: string }>(
        `INSERT INTO app.project_invitation (project_id, email, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '7 days')
         RETURNING id, expires_at::text`,
        [projectId, email, tokenHash, actorId],
      );
      await appendAuditEvent(client, workspaceId, actorId, "project_invitation_created", result.rows[0].id, {}, "project_invitation");
      return {
        id: result.rows[0].id,
        email,
        expiresAt: result.rows[0].expires_at,
        invitationUrl: invitationLink(request.url, token),
      };
    });
    return json(invitation, 201);
  } catch (error) { return errorResponse(error); }
}

function invitationLink(requestUrl: string, token: string) {
  const configuredBase = process.env.APP_BASE_URL;
  const base = configuredBase || (process.env.NODE_ENV === "development" ? requestUrl : "");
  if (!base) throw new InvitationLinkConfigurationError("APP_BASE_URL must be configured before creating project invitations.");
  let origin: URL;
  try { origin = new URL(base); } catch { throw new InvitationLinkConfigurationError("APP_BASE_URL is invalid."); }
  const localDevelopment = process.env.NODE_ENV === "development" && ["localhost", "127.0.0.1"].includes(origin.hostname);
  if ((origin.protocol !== "https:" && !localDevelopment) || origin.username || origin.password || origin.search || origin.hash) {
    throw new InvitationLinkConfigurationError("APP_BASE_URL must use the public HTTPS origin.");
  }
  const url = new URL("/invitations/accept", origin.origin);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

async function ownerProjectWorkspace(client: PoolClient, projectId: string) {
  const project = await client.query<{ workspace_id: string }>("SELECT workspace_id FROM app.construction_project WHERE id = $1", [projectId]);
  if (!project.rows[0]) throw new LedgerRequestError("Chantier introuvable.", 404);
  return requireOwnedWorkspace(client, project.rows[0].workspace_id);
}

function parseEmail(value: unknown) {
  if (typeof value !== "string") throw new LedgerRequestError("Adresse e-mail invalide.", 422);
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new LedgerRequestError("Adresse e-mail invalide.", 422);
  return email;
}

async function readJson(request: Request) {
  const text = await readUtf8Body(request, MAX_BODY_BYTES);
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new LedgerRequestError("Corps JSON invalide.", 400); }
}

function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } }); }

function errorResponse(error: unknown) {
  if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
  if (error instanceof LedgerRequestError) return json({ error: error.message }, error.status);
  if (error instanceof RequestAuthorizationError) return json({ error: error.message }, error.status);
  if (error instanceof AccessConfigurationError) return json({ error: "Authentication is not configured." }, 503);
  if (error instanceof InvitationLinkConfigurationError) return json({ error: "La configuration de l'adresse publique du site est incomplète." }, 503);
  if ((error as { code?: string } | null)?.code === "23505") return json({ error: "Une invitation active existe déjà pour cette adresse." }, 409);
  console.error("Project invitation request failed.");
  return json({ error: "La gestion des invitations a échoué." }, 503);
}
