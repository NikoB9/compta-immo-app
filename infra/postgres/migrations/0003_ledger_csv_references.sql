BEGIN;

ALTER TABLE app.financial_entry
  ADD COLUMN external_reference text,
  ADD COLUMN category_code_snapshot text,
  ADD COLUMN document_reference_snapshot text;

UPDATE app.financial_entry
SET external_reference = id::text;

ALTER TABLE app.financial_entry
  ALTER COLUMN external_reference SET NOT NULL,
  ADD CONSTRAINT financial_entry_external_reference_length
    CHECK (length(external_reference) BETWEEN 1 AND 128),
  ADD CONSTRAINT financial_entry_category_code_length
    CHECK (category_code_snapshot IS NULL OR length(category_code_snapshot) <= 80),
  ADD CONSTRAINT financial_entry_document_reference_length
    CHECK (document_reference_snapshot IS NULL OR length(document_reference_snapshot) <= 200),
  ADD CONSTRAINT financial_entry_js_safe_amount
    CHECK (amount_cents <= 9007199254740991),
  ADD CONSTRAINT financial_entry_date_matches_tax_year
    CHECK (tax_year = extract(year FROM occurred_on)::integer),
  ADD CONSTRAINT financial_entry_workspace_external_reference_unique
    UNIQUE (workspace_id, external_reference);

COMMIT;
