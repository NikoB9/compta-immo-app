import { AccessConfigurationError } from "@/server/auth/cloudflare-access";
import { RequestAuthorizationError, withAuthenticatedActor } from "@/server/auth/authenticated-actor";
import { appendAuditEvent, isUuid, LedgerRequestError, requireOwnedWorkspace } from "@/server/ledger/repository";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ projectId: string; userId: string }> };

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { projectId, userId } = await params;
    if (!isUuid(projectId) || !isUuid(userId)) throw new LedgerRequestError("Accès au chantier introuvable.", 404);
    const result = await withAuthenticatedActor(request, async (client, _identity, actorId) => {
      const project = await client.query<{ workspace_id: string }>("SELECT workspace_id FROM app.construction_project WHERE id = $1", [projectId]);
      if (!project.rows[0]) throw new LedgerRequestError("Chantier introuvable.", 404);
      await requireOwnedWorkspace(client, project.rows[0].workspace_id);
      const removed = await client.query(
        "DELETE FROM app.project_membership WHERE project_id = $1 AND user_id = $2 RETURNING user_id",
        [projectId, userId],
      );
      if (!removed.rows[0]) throw new LedgerRequestError("Membre invité introuvable dans ce chantier.", 404);
      await appendAuditEvent(client, project.rows[0].workspace_id, actorId, "project_membership_revoked", projectId, {}, "construction_project");
      return { revoked: true };
    });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof LedgerRequestError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof RequestAuthorizationError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof AccessConfigurationError) return Response.json({ error: "Authentication is not configured." }, { status: 503 });
    console.error("Project membership revocation failed.");
    return Response.json({ error: "L'accès au chantier n'a pas pu être retiré." }, { status: 503 });
  }
}
