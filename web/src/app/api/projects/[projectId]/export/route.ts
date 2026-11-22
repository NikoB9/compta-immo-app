import { createHash } from "node:crypto";
import { AccessConfigurationError } from "@/server/auth/cloudflare-access";
import { RequestAuthorizationError, withAuthenticatedActor } from "@/server/auth/authenticated-actor";
import { PrivateDocumentError, readPrivateDocument } from "@/server/documents/private-store";
import { mandateDataSha256, MANDATE_TEMPLATE_VERSION, renderMandatePdf, type MandatePdfData } from "@/server/mandate-pdf";
import { createZip, type ZipEntry } from "@/server/project-export-zip";
import { isUuid, LedgerRequestError } from "@/server/ledger/repository";

export const runtime = "nodejs";
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_ITEMS = 100;
const MAX_ROWS_PER_SECTION = 10_000;

type RouteContext = { params: Promise<{ projectId: string }> };
type DocumentRow = { id: string; object_key: string; original_filename: string; media_type: string; byte_size: string; sha256: string };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { projectId } = await params;
    if (!isUuid(projectId)) throw new LedgerRequestError("Chantier introuvable.", 404);

    const data = await withAuthenticatedActor(request, async (client) => {
      const project = await client.query<{ id: string; name: string; status: string; address: string }>(
        `SELECT p.id, p.name, p.status,
                concat_ws(', ', b.address_line1, b.postal_code || ' ' || b.locality) AS address
         FROM app.construction_project p
         JOIN app.building_address b ON b.workspace_id = p.workspace_id AND b.id = p.building_id
         WHERE p.id = $1`, [projectId],
      );
      if (!project.rows[0]) throw new LedgerRequestError("Chantier introuvable.", 404);

      const [invoices, movements, mandates, documentRows] = await Promise.all([
        client.query(
          `SELECT i.id, i.supplier_name AS "supplierName", i.invoice_number AS "invoiceNumber",
                  i.invoice_date::text AS "invoiceDate", i.invoice_total_cents::text AS "totalCents",
                  i.extraction_status AS "reviewStatus", i.invoice_document_id AS "documentId"
           FROM app.supplier_invoice i
           JOIN app.project_document d ON d.workspace_id = i.workspace_id AND d.document_id = i.invoice_document_id
           WHERE d.project_id = $1 ORDER BY i.invoice_date NULLS LAST, i.created_at, i.id`, [projectId],
        ),
        client.query(
          `SELECT m.id, m.movement_type AS "type", m.occurred_on::text AS "occurredOn",
                  m.amount_cents::text AS "amountCents", m.invoice_id AS "invoiceId",
                  m.evidence_document_id AS "evidenceDocumentId", m.paid_in_cash AS "paidInCash", m.note
           FROM app.project_movement m WHERE m.project_id = $1
           ORDER BY m.occurred_on, m.created_at, m.id`, [projectId],
        ),
        client.query<MandatePdfData & { id: string }>(
          `SELECT m.id, m.title, m.mandate_data AS "mandateData", m.content_sha256 AS "contentSha256",
                  m.created_at::text AS "createdAt",
                  COALESCE((SELECT json_agg(json_build_object(
                    'partyRole', s.party_role, 'signerEmail', s.signer_email, 'signerName', s.signer_name,
                    'consentText', s.consent_text,
                    'signatureImageDocumentId', s.signature_image_document_id, 'signedAt', s.signed_at
                  ) ORDER BY s.signed_at)
                  FROM app.project_mandate_signature s WHERE s.mandate_id = m.id), '[]'::json) AS signatures
           FROM app.project_mandate m WHERE m.project_id = $1 ORDER BY m.created_at, m.id`, [projectId],
        ),
        client.query<DocumentRow>(
          `SELECT sd.id, sd.object_key, sd.original_filename, sd.media_type, sd.byte_size::text, sd.sha256
           FROM app.stored_document sd
           WHERE EXISTS (SELECT 1 FROM app.project_document pd WHERE pd.project_id = $1 AND pd.document_id = sd.id)
              OR EXISTS (SELECT 1 FROM app.project_movement pm WHERE pm.project_id = $1 AND pm.evidence_document_id = sd.id)
              OR EXISTS (SELECT 1 FROM app.project_mandate_signature ps WHERE ps.project_id = $1 AND ps.signature_image_document_id = sd.id)
           ORDER BY sd.created_at, sd.id`, [projectId],
        ),
      ]);
      if (invoices.rows.length > MAX_ROWS_PER_SECTION || movements.rows.length > MAX_ROWS_PER_SECTION
        || mandates.rows.length > MAX_ROWS_PER_SECTION) {
        throw new LedgerRequestError("Ce chantier contient trop d’éléments pour un export unique.", 422);
      }
      if (documentRows.rows.length + mandates.rows.length > MAX_ARCHIVE_ITEMS) throw new LedgerRequestError("Ce chantier contient trop de pièces et de mandats pour un seul export. Réduisez le nombre d’éléments.", 422);

      const evidenceFiles: Array<{ id: string; path: string; originalFilename: string; mediaType: string; byteSize: number; sha256: string }> = [];
      const entries: ZipEntry[] = [];
      let totalBytes = 0;
      for (const document of documentRows.rows) {
        const expectedBytes = Number(document.byte_size);
        if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > MAX_ARCHIVE_BYTES - totalBytes) {
          throw new LedgerRequestError("L’export dépasse la limite de 100 Mio. Réduisez la taille ou le nombre de pièces jointes.", 422);
        }
        const bytes = await readPrivateDocument(document.object_key);
        if (bytes.byteLength !== expectedBytes || createHash("sha256").update(bytes).digest("hex") !== document.sha256.trim()) {
          throw new PrivateDocumentError("Une pièce jointe est incomplète ou son intégrité est compromise.", 503);
        }
        const extension = safeExtension(document.media_type);
        const path = `evidence/${document.id}${extension}`;
        entries.push({ name: path, bytes });
        totalBytes += bytes.byteLength;
        evidenceFiles.push({ id: document.id, path, originalFilename: document.original_filename, mediaType: document.media_type, byteSize: expectedBytes, sha256: document.sha256.trim() });
      }

      const mandatePdfPaths = new Map<string, string>();
      for (const mandate of mandates.rows) {
        if (mandateDataSha256(mandate.mandateData) !== mandate.contentSha256.trim()) {
          throw new LedgerRequestError("Le contenu d’un mandat ne correspond plus à son empreinte enregistrée.", 409);
        }
        const path = `mandates/${mandate.id}-${MANDATE_TEMPLATE_VERSION}.pdf`;
        entries.push({ name: path, bytes: renderMandatePdf(mandate) });
        mandatePdfPaths.set(mandate.id, path);
      }

      const projectData = project.rows[0];
      const manifest = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        project: projectData,
        invoices: invoices.rows,
        movements: movements.rows,
        mandates: mandates.rows.map((mandate) => ({ ...mandate, templateVersion: MANDATE_TEMPLATE_VERSION, pdfPath: mandatePdfPaths.get(mandate.id) })),
        evidenceFiles,
      };
      const csv = createLedgerCsv(invoices.rows, movements.rows, evidenceFiles);
      entries.unshift({ name: "registre-chantier.csv", bytes: Buffer.from(csv, "utf8") });
      entries.unshift({ name: "index.json", bytes: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") });
      const archive = createZip(entries);
      if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new LedgerRequestError("L’export dépasse la limite de 100 Mio.", 422);
      const safeName = projectData.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "chantier";
      return { archive, filename: `${safeName}-${projectId.slice(0, 8)}.zip` };
    });

    return new Response(new Uint8Array(data.archive), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${data.filename}"`,
        "Content-Length": String(data.archive.byteLength),
        "Content-Type": "application/zip",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof LedgerRequestError || error instanceof RequestAuthorizationError || error instanceof PrivateDocumentError) {
      return json({ error: error.message }, error.status);
    }
    if (error instanceof AccessConfigurationError) return json({ error: "Authentication is not configured." }, 503);
    console.error("Project export failed.");
    return json({ error: "L’export du chantier est indisponible." }, 503);
  }
}

function createLedgerCsv(
  invoices: Array<Record<string, unknown>>,
  movements: Array<Record<string, unknown>>,
  evidenceFiles: Array<{ id: string; path: string }>,
) {
  const evidence = new Map(evidenceFiles.map((file) => [file.id, file.path]));
  const rows: unknown[][] = [["type", "date", "fournisseur", "référence", "montant_eur", "statut", "justificatif", "note"]];
  for (const invoice of invoices) rows.push(["facture", invoice.invoiceDate ?? "", invoice.supplierName, invoice.invoiceNumber ?? "", centsToEuro(invoice.totalCents), invoice.reviewStatus, evidence.get(String(invoice.documentId)) ?? "", ""]);
  const movementLabels: Record<string, string> = {
    advance: "avance",
    supplier_payment: "paiement fournisseur",
    reimbursement: "remboursement au mandataire",
    supplier_refund: "remboursement fournisseur",
    return: "restitution au propriétaire",
  };
  for (const movement of movements) rows.push([movementLabels[String(movement.type)] ?? movement.type, movement.occurredOn, "", movement.invoiceId ?? "", centsToEuro(movement.amountCents), "à vérifier", evidence.get(String(movement.evidenceDocumentId)) ?? "", movement.note ?? ""]);
  return rows.map((row) => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

function centsToEuro(value: unknown) {
  const cents = BigInt(String(value));
  const zero = BigInt(0);
  const hundred = BigInt(100);
  const absolute = cents < zero ? -cents : cents;
  return `${cents < zero ? "-" : ""}${absolute / hundred},${String(absolute % hundred).padStart(2, "0")}`;
}

function csvCell(value: unknown) {
  const text = String(value ?? "").replace(/[\r\n]+/g, " ");
  const safe = /^[=+\-@\t]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function safeExtension(mediaType: string) {
  return ({ "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" } as Record<string, string>)[mediaType] ?? ".bin";
}

function json(value: unknown, status: number) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}
