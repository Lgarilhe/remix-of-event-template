
-- Table to store conversation categories/tags
CREATE TABLE public.chat_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('interested', 'not_interested', 'to_recontact', 'no_response')),
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(chat_id, created_by)
);

-- Enable RLS
ALTER TABLE public.chat_categories ENABLE ROW LEVEL SECURITY;

-- Users can only see their own categories
CREATE POLICY "Users can view their own chat categories"
ON public.chat_categories FOR SELECT
USING (auth.uid() = created_by);

CREATE POLICY "Users can create their own chat categories"
ON public.chat_categories FOR INSERT
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update their own chat categories"
ON public.chat_categories FOR UPDATE
USING (auth.uid() = created_by);

CREATE POLICY "Users can delete their own chat categories"
ON public.chat_categories FOR DELETE
USING (auth.uid() = created_by);
