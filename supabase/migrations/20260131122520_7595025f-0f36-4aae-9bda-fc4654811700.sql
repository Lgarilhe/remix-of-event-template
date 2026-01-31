-- Create candidate_notes table for adding notes to candidates
CREATE TABLE public.candidate_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  candidate_id TEXT NOT NULL, -- Notion candidate ID or LinkedIn profile ID
  shortlist_id TEXT, -- Optional link to shortlist entry
  content TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.candidate_notes ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view all notes" 
ON public.candidate_notes 
FOR SELECT 
USING (true);

CREATE POLICY "Users can create their own notes" 
ON public.candidate_notes 
FOR INSERT 
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update their own notes" 
ON public.candidate_notes 
FOR UPDATE 
USING (auth.uid() = created_by);

CREATE POLICY "Users can delete their own notes" 
ON public.candidate_notes 
FOR DELETE 
USING (auth.uid() = created_by);

-- Create candidate_reminders table for scheduling follow-ups
CREATE TABLE public.candidate_reminders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  candidate_id TEXT NOT NULL, -- Notion candidate ID or LinkedIn profile ID
  candidate_name TEXT,
  shortlist_id TEXT, -- Optional link to shortlist entry
  job_id TEXT, -- Optional link to job
  job_title TEXT,
  title TEXT NOT NULL,
  description TEXT,
  due_at TIMESTAMP WITH TIME ZONE NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.candidate_reminders ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own reminders" 
ON public.candidate_reminders 
FOR SELECT 
USING (auth.uid() = created_by);

CREATE POLICY "Users can create their own reminders" 
ON public.candidate_reminders 
FOR INSERT 
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update their own reminders" 
ON public.candidate_reminders 
FOR UPDATE 
USING (auth.uid() = created_by);

CREATE POLICY "Users can delete their own reminders" 
ON public.candidate_reminders 
FOR DELETE 
USING (auth.uid() = created_by);

-- Triggers for updated_at
CREATE TRIGGER update_candidate_notes_updated_at
BEFORE UPDATE ON public.candidate_notes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_candidate_reminders_updated_at
BEFORE UPDATE ON public.candidate_reminders
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();