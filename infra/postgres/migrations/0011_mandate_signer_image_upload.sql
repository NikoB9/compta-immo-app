BEGIN;

CREATE POLICY document_mandate_signer_insert ON app.stored_document FOR INSERT WITH CHECK (
  uploaded_by = app_private.actor_user_id()
  AND EXISTS (
    SELECT 1
    FROM app.project_mandate m
    JOIN app.user_account signer ON signer.id = app_private.actor_user_id()
    WHERE m.workspace_id = stored_document.workspace_id
      AND app_private.is_project_member(m.project_id)
      AND (m.mandate_data->>'effectiveOn')::date <= CURRENT_DATE
      AND (m.mandate_data->>'expiresOn')::date >= CURRENT_DATE
      AND (
        (
          lower(m.mandate_data #>> ARRAY['parties', 'mandant', 'email']) = lower(signer.email)
          AND NOT EXISTS (
            SELECT 1 FROM app.project_mandate_signature s
            WHERE s.mandate_id = m.id AND s.signer_user_id = app_private.actor_user_id() AND s.party_role = 'mandant'
          )
        )
        OR (
          lower(m.mandate_data #>> ARRAY['parties', 'mandataire', 'email']) = lower(signer.email)
          AND NOT EXISTS (
            SELECT 1 FROM app.project_mandate_signature s
            WHERE s.mandate_id = m.id AND s.signer_user_id = app_private.actor_user_id() AND s.party_role = 'mandataire'
          )
        )
      )
  )
);

COMMIT;
