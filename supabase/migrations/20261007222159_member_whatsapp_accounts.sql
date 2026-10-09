-- Personal WhatsApp accounts. Connection ownership is established exclusively
-- by the signed hosted-auth callback; browsers cannot claim an account ID.
CREATE TABLE IF NOT EXISTS public.member_whatsapp_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  whatsapp_account_id text NOT NULL UNIQUE,
  phone_number text,
  name text,
  account_status text NOT NULL DEFAULT 'CONNECTING',
  linked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id, whatsapp_account_id)
);

CREATE INDEX IF NOT EXISTS idx_member_whatsapp_accounts_org_id
  ON public.member_whatsapp_accounts (organization_id);
CREATE INDEX IF NOT EXISTS idx_member_whatsapp_accounts_owner
  ON public.member_whatsapp_accounts (user_id, organization_id);

ALTER TABLE public.member_whatsapp_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_whatsapp_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.member_whatsapp_accounts TO authenticated;
GRANT ALL ON public.member_whatsapp_accounts TO service_role;

DROP POLICY IF EXISTS member_whatsapp_accounts_self_read ON public.member_whatsapp_accounts;
CREATE POLICY member_whatsapp_accounts_self_read
  ON public.member_whatsapp_accounts FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND organization_id = public.get_user_org_id((SELECT auth.uid()))
    AND public.is_org_member((SELECT auth.uid()), organization_id)
  );

DROP POLICY IF EXISTS member_whatsapp_accounts_service ON public.member_whatsapp_accounts;
CREATE POLICY member_whatsapp_accounts_service
  ON public.member_whatsapp_accounts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Incoming candidate replies have no action_plan_id. Ownership must be resolved
-- from the exact personal account, as for LinkedIn and email, never its name.
DROP POLICY IF EXISTS candidate_action_messages_whatsapp_owner_read ON public.candidate_action_messages;
CREATE POLICY candidate_action_messages_whatsapp_owner_read
  ON public.candidate_action_messages FOR SELECT TO authenticated
  USING (
    channel = 'whatsapp'
    AND owner_user_id = (SELECT auth.uid())
    AND organization_id = public.get_user_org_id((SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.member_whatsapp_accounts a
      WHERE a.user_id = (SELECT auth.uid())
        AND a.organization_id = candidate_action_messages.organization_id
        AND a.whatsapp_account_id = candidate_action_messages.account_id
    )
  );
