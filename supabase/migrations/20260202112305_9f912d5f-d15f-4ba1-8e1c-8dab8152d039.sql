-- Table pour stocker les opportunités de nurturing détectées
CREATE TABLE public.nurturing_opportunities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Candidat concerné
  candidate_id TEXT NOT NULL,
  candidate_name TEXT,
  candidate_headline TEXT,
  candidate_profile_url TEXT,
  
  -- Job associé (optionnel)
  job_id TEXT,
  job_title TEXT,
  
  -- Type de trigger détecté
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('silence', 'new_job_match', 'stage_change', 'intent_detected', 'scheduled_followup')),
  
  -- Priorité calculée (1-100)
  priority_score INTEGER NOT NULL DEFAULT 50,
  
  -- Détails de l'analyse
  analysis_context JSONB DEFAULT '{}'::jsonb,
  last_message_at TIMESTAMP WITH TIME ZONE,
  days_since_contact INTEGER,
  detected_intent TEXT,
  
  -- Action suggérée
  suggested_action TEXT NOT NULL CHECK (suggested_action IN ('personalized_message', 'job_alert', 'call_proposal', 'content_share', 'followup')),
  suggested_message TEXT,
  suggested_subject TEXT,
  
  -- Statut du workflow
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'sent', 'dismissed', 'expired')),
  
  -- Tracking
  linkedin_account_id TEXT,
  created_by UUID NOT NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  sent_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + INTERVAL '7 days')
);

-- Index pour les requêtes fréquentes
CREATE INDEX idx_nurturing_status ON public.nurturing_opportunities(status);
CREATE INDEX idx_nurturing_candidate ON public.nurturing_opportunities(candidate_id);
CREATE INDEX idx_nurturing_created_by ON public.nurturing_opportunities(created_by);
CREATE INDEX idx_nurturing_priority ON public.nurturing_opportunities(priority_score DESC);
CREATE INDEX idx_nurturing_trigger ON public.nurturing_opportunities(trigger_type);

-- Enable RLS
ALTER TABLE public.nurturing_opportunities ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own opportunities"
ON public.nurturing_opportunities
FOR SELECT
USING (auth.uid() = created_by);

CREATE POLICY "Users can create their own opportunities"
ON public.nurturing_opportunities
FOR INSERT
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update their own opportunities"
ON public.nurturing_opportunities
FOR UPDATE
USING (auth.uid() = created_by);

CREATE POLICY "Users can delete their own opportunities"
ON public.nurturing_opportunities
FOR DELETE
USING (auth.uid() = created_by);

CREATE POLICY "Service role can manage all opportunities"
ON public.nurturing_opportunities
FOR ALL
USING (auth.role() = 'service_role');

-- Trigger pour updated_at
CREATE TRIGGER update_nurturing_opportunities_updated_at
BEFORE UPDATE ON public.nurturing_opportunities
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();