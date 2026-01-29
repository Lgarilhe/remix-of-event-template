-- Add network_distance column to track connection level
ALTER TABLE public.inmail_queue 
ADD COLUMN IF NOT EXISTS network_distance integer DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.inmail_queue.network_distance IS 'LinkedIn connection degree: 1=1st degree, 2=2nd degree, 3=3rd degree';