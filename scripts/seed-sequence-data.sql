-- ============================================================================
-- Seed Data: System Templates + Default Snippets for Sequences Module
--
-- Run AFTER the migration 20260331120000_enhance_sequences_module.sql
-- Replace {ORG_ID} with your organization UUID before running,
-- or remove the WHERE clause filter if you want org-agnostic system templates.
-- ============================================================================

-- ============================================================================
-- 1. SYSTEM TEMPLATES (is_system = true, visible to all orgs)
-- ============================================================================

-- Template: Sourcing LinkedIn classique (3 steps)
INSERT INTO sequence_templates (organization_id, name, description, steps_config, category, is_system)
SELECT
  o.id,
  'Sourcing LinkedIn — 3 étapes',
  'Invitation + message de suivi + relance. Le classique du sourcing tech.',
  '[
    {"step_order": 1, "action_type": "connection_request", "delay_days": 0, "delay_hours": 0, "condition_type": "always", "message_template": "Bonjour {{first_name}}, votre profil a retenu mon attention. Seriez-vous ouvert(e) à un échange rapide ?"},
    {"step_order": 2, "action_type": "message", "delay_days": 3, "delay_hours": 0, "condition_type": "if_connected", "wait_for_event": "connection_accepted", "message_template": "Merci d'\''avoir accepté {{first_name}} ! Je recrute pour un poste qui pourrait vous intéresser. Auriez-vous 15 min cette semaine pour en discuter ?"},
    {"step_order": 3, "action_type": "message", "delay_days": 5, "delay_hours": 0, "condition_type": "if_connected", "message_template": "{{first_name}}, je me permets de relancer. Le poste est toujours ouvert et votre profil correspond vraiment. Un rapide call ?"}
  ]'::jsonb,
  'sourcing',
  true
FROM organizations o
LIMIT 1
ON CONFLICT DO NOTHING;

-- Template: Multicanal LinkedIn + Email (5 steps)
INSERT INTO sequence_templates (organization_id, name, description, steps_config, category, is_system)
SELECT
  o.id,
  'Multicanal LinkedIn + Email — 5 étapes',
  'Combinaison LinkedIn et email pour maximiser le taux de réponse.',
  '[
    {"step_order": 1, "action_type": "connection_request", "delay_days": 0, "delay_hours": 0, "condition_type": "always", "message_template": "Bonjour {{first_name}}, votre parcours chez {{company}} m'\''intéresse. Connectons-nous !"},
    {"step_order": 2, "action_type": "message", "delay_days": 3, "delay_hours": 0, "condition_type": "if_connected", "wait_for_event": "connection_accepted", "message_template": "Merci {{first_name}} ! Je travaille sur une opportunité qui pourrait correspondre à votre expertise. On en parle ?"},
    {"step_order": 3, "action_type": "email", "step_channel": "email", "delay_days": 4, "delay_hours": 0, "condition_type": "always", "subject_template": "{{first_name}} — une opportunité pour vous", "message_template": "Bonjour {{first_name}},\n\nJe vous ai contacté sur LinkedIn concernant une opportunité. N'\''ayant pas eu de retour, je me permets de vous écrire par email.\n\n{ai_snippet}\n\nSeriez-vous disponible pour un échange de 15 minutes ?\n\n{{sender_name}}", "use_ai_personalization": true, "ai_personalization_source": "profile_only"},
    {"step_order": 4, "action_type": "message", "delay_days": 5, "delay_hours": 0, "condition_type": "if_connected", "message_template": "{{first_name}}, juste un petit message pour savoir si vous avez eu l'\''occasion de considérer l'\''opportunité. Je reste disponible !"},
    {"step_order": 5, "action_type": "email", "step_channel": "email", "delay_days": 7, "delay_hours": 0, "condition_type": "always", "subject_template": "Re: {{first_name}} — dernière relance", "message_template": "Bonjour {{first_name}},\n\nJe comprends que le timing n'\''est peut-être pas idéal. Si jamais votre situation évolue, n'\''hésitez pas à me recontacter.\n\nBonne continuation !\n{{sender_name}}", "include_unsubscribe": true}
  ]'::jsonb,
  'sourcing',
  true
FROM organizations o
LIMIT 1
ON CONFLICT DO NOTHING;

-- Template: Nurturing doux (3 steps email)
INSERT INTO sequence_templates (organization_id, name, description, steps_config, category, is_system)
SELECT
  o.id,
  'Nurturing — Garder le contact',
  'Emails espacés pour rester dans le radar des candidats passifs.',
  '[
    {"step_order": 1, "action_type": "email", "step_channel": "email", "delay_days": 0, "delay_hours": 0, "condition_type": "always", "subject_template": "{{first_name}}, des nouvelles du marché {{job_title}}", "message_template": "Bonjour {{first_name}},\n\nJ'\''espère que tout se passe bien chez {{company}}.\n\n{ai_snippet}\n\nSi jamais l'\''envie de nouveaux challenges se fait sentir, je serais ravi d'\''en discuter.\n\nBien cordialement,\n{{sender_name}}", "use_ai_personalization": true, "ai_personalization_source": "rag_notes_only"},
    {"step_order": 2, "action_type": "email", "step_channel": "email", "delay_days": 30, "delay_hours": 0, "condition_type": "always", "subject_template": "Une opportunité qui pourrait vous plaire", "message_template": "Bonjour {{first_name}},\n\nUne nouvelle opportunité vient de s'\''ouvrir et j'\''ai tout de suite pensé à vous.\n\n{ai_snippet}\n\nIntéressé(e) ? Un call de 10 min pour en savoir plus ?\n\n{{sender_name}}"},
    {"step_order": 3, "action_type": "email", "step_channel": "email", "delay_days": 45, "delay_hours": 0, "condition_type": "always", "subject_template": "{{first_name}} — on reste en contact ?", "message_template": "Bonjour {{first_name}},\n\nJe ne veux pas être insistant, mais je tenais à garder le lien. Le marché bouge beaucoup en ce moment.\n\nN'\''hésitez pas à me contacter si vous souhaitez faire le point sur les opportunités.\n\n{{sender_name}}", "include_unsubscribe": true}
  ]'::jsonb,
  'nurturing',
  true
FROM organizations o
LIMIT 1
ON CONFLICT DO NOTHING;

-- Template: Réactivation candidats dormants
INSERT INTO sequence_templates (organization_id, name, description, steps_config, category, is_system)
SELECT
  o.id,
  'Réactivation — Candidats dormants',
  'Réengager des candidats avec qui vous avez déjà échangé il y a plusieurs mois.',
  '[
    {"step_order": 1, "action_type": "email", "step_channel": "email", "delay_days": 0, "delay_hours": 0, "condition_type": "always", "subject_template": "{{first_name}}, on se reparle ?", "message_template": "Bonjour {{first_name}},\n\nNous avions échangé il y a quelques mois.\n\n{ai_snippet}\n\nDe nouvelles opportunités se sont ouvertes depuis — seriez-vous disponible pour un point rapide ?\n\n{{sender_name}}", "use_ai_personalization": true, "ai_personalization_source": "rag_full"},
    {"step_order": 2, "action_type": "message", "delay_days": 5, "delay_hours": 0, "condition_type": "if_connected", "message_template": "{{first_name}}, je me suis permis de vous envoyer un email. Avez-vous eu l'\''occasion d'\''y jeter un oeil ?"},
    {"step_order": 3, "action_type": "email", "step_channel": "email", "delay_days": 10, "delay_hours": 0, "condition_type": "always", "subject_template": "Re: {{first_name}}, on se reparle ?", "message_template": "{{first_name}},\n\nJe comprends que vous puissiez être occupé(e). Si le timing ne convient pas, pas de souci — gardez mes coordonnées pour plus tard !\n\n{{sender_name}}", "include_unsubscribe": true}
  ]'::jsonb,
  'reactivation',
  true
FROM organizations o
LIMIT 1
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 2. DEFAULT SNIPPETS (per-org, will be created for the first org)
-- ============================================================================

INSERT INTO sequence_snippets (organization_id, name, content, category)
SELECT o.id, name, content, category
FROM organizations o
CROSS JOIN (VALUES
  ('Accroche compétences', 'J''ai remarqué votre expertise en {{skill}} — c''est exactement le type de profil que nous recherchons pour ce projet.', 'Introduction'),
  ('Accroche entreprise', 'Votre parcours chez {{company}} est impressionnant, et je pense qu''une conversation pourrait être mutuellement enrichissante.', 'Introduction'),
  ('Proposition de valeur — Startup', 'Il s''agit d''une startup en forte croissance avec une équipe technique ambitieuse, un produit déjà en production, et de beaux challenges techniques à relever.', 'Value Prop'),
  ('Proposition de valeur — Grand groupe', 'Le poste offre un environnement stable avec des projets d''envergure, une politique de formation continue, et des perspectives d''évolution claires.', 'Value Prop'),
  ('Proposition de valeur — Remote', 'Le poste est en full remote avec une flexibilité totale sur les horaires. L''équipe est distribuée en Europe.', 'Value Prop'),
  ('CTA — Call 15 min', 'Seriez-vous disponible pour un échange de 15 minutes cette semaine ? Je peux m''adapter à vos disponibilités.', 'CTA'),
  ('CTA — Calendly', 'Vous pouvez réserver un créneau directement ici : {{calendly_link}}', 'CTA'),
  ('CTA — Soft', 'Pas de pression — si le timing ne convient pas, gardez mes coordonnées pour plus tard. Je reste disponible !', 'CTA'),
  ('Signature formelle', 'Bien cordialement,\n{{sender_name}}', 'Signature'),
  ('Signature décontractée', 'À bientôt,\n{{sender_name}}', 'Signature'),
  ('Relance douce', 'Je me permets de vous relancer car le poste est toujours ouvert et votre profil correspond vraiment à ce que nous recherchons.', 'Introduction'),
  ('Mention IA — compétences', '{ai_snippet}', 'Introduction')
) AS snippets(name, content, category)
LIMIT 12
ON CONFLICT DO NOTHING;
