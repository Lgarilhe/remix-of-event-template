-- Add retry_count column to track retry attempts per execution
ALTER TABLE public.sequence_step_executions
ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;