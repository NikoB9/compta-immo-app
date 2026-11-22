\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE app.invoice_extraction_run
  ADD COLUMN extracted_fields jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(extracted_fields) = 'object'),
  ADD COLUMN reviewed_fields jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(reviewed_fields) = 'object');

COMMIT;
