-- ─────────────────────────────────────────────────────────────────────────────
-- atomic_tracking_append v3 — restaure la priorité de status
--
-- Audit Opus 2026-05-07 : la v2 (20260402072522) a régressé par rapport à la
-- v1 (20260401130000) en remplaçant la logique de priorité par un écrasement
-- brutal `status = p_new_status`. Conséquence : un click peut écraser un
-- statut `replied` (priorité plus haute), perte d'information business.
--
-- v3 = v2 (avec SET search_path) + priorité status de v1.
--
-- Hiérarchie : sent < opened < clicked < replied. On ne descend jamais.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.atomic_tracking_append(
  p_execution_id uuid,
  p_field text,
  p_value text,
  p_new_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.sequence_step_executions
  SET
    tracking_data = jsonb_set(
      COALESCE(tracking_data, '{}'::jsonb),
      ARRAY[p_field],
      (COALESCE(tracking_data->p_field, '[]'::jsonb) || to_jsonb(p_value))
    ),
    status = CASE
      WHEN p_new_status IS NULL THEN status
      WHEN p_new_status = status THEN status
      WHEN p_new_status = 'opened'  AND status = 'sent'                          THEN p_new_status
      WHEN p_new_status = 'clicked' AND status IN ('sent', 'opened')             THEN p_new_status
      WHEN p_new_status = 'replied' AND status IN ('sent', 'opened', 'clicked')  THEN p_new_status
      ELSE status
    END,
    updated_at = now()
  WHERE id = p_execution_id;
END;
$$;
