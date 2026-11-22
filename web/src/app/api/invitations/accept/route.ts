import { createHash } from "node:crypto";
import { AccessConfigurationError, verifyCloudflareAccessToken } from "@/server/auth/cloudflare-access";
import { RequestAuthorizationError } from "@/server/auth/authenticated-actor";
import { getDatabasePool } from "@/server/db/pool";
import { RequestBodyError, readUtf8Body } from "@/server/http/request-body";
import { LedgerRequestError } from "@/server/ledger/repository";
import { appendAuditEvent } from "@/server/ledger/repository";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 4 * 1024;

export async function POST(request: Request) {
  try {
    const identity = await verifiedIdentity(request);
    const body = await readJson(request);
    if (typeof body.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) {
      return json({ error: "Lien d'invitation invalide." }, 422);
    }
    const tokenHash = createHash("sha256").update(body.token, "utf8").digest("hex");
    const client = await getDatabasePool().connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      const accepted = await client.query<{ project_id: string; user_id: string }>(
        "SELECT project_id, user_id FROM app_private.accept_project_invitation($1, $2)",
        [tokenHash, identity.email],
      );
      const row = accepted.rows[0];
      if (!row) throw new LedgerRequestError("Invitation invalide ou expirée.", 404);
      await client.query("SELECT set_config('app.actor_user_id', $1, true)", [row.user_id]);
      const project = await client.query<{ workspace_id: string }>("SELECT workspace_id FROM app.construction_project WHERE id = $1", [row.project_id]);
      if (!project.rows[0]) throw new Error("Accepted project is no longer available.");
      await appendAuditEvent(client, project.rows[0].workspace_id, row.user_id, "project_invitation_accepted", row.project_id, {}, "construction_project");
      await client.query("COMMIT");
      transactionOpen = false;
      return json({ accepted: true, projectId: row.project_id });
    } catch (error) {
      if (transactionOpen) {
        try { await client.query("ROLLBACK"); } catch { /* Preserve the original failure. */ }
      }
      if ((error as { code?: string } | null)?.code === "P0002") return json({ error: "Invitation invalide ou expirée." }, 404);
      if ((error as { code?: string } | null)?.code === "42501") return json({ error: "Ce compte n'est pas autorisé à rejoindre le chantier." }, 403);
      throw error;
    } finally { client.release(); }
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
    if (error instanceof LedgerRequestError) return json({ error: error.message }, error.status);
    if (error instanceof RequestAuthorizationError) return json({ error: error.message }, error.status);
    if (error instanceof AccessConfigurationError) return json({ error: "Authentication is not configured." }, 503);
    console.error("Project invitation acceptance failed.");
    return json({ error: "L'invitation n'a pas pu être acceptée." }, 503);
  }
}

async function verifiedIdentity(request: Request) {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) throw new RequestAuthorizationError("Authentication required.", 401);
  const identity = await verifyCloudflareAccessToken(token);
  if (!identity) throw new RequestAuthorizationError("Invalid authentication.", 401);
  return identity;
}

async function readJson(request: Request) {
  const text = await readUtf8Body(request, MAX_BODY_BYTES);
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new LedgerRequestError("Corps JSON invalide.", 400);
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof LedgerRequestError) throw error;
    throw new LedgerRequestError("Corps JSON invalide.", 400);
  }
}

function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } }); }
