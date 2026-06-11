CREATE TABLE public.candidate_portal_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id text NOT NULL,
  candidate_name text,
  job_id text,
  job_title text,
  token text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  pipeline_stage text DEFAULT 'Nouveau',
  next_steps text,
  company_name text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '90 days'),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE(token)
);

ALTER TABLE public.candidate_portal_tokens ENABLE ROW LEVEL SECURITY;

-- Authenticated users can manage their own tokens
DROP POLICY IF EXISTS "Users can create portal tokens" ON public.candidate_portal_tokens;
CREATE POLICY "Users can create portal tokens" ON public.candidate_portal_tokens
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can view their own tokens" ON public.candidate_portal_tokens;
CREATE POLICY "Users can view their own tokens" ON public.candidate_portal_tokens
  FOR SELECT TO authenticated USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can update their own tokens" ON public.candidate_portal_tokens;
CREATE POLICY "Users can update their own tokens" ON public.candidate_portal_tokens
  FOR UPDATE TO authenticated USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can delete their own tokens" ON public.candidate_portal_tokens;
CREATE POLICY "Users can delete their own tokens" ON public.candidate_portal_tokens
  FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- Public access by token (for the portal page — anon role)
DROP POLICY IF EXISTS "Anyone can view active tokens by token value" ON public.candidate_portal_tokens;
CREATE POLICY "Anyone can view active tokens by token value" ON public.candidate_portal_tokens
  FOR SELECT TO anon USING (is_active = true AND (expires_at IS NULL OR expires_at > now()));