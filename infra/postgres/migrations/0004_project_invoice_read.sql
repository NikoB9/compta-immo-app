\set ON_ERROR_STOP on
BEGIN;

-- Guests may see only invoices that are explicitly linked to one of their assigned projects.
CREATE POLICY invoice_owner_or_project_guest_read ON app.supplier_invoice FOR SELECT USING (
  app_private.owns_workspace(workspace_id)
  OR EXISTS (
    SELECT 1 FROM app.project_movement m
    WHERE m.workspace_id = supplier_invoice.workspace_id
      AND m.invoice_id = supplier_invoice.id
      AND app_private.is_project_member(m.project_id)
  )
  OR EXISTS (
    SELECT 1 FROM app.project_document d
    WHERE d.workspace_id = supplier_invoice.workspace_id
      AND d.document_id = supplier_invoice.invoice_document_id
      AND app_private.is_project_member(d.project_id)
  )
);

COMMIT;
