-- Table des templates de séquences
CREATE TABLE public.outreach_sequences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Étapes de séquence (template)
CREATE TABLE public.sequence_steps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sequence_id UUID NOT NULL REFERENCES public.outreach_sequences(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('inmail', 'connection_request', 'profile_visit', 'message')),
  -- Conditions pour exécuter cette étape
  condition_type TEXT CHECK (condition_type IN ('always', 'if_connected', 'if_not_connected', 'if_no_response')),
  -- Délai avant cette étape (depuis l'étape précédente)
  delay_days INTEGER NOT NULL DEFAULT 0,
  delay_hours INTEGER NOT NULL DEFAULT 0,
  -- Fenêtre horaire préférée
  preferred_hour_start INTEGER CHECK (preferred_hour_start >= 0 AND preferred_hour_start <= 23),
  preferred_hour_end INTEGER CHECK (preferred_hour_end >= 0 AND preferred_hour_end <= 23),
  -- Contenu du message (pour inmail, connection_request, message)
  subject_template TEXT,
  message_template TEXT,
  -- Génération IA
  use_ai_personalization BOOLEAN NOT NULL DEFAULT false,
  ai_tone TEXT CHECK (ai_tone IN ('professional', 'casual', 'enthusiastic')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(sequence_id, step_order)
);

-- Candidats inscrits dans une séquence
CREATE TABLE public.sequence_enrollments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sequence_id UUID NOT NULL REFERENCES public.outreach_sequences(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL, -- LinkedIn account ID
  -- Infos candidat
  profile_id TEXT NOT NULL, -- LinkedIn profile ID
  profile_name TEXT,
  profile_headline TEXT,
  profile_url TEXT,
  -- Job associé (pour personnalisation)
  job_id TEXT,
  job_title TEXT,
  -- État
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'replied', 'bounced', 'cancelled')),
  current_step_order INTEGER NOT NULL DEFAULT 0,
  -- Tracking
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  replied_at TIMESTAMP WITH TIME ZONE,
  user_timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
  -- Éviter les doublons
  UNIQUE(sequence_id, profile_id)
);

-- Historique d'exécution des étapes
CREATE TABLE public.sequence_step_executions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  enrollment_id UUID NOT NULL REFERENCES public.sequence_enrollments(id) ON DELETE CASCADE,
  step_id UUID NOT NULL REFERENCES public.sequence_steps(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  -- Planification
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  -- Exécution
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'skipped', 'sending', 'sent', 'failed', 'cancelled')),
  executed_at TIMESTAMP WITH TIME ZONE,
  -- Contenu final (après personnalisation IA)
  final_subject TEXT,
  final_message TEXT,
  -- Erreurs
  error_message TEXT,
  skip_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.outreach_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequence_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequence_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequence_step_executions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for outreach_sequences
CREATE POLICY "Users can view their own sequences" ON public.outreach_sequences
  FOR SELECT USING (auth.uid() = created_by);
CREATE POLICY "Users can create their own sequences" ON public.outreach_sequences
  FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Users can update their own sequences" ON public.outreach_sequences
  FOR UPDATE USING (auth.uid() = created_by);
CREATE POLICY "Users can delete their own sequences" ON public.outreach_sequences
  FOR DELETE USING (auth.uid() = created_by);

-- RLS Policies for sequence_steps
CREATE POLICY "Users can view steps of their sequences" ON public.sequence_steps
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.outreach_sequences WHERE id = sequence_id AND created_by = auth.uid()
  ));
CREATE POLICY "Users can manage steps of their sequences" ON public.sequence_steps
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.outreach_sequences WHERE id = sequence_id AND created_by = auth.uid()
  ));

-- RLS Policies for sequence_enrollments
CREATE POLICY "Users can view their enrollments" ON public.sequence_enrollments
  FOR SELECT USING (auth.uid() = created_by);
CREATE POLICY "Users can create their enrollments" ON public.sequence_enrollments
  FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Users can update their enrollments" ON public.sequence_enrollments
  FOR UPDATE USING (auth.uid() = created_by);
CREATE POLICY "Users can delete their enrollments" ON public.sequence_enrollments
  FOR DELETE USING (auth.uid() = created_by);

-- RLS Policies for sequence_step_executions
CREATE POLICY "Users can view their step executions" ON public.sequence_step_executions
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.sequence_enrollments WHERE id = enrollment_id AND created_by = auth.uid()
  ));
CREATE POLICY "Users can manage their step executions" ON public.sequence_step_executions
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.sequence_enrollments WHERE id = enrollment_id AND created_by = auth.uid()
  ));

-- Service role access for edge functions
CREATE POLICY "Service role can manage all sequences" ON public.outreach_sequences
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role can manage all steps" ON public.sequence_steps
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role can manage all enrollments" ON public.sequence_enrollments
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role can manage all executions" ON public.sequence_step_executions
  FOR ALL USING (auth.role() = 'service_role');

-- Triggers for updated_at
CREATE TRIGGER update_outreach_sequences_updated_at
  BEFORE UPDATE ON public.outreach_sequences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sequence_enrollments_updated_at
  BEFORE UPDATE ON public.sequence_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sequence_step_executions_updated_at
  BEFORE UPDATE ON public.sequence_step_executions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();