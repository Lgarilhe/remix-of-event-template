-- ─────────────────────────────────────────────────────────────────────────────
-- DRY-RUN test : trace le graphe de la séquence "Outreach Adaptatif"
-- en simulant les 3 chemins possibles sans toucher Unipile.
--
-- Chemins :
--  A. Candidat déjà 1er degré (check_connection → if_true)
--  B. Candidat 2e/3e + invitation acceptée (check_connection → if_false → wait → success)
--  C. Candidat 2e/3e + invitation timeout (check_connection → if_false → wait → timeout → InMail)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Affiche le graphe complet (tous les liens entre steps)
WITH g AS (
  SELECT
    s.step_order,
    s.action_type,
    s.use_ai_personalization,
    s.timeout_days,
    s.delay_days,
    s.delay_minutes,
    LEFT(s.message_template, 60) AS msg_preview,
    s.condition_type,
    (SELECT step_order FROM sequence_steps WHERE id = s.if_true_goto_step) AS if_true,
    (SELECT step_order FROM sequence_steps WHERE id = s.if_false_goto_step) AS if_false,
    (SELECT step_order FROM sequence_steps WHERE id = s.next_step_id) AS next_to,
    (SELECT step_order FROM sequence_steps WHERE id = s.timeout_branch_step_id) AS timeout_to
  FROM sequence_steps s
  WHERE s.sequence_id = '551c1e1a-23f2-4554-b09a-cd02826748c9'
)
SELECT
  step_order,
  action_type,
  delay_days || 'j' || delay_minutes || 'min' AS delay,
  COALESCE(timeout_days::text || 'j', '-') AS timeout,
  CASE WHEN use_ai_personalization THEN 'IA' ELSE '-' END AS ia,
  COALESCE('→' || if_true::text, '') AS if_true,
  COALESCE('→' || if_false::text, '') AS if_false,
  COALESCE('→' || next_to::text, '') AS next,
  COALESCE('⏱→' || timeout_to::text, '') AS on_timeout
FROM g
ORDER BY step_order;
