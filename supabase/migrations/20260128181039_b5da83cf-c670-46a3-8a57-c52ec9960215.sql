-- Add timeout_branch_step_id for conditional branching
ALTER TABLE public.sequence_steps ADD COLUMN IF NOT EXISTS timeout_branch_step_id uuid REFERENCES public.sequence_steps(id);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_sequence_steps_timeout_branch ON public.sequence_steps(timeout_branch_step_id) WHERE timeout_branch_step_id IS NOT NULL;