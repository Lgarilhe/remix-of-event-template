
-- Create sequence_snippets table
CREATE TABLE IF NOT EXISTS public.sequence_snippets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.sequence_snippets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can manage snippets"
  ON public.sequence_snippets
  FOR ALL
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

-- Create sequence_templates table
CREATE TABLE IF NOT EXISTS public.sequence_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  steps_config JSONB NOT NULL DEFAULT '[]'::jsonb,
  category TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.sequence_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view own and system templates"
  ON public.sequence_templates
  FOR SELECT
  TO authenticated
  USING (is_system = true OR public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "Org members can manage own templates"
  ON public.sequence_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "Org members can update own templates"
  ON public.sequence_templates
  FOR UPDATE
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "Org members can delete own templates"
  ON public.sequence_templates
  FOR DELETE
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- Add new columns for LOV-1/2/3 features
ALTER TABLE public.sequence_steps
  ADD COLUMN IF NOT EXISTS parent_step_id UUID REFERENCES public.sequence_steps(id),
  ADD COLUMN IF NOT EXISTS branch TEXT,
  ADD COLUMN IF NOT EXISTS step_channel TEXT DEFAULT 'linkedin',
  ADD COLUMN IF NOT EXISTS ai_personalization_source TEXT DEFAULT 'profile_only',
  ADD COLUMN IF NOT EXISTS ai_personalization_prompt TEXT,
  ADD COLUMN IF NOT EXISTS sender_id TEXT,
  ADD COLUMN IF NOT EXISTS include_unsubscribe BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS signature_id TEXT,
  ADD COLUMN IF NOT EXISTS cc_emails TEXT[],
  ADD COLUMN IF NOT EXISTS bcc_emails TEXT[];

ALTER TABLE public.sequence_enrollments
  ADD COLUMN IF NOT EXISTS email_used TEXT,
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS company_name TEXT;

ALTER TABLE public.sequence_step_executions
  ADD COLUMN IF NOT EXISTS channel TEXT,
  ADD COLUMN IF NOT EXISTS tracking_data JSONB,
  ADD COLUMN IF NOT EXISTS ai_snippet TEXT,
  ADD COLUMN IF NOT EXISTS personalized_subject TEXT;

ALTER TABLE public.outreach_sequences
  ADD COLUMN IF NOT EXISTS stop_on_company_reply BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS multi_sender_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.sequence_templates(id);
