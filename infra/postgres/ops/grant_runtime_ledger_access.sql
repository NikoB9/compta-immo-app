\set ON_ERROR_STOP on

-- Apply after grant_runtime_session_access.sql; these are the first ledger API grants.
GRANT SELECT ON app.building_address, app.unit TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.financial_entry TO app_runtime;
GRANT INSERT ON app.audit_event TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO app_runtime;

-- Authenticated invoice attachment and preview endpoints.
GRANT SELECT, INSERT ON app.stored_document, app.entry_document TO app_runtime;

-- Project and debours workspace API.
GRANT SELECT, INSERT ON app.construction_project TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.project_movement TO app_runtime;
GRANT SELECT, INSERT ON app.supplier_invoice TO app_runtime;
GRANT SELECT ON app.invoice_payment TO app_runtime;
GRANT SELECT, INSERT ON app.project_document TO app_runtime;
