BEGIN;

-- RLS policies and the authenticated session query call this transaction-local actor helper.
GRANT EXECUTE ON FUNCTION app_private.actor_user_id() TO app_runtime;

COMMIT;
