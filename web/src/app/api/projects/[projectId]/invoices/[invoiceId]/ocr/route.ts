import { AccessConfigurationError } from "@/server/auth/cloudflare-access";
import { RequestAuthorizationError, withAuthenticatedActor } from "@/server/auth/authenticated-actor";
import { RequestBodyError, readUtf8Body } from "@/server/http/request-body";
import { appendAuditEvent, isUuid, LedgerRequestError, requireOwnedWorkspace } from "@/server/ledger/repository";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const MAX_LINES = 200;
const MAX_PAGES = 20;
const ENGINE = "pdfjs+tesseract.js";
const ENGINE_VERSION = "pdfjs-dist 6.5.438; tesseract.js 7.0.0";

type RouteContext = { params: Promise<{ projectId: string; invoiceId: string }> };
type RecognizedLine = { description: string; lineTotalCents: number; sourcePage: number; confidence: number | null; source: "native_pdf_text" | "local_ocr" };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { projectId, invoiceId } = await params;
    if (!isUuid(projectId) || !isUuid(invoiceId)) throw new LedgerRequestError("Facture introuvable.", 404);
    const body = await readJson(request);
    if (typeof body.recognizedText !== "string" || !body.recognizedText.trim() || body.recognizedText.length > 500_000) {
      throw new LedgerRequestError("Texte OCR invalide ou trop volumineux.", 422);
    }
    if (!Array.isArray(body.lines) || body.lines.length > MAX_LINES) throw new LedgerRequestError("Nombre de lignes OCR invalide.", 422);
    const lines = body.lines.map(parseLine);
    const extractedFields = parseFields(body.extractedFields);
    const reviewedFields = parseFields(body.reviewedFields);
    if (typeof body.pageCount !== "number" || !Number.isInteger(body.pageCount) || body.pageCount < 1 || body.pageCount > MAX_PAGES) {
      throw new LedgerRequestError("Nombre de pages OCR invalide.", 422);
    }
    const pageCount = body.pageCount;
    if (lines.some((line) => line.sourcePage > pageCount)) throw new LedgerRequestError("La page source d'une ligne est invalide.", 422);

    const saved = await withAuthenticatedActor(request, async (client, _identity, actorId) => {
      const project = await client.query<{ workspace_id: string }>(
        "SELECT workspace_id FROM app.construction_project WHERE id = $1", [projectId],
      );
      if (!project.rows[0]) throw new LedgerRequestError("Chantier introuvable.", 404);
      const workspaceId = await requireOwnedWorkspace(client, project.rows[0].workspace_id);
      const invoice = await client.query<{ id: string; document_id: string; document_sha256: string }>(
        `SELECT i.id, d.document_id, sd.sha256
         FROM app.supplier_invoice i
         JOIN app.project_document d ON d.workspace_id = i.workspace_id AND d.document_id = i.invoice_document_id
         JOIN app.stored_document sd ON sd.workspace_id = d.workspace_id AND sd.id = d.document_id
         WHERE i.workspace_id = $1 AND d.project_id = $2 AND i.id = $3
         FOR UPDATE OF i`,
        [workspaceId, projectId, invoiceId],
      );
      const invoiceRow = invoice.rows[0];
      if (!invoiceRow) throw new LedgerRequestError("Facture introuvable dans ce chantier.", 404);
      const confirmed = await client.query(
        `SELECT 1 FROM app.invoice_line_item
         WHERE workspace_id = $1 AND invoice_id = $2 AND review_status = 'confirmed' LIMIT 1`,
        [workspaceId, invoiceId],
      );
      if (confirmed.rows.length) throw new LedgerRequestError("Des lignes confirmées existent déjà. Corrigez-les sans relancer l’OCR.", 409);

      await client.query("DELETE FROM app.invoice_line_item WHERE workspace_id = $1 AND invoice_id = $2", [workspaceId, invoiceId]);
      const run = await client.query<{ id: string }>(
        `INSERT INTO app.invoice_extraction_run (
          workspace_id, invoice_id, engine, engine_version, source_document_sha256,
          status, recognized_text, extracted_fields, reviewed_fields, started_at, finished_at, created_by
        ) VALUES ($1, $2, $3, $4, $5, 'needs_review', $6, $7::jsonb, $8::jsonb, now(), now(), $9)
        RETURNING id`,
        [workspaceId, invoiceId, ENGINE, ENGINE_VERSION, invoiceRow.document_sha256, body.recognizedText,
          JSON.stringify(extractedFields), JSON.stringify(reviewedFields), actorId],
      );
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        await client.query(
          `INSERT INTO app.invoice_line_item (
            workspace_id, invoice_id, extraction_run_id, line_number, description,
            amount_basis, line_total_cents, source_page, source_text, confidence,
            extracted_fields, review_status
          ) VALUES ($1, $2, $3, $4, $5, 'unknown', $6, $7, $8, $9, $10::jsonb, 'needs_review')`,
          [workspaceId, invoiceId, run.rows[0].id, index + 1, line.description,
          line.lineTotalCents, line.sourcePage, line.description, line.confidence as number | null,
            JSON.stringify({ source: line.source, pageCount })],
        );
      }
      await appendAuditEvent(client, workspaceId, actorId, "invoice_ocr_completed", invoiceId, {
        pageCount,
        lineCount: lines.length,
      }, "supplier_invoice");
      return { extractionRunId: run.rows[0].id, lineCount: lines.length, reviewStatus: "needs_review" };
    });
    return json(saved, 201);
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
    if (error instanceof LedgerRequestError) return json({ error: error.message }, error.status);
    if (error instanceof RequestAuthorizationError) return json({ error: error.message }, error.status);
    if (error instanceof AccessConfigurationError) return json({ error: "Authentication is not configured." }, 503);
    console.error("Local invoice OCR result could not be stored.");
    return json({ error: "Le résultat OCR n’a pas pu être enregistré." }, 503);
  }
}

function parseLine(value: unknown): RecognizedLine {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LedgerRequestError("Ligne OCR invalide.", 422);
  const line = value as Record<string, unknown>;
  if (typeof line.description !== "string" || !line.description.trim() || line.description.length > 500 || line.description.includes("\0")) {
    throw new LedgerRequestError("Désignation OCR invalide.", 422);
  }
  if (!Number.isSafeInteger(line.lineTotalCents) || (line.lineTotalCents as number) <= 0) {
    throw new LedgerRequestError("Montant de ligne OCR invalide.", 422);
  }
  if (!Number.isInteger(line.sourcePage) || (line.sourcePage as number) < 1 || (line.sourcePage as number) > MAX_PAGES) {
    throw new LedgerRequestError("Page source OCR invalide.", 422);
  }
  if (line.confidence !== null && (typeof line.confidence !== "number" || !Number.isFinite(line.confidence) || line.confidence < 0 || line.confidence > 1)) {
    throw new LedgerRequestError("Confiance OCR invalide.", 422);
  }
  if (line.source !== "native_pdf_text" && line.source !== "local_ocr") throw new LedgerRequestError("Provenance OCR invalide.", 422);
  return { description: line.description.trim(), lineTotalCents: line.lineTotalCents as number, sourcePage: line.sourcePage as number, confidence: line.confidence, source: line.source };
}

function parseFields(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LedgerRequestError("Champs de facture OCR invalides.", 422);
  const fields = value as Record<string, unknown>;
  const supplierName = optionalText(fields.supplierName, 300);
  const invoiceNumber = optionalText(fields.invoiceNumber, 120);
  const invoiceDate = fields.invoiceDate == null || fields.invoiceDate === "" ? null : fields.invoiceDate;
  if (invoiceDate !== null && (typeof invoiceDate !== "string" || !validDate(invoiceDate))) {
    throw new LedgerRequestError("Date extraite invalide.", 422);
  }
  const totalCents = fields.totalCents == null ? null : fields.totalCents;
  if (totalCents !== null && (!Number.isSafeInteger(totalCents) || (totalCents as number) <= 0)) {
    throw new LedgerRequestError("Total extrait invalide.", 422);
  }
  return { supplierName, invoiceNumber, invoiceDate, totalCents };
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function optionalText(value: unknown, maxLength: number) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > maxLength || value.includes("\0")) {
    throw new LedgerRequestError("Champ de facture OCR invalide.", 422);
  }
  return value.trim() || null;
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
