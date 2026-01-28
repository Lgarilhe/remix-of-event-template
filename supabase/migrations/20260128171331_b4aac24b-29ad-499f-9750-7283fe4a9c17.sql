-- Create table for InMail queue
CREATE TABLE public.inmail_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id TEXT NOT NULL,
  recipient_profile_id TEXT NOT NULL,
  recipient_name TEXT,
  recipient_headline TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  scheduled_at TIMESTAMP WITH TIME ZONE,
  sent_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  user_timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.inmail_queue ENABLE ROW LEVEL SECURITY;

-- Users can view their own queued InMails
CREATE POLICY "Users can view their own queued InMails"
ON public.inmail_queue
FOR SELECT
USING (auth.uid() = created_by);

-- Users can create their own queued InMails
CREATE POLICY "Users can create their own queued InMails"
ON public.inmail_queue
FOR INSERT
WITH CHECK (auth.uid() = created_by);

-- Users can update their own queued InMails
CREATE POLICY "Users can update their own queued InMails"
ON public.inmail_queue
FOR UPDATE
USING (auth.uid() = created_by);

-- Users can delete their own queued InMails
CREATE POLICY "Users can delete their own queued InMails"
ON public.inmail_queue
FOR DELETE
USING (auth.uid() = created_by);

-- Service role can manage all InMails (for cron processing)
CREATE POLICY "Service role can manage all InMails"
ON public.inmail_queue
FOR ALL
USING (auth.role() = 'service_role');

-- Create trigger for updated_at
CREATE TRIGGER update_inmail_queue_updated_at
BEFORE UPDATE ON public.inmail_queue
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Index for efficient queue processing
CREATE INDEX idx_inmail_queue_status_scheduled ON public.inmail_queue (status, scheduled_at);
CREATE INDEX idx_inmail_queue_created_by ON public.inmail_queue (created_by);