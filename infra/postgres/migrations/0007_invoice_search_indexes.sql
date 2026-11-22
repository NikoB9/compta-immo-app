\set ON_ERROR_STOP on
BEGIN;

CREATE INDEX supplier_invoice_search_idx
  ON app.supplier_invoice USING gin (
    to_tsvector('french', coalesce(supplier_name, '') || ' ' || coalesce(invoice_number, ''))
  );
CREATE INDEX invoice_line_description_search_idx
  ON app.invoice_line_item USING gin (to_tsvector('french', description));
CREATE INDEX supplier_invoice_amount_search_idx
  ON app.supplier_invoice (workspace_id, invoice_total_cents);
CREATE INDEX invoice_line_amount_search_idx
  ON app.invoice_line_item (workspace_id, line_total_cents)
  WHERE line_total_cents IS NOT NULL;

COMMIT;
