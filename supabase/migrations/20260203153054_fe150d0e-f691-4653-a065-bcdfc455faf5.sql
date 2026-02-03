-- Ajouter le support des délais en minutes et du branchement conditionnel
ALTER TABLE public.sequence_steps
ADD COLUMN delay_minutes integer DEFAULT 0,
ADD COLUMN if_true_goto_step uuid REFERENCES public.sequence_steps(id) ON DELETE SET NULL,
ADD COLUMN if_false_goto_step uuid REFERENCES public.sequence_steps(id) ON DELETE SET NULL;