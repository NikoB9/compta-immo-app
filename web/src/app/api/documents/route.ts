import { randomUUID, createHash } from "node:crypto";
import { AccessConfigurationError } from "@/server/auth/cloudflare-access";
import {
  RequestAuthorizationError,
  withAuthenticatedActor,
} from "@/server/auth/authenticated-actor";
import { RequestBodyError, readBytesBody } from "@/server/http/request-body";
import {
  appendAuditEvent,
  isUuid,
  LedgerRequestError,
  requireOwnedWorkspace,
} from "@/server/ledger/repository";
import {
  detectDocumentMediaType,
  makeDocumentObjectKey,
  MAX_DOCUMENT_BYTES,
  PrivateDocumentError,
  removePrivateDocument,
  sanitizeDocumentFilename,
  writePrivateDocument,
} from "@/server/documents/private-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let objectKey: string | undefined;
  let fileWritten = false;
  let databaseCommitted = false;

  try {
    const workspaceId = request.headers.get("x-workspace-id");
    const entryReference = request.headers.get("x-entry-reference");
    const projectId = request.headers.get("x-project-id");
    const encodedFilename = request.headers.get("x-document-filename");
    if (!workspaceId || (Boolean(entryReference) === Boolean(projectId))) {
      throw new LedgerRequestError("Indiquez un rattachement à une écriture ou à un chantier.", 422);
    }
    if (entryReference && (entryReference.length > 128 || entryReference.includes("\0"))) {
      throw new LedgerRequestError("Écriture de rattachement invalide.", 422);
    }
    if (projectId && !isUuid(projectId)) {
      throw new LedgerRequestError("Chantier de rattachement invalide.", 422);
    }

    let requestedFilename: string | null = null;
    if (encodedFilename) {
      try {
        requestedFilename = decodeURIComponent(encodedFilename);
      } catch {
        throw new PrivateDocumentError("Nom de fichier invalide.", 400);
      }
    }
    const originalFilename = sanitizeDocumentFilename(requestedFilename);
    const bytes = await readBytesBody(request, MAX_DOCUMENT_BYTES);
    if (bytes.byteLength === 0) throw new PrivateDocumentError("Le fichier est vide.", 400);
    const mediaType = detectDocumentMediaType(bytes);
    const documentId = randomUUID();
    objectKey = makeDocumentObjectKey(workspaceId, documentId);

    const result = await withAuthenticatedActor(request, async (client, _identity, actorId) => {
      const ownerWorkspaceId = await requireOwnedWorkspace(client, workspaceId);
      let entryId: string | null = null;
      let projectWorkspaceId: string | null = null;
      if (entryReference) {
        const entry = await client.query<{ id: string }>(
          `SELECT id FROM app.financial_entry
           WHERE workspace_id = $1 AND external_reference = $2`,
          [ownerWorkspaceId, entryReference],
        );
        if (!entry.rows[0]) throw new LedgerRequestError("Écriture introuvable.", 404);
        entryId = entry.rows[0].id;
      } else {
        const project = await client.query<{ workspace_id: string }>(
          `SELECT workspace_id FROM app.construction_project WHERE id = $1`, [projectId],
        );
        if (!project.rows[0]) throw new LedgerRequestError("Chantier introuvable.", 404);
        projectWorkspaceId = await requireOwnedWorkspace(client, project.rows[0].workspace_id);
        if (projectWorkspaceId !== ownerWorkspaceId) throw new LedgerRequestError("Le chantier n'appartient pas à cet espace.", 404);
      }

      await writePrivateDocument(objectKey!, bytes);
      fileWritten = true;
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      await client.query(
        `INSERT INTO app.stored_document (
          id, workspace_id, object_key, original_filename, media_type, byte_size, sha256, uploaded_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [documentId, ownerWorkspaceId, objectKey, originalFilename, mediaType, bytes.byteLength, sha256, actorId],
      );
      if (entryId) {
        await client.query(
          `INSERT INTO app.entry_document (workspace_id, entry_id, document_id)
           VALUES ($1, $2, $3)`,
          [ownerWorkspaceId, entryId, documentId],
        );
      } else {
        await client.query(
          `INSERT INTO app.project_document (workspace_id, project_id, document_id, shared_by)
           VALUES ($1, $2, $3, $4)`,
          [projectWorkspaceId, projectId, documentId, actorId],
        );
      }
      await appendAuditEvent(client, ownerWorkspaceId, actorId, "document_uploaded", entryId ?? projectId, {
        bytes: bytes.byteLength,
      }, entryId ? "financial_entry" : "construction_project");

      return { id: documentId, originalFilename, mediaType, byteSize: bytes.byteLength };
    });

    databaseCommitted = true;
    return Response.json(result, {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (objectKey && fileWritten && !databaseCommitted) {
      try {
        await removePrivateDocument(objectKey);
      } catch {
        console.error("Unable to remove an unlinked private document file.");
      }
    }
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
  if (error instanceof PrivateDocumentError) return json({ error: error.message }, error.status);
  if (error instanceof LedgerRequestError) return json({ error: error.message }, error.status);
  if (error instanceof RequestAuthorizationError) return json({ error: error.message }, error.status);
  if (error instanceof AccessConfigurationError) return json({ error: "Authentication is not configured." }, 503);
  if ((error as { code?: string } | null)?.code === "23503") return json({ error: "L'écriture de rattachement est invalide." }, 422);

  console.error("Private document upload failed.");
  return json({ error: "Le stockage privé des documents est indisponible." }, 503);
}

function json(value: unknown, status: number) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
