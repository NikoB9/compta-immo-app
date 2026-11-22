\set ON_ERROR_STOP on
BEGIN;

CREATE TABLE app.invoice_extraction_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  engine text NOT NULL,
  engine_version text NOT NULL,
  source_document_sha256 char(64) NOT NULL CHECK (source_document_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'needs_review', 'failed')),
  recognized_text text,
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid NOT NULL REFERENCES app.user_account(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, invoice_id) REFERENCES app.supplier_invoice(workspace_id, id) ON DELETE RESTRICT,
  CHECK ((status IN ('completed', 'needs_review', 'failed')) = (finished_at IS NOT NULL)),
  CHECK (error_code IS NULL OR status = 'failed')
);
CREATE INDEX invoice_extraction_run_invoice ON app.invoice_extraction_run(workspace_id, invoice_id, created_at DESC);

CREATE TABLE app.invoice_line_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  extraction_run_id uuid,
  line_number integer NOT NULL CHECK (line_number > 0),
  description text NOT NULL CHECK (length(trim(description)) > 0),
  quantity numeric(18, 6) CHECK (quantity IS NULL OR quantity > 0),
  unit text,
  unit_price_cents bigint CHECK (unit_price_cents IS NULL OR unit_price_cents >= 0),
  amount_basis text NOT NULL DEFAULT 'unknown' CHECK (amount_basis IN ('before_tax', 'after_tax', 'unknown')),
  tax_rate_basis_points smallint CHECK (tax_rate_basis_points BETWEEN 0 AND 10000),
  tax_amount_cents bigint CHECK (tax_amount_cents IS NULL OR tax_amount_cents >= 0),
  line_total_cents bigint CHECK (line_total_cents IS NULL OR line_total_cents >= 0),
  source_page smallint CHECK (source_page IS NULL OR source_page > 0),
  source_text text,
  confidence numeric(5, 4) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  extracted_fields jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(extracted_fields) = 'object'),
  review_status text NOT NULL DEFAULT 'needs_review' CHECK (review_status IN ('needs_review', 'confirmed', 'excluded')),
  reviewed_by uuid REFERENCES app.user_account(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, invoice_id, line_number),
  FOREIGN KEY (workspace_id, invoice_id) REFERENCES app.supplier_invoice(workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, extraction_run_id) REFERENCES app.invoice_extraction_run(workspace_id, id) ON DELETE RESTRICT,
  CHECK ((review_status = 'confirmed') = (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX invoice_line_invoice_order ON app.invoice_line_item(workspace_id, invoice_id, line_number);
CREATE INDEX invoice_line_amount ON app.invoice_line_item(workspace_id, line_total_cents);
CREATE INDEX invoice_line_search ON app.invoice_line_item USING gin (to_tsvector('simple', description));

ALTER TABLE app.invoice_extraction_run ENABLE ROW LEVEL SECURITY;
CREATE POLICY extraction_run_owner_all ON app.invoice_extraction_run
  USING (app_private.owns_workspace(workspace_id))
  WITH CHECK (app_private.owns_workspace(workspace_id));
CREATE POLICY extraction_run_project_guest_read ON app.invoice_extraction_run FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM app.supplier_invoice i
    JOIN app.project_document d
      ON d.workspace_id = i.workspace_id AND d.document_id = i.invoice_document_id
    WHERE i.workspace_id = invoice_extraction_run.workspace_id
      AND i.id = invoice_extraction_run.invoice_id
      AND app_private.is_project_member(d.project_id)
  )
);

ALTER TABLE app.invoice_line_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_line_owner_all ON app.invoice_line_item
  USING (app_private.owns_workspace(workspace_id))
  WITH CHECK (app_private.owns_workspace(workspace_id));
CREATE POLICY invoice_line_project_guest_read ON app.invoice_line_item FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM app.supplier_invoice i
    JOIN app.project_document d
      ON d.workspace_id = i.workspace_id AND d.document_id = i.invoice_document_id
    WHERE i.workspace_id = invoice_line_item.workspace_id
      AND i.id = invoice_line_item.invoice_id
      AND app_private.is_project_member(d.project_id)
  )
);

COMMIT;
