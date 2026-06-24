-- The "Enable automatic RLS" project option installs public.rls_auto_enable() as a
-- SECURITY DEFINER function. It only needs to run from the event trigger, not via
-- the REST API, so revoke EXECUTE from the public/api roles (clears security
-- advisor warnings 0028/0029). Reversible: re-GRANT EXECUTE to restore.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
