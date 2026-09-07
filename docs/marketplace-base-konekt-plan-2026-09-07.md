# Marketplace en cercle fermé et Base Konekt à crédits

Date : 2026-09-07. Branche `claude/repository-audit-pcgg0y`. Suite du lot P0
(`docs/p0-plan-2026-09-06.md`). Décisions prises avec Laurent le 2026-09-06 :
la marketplace reste dans l'application et se lance en petit comité (un cercle
de recruteurs partenaires validés à la main), la Base Konekt se vend avec un
quota de recherches inclus dans les formules Cabinet et Entreprise, puis en
crédits au-delà.

Rien n'est modifié en prod pendant la préparation ; les migrations passent par
le workflow habituel après merge.

## 1. État des lieux

### Marketplace

Ce qui existe. Une entreprise active le « mode chasse » sur une mission
(`MissionHuntMode`, onglet Configuration) : pourcentage de rémunération
(`hunt_bounty_percent`), nombre maximal de recruteurs, date limite, puis
publie ou retire. La page `/marketplace` (cabinets et indépendants) liste les
missions publiées des autres organisations et insère une ligne
`hunt_applications` au clic sur « Postuler ». L'onglet Marketplace des
paramètres affiche des listes de contrôle (`feature_activations`) dont les
boutons ne font rien.

Ce qui manque. Aucun écran ne montre les candidatures à l'entreprise, aucune
acceptation, aucune notification, aucun suivi de qui travaille sur quoi.
Un recruteur accepté ne verrait pas la mission dans sa liste `/missions`
(`useSourcingProjects` filtre sur son organisation) alors que les règles
d'accès existent déjà : `mission_team` accepte des membres externes (rôle
`freelance`), et les policies `mission_team_*` leur ouvrent la mission, les
candidats, les notes et les évaluations. L'équipe mission affiche un membre
externe sans nom (`getMemberName` ne lit que les membres de l'organisation).

Failles constatées en prod (lecture seule, 2026-09-07) :

- `hunt_applications` n'a ni UNIQUE (projet, recruteur) ni CHECK sur le
  statut, `feature_activations` non plus (contraintes perdues à l'import).
- La policy `own_or_project_org` de `hunt_applications` est FOR ALL sans
  WITH CHECK : un recruteur peut passer sa propre candidature à `accepted`,
  et postuler sur une mission non publiée.
- Toute personne connectée, quelle que soit son organisation, lit le brief
  complet des missions publiées (`Authenticated can view published hunt
  missions`, plus une policy `public_hunt_select` pour `public`).
- Les profils (`profiles`) ne sont lisibles que dans sa propre organisation :
  l'entreprise ne peut pas afficher le nom d'un candidat recruteur.

Volumes : 17 organisations (3 entreprises, 2 cabinets, 2 indépendants, 10 sans
type), 3 missions en mode chasse (1 publiée), 0 candidature, 0 activation,
3 lignes `mission_team`, toutes internes.

### Base Konekt

`coresignal-search` (aperçu 20 profils = 2 crédits Konekt, fiche complète =
2 crédits) n'est ouverte qu'aux organisations dont
`organization_integrations.coresignal_enabled` vaut true ; ce drapeau n'est
pas dans la liste `update_integration_settings`, seul le service role peut le
poser (une organisation activée en prod, 42 transactions en 90 jours). Côté
front, le sélecteur « LinkedIn / Base Konekt » n'apparaît que si le drapeau
est lu par `useOrganizationIntegrations`, dont la requête n'est activée que
pour les administrateurs : un membre ne voit jamais la Base Konekt. Le solde
de crédits est vérifié avant chaque appel ; aucun quota inclus n'existe.

## 2. Décisions

### Cercle partenaires

1. Un cabinet ou un indépendant demande à rejoindre le cercle depuis
   `/marketplace` (ou Paramètres > Marketplace) en renseignant un titre, une
   présentation, des spécialisations et son URL LinkedIn. La demande est
   stockée dans `feature_activations` (`marketplace_recruit`,
   `pending_validation`). Konekt valide à la main ; le statut passe à
   `active`. Le statut est porté par l'organisation : tous ses membres
   deviennent partenaires.
2. Seuls les partenaires validés voient les missions publiées et peuvent
   postuler. Une candidature est personnelle (un recruteur, une mission),
   avec un message facultatif.
3. L'entreprise voit les candidatures sur la mission (profil du recruteur,
   organisation, message), accepte ou refuse. Accepter ajoute le recruteur à
   `mission_team` avec le rôle `freelance` : il retrouve la mission dans
   `/missions` sous « Missions partenaires » et travaille dans le workspace
   (recherche, scoring, pipeline). L'entreprise peut mettre fin à la
   collaboration ; le recruteur peut retirer une candidature en attente.
4. Rémunération : le pourcentage du salaire annuel fixé sur la mission est la
   seule condition commerciale ; le recruteur facture l'entreprise
   directement. Konekt ne prend pas part au paiement pendant la bêta. Ce
   point est écrit sur la carte de mission et dans la boîte de candidature.
5. Publication : réservée aux organisations de type entreprise, sur le plan
   Entreprise ou pendant l'essai (sinon tous les essais, qui sont sur le plan
   Cabinet, en seraient exclus). La règle est appliquée par un trigger en
   base, pas seulement par le front.
6. Statuts de mission : `draft` (non visible), `published` (ouverte aux
   candidatures), `in_progress` (au moins un partenaire accepté, encore
   ouverte tant que le nombre maximal n'est pas atteint), `filled` et
   `cancelled` (fermées). Une mission dont la date limite est passée n'est
   plus listée. Le nombre maximal de recruteurs est appliqué à l'acceptation.
7. Notifications dans l'application (centre de notifications du lot P0) :
   nouvelle candidature (propriétaires et administrateurs de l'entreprise),
   candidature acceptée ou refusée (le recruteur), validation du cercle
   (propriétaires et administrateurs de l'organisation partenaire). Pas
   d'email dans ce lot.
8. Administration du cercle : un panneau sur `/marketplace`, visible des seuls
   identifiants listés dans le secret `KONEKT_PLATFORM_ADMIN_USER_IDS`, liste
   les demandes et valide ou suspend une organisation (edge function
   `marketplace-admin`). Sans le secret, le panneau n'existe pas et la
   validation se fait dans l'éditeur SQL (commande en section 5).
9. Les listes de contrôle et le bouton « Commencer l'activation » de l'onglet
   Marketplace disparaissent. La carte « Portail client » de cet onglet aussi
   (le portail se règle par mission).

### Base Konekt

1. Activation en libre-service par un propriétaire ou administrateur, depuis
   le panneau de recherche ou Paramètres > Crédits IA, si le plan effectif
   n'est pas `free`. Le plan gratuit voit l'explication et un lien vers les
   tarifs.
2. Quota de recherches incluses par mois civil, par organisation :
   `limits.database_searches_included` = 0 (free), 0 (solo), 100 (cabinet),
   300 (entreprise). Une recherche = une page d'aperçu de 20 profils. Au-delà
   du quota, ou sur Solo, chaque page coûte 2 crédits, comme aujourd'hui. La
   fiche complète reste à 2 crédits dans tous les cas.
3. Tous les membres voient le sélecteur de source dès que la Base Konekt est
   activée, et le compteur « N recherches incluses restantes ce mois » ou
   « 2 crédits par page ».
4. Le serveur applique les deux règles (plan, quota) ; le front ne fait
   qu'afficher.

## 3. Lot M : marketplace en cercle fermé

### Migration `supabase/migrations/20260907053654_marketplace_partner_circle.sql`

Idempotente, rejouable, search_path vide sur les fonctions, EXECUTE retiré à
PUBLIC et anon.

1. `hunt_applications` : dédoublonnage (garder la plus ancienne par
   `(project_id, recruiter_user_id)`), UNIQUE
   `hunt_applications_project_recruiter_key`, CHECK
   `hunt_applications_status_check` avec `('pending','accepted','rejected',
   'withdrawn','ended')`, colonnes `responded_at timestamptz`, `responded_by
   uuid`, trigger `updated_at`. Policies : supprimer `own_or_project_org` et
   `hunt_applications_policy` ; SELECT pour `authenticated` USING
   `recruiter_user_id = auth.uid() OR public.is_org_member_for_project(auth.uid(), project_id)` ;
   REVOKE INSERT, UPDATE, DELETE à `anon` et `authenticated` (écritures par
   RPC uniquement).
2. `feature_activations` : dédoublonnage, UNIQUE
   `feature_activations_org_feature_key (organization_id, feature)`, CHECK sur
   le statut `('inactive','pending_validation','active','suspended')`,
   colonnes `requested_at timestamptz`, `requested_by uuid`. Policies :
   supprimer `org_members_all` et `feature_activations_policy` ; SELECT pour
   les membres de l'organisation ; REVOKE INSERT, UPDATE, DELETE à `anon` et
   `authenticated`.
3. `sourcing_projects` : supprimer `public_hunt_select` et `Authenticated can
   view published hunt missions` ; créer `marketplace_partner_select` FOR
   SELECT TO authenticated USING
   `hunt_mode = true AND hunt_status IN ('published','in_progress') AND public.is_marketplace_partner(auth.uid())`.
   CHECK `sourcing_projects_hunt_bounty_check` (NULL ou entre 5 et 30) et
   `sourcing_projects_hunt_max_recruiters_check` (NULL ou entre 1 et 10),
   posés seulement si aucune ligne existante ne les viole (sinon NOTICE).
4. Fonctions :
   - `is_marketplace_partner(_user_id uuid) returns boolean` STABLE SECURITY
     DEFINER : existe une ligne `feature_activations` active
     `marketplace_recruit` pour une organisation dont l'utilisateur est membre.
   - `can_publish_hunt_mission(_organization_id uuid) returns boolean` :
     `organizations.org_type = 'enterprise'` et (plan effectif dans
     `('entreprise','enterprise')` ou abonnement `trialing` non expiré), même
     règle de plan effectif que `get_subscription_state`.
   - Trigger BEFORE UPDATE `sourcing_projects_hunt_publish_guard` : si
     `NEW.hunt_status = 'published'` et `OLD.hunt_status IS DISTINCT FROM
     'published'` et `auth.uid() IS NOT NULL` et non
     `can_publish_hunt_mission(NEW.organization_id)` → RAISE « La publication
     sur la marketplace est disponible avec le plan Entreprise ». Le service
     role (auth.uid() NULL) passe.
   - `request_marketplace_partner(p_headline text, p_bio text,
     p_specializations text[], p_linkedin_url text) returns jsonb` :
     appelant propriétaire ou administrateur de son organisation active
     (`get_user_org_id`), `org_type` dans `('agency','freelance')` ; met à
     jour `profiles` (recruiter_headline, recruiter_bio, specializations,
     linkedin_url) ; upsert `feature_activations` en `pending_validation`
     (sans toucher une ligne déjà `active` ou `suspended`, qui est renvoyée
     telle quelle) avec `requested_at`, `requested_by`. Renvoie le statut.
   - `get_marketplace_partner_state() returns jsonb` : statut de
     l'organisation active de l'appelant (`status`, `requested_at`,
     `validated_at`, `org_type`, `can_request`) ; `inactive` si aucune ligne.
   - `apply_to_hunt_mission(p_project_id uuid, p_message text) returns uuid` :
     partenaire ; mission `hunt_mode` en `published` ou `in_progress`, d'une
     autre organisation, date limite non passée, nombre d'acceptés inférieur à
     `coalesce(hunt_max_recruiters, 3)` ; insertion en `pending` avec
     `recruiter_org_id` ; doublon → exception « Vous avez déjà postulé à cette
     mission » ; notification `info` « Nouvelle candidature » aux
     propriétaires et administrateurs de l'entreprise, corps « {nom} ({org})
     souhaite chasser sur {mission} », lien `/missions/{id}?tab=config`.
   - `withdraw_hunt_application(p_application_id uuid)` : propre candidature
     `pending` → `withdrawn`.
   - `respond_to_hunt_application(p_application_id uuid, p_decision text)
     returns jsonb` : appelant propriétaire ou administrateur de
     l'organisation de la mission ; `accepted` : vérifie le plafond, insère
     `mission_team` (rôle `freelance`, permissions
     `{"can_edit_brief": false, "can_source": true, "can_submit": true}`) si
     absent, statut `accepted`, `responded_at/by`, `hunt_status` → `in_progress`
     si `published`, notification `success` « Candidature acceptée » au
     recruteur, lien `/missions/{id}` ; `rejected` : statut, notification
     `info` « Candidature non retenue », lien `/marketplace`.
   - `end_hunt_collaboration(p_application_id uuid)` : même droit ; supprime
     la ligne `mission_team`, statut `ended`, notification au recruteur.
   - `get_hunt_applicants(p_project_id uuid) returns setof jsonb` : membres de
     l'organisation de la mission ; candidature + `display_name`,
     `recruiter_headline`, `recruiter_bio`, `specializations`, `linkedin_url`,
     `years_experience`, `placements_count`, `rating`, nom et type de
     l'organisation du recruteur.
   - `get_my_hunt_applications() returns setof jsonb` : candidatures de
     l'appelant avec nom de mission, `client_name`, titre du brief,
     `hunt_bounty_percent`, `hunt_status`, nom de l'entreprise.
   - `get_partner_missions() returns setof jsonb` : missions où l'appelant est
     dans `mission_team` et dont l'organisation n'est pas la sienne : `id`,
     `name`, `client_name`, titre du brief, `hunt_status`,
     `hunt_bounty_percent`, nom de l'entreprise, `created_at`.
   - `get_mission_team_profiles(p_project_id uuid) returns setof jsonb` :
     membres de l'organisation de la mission ou de son équipe ; lignes
     `mission_team` + `display_name`, `recruiter_headline`, `is_external`
     (non membre de l'organisation de la mission).
   - `get_hunt_mission_stats(p_project_id uuid) returns jsonb` : pour
     l'organisation de la mission : `pending`, `accepted`, `max_recruiters`.
   - `count_hunt_accepted(p_project_id uuid)` peut servir d'utilitaire interne
     aux RPC (accès service role seulement).
   Toutes les RPC destinées aux clients : EXECUTE à `authenticated` et
   `service_role` seulement.

### Edge function `supabase/functions/marketplace-admin/index.ts`

`requireAuth` ; identifiants autorisés = `KONEKT_PLATFORM_ADMIN_USER_IDS`
(séparés par des virgules) ; secret absent ou utilisateur hors liste → 403
`{ error: "Administration plateforme non disponible", errorType:
"NOT_PLATFORM_ADMIN" }` sauf pour `whoami`, qui répond `{ is_platform_admin:
false }`. Actions : `whoami`, `list_partners` (toutes les lignes
`marketplace_recruit` avec nom, type, date de demande, demandeur, nombre de
membres), `validate_partner { organization_id }` (statut `active`,
`validated_by` = id de l'appelant, `validated_at`, notification `success`
« Bienvenue dans le cercle partenaires » aux propriétaires et
administrateurs, lien `/marketplace`), `suspend_partner { organization_id }`
(statut `suspended`). Client service role, `fetchWithTimeout` inutile (aucun
appel externe). Ajouter la fonction dans `supabase/config.toml` comme les
autres (vérifier le format existant).

### Front

- `src/hooks/useMarketplace.ts` : `usePartnerState()`, `useOpenHuntMissions()`
  (lecture `sourcing_projects` filtrée `hunt_mode`, statut dans
  published/in_progress, date limite non passée, organisation différente, plus
  `get_hunt_mission_stats` n'est pas nécessaire côté partenaire : la carte
  affiche les places restantes depuis un champ calculé renvoyé par une RPC
  `get_open_hunt_missions()` si plus simple ; au choix de l'implémenteur, mais
  une seule source), `useMyHuntApplications()`, `usePartnerMissions()`,
  `useHuntApplicants(projectId)`, mutations `requestPartner`, `apply`,
  `withdraw`, `respond`, `endCollaboration`, et `usePlatformAdmin()`
  (`whoami`, `listPartners`, `validate`, `suspend`) via
  `invokeEdgeFunction('marketplace-admin', …)`.
- `src/pages/Marketplace.tsx` réécrite. Cabinet ou indépendant non partenaire :
  carte « Cercle partenaires » (ce que c'est, comment ça se passe, la
  rémunération facturée directement) et formulaire de demande (titre,
  présentation, spécialisations en puces, URL LinkedIn) ; demande envoyée →
  état « En attente de validation par l'équipe Konekt » ; suspendu → message.
  Partenaire : onglets « Missions ouvertes » (cartes avec titre, client,
  contrat, lieu, télétravail, compétences, pourcentage, places restantes,
  date limite, bouton « Postuler » ouvrant une boîte avec message facultatif
  et rappel de la rémunération), « Mes candidatures » (statut, mission, lien
  vers le workspace si acceptée, « Retirer » si en attente), « Missions en
  cours » (`get_partner_missions`). Entreprise : « Vos missions publiées »
  (nom, statut, candidatures en attente, recruteurs acceptés, lien vers
  `/missions/{id}?tab=config`) et un état vide expliquant où publier.
  Panneau « Administration du cercle » en bas si `whoami` répond vrai.
- `src/components/missions/MissionHuntMode.tsx` : vouvoiement, plus de tiret
  long ; message de plan si `!canPublishPlan` (plan Entreprise ou essai) avec
  lien `/pricing` ; sections « Candidatures » (liste `get_hunt_applicants`,
  profil déplié, Accepter / Refuser) et « Recruteurs partenaires » (acceptés,
  « Mettre fin ») ; actions « Mission pourvue », « Annuler », « Remettre en
  brouillon ». Les libellés « bounty » deviennent « Rémunération (% du
  salaire annuel) ».
- `src/components/settings/MarketplaceActivation.tsx` : entreprise →
  explication du mode chasse et lien vers `/marketplace` ; cabinet ou
  indépendant → même carte « Cercle partenaires » que la page (composant
  partagé `src/components/marketplace/PartnerCircleCard.tsx`). Carte portail
  client retirée.
- `/missions` (`ProjectsListV2` ou le composant qui liste les missions) :
  section « Missions partenaires » pour les cabinets et indépendants quand
  `get_partner_missions` renvoie des lignes ; clic → `/missions/{id}`.
- Équipe mission (`src/components/missions/process/shared.tsx`,
  `MissionProcessV2.tsx`) : noms via `get_mission_team_profiles` ; libellé du
  rôle `freelance` → « Recruteur partenaire » ; pas de suppression d'un membre
  externe depuis cette liste (elle passe par « Mettre fin » dans le mode
  chasse).
- `src/components/AppSidebar.tsx` : entrée Marketplace sans garde de type
  (la page gère chaque cas).
- `src/integrations/supabase/types.ts` : nouvelles RPC et colonnes, à la main.
- `src/lib/featureGates.ts` : inchangé (`marketplace_publish` par plan reste).

### Critères de réussite

- Un indépendant demande à rejoindre, Konekt valide (panneau ou SQL), il voit
  la mission publiée, postule, l'entreprise reçoit la notification, accepte ;
  le recruteur reçoit la notification, voit la mission dans « Missions
  partenaires », ouvre le workspace et peut chercher, scorer et déplacer un
  candidat.
- Un utilisateur non partenaire ne lit aucune mission d'une autre organisation
  (SELECT vide), ne peut ni insérer ni modifier `hunt_applications` en direct.
- Un cabinet sur le plan Cabinet, hors essai, ne peut pas publier ; un
  UPDATE direct de `hunt_status` est refusé par le trigger.
- `deno check` sans erreur, TypeScript à 28 erreurs ou moins, build, vitest,
  liste Playwright inchangée (le test « agency-owner voit la nav Marketplace »
  reste vrai).

## 4. Lot K : Base Konekt

### Migration `supabase/migrations/20260907053655_base_konekt_activation.sql`

1. `subscription_plans.limits` : `database_searches_included` = 0 (free), 0
   (solo), 100 (cabinet, pro), 300 (entreprise, enterprise), par `limits ||
   jsonb`. `features` : ajouter, si absent, « Base Konekt : 100 recherches
   incluses par mois » (cabinet), « Base Konekt : 300 recherches incluses par
   mois » (entreprise), « Base Konekt en crédits » (solo).
2. `organization_integrations` : `coresignal_activated_at timestamptz`,
   `coresignal_activated_by uuid`.
3. Table `base_konekt_usage` (`id`, `organization_id`, `user_id`, `action`
   CHECK dans `('preview','search','collect')`, `included boolean`, `credits
   integer`, `created_at`) ; index `(organization_id, created_at)` ; RLS :
   SELECT pour les membres de l'organisation ; écritures service role.
4. RPC `set_base_konekt_enabled(p_organization_id uuid, p_enabled boolean)
   returns jsonb` : propriétaire ou administrateur ; activation refusée si le
   plan effectif est `free` (exception « Disponible à partir du plan Solo ») ;
   upsert `organization_integrations` (`coresignal_enabled`,
   `coresignal_activated_at`, `coresignal_activated_by`).
5. RPC `get_base_konekt_state(p_organization_id uuid) returns jsonb` :
   membre ; `enabled`, `plan_allows` (plan effectif différent de `free`),
   `effective_plan_id`, `included_monthly`, `included_used` (lignes
   `base_konekt_usage` du mois civil, `included = true`, actions preview et
   search), `included_remaining`, `period_end` (1er du mois suivant),
   `credits_per_search` 2, `credits_per_profile` 2.
6. Fonction interne `reserve_base_konekt_included(p_organization_id uuid,
   p_user_id uuid, p_action text) returns boolean` (service role) : dans une
   transaction, insère une ligne `included = true` si le quota mensuel n'est
   pas atteint (verrou `pg_advisory_xact_lock` sur l'organisation), renvoie
   true ; sinon false. Évite la double consommation en parallèle.

### Edge function `coresignal-search`

- Remplacer la lecture directe du drapeau par : `getSubscriptionGate` →
  `planAllows = effectivePlanId !== 'free'` ; drapeau `coresignal_enabled`
  lu comme aujourd'hui. Non activé ou plan gratuit → 403 `NOT_ENABLED` avec
  `plan_allows` dans la réponse.
- Actions `preview` et `search` : appeler `reserve_base_konekt_included` ; si
  true, pas de pré-vérification de solde ni de `settleCredits`, réponse avec
  `included: true` et `included_remaining` ; sinon, pré-vérification et
  `settleCredits` comme aujourd'hui, ligne `base_konekt_usage` `included =
  false`, réponse avec `included: false`. Si l'appel fournisseur échoue après
  réservation, supprimer la ligne réservée.
- Action `collect` : inchangée côté crédits, plus une ligne d'usage.

### Front

- `src/hooks/useBaseKonekt.ts` : `useBaseKonektState()` (RPC, tous les
  membres, `staleTime` 1 min, invalidation après chaque recherche Base
  Konekt) et `setEnabled`.
- `src/components/outreach/search/SearchFiltersPanel.tsx` : le sélecteur de
  source dépend de `state.enabled` (plus de `useOrganizationIntegrations`) ;
  sous le sélecteur, « {n} recherches incluses restantes ce mois » ou « 2
  crédits par page de résultats » ; si non activée : bouton « Base Konekt »
  qui ouvre `src/components/outreach/search/BaseKonektDialog.tsx` (ce que
  c'est : une base de profils consultable sans compte LinkedIn ; ce qui est
  inclus dans le plan ; le coût au-delà ; une ligne sur les données
  publiques et la page `/privacy`) avec « Activer » pour un administrateur,
  « Demandez à un administrateur » sinon, ou « Voir les plans » sur le plan
  gratuit.
- `src/components/settings/AICreditsSettings.tsx` : carte « Base Konekt »
  (`src/components/settings/BaseKonektCard.tsx`) : état, barre
  « {used} / {monthly} recherches incluses », date de remise à zéro,
  interrupteur activer / désactiver (administrateur), coût au-delà.
- `src/hooks/useLinkedInSearchActions.ts` : `errorType === 'NOT_ENABLED'` →
  toast « Base Konekt non activée. Activez-la depuis le panneau de
  recherche. » ; réponse `included` → toast discret facultatif, au minimum
  invalider l'état.
- `src/integrations/supabase/types.ts` : RPC, table, colonnes.
- Aucun nom de fournisseur visible (le mot Coresignal reste dans le code et
  les commentaires seulement).

### Critères de réussite

- Un administrateur sur le plan Cabinet active la Base Konekt en deux clics ;
  un membre voit le sélecteur et le compteur ; la 101e page du mois débite 2
  crédits ; sur le plan gratuit, l'activation est refusée côté serveur.
- `deno check`, TypeScript, build, vitest, Playwright liste inchangés.

## 5. Actions prod après merge

1. Migrations `20260907053654` et `20260907053655` par le workflow.
2. Edge functions : `marketplace-admin` (nouvelle) et `coresignal-search`
   déployées par le workflow (`_shared/` inchangé sinon).
3. Poser `KONEKT_PLATFORM_ADMIN_USER_IDS` (identifiants `auth.users` des
   administrateurs Konekt, séparés par des virgules) pour ouvrir le panneau
   d'administration du cercle. Sans lui, valider une organisation partenaire
   par SQL :
   `update feature_activations set status = 'active', validated_at = now(), validated_by = '<uid>' where organization_id = '<org>' and feature = 'marketplace_recruit';`
4. Régénérer `types.ts` (`supabase gen types typescript --linked`).
5. Vérifier que l'organisation déjà activée sur la Base Konekt garde son
   accès (drapeau conservé) et que son plan n'est pas `free`.
