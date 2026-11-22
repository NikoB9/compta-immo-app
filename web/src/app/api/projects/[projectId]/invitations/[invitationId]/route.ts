import { AccessConfigurationError } from "@/server/auth/cloudflare-access";
import { RequestAuthorizationError, withAuthenticatedActor } from "@/server/auth/authenticated-actor";
import { appendAuditEvent, isUuid, LedgerRequestError, requireOwnedWorkspace } from "@/server/ledger/repository";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string; invitationId: string }> };

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { projectId, invitationId } = await params;
    if (!isUuid(projectId) || !isUuid(invitationId)) throw new LedgerRequestError("Invitation introuvable.", 404);
    const result = await withAuthenticatedActor(request, async (client, _identity, actorId) => {
      const project = await client.query<{ workspace_id: string }>("SELECT workspace_id FROM app.construction_project WHERE id = $1", [projectId]);
      if (!project.rows[0]) throw new LedgerRequestError("Chantier introuvable.", 404);
      await requireOwnedWorkspace(client, project.rows[0].workspace_id);
      const deleted = await client.query(
        `DELETE FROM app.project_invitation
         WHERE id = $1 AND project_id = $2 AND accepted_at IS NULL
         RETURNING id`,
        [invitationId, projectId],
      );
      if (!deleted.rows[0]) throw new LedgerRequestError("Invitation en attente introuvable.", 404);
      await appendAuditEvent(client, project.rows[0].workspace_id, actorId, "project_invitation_revoked", invitationId, {}, "project_invitation");
      return { revoked: true };
    });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof LedgerRequestError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof RequestAuthorizationError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof AccessConfigurationError) return Response.json({ error: "Authentication is not configured." }, { status: 503 });
    console.error("Project invitation revocation failed.");
    return Response.json({ error: "L'invitation n'a pas pu être révoquée." }, { status: 503 });
  }
}
