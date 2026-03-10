
-- Comments on candidates in ATS
CREATE TABLE public.candidate_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id text NOT NULL,
  job_id text,
  content text NOT NULL,
  mentions uuid[] DEFAULT '{}',
  created_by uuid NOT NULL,
  organization_id uuid REFERENCES public.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.candidate_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view comments"
  ON public.candidate_comments FOR SELECT
  USING (organization_id = get_user_org_id(auth.uid()) OR (organization_id IS NULL AND created_by = auth.uid()));

CREATE POLICY "Org members can create comments"
  ON public.candidate_comments FOR INSERT
  WITH CHECK (auth.uid() = created_by AND (organization_id IS NULL OR is_org_member(auth.uid(), organization_id)));

CREATE POLICY "Authors can update their comments"
  ON public.candidate_comments FOR UPDATE
  USING (created_by = auth.uid());

CREATE POLICY "Authors can delete their comments"
  ON public.candidate_comments FOR DELETE
  USING (created_by = auth.uid());

CREATE POLICY "Service role can manage all comments"
  ON public.candidate_comments FOR ALL
  USING (auth.role() = 'service_role');

-- In-app notifications
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL DEFAULT 'mention',
  title text NOT NULL,
  body text,
  link text,
  read_at timestamptz,
  metadata jsonb DEFAULT '{}',
  organization_id uuid REFERENCES public.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications"
  ON public.notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update their own notifications"
  ON public.notifications FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage all notifications"
  ON public.notifications FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Org members can create notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (is_org_member(auth.uid(), organization_id) OR organization_id IS NULL);

-- Enable realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Index for quick lookups
CREATE INDEX idx_candidate_comments_candidate ON public.candidate_comments(candidate_id);
CREATE INDEX idx_candidate_comments_org ON public.candidate_comments(organization_id);
CREATE INDEX idx_notifications_user ON public.notifications(user_id, read_at);
