-- Create job_favorites table for saving favorite jobs
CREATE TABLE public.job_favorites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, job_id)
);

-- Create index for faster lookups
CREATE INDEX idx_job_favorites_user_id ON public.job_favorites(user_id);
CREATE INDEX idx_job_favorites_job_id ON public.job_favorites(job_id);

-- Enable Row Level Security
ALTER TABLE public.job_favorites ENABLE ROW LEVEL SECURITY;

-- Users can view their own favorites
CREATE POLICY "Users can view their own favorites"
ON public.job_favorites
FOR SELECT
USING (auth.uid() = user_id);

-- Users can add their own favorites
CREATE POLICY "Users can add their own favorites"
ON public.job_favorites
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can remove their own favorites
CREATE POLICY "Users can delete their own favorites"
ON public.job_favorites
FOR DELETE
USING (auth.uid() = user_id);