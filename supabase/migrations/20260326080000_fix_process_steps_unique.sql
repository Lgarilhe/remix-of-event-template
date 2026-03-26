-- Remove UNIQUE constraint on (project_id, step_order) to allow drag-and-drop reordering.
-- The order is managed application-side, and the UNIQUE constraint causes conflicts
-- during reorder operations (swapping step_order values).

ALTER TABLE public.mission_process_steps DROP CONSTRAINT IF EXISTS mission_process_steps_project_id_step_order_key;

-- Add a non-unique index for performance
CREATE INDEX IF NOT EXISTS idx_process_steps_project_order
  ON public.mission_process_steps(project_id, step_order);
