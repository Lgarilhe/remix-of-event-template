-- A mailbox mapping is personal. Team members may still read connection
-- metadata for multi-sender configuration, but browser writes must never be
-- able to claim, edit, or unlink another member's mailbox.

DROP POLICY IF EXISTS "member_email_accounts_insert" ON public.member_email_accounts;
CREATE POLICY "member_email_accounts_insert" ON public.member_email_accounts
  FOR INSERT
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND user_id = auth.uid()
    AND linked_by = auth.uid()
  );

DROP POLICY IF EXISTS "member_email_accounts_update" ON public.member_email_accounts;
CREATE POLICY "member_email_accounts_update" ON public.member_email_accounts
  FOR UPDATE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND user_id = auth.uid()
  )
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND user_id = auth.uid()
    AND linked_by = auth.uid()
  );

DROP POLICY IF EXISTS "member_email_accounts_delete" ON public.member_email_accounts;
CREATE POLICY "member_email_accounts_delete" ON public.member_email_accounts
  FOR DELETE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND user_id = auth.uid()
  );

