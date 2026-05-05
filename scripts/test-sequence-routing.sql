-- ─────────────────────────────────────────────────────────────────────────────
-- Simule la logique scheduleNextStep() de process-sequences/index.ts
-- pour chaque transition possible. Vérifie que la cron route correctement.
--
-- Reproduit les requêtes JS en SQL :
--   1. Si forceBranchStepId : SELECT * FROM sequence_steps WHERE id = X
--   2. Si check_connection avec conditionResult : if_true_goto_step / if_false_goto_step
--   3. Sinon next_step_id explicite
--   4. Fallback step_order+1 SAUF si current step est "branch target"
--      (référencé via if_true/if_false/timeout_branch/next_step_id)
-- ─────────────────────────────────────────────────────────────────────────────

WITH seq AS (SELECT '551c1e1a-23f2-4554-b09a-cd02826748c9'::uuid AS id),
steps AS (
  SELECT id, step_order, action_type, next_step_id, if_true_goto_step,
         if_false_goto_step, timeout_branch_step_id
  FROM sequence_steps WHERE sequence_id = (SELECT id FROM seq)
),
-- Détecte les "branch targets" : steps référencés depuis ailleurs
branch_targets AS (
  SELECT DISTINCT t.id AS target_id
  FROM steps s
  JOIN steps t ON t.id IN (
    s.if_true_goto_step, s.if_false_goto_step,
    s.timeout_branch_step_id, s.next_step_id
  )
),
-- Pour chaque step, calcule ce que scheduleNextStep RETOURNERAIT
transitions AS (
  SELECT
    s.step_order AS from_step,
    s.action_type AS from_action,
    -- Cas 1 : si check_connection → 2 résultats possibles (yes/no)
    CASE WHEN s.action_type = 'check_connection' THEN
      'YES → step ' || (SELECT step_order FROM steps WHERE id = s.if_true_goto_step) ||
      ' / NO → step ' || (SELECT step_order FROM steps WHERE id = s.if_false_goto_step)
    -- Cas 2 : si wait_connection → 2 résultats (success / timeout)
    WHEN s.action_type = 'wait_connection' THEN
      'success → step ' || (SELECT step_order FROM steps WHERE id = s.next_step_id) ||
      ' / timeout → step ' || (SELECT step_order FROM steps WHERE id = s.timeout_branch_step_id)
    -- Cas 3 : next_step_id explicite
    WHEN s.next_step_id IS NOT NULL THEN
      '→ step ' || (SELECT step_order FROM steps WHERE id = s.next_step_id)
    -- Cas 4 : fallback step_order+1 SAUF si branch target (alors END)
    WHEN EXISTS (SELECT 1 FROM branch_targets bt WHERE bt.target_id = s.id) THEN
      'END (branch target, no next_step_id)'
    ELSE
      'fallback → step ' || (s.step_order + 1)
    END AS resolved_next
  FROM steps s
)
SELECT * FROM transitions ORDER BY from_step;
