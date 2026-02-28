
-- Table pour stocker l'historique des appels Aircall
CREATE TABLE public.aircall_calls (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  aircall_id bigint NOT NULL UNIQUE,
  direction text NOT NULL, -- 'inbound' ou 'outbound'
  status text, -- 'done', 'missed', 'voicemail', etc.
  started_at timestamp with time zone,
  answered_at timestamp with time zone,
  ended_at timestamp with time zone,
  duration integer DEFAULT 0, -- durée en secondes
  raw_number text, -- numéro brut du contact
  caller_name text,
  caller_number text,
  callee_name text,
  callee_number text,
  recording_url text,
  voicemail_url text,
  tags text[] DEFAULT '{}',
  notes text,
  user_name text, -- nom du recruteur Aircall
  user_email text, -- email du recruteur
  -- Matching candidat
  matched_candidate_phone text, -- numéro normalisé utilisé pour le match
  matched_candidate_name text, -- nom utilisé pour le match fuzzy
  matched_airtable_candidate_id text, -- lien vers airtable_candidates
  matched_linkedin_profile_id text, -- lien vers profil LinkedIn
  -- Metadata
  raw_data jsonb DEFAULT '{}'::jsonb,
  synced_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Index pour le matching par numéro
CREATE INDEX idx_aircall_calls_raw_number ON public.aircall_calls (raw_number);
CREATE INDEX idx_aircall_calls_caller_number ON public.aircall_calls (caller_number);
CREATE INDEX idx_aircall_calls_callee_number ON public.aircall_calls (callee_number);
CREATE INDEX idx_aircall_calls_matched_airtable ON public.aircall_calls (matched_airtable_candidate_id);
CREATE INDEX idx_aircall_calls_matched_linkedin ON public.aircall_calls (matched_linkedin_profile_id);
CREATE INDEX idx_aircall_calls_started_at ON public.aircall_calls (started_at DESC);

-- Enable RLS
ALTER TABLE public.aircall_calls ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Authenticated users can read calls"
  ON public.aircall_calls FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role can manage calls"
  ON public.aircall_calls FOR ALL
  USING (auth.role() = 'service_role');
