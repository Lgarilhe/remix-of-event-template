-- Migration : backfill organization_id manquants dans chat_categories
--
-- Problème : avant que les checks `if (!organizationId) skip` soient en
-- place côté frontend, des rows ont été créées avec organization_id NULL
-- (par useChatCategories quand useOrganization n'avait pas encore
-- chargé). Ces rows orphelines empêchent les UPDATE ultérieurs
-- (snooze, archive) à cause du RLS USING `organization_id = get_user_org_id()`.
--
-- Fix : pour chaque row sans organization_id, on récupère
-- profiles.active_organization_id du created_by et on l'assigne.

UPDATE public.chat_categories cc
SET organization_id = p.active_organization_id
FROM public.profiles p
WHERE p.user_id = cc.created_by
  AND cc.organization_id IS NULL
  AND p.active_organization_id IS NOT NULL;

-- Nettoyage : si après le backfill il reste des rows orphelines (user
-- n'a pas de profile / pas d'active_organization_id), on les supprime
-- car elles ne sont de toute façon plus accessibles via RLS.
DELETE FROM public.chat_categories
WHERE organization_id IS NULL;

-- Optionnel : ajouter une contrainte NOT NULL pour empêcher de futures
-- rows orphelines (mais peut casser des inserts en cours de transition).
-- À activer plus tard si besoin :
-- ALTER TABLE public.chat_categories
--   ALTER COLUMN organization_id SET NOT NULL;
