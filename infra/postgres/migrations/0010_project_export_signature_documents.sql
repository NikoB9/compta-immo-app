BEGIN;

CREATE OR REPLACE FUNCTION app_private.can_read_document(target_document_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_document d
    WHERE d.document_id = target_document_id
      AND app_private.is_project_member(d.project_id)
  )
  OR EXISTS (
    SELECT 1 FROM project_movement m
    WHERE m.evidence_document_id = target_document_id
      AND app_private.is_project_member(m.project_id)
  )
  OR EXISTS (
    SELECT 1 FROM project_movement m
    JOIN supplier_invoice i
      ON i.workspace_id = m.workspace_id AND i.id = m.invoice_id
    WHERE i.invoice_document_id = target_document_id
      AND app_private.is_project_member(m.project_id)
  )
  OR EXISTS (
    SELECT 1 FROM project_mandate_signature s
    WHERE s.signature_image_document_id = target_document_id
      AND app_private.is_project_member(s.project_id)
  )
$$;

COMMIT;
