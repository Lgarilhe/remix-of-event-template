-- Add next_step_id column to sequence_steps for graph-based step chaining
ALTER TABLE public.sequence_steps 
ADD COLUMN IF NOT EXISTS next_step_id UUID REFERENCES public.sequence_steps(id);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_sequence_steps_next_step_id ON public.sequence_steps(next_step_id);