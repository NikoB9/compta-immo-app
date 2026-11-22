\set ON_ERROR_STOP on

-- These grants model a non-owner application role. Production grants should be
-- narrowed to the server operations as the API routes are added.
CREATE ROLE app_runtime NOLOGIN;
GRANT USAGE ON SCHEMA app, app_private TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO app_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private TO app_runtime;

INSERT INTO app.user_account (id, email, display_name) VALUES
  ('10000000-0000-4000-8000-000000000001', 'owner@example.test', 'Owner'),
  ('10000000-0000-4000-8000-000000000002', 'guest@example.test', 'Guest'),
  ('10000000-0000-4000-8000-000000000003', 'other@example.test', 'Other');
INSERT INTO app.workspace (id, name) VALUES
  ('20000000-0000-4000-8000-000000000001', 'Workspace one'),
  ('20000000-0000-4000-8000-000000000002', 'Workspace two');
INSERT INTO app.workspace_membership (workspace_id, user_id, role) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', 'owner');
INSERT INTO app.building_address (id, workspace_id, label, address_line1, postal_code, locality) VALUES
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Building', '1 Example Street', '00000', 'Example'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Other building', '2 Example Street', '00000', 'Example');
INSERT INTO app.category (id, workspace_id, code, label, entry_type) VALUES
  ('35000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'WORKS', 'Works', 'expense');
INSERT INTO app.financial_entry (workspace_id, building_id, external_reference, category_id, tax_year, occurred_on, entry_type, description, amount_cents, administrative_amount_cents, internal_only_cents, created_by) VALUES
  ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'fixture-tax-record', '35000000-0000-4000-8000-000000000001', 2026, DATE '2026-01-01', 'expense', 'Tax record', 10000, 10000, 0, '10000000-0000-4000-8000-000000000001');
INSERT INTO app.stored_document (id, workspace_id, object_key, original_filename, media_type, byte_size, sha256, uploaded_by) VALUES
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'test/project-proof.pdf', 'proof.pdf', 'application/pdf', 10, repeat('a', 64), '10000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'test/other.pdf', 'other.pdf', 'application/pdf', 10, repeat('b', 64), '10000000-0000-4000-8000-000000000003'),
  ('40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'test/project-invoice.pdf', 'invoice.pdf', 'application/pdf', 10, repeat('c', 64), '10000000-0000-4000-8000-000000000001');
INSERT INTO app.supplier_invoice (id, workspace_id, supplier_name, invoice_total_cents, invoice_document_id)
VALUES ('70000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Supplier', 5000, '40000000-0000-4000-8000-000000000003');
INSERT INTO app.construction_project (id, workspace_id, building_id, name) VALUES
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Assigned project');
INSERT INTO app.project_membership (project_id, user_id) VALUES
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002');
INSERT INTO app.project_movement (id, workspace_id, project_id, movement_type, occurred_on, amount_cents, invoice_id, evidence_document_id, created_by) VALUES
  ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'supplier_payment', DATE '2026-01-01', 5000, '70000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001');
INSERT INTO app.invoice_payment (workspace_id, invoice_id, paid_on, amount_cents, paid_by)
VALUES ('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', DATE '2026-01-01', 3000, 'owner');

DO $$ BEGIN
  INSERT INTO app.invoice_payment (workspace_id, invoice_id, paid_on, amount_cents, paid_by)
  VALUES ('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', DATE '2026-01-02', 2500, 'owner');
  RAISE EXCEPTION 'overpayment allocation unexpectedly accepted';
EXCEPTION WHEN check_violation THEN NULL;
END $$;

-- The database must reject a document from another workspace even if the
-- caller supplies a valid project ID.
DO $$ BEGIN
  INSERT INTO app.project_document (workspace_id, project_id, document_id, shared_by)
  VALUES ('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'cross-workspace project document unexpectedly accepted';
EXCEPTION WHEN foreign_key_violation THEN NULL;
END $$;

SET ROLE app_runtime;
DO $$
BEGIN
  IF app_private.resolve_user_id_for_email('guest@example.test') IS DISTINCT FROM '10000000-0000-4000-8000-000000000002'::uuid THEN
    RAISE EXCEPTION 'verified guest email should resolve to the active user';
  END IF;
  IF app_private.resolve_user_id_for_email('missing@example.test') IS NOT NULL THEN
    RAISE EXCEPTION 'unknown email should not resolve to an application user';
  END IF;
END $$;
SET app.actor_user_id = '10000000-0000-4000-8000-000000000002';
DO $$
BEGIN
  IF (SELECT count(*) FROM app.construction_project) <> 1 THEN
    RAISE EXCEPTION 'guest should only see assigned project';
  END IF;
  IF (SELECT count(*) FROM app.project_movement) <> 1 THEN
    RAISE EXCEPTION 'guest should see assigned project movements';
  END IF;
  IF (SELECT count(*) FROM app.stored_document) <> 2 THEN
    RAISE EXCEPTION 'guest should see only project evidence and linked invoice';
  END IF;
  IF (SELECT count(*) FROM app.financial_entry) <> 0 THEN
    RAISE EXCEPTION 'project guest must not see fiscal ledger';
  END IF;
  BEGIN
    INSERT INTO app.project_movement (workspace_id, project_id, movement_type, occurred_on, amount_cents, created_by)
    VALUES ('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'advance', DATE '2026-01-02', 100, '10000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'project guest unexpectedly inserted movement';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET ROLE app_runtime;
SET app.actor_user_id = '10000000-0000-4000-8000-000000000001';
DO $$
BEGIN
  IF (SELECT count(*) FROM app.construction_project) <> 1 THEN
    RAISE EXCEPTION 'workspace owner should see its project';
  END IF;
  IF (SELECT count(*) FROM app.project_movement) <> 1 THEN
    RAISE EXCEPTION 'workspace owner should see its project movements';
  END IF;
  IF (SELECT count(*) FROM app.financial_entry) <> 1 THEN
    RAISE EXCEPTION 'workspace owner should see its fiscal ledger';
  END IF;
END $$;
RESET ROLE;
