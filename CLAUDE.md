# CLAUDE.md — Rules & Code Map for Konekt

## 🧠 Discipline baseline — 5 principes (à appliquer par défaut)

Avant toute action de code, valider ces 5 principes :

1. **Think Before Coding** — Expliciter les hypothèses, surfacer les ambiguïtés plutôt que de deviner silencieusement. Si la demande est floue, **poser une question** au lieu de partir dans une direction.
2. **Simplicity First** — Code minimal sans features spéculatives ni abstractions inutiles. Trois lignes similaires valent mieux qu'une abstraction prématurée.
3. **Surgical Changes** — Modifier UNIQUEMENT ce qui est demandé. Pas de refactor opportunistes, pas de renames "tant qu'on y est", pas de cleanup non demandé. Le scope = ce qui a été demandé, point.
4. **Goal-Driven Execution** — Transformer la tâche en critères de succès vérifiables avant d'agir. "Comment je sais que c'est fini ?" doit avoir une réponse concrète.
5. **Mind the Context** — Sur les fichiers > 1000 lignes (process-sequences, score-profile-job, useMessagesInbox, unipile-search, enrich-company), toujours `Read` avec `offset/limit` ciblé sur la zone à modifier — jamais le fichier entier. Pour les recherches cross-codebase (environ 1 150 fichiers suivis, dont 970 sous src/ et supabase/), déléguer à un sub-agent `Explore` plutôt que grep en série. Si la session dépasse ~40% de contexte ou 2h, proposer `/compact` avant de continuer un nouveau chantier (au-delà la qualité se dégrade — hallucinations, oublis).

Ces 5 principes l'emportent sur l'envie d'être proactif. Si tension entre "faire bien" et "faire ce qui est demandé" → faire ce qui est demandé.

---

## Stack & infrastructure (post-migration 2026-04-21)
- **Frontend** : Vite + React + TS, déployé sur **Vercel** (branche `main` auto-deploy)
  - Prod URL : https://konekt-app-navy.vercel.app
  - `vercel.json` gère les rewrites SPA (toutes les routes → `index.html`)
- **Backend** : Supabase self-managed project **konekt-production** (ref `crckfywoyjxkawathdff`, West EU Ireland)
  - Dashboard : https://supabase.com/dashboard/project/crckfywoyjxkawathdff
  - SQL editor : https://supabase.com/dashboard/project/crckfywoyjxkawathdff/sql
  - Edge functions : https://supabase.com/dashboard/project/crckfywoyjxkawathdff/functions
  - Auth URL config : https://supabase.com/dashboard/project/crckfywoyjxkawathdff/auth/url-configuration
- **Lovable est retiré** : plus de push automatique vers main depuis Lovable Cloud. Tout passe par commits Git → Vercel.

## Before modifying any file
1. **Read the FULL file** (or at minimum all imports + the function being changed)
2. **Search for all call sites** — grep for the function/component name to find who uses it
3. **Check for caches, memos, effects** — React state that might override your changes
4. **Check for race conditions** — useEffect dependency arrays, async timing
5. **Sync with main first** — `git fetch origin main && git rebase origin/main`

## Before committing
Les hooks pre-commit (`.claude/settings.json`) lancent **automatiquement** (⚠️ uniquement sur les `git commit` passés par l'outil Bash de Claude Code — un `git commit` humain ou un push direct les contourne ; le vrai filet obligatoire = CI de PR, à câbler) :
- `npx tsc --noEmit -p tsconfig.app.json` — **ratchet** : bloque si le nombre d'erreurs TS dépasse la baseline (11 au 2026-10-04, après les lots 0c-3 et 0c-4 ; 32 au 2026-07-15 après la régénération de `types.ts` depuis le schéma prod). Résorber la dette puis abaisser la baseline. ⚠️ Ne PAS revenir à `npx tsc --noEmit` sans `-p` : le `tsconfig.json` racine est solution-style (`"files": []`) → vérifie 0 fichier (hook vacant). Les 11 erreurs restantes sont de vraies anomalies code/schéma (ex. `profiles` n'a pas de colonnes `full_name`/`email` mais le code les interroge ; type `SourcingProject` désynchronisé) — à corriger au cas par cas, ne PAS masquer par `as any`. Régénérer `types.ts` via `supabase gen types typescript --linked` (ne PAS laisser la sortie CLI polluer le fichier).
- `npx vite build` — bloque le commit si build prod échoue. ⚠️ esbuild strip les types → ce build ne type-check PAS (d'où le hook tsc ci-dessus).

Vérif manuelle à faire en plus : **pas d'imports orphelins** (grep pour les noms de composants/fonctions supprimés).

## Runbook hotfix prod
1. Fix en local sur une branche.
2. `npx tsc --noEmit && npx vite build` → doit passer.
3. Commit + push → PR ou merge direct sur `main`.
4. Vercel redéploie auto le frontend (~2min).
5. **Edge functions** : auto-déployées par `.github/workflows/deploy-edge-functions.yml` sur push `main` (depuis 2026-07). Hotfix manuel toujours possible : `supabase functions deploy <name> --project-ref crckfywoyjxkawathdff`.
6. **Migrations SQL** : auto-appliquées par `.github/workflows/deploy-migrations.yml` sur push `main` (paths `supabase/migrations/**`) via `supabase db push --linked`. ⚠️ Ce workflow a été cassé pendant des semaines (table de suivi remote `supabase_migrations.schema_migrations` désynchro — 6/219 versions trackées seulement → `db push` refuse : « Found local migration files to be inserted before the last migration on remote »). Réparé via l'input `repair_tracking=true` (break-glass, tracking-only). Si tu vois cette erreur : relancer le workflow en `workflow_dispatch` avec `repair_tracking=true`. Hotfix manuel toujours possible : `supabase db push --linked` (idempotent) ou SQL editor.
7. Rollback Vercel : Dashboard Vercel → Deployments → "Promote to Production" sur le deploy précédent.

### 🚨 Discipline migrations — règles ABSOLUES (incidents des 14-15/07/2026)

Deux sessions Claude en parallèle ont cassé le workflow de migrations 3 fois en 24h (collisions de versions, tracking désynchronisé). Pour ne JAMAIS reproduire :

1. **Toute migration passe par un fichier committé** dans `supabase/migrations/` — jamais de DDL direct via SQL editor ou MCP `apply_migration` sans fichier correspondant dans le repo.
2. **Si tu dois hotfixer en prod via MCP** (workflow cassé, urgence) : après application, **aligne la table de suivi sur la version du fichier du repo** — `UPDATE supabase_migrations.schema_migrations SET version = '<version du fichier>' WHERE name = '<name>'`. MCP `apply_migration` stampe son propre timestamp → sans cet alignement, le prochain `db push` refuse (« Remote migration versions not found in local migrations directory »).
3. **Timestamp unique obligatoire** : avant de créer un fichier, `ls supabase/migrations/ | grep <ta date>` ET `git fetch origin main && git ls-tree origin/main supabase/migrations/` — deux fichiers avec la même version cassent la CI e2e (duplicate key sur `schema_migrations_pkey`) et le push prod. Utilise `date -u +%Y%m%d%H%M%S` (heure réelle, pas un timestamp rond).
4. **Jamais** `supabase migration repair --status reverted` sur une version dont le fichier existe dans le repo — ça recrée l'erreur out-of-order au push suivant (le DDL reste appliqué mais le tracking l'oublie).
5. Diagnostic rapide d'une désynchro : comparer `select version from supabase_migrations.schema_migrations` avec `ls supabase/migrations/` — toute version présente d'un seul côté doit être réconciliée (fichier reconstruit depuis `statements`, ou tracking renommé), jamais ignorée.
6. **Toute migration doit rejouer sur une base vide.** La prod a été créée depuis `MIGRATION_CLEAN.sql`, pas depuis les migrations : elle n'a pas les objets posés de janvier à avril 2026. Une migration écrite « contre les policies réelles de la prod » passe donc en prod et casse une reconstruction à neuf, seul mode de la CI e2e. Deux pièges vus le 2026-09-07 : un `DROP FUNCTION` retenu par des policies homonymes qui n'existent qu'en base neuve, et un `DELETE` sur `notion_api_cache`, table de l'import Lovable qu'aucune migration ne crée (à traiter sous `IF to_regclass(...) IS NOT NULL`).
7. **Une policy permissive héritée annule le durcissement posé à côté d'elle.** Les policies permissives s'additionnent : dropper le nom de la prod ne suffit pas si le nom d'origine survit en base neuve. Après toute migration RLS, reconstruire une base depuis zéro et jouer `supabase/tests/rls_two_orgs_audit.sql` : le bloc général (10 contrôles) et le bloc séquences (22 contrôles) doivent passer.

---

## Architecture rules
- When in mission context (`activeProject` exists), the brief IS the job — never ask users to select a job
- `filters_snapshot` on `sourcing_projects` stores AI-generated search filters + suggestions
- `job_details` on `sourcing_projects` stores the brief data (JobDetails type from `src/types/jobDetails.ts`)
- The LinkedInSearch component has an internal cache (`missionSearchCache`) that can override hook state

## 🎯 Sourcing strategy (décision 2026-04-27, après audit Apollo+PDL+Lemlist+HeyReach)

**Sourcing PRIMAIRE = LinkedIn via Unipile** (100 % du moteur). Pas de "Base Konekt" externe pour la recherche.

Pourquoi :
- Apollo `mixed_people/api_search` masque `last_name` BY-DESIGN sur tous les plans → bulk_match (1 cr/profil) obligatoire
- Apollo viole les ToS avec une seule API key partagée multi-tenant SaaS (besoin contrat OEM custom $3K-75K/an)
- PDL Person Search facture chaque profil retourné (~$0.28 sur Pro) → modèle "browsing payant" insoutenable côté UX user
- LinkedIn (Unipile) = même pattern que Lemlist / HeyReach / Phantombuster : on utilise la session LinkedIn de l'user → noms visibles, skills/edu/langues complets, $0 par profil
- Tous les recruteurs cibles ont DÉJÀ LinkedIn (Recruiter $700/mois ou Sales Nav $80/mois) — c'est la norme du métier

Ce qui reste de la migration PDL (nettoyage du 2026-09-06) :
- `_shared/pdl-mapping.ts` et `resolvePDLCredentials` : SUPPRIMÉS (aucun appelant)
- `pdl_profile_cache` table + RLS : encore en base, sans lecteur ni écrivain
- `PDL_API_KEY` : plus lu par aucune fonction, inutile sur un nouvel environnement
- `database-search`, `pdl-search`, `apollo-search` edge functions : SUPPRIMÉES (le frontend n'appelle plus que `unipile-search` et `coresignal-search`)

Apollo/PDL futurs cas d'usage :
- **ENRICHMENT CIBLÉ** : récupérer email/phone d'un candidat shortlisté (1 crédit pour 1 candidat actionnable, ROI clair)
- **JAMAIS** comme source de browsing massif

Fournisseurs enrichment recommandés (ordre de préférence) :
1. **Dropcontact** 🇫🇷 — ~$24/mois pour 1500 enrichments = $0.016/profil — RGPD natif, qualité B2B FR/EU
2. **PDL Person Enrich** — $0.28/match groupé email+phone — déjà branché techniquement
3. **Apollo People Match** — viable seulement avec contrat OEM (sinon ToS violés)
- Hunter / Snov.io en options secondaires

## ⚠️ Branding — vendor names NEVER user-facing

**Critical rule** : the names of our backend providers must **never** appear in any UI text, toast, error message, tooltip, label, placeholder, or any string that an end-user can read.

This applies to (non-exhaustive) :
- **Unipile** (LinkedIn provider) → say "**LinkedIn**" or "service de connexion LinkedIn"
- **People Data Labs / PDL** (database provider) → say "**Base Konekt**"
- **Apollo / Apollo.io** (legacy database provider) → say "**Base Konekt**"
- **Brandfetch / Clearbit / Logo.dev** (logos) → no mention, just the result
- **Resend** (email infra) → "Konekt sender" or no mention
- **Anthropic / Claude** → "IA Konekt" or "assistant IA"

**Allowed exceptions** (legal obligation only) :
- Pages `/privacy` and `/privacy-extension` (RGPD art. 28 — sub-processor list)
- DPA / CGU PDFs (legal docs)

**Internal uses always allowed** :
- Variable names (`invokeUnipile`, `apolloData`)
- Edge function names (`unipile-accounts`, `pdl-search`, `apollo-search`)
- Type unions (`source: 'pdl' | 'apollo'`)
- Console logs (debug only, not surfaced to UI)
- Comments in code
- This `CLAUDE.md` and other internal docs

**Why** : (1) avoid vendor lock-in being visible to clients, (2) maintain Konekt branding, (3) keep migration freedom (we're already migrating Apollo→PDL), (4) clients shouldn't know our infra stack.

**Before merging any UI change** : grep for `Unipile`, `Apollo`, `PDL`, `People Data Labs` in user-visible strings (JSX text, toast/sonner messages, tooltips, labels, placeholders).

### Notion : un connecteur parmi d'autres (décision du 2026-10-04)
Notion n'apparaît dans l'application que comme connecteur de l'assistant : une ligne de la liste « Applications connectées » (Paramètres › Connexions, `#applications`, `AssistantConnectorsCard` et `NotionConnectorRow`), son interrupteur dans le menu des connecteurs du chat et ses cartes d'outils (« Recherche dans Notion »). Rien d'autre : pas de carte à part, pas d'exemple « Notion » dans les textes ni dans les prompts, et jamais de mention de l'organisation interne de Konekt dans Notion, qui sert de modèle aux agents sans être une référence visible. Un connecteur d'organisation ne peut pas prendre un nom réservé (`RESERVED_BUILTIN_CONNECTORS`, `src/lib/assistantConnectors.ts`). Garde statique : `tests/ux/notion-connecteur-liste.test.mjs`.

---

## Code Map

### Routes (src/App.tsx)
```
/dashboard               → Dashboard (stats + welcome CTA if no missions)
/missions                → Outreach page (liste des missions)
/missions/:id/*          → MissionEntry : nouvelle page MissionWorkspaceV3 par défaut (/missions/:id, /sourcing, /cadrage) ;
                           ancienne page MissionWorkspace → MissionWorkspaceV2 (3 phases, sous-onglets via ?tab=) pour un
                           navigateur qui l'a choisie (?nouvelle-mission=0, clé konekt.mission-v3 = '0', src/lib/missionBeta.ts)
/mission-invite/:token   → AcceptMissionInvite
/sourcing                → SourcingSearches (recherches hors mission)
/sourcing/:id            → SourcingSearchPage
/agents                  → AgentsPage
/pipeline                → ATS page (kanban/table/timeline/analytics)
/pipeline/scorecard/:candidateId → ScorecardFullPage (alias legacy /ats/scorecard/:candidateId)
/candidates              → Redirects to /pipeline
/inbox                   → Inbox
/calendar                → CalendarPage
/tasks                   → TasksPage
/marketplace             → Marketplace
/settings                → Settings, coquille à deux portes (src/pages/Settings.tsx, registre src/components/settings/shell/sections.tsx).
  Mon compte : /settings/account/connections | writing | journal (provisoire, part dans /agents au lot 9).
  Mon organisation (propriétaire et admin) : /settings/org/general | team | billing | assistant.
  Anciens ?tab= redirigés par resolveLegacySettingsUrl (src/lib/settingsRoutes.ts), paramètres conservés.
/qualification/:id       → Qualification session (deep-linked from modals)
Public (no AppLayout): / (landing), /auth, /onboarding (protected, no org guard), /portal/:token (CandidatePortal),
  /client/:token (ClientPortalV2), /r/:slug (RecruiterPublicProfile), /unsubscribe, /privacy, /privacy-extension,
  /pricing (page tarifs publique, lisible sans session : SELECT anon sur subscription_plans)
Legacy: /outreach → /missions, /ats → /pipeline, /index → /
```

### Mission Flow
Un seul parcours mission : V2, 3 phases linéaires (`src/components/missions/v2/`). Plus de flag `mission_v2` ni de composants V1. Depuis le 2026-09-30, la nouvelle page (`src/components/missions/v3/`, refonte mission) est la page par défaut ; l'arbre ci-dessous décrit l'ancienne page, gardée derrière `?nouvelle-mission=0` jusqu'aux lots de retrait.
```
MissionWorkspace (src/pages/MissionWorkspace.tsx : loading / introuvable / rendu V2)
└── MissionWorkspaceV2       — PhaseStepper (3 phases) + sous-onglets, lus/écrits via ?tab=
    ├── Phase 1 « Cadrage »
    │   ├── MissionOverviewV2   — ?tab=overview (défaut)
    │   ├── MissionBriefV2      — ?tab=brief, édite job_details (readOnly si !hasFeature('edit_brief'))
    │   ├── MissionProcessV2    — ?tab=process, étapes d'entretien + équipe (briques partagées : missions/process/shared.tsx)
    │   └── MissionConfigV2     — ?tab=config, hunt mode (MissionHuntMode) + portail client (MissionClientPortal)
    ├── Phase 2 « Sourcing & Outreach »
    │   ├── MissionSourcing     — ?tab=sourcing → LinkedInSearch (search orchestrator, the most complex component)
    │   └── MissionOutreach     — ?tab=outreach, séquences + invitations
    └── Phase 3 « Pipeline »
        ├── MissionPipeline     — ?tab=pipeline, kanban candidats
        └── MissionInsights     — ?tab=insights, analytics
```
- Les sous-onglets se verrouillent selon `useMissionReadiness` (brief/process incomplets → phases 2 et 3 bloquées, toast « Complétez les étapes précédentes »).
- Deep links historiques `?tab=brief|process|config|sourcing|outreach|pipeline|insights` restent valides (mapping tab → phase dans MissionWorkspaceV2).

### Search & Sourcing Flow (CRITICAL — most complex part)
```
MissionSourcing
  → LinkedInSearch (orchestrator, manages cache)
    → useLinkedInSearch (hook, ~770 lignes)
       ├── searchReducer: filters, results, selectedJob, jobScores, cursor
       ├── viewReducer: statusFilter, showDismissed
       ├── Loads filters_snapshot → transforms AI format to LinkedInFiltersState
       ├── Creates synthetic job from brief: id="project:{projectId}"
       └── Deferred location resolution via pendingLocationRef
    → useLinkedInSearchActions (~1 100 lignes) — executes search via Unipile/database
    → useLinkedInScoring (~1 350 lignes) — batch AI scoring via score-profile-job
    → SearchFiltersPanel — filter UI + AutoFillFiltersButton
```

**Filter format transformation:**
- AI format (from edge function): `skills_keywords[]`, `location_keywords[]`, `role[].keywords`
- UI format (LinkedInFiltersState): `location[]`, `skills[]`, `role[]`, `calculated_experience_min`
- Transformation happens in the `isAIFormat` block of `useLinkedInSearch` (filters_snapshot loading effect)

### Data Model (key tables)
```
sourcing_projects          — missions (name, job_details, filters_snapshot, status, stats)
mission_process_steps      — interview steps per mission
mission_team               — team members per mission
mission_invitations        — freelancer invites with tokens
job_candidate_status       — un candidat dans une mission : note et étape. Modèle des étapes (refonte mission, lot 0a) :
                             .general_stage (to_sort, retained, contacted, replied, interviewing, hired, rejected ;
                             NOT NULL, défaut to_sort) ; .process_step_id (étape d'entretien, clé vers mission_process_steps,
                             ON DELETE SET NULL ; seulement en interviewing, et alors égale à pipeline_stage) ;
                             .stage_entered_at (NOT NULL, approchée pour les lignes reprises) ; .decision_source (ai, user,
                             system ; NULL = aucune décision) ; jalons contacted_at, replied_at, first_interview_at,
                             presented_at, hired_at (posés une fois, sur une date vraie), rejected_at et rejected_from_stage
                             (dernier écart) ; .reply_summary (résumé d'une réponse, écrit à partir du lot 0b).
                             .status (défaut 'new') et .pipeline_stage deviennent des colonnes de compatibilité. Le
                             déclencheur stage_sync_from_legacy en dérive l'étape à chaque écriture du couple, et remet à leur
                             ancienne valeur les nouvelles colonnes écrites en direct (hors set_candidate_stage) ; il ne
                             modifie jamais status ni pipeline_stage.
                             Compteurs stats_* de la mission (lot 0c-1) : lus dans get_mission_stage_counts (une seule
                             définition). Le recalcul complet de la migration n'a touché ni updated_at ni l'indexation ;
                             ensuite, un recalcul qui change un compteur réécrit la mission (updated_at et indexation),
                             comme au lot 0a. stats_total_found = Sourcés (une ligne par
                             candidat, jamais ouverts compris) ; stats_messaged = contactés au total ; stats_shortlisted =
                             retenus au total (cumuls : un candidat qui avance ou qu'on écarte ne les fait pas baisser) ;
                             stats_dismissed = écartés en ce moment ; stats_scored = notés. Affichés avec « au total »
                             (tableau de bord, Vue d'ensemble, recherches, résumé du matin), jamais sous le nom d'une étape.
                             Garde stage_write_guard (lot 0b), en observation : une écriture directe qui change l'étape
                             dérivée (jeton authenticated, service_role ou anon, ou SET ROLE) est journalisée dans
                             jcs_direct_write_log (rôle, utilisateur, ligne, couples, x-client-info ; fermé à anon et
                             authenticated). Le navigateur signe x-client-info de son build : `konekt/<7 caractères du commit
                             Vercel>`, ou `konekt/dev` (src/integrations/supabase/client.ts, define de vite.config.ts).
                             Passent sans trace : set_candidate_stage(s), insertion À trier, note, changement
                             de mission au couple intact, replace_process_steps, contextes sans jeton (migration, psql, cron).
                             Mode : jcs_stage_write_mode() (off, observe, refuse). Le refus (HINT STAGE_DIRECT_WRITE) viendra
                             au lot 0b-5. Arrêt d'urgence neutre : ALTER TABLE public.job_candidate_status DISABLE TRIGGER
                             stage_write_guard; puis un fichier de migration qui repose le mode voulu (règle 1).
mission_candidate_rows     : vue (lot 0c-1, security_invoker : RLS de l'appelant ; SELECT authenticated et service_role,
                             rien pour anon). Une ligne par (organisation, mission, candidat) : la ligne canonique d'un
                             groupe de doublons (écart d'une personne s'il est sa dernière décision, sinon étape la plus
                             avancée, À trier en dernier), jalons les plus anciens du groupe, note de la ligne notée la plus
                             récente, group_ids et group_size (un geste écrit tout le groupe), mission_name. is_unopened :
                             profil trouvé par une recherche, jamais noté, trié, contacté ni inscrit (séquence ou InMail) ;
                             hors du Pipeline, il reste au Sourcing (« N profils trouvés »). Les doublons restent en base
                             jusqu'à la fusion du lot 4.
mission_conversations      : lien entre une conversation LinkedIn et une mission (lot 0b). Une ligne par organisation,
                             mission, compte et candidat (candidate_id, candidate_ids, candidate_slug, chat_id). Écrite par
                             le serveur seulement (fonctions record_*), lue par les membres de l'organisation (un collaborateur :
                             ses liens seulement, comme ses inscriptions). Les dates ne reculent jamais. last_mission_send_at
                             (dernier envoi attribué à la mission) choisit la mission d'une réponse sur un fil partagé. Reprise :
                             un lien par inscription existante (source backfill). Effacement RGPD : le déclencheur
                             mission_conversations_gdpr_erase supprime les liens du candidat dans l'organisation quand une
                             inscription reçoit tracking_data.gdpr_erased_at ; recordGdprErasure supprime aussi ceux d'un
                             candidat sans inscription et vide ses reply_summary. rgpd-purge : liens sans événement ni
                             création depuis 24 mois. export-org-data : table exportée. Pipeline mis à jour à partir du lien :
                             réponse (record_candidate_inbound, mission de la conversation), envoi (« Contacté »), message
                             écrit hors Konekt (record_own_message) ; voir « Séquences : règles du moteur et de l'interface ».
inmail_queue               : .project_id (lot 0b), mission de l'InMail programmé, pour « Contacté » et le lien à l'envoi.
outreach_sequences         — message sequences
sequence_enrollments       — candidates in sequences (.pause_reason : manual, account_disconnected, quota_reached, subscription_required,
                             sequence_inactive, auto_paused, send_failed, blocked_by_candidate ; jamais NULL pour une pause ;
                             .assigned_sender_id en text ; trigger sequence_enrollments_check_sender_owner : pas d'inscription
                             depuis le compte LinkedIn relié à un autre membre, HINT ENROLL_ACCOUNT_OF_OTHER_MEMBER)
organizations              — org + subscription
organization_members       — member roles (admin/owner/collaborator)
profiles                   — user profiles
subscription_plans         — plans (price_monthly/yearly per seat, limits.ai_credits, limits.contacts_included,
                             limits.max_members, stripe_price_id_monthly/yearly ; SELECT accordé à anon)
organization_subscriptions — plan_id, status (trialing/active/...), seats, trial_ends_at, stripe_* ids
subscription_trial_grants  — un essai par utilisateur créateur (user_id PRIMARY KEY)
candidate_enrichments      — .included = demande couverte par le forfait du plan
phone_calls                — appels de l'opérateur relié (téléphonie, lot A1 : Aircall d'abord, Ringover ensuite), une ligne par
                             (organisation, fournisseur, identifiant du fournisseur). Lue par les membres de l'organisation active,
                             écrite seulement par record_phone_call (service_role, rejouable, un événement plus ancien est sans effet).
                             contact_number_e164 = clé du rapprochement avec candidate_contacts.phone, fait À LA LECTURE
                             (src/lib/phoneCalls.ts), jamais figé à l'écriture. talk_seconds = décroche → fin (la durée brute du
                             fournisseur compte la sonnerie). Normalisation : supabase/functions/_shared/phone.ts, copie exacte dans
                             src/lib/phone.ts (un test garde les deux identiques) ; un numéro ambigu rend null, jamais un faux rapprochement.
                             Remplace aircall_calls (morte, 0 appel : retrait au lot I0).
telephony_connections      — liaison d'une organisation à son opérateur : empreinte SHA-256 du jeton de webhook (c'est elle qui
                             retrouve l'organisation, sans jeton partagé) et id du webhook chez le fournisseur. Illisible et
                             inécrivable par tout rôle client ; l'état passe par get_telephony_status(org) (owner/admin).
phone_call_insights        — transcription, résumé et état de traitement d'un appel (une ligne par appel, fille de phone_calls : un
                             appel effacé l'emporte). Lue par les membres de l'organisation active, écrite par la clé de service
                             seulement (fonction phone-call-insights). status : pending, transcribed (transcription gardée, pas de
                             résumé), ready, unavailable (Aircall n'a rien : module AI Assist absent, appel non enregistré),
                             failed ; error_code : too_short, credits, no_user, llm, format, no_credentials, aircall_error,
                             unavailable. transcript = jsonb [{speaker: agent|contact|unknown, text, start}]. summary_started_at =
                             verrou doux de 3 minutes contre deux résumés simultanés.
phone_call_task_suggestions — tâches que l'IA propose après un appel (fille de phone_calls). Lecture par l'organisation ; le navigateur
                             ne peut mettre à jour que state, reminder_id et resolved_at, et seulement de « proposed » vers
                             « accepted » ou « dismissed », une seule fois (policy UPDATE : USING state = 'proposed', WITH CHECK
                             state IN ('accepted','dismissed')). Accepter = insérer une ligne de candidate_reminders (category
                             follow_up, auto_generated), puis passer la suggestion à « accepted » ; si la suggestion était déjà
                             traitée, la tâche créée est retirée (src/lib/phoneCallInsights.ts, acceptCallTaskSuggestion).
candidate_photos           : copie privée de la photo LinkedIn d'un candidat (design simplifié, lot P). Une ligne par
                             (organisation, candidat) : status (pending, stored, expired, failed, skipped, erased),
                             storage_path (seulement en stored). Fichier dans le bucket privé candidate-photos
                             ({organisation}/{sha256 de « organisation:candidat »}.{jpg|png|webp}, 200 ko au plus). Lue par
                             les membres de l'organisation (une policy SELECT, aussi sur les fichiers du bucket), écrite
                             par la clé de service seulement : capture-candidate-photos (cron toutes les 2 min,
                             claim_candidate_photos : profil LinkedIn lu pour 100 candidats au plus par passage, relu
                             seulement après un changement de la ligne ; list_candidate_photo_orphans) et l'effacement RGPD (étape 10 de
                             recordGdprErasure : fichiers supprimés, marqueur erased jamais repris). Exportée par
                             export-org-data. Écran : PersonAvatar avec `candidateId` montre la copie (adresse signée une
                             heure, lue par lots, src/lib/candidatePhotos.ts et CandidatePhotosProvider), sinon le lien
                             LinkedIn, sinon les initiales.
```
RPC (SECURITY DEFINER, authenticated) : `get_subscription_state(org)` (plan effectif, essai, sièges, limites ;
expire un essai échu à la lecture), `get_org_contact_usage(org)` (contacts inclus utilisés / forfait),
`get_linkedin_quota_status(account)` (compteurs jour/semaine, facteur de montée en charge via `linkedin_ramp_factor`).
Cron : `expire-subscription-trials` (horaire) → `expire_subscription_trials()`.
`get_sequence_enrollment_counts(p_sequence_ids)` (SECURITY INVOKER, compte par séquence, statut et raison de pause, borné par la RLS),
`find_recent_org_contacts(p_org, p_values, p_slugs, p_since)` (SECURITY DEFINER, anti-doublon sur toute l'organisation de l'appelant, collaborateur compris, colonnes minimales),
`save_sequence_steps` (refus HINT STEP_HAS_HISTORY pour une étape déjà envoyée, SEQUENCE_NOT_OWNER pour la séquence d'autrui côté collaborateur).
`client_portal_candidates(token)` (lot C1 : seule lecture des candidats du portail client, retenus et au-delà de l'organisation du lien ; service_role seulement, appelée par client-portal-data). Tout lien de portail expire (90 jours par défaut, `expires_at` NOT NULL).
`get_org_member_emails(org)` (e-mails de auth.users des membres ; appelant owner/admin/member de l'org, jamais collaborator ni anon) :
`profiles` n'a pas de colonne `email` ni `avatar_url`, ne jamais les demander.
`set_candidate_stage(p_id, p_stage, p_source, p_organization_id, p_process_step_id, p_legacy_stage)` (lot 0a, SECURITY INVOKER) :
écriture de l'étape d'un candidat, qui tient aussi le couple status / pipeline_stage. Depuis le lot 0b-4, tous les écrivains y
passent : navigateur par `src/lib/candidateStage.ts` (`setCandidateStage(s)`, origine `user` seulement, lots de 200,
`ATS_LABEL_TO_STAGE` identique à la table de l'assistant, `missionColumnToStage`, l'annulation par `readStageSnapshots`, `buildUndoMoves` et `undoCandidateStages`,
`stageErrorMessage` par HINT, option `surface` des gestes : événement `Stage Change`) ; serveur par `apply_mission_candidate_stage` (add-to-shortlist, outils de l'assistant) et les
fonctions record_*. Plus aucune écriture directe de status ou pipeline_stage qui change l'étape (garde statique
`tests/c1/lot0b-ecrivains.test.mjs`, liste blanche commentée). La RLS de l'appelant s'applique.
Hors navigateur (clé de service), `p_organization_id` est obligatoire (HINT STAGE_ORG_REQUIRED) ; une ligne d'une autre
organisation est introuvable (STAGE_ROW_NOT_FOUND). Trois origines :
- `user` : la seule admise depuis le navigateur (sinon STAGE_SOURCE_FORBIDDEN). Vers interviewing, l'étape d'entretien est
  obligatoire si la mission en a (STAGE_STEP_REQUIRED), sauf avec un libellé du /pipeline (`p_legacy_stage`, liste blanche
  par étape, sinon STAGE_LEGACY_MISMATCH).
- `ai` : seulement to_sort (sinon STAGE_AI_FORBIDDEN). Elle marque l'origine d'une ligne À trier sans origine, ne change ni
  l'étape ni la date, et ne sort jamais une ligne d'Écarté.
- `system` (événements : envoi, réponse, rendez-vous) : seulement contacted, replied ou interviewing. Jamais une ligne À trier
  ou Retenue vers replied (résultat `not_contacted`), jamais de recul ni de reprise d'un écarté (résultat `kept`).
Réponse jsonb : `changed`, `result` (updated, unchanged, kept, not_contacted), étape, étape d'entretien, date et origine.
`candidate_stage_from_legacy(status, pipeline_stage, step_id)` : correspondance pure de l'ancien couple vers l'étape, commune
au déclencheur, à la reprise et à `set_candidate_stage`.
`set_candidate_stages(p_ids, p_stage, p_source, p_organization_id, p_process_step_id, p_legacy_stage, p_from_stages)` (lot 0b,
SECURITY INVOKER, authenticated et service_role) : `set_candidate_stage` sur 200 lignes au plus (HINT STAGE_BATCH_TOO_LARGE),
un résultat par ligne. `p_from_stages` : étapes de départ admises, les autres lignes rendent `skipped`. Seuls les refus 22023
et P0002 sont rendus par ligne ; toute autre erreur annule l'appel.
Fonctions serveur du lot 0b (SECURITY INVOKER, service_role seulement, jamais authenticated : l'organisation vient de
l'appelant) : `record_candidate_outbound` (envoi : lien, puis « Contacté » en origine system, ligne créée si un créateur est
donné), `record_candidate_inbound` (réponse : mission de la conversation, sinon du profil, de l'inscription ou des lignes
contactées ; « Contacté » puis « A répondu » si un envoi Konekt est prouvé dans la mission ; `p_received_at` pour un
rattrapage, rien avant le premier contact), `record_own_message` (message écrit depuis le compte du recruteur : écho d'un envoi,
note d'invitation, fil rattaché, sinon Retenu dans une seule mission), `record_reply_summary`, `resolve_meeting_mission` et
`record_candidate_meeting` (rendez-vous : première étape d'entretien, ou ITW en cours). Aides : `resolve_conversation_mission`,
`candidate_mission_sends`, `apply_mission_candidate_stage`, `touch_mission_conversation`, `enrollment_mission_id`,
`candidate_enrollment_ids`. Refus métier : 22023 ou P0002, HINT `STAGE_*`, `MISSION_*` ou `LINK_*`.
`candidate_mission_sends` (lot 0c-1) : un InMail `replied` avec `sent_at` reste une preuve d'envoi.
Lectures du lot 0c (sens des chiffres, décision 1 du plan 0c, reprise dans `docs/refonte-mission/conception.md` section 13 : carte de mission et kanban en effectifs « en ce moment » sous le
nom de l'étape, partout ailleurs des cumuls écrits « au total ») :
`get_mission_stage_counts(p_project_ids)` (SECURITY INVOKER, authenticated et service_role) : une ligne par mission demandée,
même sans candidat, sur mission_candidate_rows. Appel authenticated : missions de l'organisation de l'appelant seulement (pas
de zéros faux pour une mission visible par l'équipe de mission) ; service_role ou fonction SECURITY DEFINER : toutes.
Effectifs `unopened`, `to_sort` (hors jamais ouverts) … `rejected`, `interviewing_by_step`, `scored` ; cumuls `ever_retained`,
`ever_contacted`, `ever_replied`, `ever_interviewed`, `ever_presented`, `ever_hired` (jalon, étape, ou écart depuis l'étape par
`rejected_from_stage`) ; `triaged_by_user`, `last_stage_move_at`. Source unique des `stats_*` (recompute_mission_stats).
`get_project_stats` et `get_multiple_project_stats` n'ont plus aucun lecteur dans `src/` (lots 0c-3 et 0c-4) ; elles restent en base jusqu'au lot 0c-6.
`undo_candidate_stages(p_moves)` (SECURITY INVOKER, authenticated seulement, 200 lignes au plus) : annulation d'un geste ;
remet l'étape (colonne d'entretien du /pipeline comprise), la date, l'origine et l'écart d'avant, efface les jalons posés par
le geste ; `moved_since` si la ligne a bougé depuis ou si sa dernière décision n'est pas celle d'une personne,
`unchanged` si elle est déjà à l'étape d'avant ; entrée invalide : HINT `STAGE_UNDO_INVALID`. Appelée par « Annuler » du /pipeline (lot 0c-4, `undoCandidateStages`).
`rgpd_purge_candidate_rows(p_inactive_before, p_rejected_before, p_dry_run, p_limit)` (service_role seulement) : lignes
candidat à purger (24 mois sans activité hors Embauché, 12 mois après un écart), `p_dry_run` vrai par défaut, fenêtres plus
courtes refusées (HINT `PURGE_WINDOW_TOO_SHORT`). La fonction serveur rgpd-purge est en « compte seulement » par défaut
(décision 5 du plan 0c, même section) : sans `{"dry_run": false}` dans le corps, elle ne supprime rien, à aucune étape, et journalise ce
qu'elle supprimerait ; `knowledge_chunks` purgé par organisation, seulement sans autre ligne du candidat. Planification et règles
à décider après avis juridique.
Outils de l'assistant (lot 0c-2) : `get_my_missions` et `get_mission_overview` comptent par `get_mission_stage_counts`
(candidats du Pipeline, profils jamais ouverts à part) ; `get_mission_candidates` lit mission_candidate_rows (filtre sur l'étape
générale, jamais ouverts exclus) ; `assign_candidate_to_member` et `draft_outreach_message` cherchent le candidat par
`project_id` et organisation, tous auteurs ; le nombre de profils annoncé par `start_background_scoring` a le périmètre du worker
`process-agent-tasks` (organisation et `job_id` échantillon). Garde statique : `tests/c1/lot0c-lectures.test.mjs`.
Écrans (lots 0c-3 et 0c-4) : le kanban et le tableau de l'ancienne page mission (`useProjectCandidates`) et le `/pipeline`
(`useATSData`) lisent `mission_candidate_rows`, rangent par `general_stage` (`missionColumnOf`, `atsColumnOf`, `src/lib/stageDisplay.ts`)
et écrivent tout le groupe (`group_ids`) ; « Dans cette étape depuis N j » compte sur `stage_entered_at`. La liste des missions et le
tableau de bord lisent `get_mission_stage_counts` (`useMissionStageCounts`), Analyses et l'entonnoir passent par
`src/lib/missionStatsAdapter.ts`. Gardes statiques : `tests/c1/lot0c-socle-ecrans.test.mjs`, `lot0c3-*.test.mjs`, `lot0c4-*.test.mjs`.
Carte « Maintenant » (lot 3, 04/10/2026) : une seule règle de prochaine action, `src/lib/missionNextAction.ts` (module pur : rangs 0, 3, 6, 7, 8, 8b, 10 et 11, justification de « Pourquoi maintenant ? », ligne « Ensuite », colonne « Prochaine action » par `rowNextAction`, une ligne par mission par `missionListAction`), servie par `useMissionNow` (carte), `useMissionAttention` (RPC `get_mission_attention`, clé sous `['mission-stage-counts', 'attention', …]`) et `useMissionActionSnoozes` (« Plus tard »). `get_mission_attention(p_project_ids, p_item_limit, p_interview_days, p_reply_days)` : SECURITY INVOKER, authenticated seulement, une ligne par mission de l'organisation de l'appelant ; réponses non traitées lues dans `mission_conversations` (`last_inbound_at` postérieur à `last_outbound_at`, plafond de 30 jours) sur le compte LinkedIn de la personne connectée (les réponses d'un collègue sont comptées à part), entretiens sans mouvement depuis plus de 5 jours, profils notés à trier dont recommandés (`is_go_recommendation`), poste décrit (`job_details_is_described`, alignée sur `canScoreProfiles`). Cette lecture par liens diffère du chiffre d'« À traiter » de la barre latérale (notifications non lues, fenêtre de 3 jours ouvrés) : les deux peuvent dire des choses différentes pour une même réponse. `mission_action_snoozes` : « Plus tard » par personne (unique par personne, mission et clé d'action ; son auteur seul ; écriture refusée hors de l'organisation de la mission), échéance le lendemain 06:00 heure du navigateur ; un message du candidat postérieur au report annule le report d'une réponse ; jamais d'écriture sur `notifications`, `candidate_reminders` ni sur une clé `['sidebar', …]`. Gardes statiques : `tests/c1/lot3-*.test.mjs`, comportement : `tests/ux/lot3-maintenant.test.mjs`. Allégée le 04/10/2026 (retour du propriétaire : « trop chargé ») : la carte montre une phrase, un seul bouton plein et deux liens discrets ; la proposition, la règle appliquée, la liste « Ensuite » et « Non suivi » ne s'affichent que sous « Pourquoi maintenant ? ». Écran Pipeline : puces en une rangée sans titres de groupe ni effectif nul (le nom accessible garde le « 0 »), boutons Bilan et Prise de contact discrets, liste sans colonne « Depuis » (l'ancienneté passe sous l'étape, en orange à partir de 7 jours), action écrite seulement quand il y en a une (`rowNextAction` ne change pas : l'affichage ignore son texte de repos), visage du candidat (sa photo LinkedIn enregistrée, sinon ses initiales : voir « Visages des candidats » plus bas) et note en anneau. Même allègement pour le Cadrage et le Sourcing de la nouvelle page (04/10/2026) : Cadrage sans cartes (`SectionHeader`, `sectionUi.ts` : `SECTION_CLASS`, `REVEAL_ON_ROW`, `TOUCH`, `TOUCH_FIELD`, `useReturnFocus`), bandeau d'état en une ligne (anneau, titre, une phrase), corbeille, « Rédhibitoire » et poignée visibles au survol, au focus ou au toucher (l'opacité seule change, jamais `display`), « Qui recrute » sur une ligne avec « Préciser », colonne « En ce moment » des étapes seulement s'il y a des candidats ; Sourcing en puces d'état et bascule sans cadre, « Noter les N profils » seul bouton plein, tableau sans carte avec colonnes par défaut réduites (nom et titre, lieu, expérience, note ; choix enregistré sous `konekt_table_columns_v3_*`, jamais dans la clé de l'ancienne page). Les composants partagés avec l'ancienne page ne changent que derrière un drapeau, défaut identique à l'ancien rendu : `variant="mission-v3"` (CompactResultsTable, LinkedInResultCard, CardActions, CardStatusBadges, SmartOverlays, VoiceDictation), `embedded` (MissionConfigV2, MissionHuntMode, MissionClientPortal, MissionTeamSection de `process/shared.tsx`), `quiet` (SequenceEnrollButton, AddToProjectButton). En-tête de mission et liste des missions, même jour : en-tête avec le logo du client (`missionClientName` de `shell/missionClient.ts` : `job_details.client.name` d'abord, sinon `client_name`, comme l'accueil et la liste), statut sans cadre ni point de couleur placé à droite avant le menu « ... », client écrit seulement s'il reste 6 rem après le nom, fil « Missions » masqué de 1024 à 1279 px (reste dans le menu du nom et la barre latérale), un seul « Réactiver » par écran sur une mission archivée (bandeau `MissionStateBanner`, `ArchivedNotice` sans cadre et sans bouton sauf `withAction` dans le panneau plein écran) ; liste des missions (`ProjectsListV2`) avec logo du client, visages des candidats en entretien (`useInterviewingPeople` : une lecture bornée de `mission_candidate_rows`, 300 lignes au plus, RLS de l'appelant), sous-titre sans zéro, colonnes d'effectifs à partir de 1280 px et seulement si elles ont un nombre (en dessous : une phrase sous le nom), activité écrite à partir d'une heure (`QUIET_ACTIVITY_MS` de `missionListFormat.ts`), menu de ligne visible au survol, au focus ou au toucher (`REVEAL_ON_ROW`), ligne d'action orange seulement quand une réponse attend. Aucun calcul de chiffre n'a changé. Visages des candidats (05/10/2026) : la liste de Pipeline, la section À trier, le kanban (colonnes de 224 px) et l'en-tête de la fiche montrent la photo LinkedIn déjà enregistrée (`MissionCandidateRow.pictureUrl`, extraite côté base par `picture:linkedin_profile_data->>profile_picture_url` dans `MISSION_ROW_LIGHT_COLUMNS`, jamais le profil entier), sinon les initiales, y compris quand le lien a expiré (`PersonAvatar`). Le /pipeline global fait de même (06/10/2026) : carte du kanban, tableau et chronologie montrent la photo de la ligne de mission (`ATSCandidate.pictureUrl`, même extraction côté base dans `MCR_DISPLAY_COLUMNS`) ; un candidat de séquence ou d'InMail sans ligne n'a pas de photo, donc ses initiales. Copie privée des photos (lot P, 05/10/2026) : ces visages passent `candidateId` à PersonAvatar et montrent d'abord la copie (voir `candidate_photos`), jamais une photo devinée.

### Key Hooks
```
useSourcingProjects        — CRUD for sourcing_projects (React Query, 5min stale)
useMissionProcess          — process steps + team management
useMissionInvitations      — invite management
useLinkedInSearch          — search state machine (the big one)
useLinkedInSearchActions   — search execution + pagination
useLinkedInScoring         — batch AI scoring (3 parallel waves of 10)
useFilteredLinkedInAccounts — shared hook for account filtering
useOrganization            — org context + member role
useJobCandidateStatus      — candidate tracking per job
useSubscriptionState       — plan effectif, essai, sièges (RPC get_subscription_state)
useQuotaGate               — canCreateJob, canInviteMember (sièges moins invitations en attente)
useLinkedInQuotaStatus     — plafonds LinkedIn après palier (RPC get_linkedin_quota_status)
```

### Contexts
```
LinkedInAccountsContext     — LinkedIn accounts from Unipile (auto-reload, health check 5min)
AgentContext                — agent drawer state (open/close, modes: brief/process/sourcing/outreach)
OutreachSearchContext       — legacy global search (mostly replaced by useLinkedInSearch)
```

### Barre latérale (lots 5 et 6, 2026-09)
`src/components/AppSidebar.tsx` : trois onglets (À traiter par défaut, Missions, Assistant ; `src/lib/sidebarTabs.ts`), panneau de l'onglet actif, rangée basse (Tâches, Agenda, Marketplace, Paramètres, Aide), menu de l'avatar. Plus de cloche. La bulle ronde de l'assistant est revenue le 2026-10-05 (`src/components/agent/AssistantLauncher.tsx`, montée par `AppLayout`, masquée sur /agents et /inbox, `openAgent()`) ; Ctrl K reste.
- Composants dans `src/components/sidebar/**`, hooks dans `src/hooks/sidebar/**`, clés React Query sous `['sidebar', …]`, un seul canal temps réel (`useSidebarRealtime`).
- Un seul chiffre coloré : À traiter = panne LinkedIn + réponses de candidats non lues (3 jours ouvrés) + mes validations + notifications « action » non lues (`src/lib/sidebarSignals.ts`, `todoCount` : `null` si une source n'a rien renvoyé, jamais 0 inventé).
- La messagerie ne marque lues que les notifications de la conversation ouverte (`metadata->>chat_id`, `Inbox.tsx`).
- Épingles de missions : `job_favorites`, index unique `(user_id, job_id)`, une seule policy `own_rows_all` ; le front n'écrit jamais `organization_id` (absent en prod).
- Plafond de missions : `useQuotaGate` compte les missions non terminées ni archivées (`sourcing_projects` n'a pas `archived_at`).
- Événements à venir (05/10/2026) : zone `src/components/sidebar/UpcomingEvents.tsx`, sous le panneau de l'onglet actif, sur les trois onglets, barre dépliée seulement, masquée quand rien n'est prévu. Elle lit `qualification_sessions` des 3 prochains jours que j'anime (`useUpcomingInterviews`, clé `['sidebar', 'upcoming-interviews', …]`, même filtre « moi » que `useTodoInterviews`) ; la logique pure est dans `src/lib/sidebarSignals.ts` (`upcomingInterviews`, `formatUpcomingTime`, `interviewLinks`, `dueInterviewAlerts`). Cliquer une ligne ouvre la fiche (`/pipeline?candidate=`), sinon `/qualification/:id`. De 15 minutes avant le début jusqu'à la fin, la ligne propose Assistant d'entretien, visio et grille. `useInterviewAlerts`, monté dans AppSidebar, pose à l'heure de début une alerte `toast.custom` (rendue par Sonner, hors routeur : `InterviewAlertToast` et `InterviewActionButtons` ne lisent aucun contexte) avec Assistant d'entretien (`/pipeline/scorecard/:id?mission=…&coaching=1`), Rejoindre, Fiche et Grille ; une alerte par entretien et par heure de début (clés dans `localStorage` `konekt:interview-alerts`), proposée 10 minutes, absente si la personne est déjà sur la grille du candidat concerné. L'enregistrement part au clic sur « Démarrer l'enregistrement » dans l'assistant : le navigateur exige ce geste pour ouvrir le micro. Un agenda relié n'a qu'à écrire des lignes dans `qualification_sessions` pour apparaître ici. Une séance `cancelled` (posée par `calendly-webhook`, voir la note « Entretiens » plus bas) n'est ni listée ni alertée ; un déplacement met à jour les heures de la même séance, que la zone relit au rafraîchissement suivant (5 minutes). Test : `tests/ux/barre-evenements-a-venir.test.mjs`.
- Entretiens (« Entretiens aujourd'hui », « Comptes rendus à faire ») : `useTodoInterviews` lit `qualification_sessions` (animateur, sinon créateur) et se rafraîchit toutes les 5 minutes ; `splitInterviews` écarte `completed` et `cancelled`. `calendly-webhook` pose `cancelled` sur `invitee.canceled` (séances `scheduled` ou `in_progress` seulement, filtre par organisation de la séance). Un déplacement met à jour la même séance (événement, invité, heures, lien, statut gardé) via `old_invitee` de l'`invitee.created` ; l'`invitee.canceled` `rescheduled: true` qui l'accompagne est ignoré, dans l'un ou l'autre ordre. Limite connue : `setup-calendly-webhook` recrée un abonnement qui n'a pas les deux événements, mais ne vérifie pas la clé de signature d'un abonnement complet (créé sans clé avant ce correctif, il est rejeté en 401) : le supprimer côté Calendly puis rappeler la fonction. Le calendrier, le tableau de bord (`DashboardTodayPanel`) et `useAutoTaskSuggestions` ne filtrent pas encore `cancelled`. Ces trois fonctions Calendly sont retirées au lot I3 (`docs/refonte-mission/complement-equipe-marketplace-integrations.md`, section 3.5).

### Edge Functions (supabase/functions/)
```
Search & scoring:   unipile-search, coresignal-search, generate-search-filters, refine-search-filters, nl-filter-edit,
                    score-profile-job (batch LLM, 10 profiles/call), detect-profile-fraud, run-agent-search, search-agent-chat
AI / agent:         ai-chat-completion, ai-credits, agent-tool-action, agent-daily-digest, process-agent-tasks, text-action,
                    live-coach, deepgram-temp-key, generate-scorecard, generate-call-report, generate-client-competitors
Knowledge / RAG:    ingest-context, auto-ingest-context, ingest-user-file, retrieve-context, generate-embedding
Outreach & sequences: generate-outreach-message, generate-reply-suggestions, process-sequences, process-inmail-queue,
                    process-scheduled-actions, sequence-send-email, sequence-email-track, sequence-webhooks-handler
Inbox:              auto-analyze-message, auto-categorize-chats, analyze-response
Email transactionnel: send-transactional-email, process-email-queue, handle-email-suppression, handle-email-unsubscribe
Enrichment & sociétés: enrich-company, enrich-candidate-contact, get-enrichment-status, process-enrichment-queue,
                    resolve-pedigree-directory, refresh-pedigree-by-funding-stage
LinkedIn accounts:  unipile-accounts, unipile-webhook, unipile-manage-webhooks
Missions / pipeline: add-to-shortlist, submit-application (neutralisée au lot C1 : répond 410, à supprimer en prod), client-portal-data,
                    accept-mission-invitation, accept-invitation, send-team-invitation, marketplace-admin, resolve-client-logo (logo du client enregistré dans le brief, copie dans org-logos/{org}/clients/, appelée à l'affichage de la liste et de la mission)
Notion:             notion-mcp-oauth (connexion Notion de l'assistant)
Autres intégrations: stripe-webhook, create-checkout-session, create-portal-session, aircall-webhook (reçoit les appels, organisation retrouvée par le jeton de la liaison), aircall-connect (relier ou délier le compte Aircall d'une organisation, owner/admin), phone-call-insights (transcription Aircall, résumé et tâches proposées d'un appel ; appelée par aircall-webhook sur « transcription.created » avec la clé de service, et par le navigateur avec le JWT d'un membre pour « Récupérer » ou « Réessayer »), calendly-webhook,
                    setup-calendly-webhook, backfill-calendly
Extension Chrome:   extension-token, extension-quick-add, extension-pipeline-status
RGPD / données:     export-org-data, rgpd-erase-contact, rgpd-purge (compte seulement par défaut, lot 0c-2 ; étape 6 : transcriptions d'appels)
Photos:             capture-candidate-photos (copie privée des photos LinkedIn des candidats, cron toutes les 2 min, lot P)
```
74 fonctions (2026-10-06, phone-call-insights ajoutée par la transcription des appels ; 73 au 2026-10-05, aircall-connect ajoutée par la téléphonie lot A1 ; 72 après resolve-client-logo puis capture-candidate-photos ; 70 au 2026-09-28, après le retrait de Notion hors connexion de l'assistant ; create-portal-session ajoutée par le lot P0-C, marketplace-admin par le lot M). Supprimées lors des nettoyages : database-search, apollo-search, pdl-search, enrich-contact, enrich-vivier-contacts, puis le 2026-09-06 (aucun appelant) : analyze-linkedin-profile, backfill-knowledge-lake, chat-filter-assistant, estimate-search-count, fetch-aircall, fetch-airtable, fetch-notion-schema, n8n-create-workflow, nurturing-analyzer, preview-transactional-email, process-debrief, scan-career-pages, scrape-job-url, screen-candidate, sequence-snippets-crud, sequence-templates-crud, check-invitation-status, audit-employer-brand, generate-recruiter-bio, scan-recruiter-linkedin, puis le 2026-09-28 (retrait de Notion hors MCP) : fetch-notion-jobs, fetch-notion-candidates, update-notion-job, notify-notion, update-candidate-stage. Liste à jour : `ls supabase/functions/`.

---

## Supabase secrets (edge functions)

Configurer via dashboard : https://supabase.com/dashboard/project/crckfywoyjxkawathdff/settings/functions
ou CLI : `supabase secrets set --project-ref crckfywoyjxkawathdff KEY=value`.

### Auto-provisionnés par Supabase (ne pas toucher)
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `SUPABASE_PUBLISHABLE_KEY`.

### CRITICAL — à setter absolument, sinon fonctionnalités core cassées
| Secret | Utilisé par (principales) |
|--------|---------------------------|
| `ANTHROPIC_API_KEY` | **tous les appels AI** — le helper `_shared/call-claude.ts` est l'unique passerelle vers les LLM depuis la migration Lovable → Anthropic direct (2026-04-21). Ancien Lovable Gateway Gemini remplacé par Claude Haiku 4.5. Lu par 22 fonctions (2026-09-28) : ai-chat-completion, analyze-response, auto-analyze-message, auto-categorize-chats, detect-profile-fraud, enrich-company, generate-call-report, generate-client-competitors, generate-outreach-message, generate-reply-suggestions, generate-scorecard, generate-search-filters, ingest-user-file, live-coach, nl-filter-edit, process-sequences, refine-search-filters, retrieve-context, score-profile-job, search-agent-chat, sequence-send-email, text-action ; plus agent-tool-action et process-scheduled-actions via `_shared/agent-tools-mutations.ts` (import dynamique de call-claude.ts) |
| `OPENAI_API_KEY` | generate-embedding, ingest-context, ingest-user-file, retrieve-context (embeddings seulement) |
| `UNIPILE_API_KEY` + `UNIPILE_DSN` | unipile-accounts, unipile-search, unipile-webhook, unipile-manage-webhooks + toutes les fonctions qui touchent LinkedIn (~15 au total) |
| `SB_SECRET_KEY` | clé service-role « nouveau format » : lue en priorité par `_shared/require-auth.ts` et par quasiment toutes les fonctions (`Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`). Si absente, repli sur `SUPABASE_SERVICE_ROLE_KEY` auto-provisionnée |
| `ALLOWED_ORIGINS` | `_shared/cors.ts` (allowlist CORS, séparée par des virgules ; défaut = prod Vercel + localhost si absente) |
| `NOTION_API_KEY` + `NOTION_CANDIDATS_DB_ID` + `NOTION_POSTES_DB_ID` + `NOTION_SHORTLIST_DB_ID` | **Retirés (décision 16)** : plus lus par aucune fonction depuis le retrait de la synchro Notion par clé API (étapes 1 et 2, 28 et 29/09/2026 ; process-sequences et calendly-webhook compris). À supprimer des secrets existants, inutiles sur un nouvel environnement. Seule la connexion Notion de l'assistant reste (`NOTION_TOKEN_ENCRYPTION_KEY`, `NOTION_ALLOWED_RETURN_ORIGINS`, plus bas) |
| `STRIPE_SECRET_KEY` | create-checkout-session, create-portal-session, stripe-webhook (relecture des abonnements) |
| `RESEND_API_KEY` | process-email-queue (envoi emails via Resend API) |

**Note importante** : `LOVABLE_API_KEY` est entièrement retiré depuis 2026-04-21 (AI + Email). Emails sont maintenant sur Resend. AI sur Anthropic direct.

### IMPORTANT — features secondaires
| Secret | Utilisé par |
|--------|-------------|
| `APOLLO_API_KEY` | enrich-company, refresh-pedigree-by-funding-stage (+ repli env dans `_shared/resolve-org-credentials.ts`) |
| `CORESIGNAL_API_KEY` | coresignal-search (via `resolveCoresignalCredentials` de `_shared/resolve-org-credentials.ts`) |
| `BETTERCONTACT_API_KEY` | enrich-candidate-contact, get-enrichment-status |
| `BETTERCONTACT_CREDIT_COST_USD` | get-enrichment-status — prix d'un crédit fournisseur en dollars, pour renseigner `cost_usd` sur les débits d'enrichissement (sans jeton, le calcul par jetons donnerait zéro). Défaut 0.045, à remplacer par le tarif contracté |
| `UNIPILE_V2_API_KEY` + `UNIPILE_V2_WEBHOOK_TOKEN` | `_shared/unipile-v2.ts` (importé par unipile-webhook, unipile-manage-webhooks) — API v2 activée seulement si la clé est posée |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook |
| `AIRCALL_WEBHOOK_TOKEN` | **Retiré (téléphonie, lot A1)** : plus lu par aucune fonction, chaque liaison a son jeton propre (empreinte dans `telephony_connections`). À supprimer des secrets existants |
| `CALENDLY_WEBHOOK_SIGNING_KEY` | calendly-webhook (vérifie la signature), setup-calendly-webhook (la pose sur l'abonnement, refus s'il manque) |
| `UNIPILE_WEBHOOK_SECRET` | unipile-webhook, unipile-manage-webhooks, unipile-accounts, sequence-webhooks-handler, `_shared/unipile-v2.ts` |
| `SEQUENCE_WEBHOOK_SECRET` | sequence-webhooks-handler |
| `PROCESS_SEQUENCES_SECRET` | auth des crons : process-sequences, process-email-queue, process-inmail-queue, process-scheduled-actions, process-agent-tasks, process-enrichment-queue, agent-daily-digest, refresh-pedigree-by-funding-stage, resolve-pedigree-directory, capture-candidate-photos |
| `KONEKT_PLATFORM_ADMIN_USER_IDS` | unipile-manage-webhooks (ids user séparés par des virgules ; sans ce secret, owner/admin de l'org suffit — SEC-031) |
| `NOTION_TOKEN_ENCRYPTION_KEY` | `_shared/notion-secret-crypto.ts` (chiffrement des tokens Notion ; importé par notion-mcp-oauth et `_shared/notion-mcp-connection.ts`) |
| `NOTION_ALLOWED_RETURN_ORIGINS` | notion-mcp-oauth (origines de retour OAuth autorisées) |
| `APP_URL` | agent-daily-digest, create-checkout-session, create-portal-session, notion-mcp-oauth, send-transactional-email, sequence-email-track, sequence-send-email, `_shared/agent-tools-mutations.ts` (= https://konekt-app-navy.vercel.app) |
| `EMAIL_SITE_NAME` + `EMAIL_SENDER_DOMAIN` + `EMAIL_FROM_DOMAIN` | send-transactional-email (défauts : « Konekt », `notify.konekt.fr`, `konekt.fr`) |
| `RESEND_WEBHOOK_SECRET` | handle-email-suppression (Svix signature verif, format `whsec_...`) |
| `EMAIL_LINK_SIGNING_SECRET` (+ `EMAIL_LINK_SIGNING_SECRET_PREVIOUS` pour une rotation) | sequence-send-email, sequence-email-track : signature des liens suivis et du pixel des e-mails de séquence. Repli sur la clé de service si absent |

### OPTIONAL — fallback/dev
`DEEPGRAM_API_KEY` + `DEEPGRAM_PROJECT_ID` (deepgram-temp-key), `PERPLEXITY_API_KEY` (enrich-company), `FIRECRAWL_API_KEY` (enrich-company), `CANDIDATE_PHOTO_ORIGINS` (capture-candidate-photos : origines de photos ajoutées à https://media.licdn.com, banc local seulement, jamais en prod).

`PDL_API_KEY`, `N8N_API_KEY`, `N8N_INSTANCE_URL` et `MICROSOFT_GRAPH_TOKEN` ne sont plus lus par aucune fonction depuis le nettoyage du 2026-09-06 : inutiles sur un nouvel environnement, à retirer des secrets existants à l'occasion.

## Supabase Auth config (URL allow-list)

À configurer manuellement dans le Dashboard (pas via `supabase config push` qui reset d'autres settings) :
https://supabase.com/dashboard/project/crckfywoyjxkawathdff/auth/url-configuration

- **Site URL** : `https://konekt-app-navy.vercel.app`
- **Redirect URLs** (additional) :
  - `https://konekt-app-navy.vercel.app/**`
  - `http://localhost:5173/**`
  - `http://localhost:8080/**`

## Gotcha RLS (fix du 2026-04-21)

Le schéma importé depuis Lovable n'avait PAS les GRANTs sur les tables public → erreur "permission denied for table organizations" lors de l'onboarding. Fix appliqué : migration `supabase/migrations/20260421180000_grants_bootstrap_owner_uniques.sql`, qui grant SELECT/INSERT/UPDATE/DELETE à `authenticated` + default privileges + fix bootstrap owner (enforce_role_hierarchy) + ajout UNIQUE constraints sur 10 tables (profiles, connector_instances, ai_credit_balances, organization_subscriptions, chat_categories, job_candidate_status, member_email_accounts, member_linkedin_accounts, member_quotas, message_analysis_cache) + extension `members_select` sur organizations pour inclure `created_by = auth.uid()`. Idempotente, rejouable.

---

## Critical State Patterns

### missionSearchCache (IN-MEMORY, survives re-mounts)
```
Map<"mission-sourcing:{projectId}", {
  filters, results, selectedJob, jobScores, sortByScore,
  statusFilter, showDismissed, selectedProfiles,
  scrollTop, scoringInstructions
}>
```
- Written on: tab switch away, filter change, search complete
- Hydrated on: tab re-entry (hydratedCacheKeyRef prevents double hydrate)
- **DANGER**: In mission context, cache restore SKIPS selectedJob (we fixed this) but still restores everything else

### Synthetic Job Creation
```
activeProject exists → useLinkedInSearch creates job from brief:
  id: "project:{projectId}"
  title: jd.title || activeProject.name
  skills: jd.skills_must_have + jd.skills_should_have
  description: jd.mission_description + jd.context
  bodyContent: evaluation_criteria (max 15, truncated to 2000 chars)
  mustHave/shouldHave/niceToHave: from brief skills
```
- Re-triggers on: `activeProject?.id` OR `activeProject?.job_details` change
- Cache restore does NOT override this (`hydratedCacheKeyRef` / `activeProject` guard in the cache restore effect)

### Filter Loading from filters_snapshot
```
1. useLinkedInSearch detects AI format (has skills_keywords/location_keywords/role[].keywords)
2. Transforms to LinkedInFiltersState format
3. Stores pending location keyword in pendingLocationRef
4. When selectedAccount becomes available → resolves location to geo ID
```

---

## Edge Function Conventions (MANDATORY)

Every edge function MUST follow these patterns. See `.claude/skills/edge-function.md` for the full skeleton.

### Auth & Multi-tenant
```typescript
// 1. Auth — use requireAuth from shared module
import { requireAuth, verifyOrgMembership } from "../_shared/require-auth.ts";
const auth = await requireAuth(req, corsHeaders);

// 2. If organization_id comes from request body, VERIFY membership
if (organization_id && auth.userId) {
  const isMember = await verifyOrgMembership(admin, auth.userId, organization_id);
  if (!isMember) return json({ error: "Forbidden" }, 403);
}
```

### Plan et sièges : use the shared gate
```typescript
import { getSubscriptionGate } from "../_shared/subscription-gate.ts";
const gate = await getSubscriptionGate(adminClient, organizationId);
// gate.effectivePlanId, gate.status, gate.seatLimit (TRIAL_SEAT_ALLOWANCE = 10 pendant l'essai),
// gate.seatCount, gate.canSendSequences, gate.canEnrichContacts (false sur free)
```
Appelants : process-sequences, process-inmail-queue, enrich-candidate-contact (403 PLAN_REQUIRED), send-team-invitation et accept-invitation (refus de siège). Le helper lit `get_subscription_state`, jamais `organization_subscriptions.plan_id` en direct.

### Credentials — NEVER use mutable globals
```typescript
// ❌ WRONG — credential bleed between concurrent requests
let UNIPILE_API_KEY = Deno.env.get("UNIPILE_API_KEY");

// ✅ CORRECT — immutable env fallbacks + per-request resolution
const ENV_UNIPILE_API_KEY = Deno.env.get("UNIPILE_API_KEY");
// In handler: resolve per-org, store in local variable
const creds = await resolveUnipileCreds(orgId, supabase);
```

### External HTTP calls — ALWAYS use fetchWithTimeout
```typescript
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}
// Use 30s for LLM calls, 15s for everything else
```

### AI calls — ALWAYS settle credits
```typescript
import { extractAIParams, settleCredits } from "../_shared/settle-credits.ts";
// After every Anthropic API call:
await settleCredits(adminClient, {
  organizationId, userId, aiAction, modelId,
  tokensInput: response.usage.input_tokens,
  tokensOutput: response.usage.output_tokens,
  description,
});
```

### AI model IDs — current valid models
- `claude-sonnet-4-6` — default for all AI calls
- `claude-opus-4-6` — for complex reasoning (agent chat)
- `claude-haiku-4-5-20251001` — for fast/cheap tasks
- Resolve via `getAnthropicModelId()` from `_shared/ai-config.ts`
- **NEVER hardcode deprecated IDs** like `claude-sonnet-4-20250514`

### DSN format for Unipile
- `resolveUnipileCredentials()` returns dsn WITH `https://` prefix
- When constructing URLs: `const baseDsn = creds.dsn.startsWith('http') ? creds.dsn : \`https://${creds.dsn}\``
- NEVER do `https://${creds.dsn}` — causes double `https://`

---

## Frontend Conventions

### Feature gating
```typescript
import { hasFeature } from '@/lib/featureGates';
// hasFeature(orgType, feature) — fail-closed: returns false while orgType is null (org loading).
```
Second axe, par plan d'abonnement : `hasPlanFeature(planId, feature)` dans le même fichier (`sequences_send`, `contact_enrichment`, `team`, `client_portal`, `agency_settings`, `marketplace_publish`) ; miroir serveur dans `supabase/functions/_shared/subscription-gate.ts`.

**Plan effectif = `get_subscription_state`, jamais `organization_subscriptions` en direct côté front.** Le hook `useSubscriptionState` appelle la RPC, qui expire un essai échu à la lecture et renvoie `effective_plan_id`, `status`, `trial_days_left`, `seat_count`, `limits`. Lire `organization_subscriptions.plan_id` directement donne un essai expiré non encore basculé ou un abonnement annulé comme s'il était actif (`useSubscription` ne lit la ligne brute que pour les identifiants Stripe et prend le plan effectif de `useSubscriptionState`).

Matrice par type d'organisation (`enterprise` / `agency` / `freelance`) dans `src/lib/featureGates.ts`. Décision produit 2026-09 : **un freelance a les mêmes droits qu'un cabinet sur ses missions** (`create_missions`, `edit_brief`, `edit_process`, `sourcing`, `outreach`, `pipeline`, `client_portal`, `marketplace_browse`), **sauf** `team_management` (pas d'onglet Équipe) et `agency_settings` (plus aucun lecteur depuis le retrait de l'onglet Agence). `marketplace_publish` reste réservé aux entreprises. Les rubriques des Paramètres (`sectionAccess`, `src/lib/settingsRoutes.ts` : Équipe exige `team_management`) et les `readOnly` de MissionBriefV2/MissionProcessV2 découlent de cette matrice.

### Écritures sur `organizations` — passer par `updateOrganization`
`src/lib/organizationUpdate.ts` relit la ligne écrite : sans `.select()`, un refus RLS répond « succès » sur 0 ligne. Côté base (lot 1 des Paramètres, migration 20260923095813) : une seule policy UPDATE `admins_update` (owner/admin) et le trigger `organizations_update_guard`. L'admin modifie `name`, `logo_url`, `website`, `ai_context` ; tout le reste (`org_type`, `agency_permissions`, `ai_model_default`…) reste au propriétaire (HINT `ORG_OWNER_ONLY`). Passage en `freelance` refusé s'il reste un autre membre ou une invitation en attente (HINT `ORG_FREELANCE_NOT_SOLO`). Bucket `org-logos` : écriture owner/admin dans le dossier `{organization_id}/`, un nom de fichier unique par envoi.
Audits SQL rejoués par la CI e2e (base neuve) : `supabase/tests/rls_two_orgs_audit.sql`, `org_writes_audit.sql`, `org_member_emails_audit.sql`, `member_quotas_self_service.sql`, `job_favorites_audit.sql`, ceux du lot C1 : `assistant_conversations_audit.sql`, `client_portal_audit.sql`, `partner_engagements_audit.sql`, `rls_and_definer_audit.sql`, et pour les séquences `seq_db_audit.sql`, `seq_scheduled_1_audit.sql`, `seq_steps_1_audit.sql`, `seq_engine_1_audit.sql`, `seq_identity_audit.sql`, `seq_decisions_db_audit.sql`, et pour le modèle des étapes candidat (refonte mission, lot 0a) `candidate_stage_model_audit.sql`, puis pour les écrivains du lot 0b `candidate_stage_writers_audit.sql`, et pour les lectures du lot 0c `candidate_stage_readers_audit.sql`, puis pour la carte Maintenant (lot 3) `mission_attention_audit.sql` et `mission_action_snoozes_audit.sql`, et pour la copie privée des photos (design simplifié, lot P) `candidate_photos_audit.sql`. `org_logos_storage_audit.sql` se lance à la main (tables internes du stockage).
Dans un audit, ne jamais appeler sous `SET ROLE anon` ou `authenticated` une fonction refusée à ce rôle : dans l'image Postgres locale (17.6.1.106), supautils ajoute un indice au refus et le serveur tombe (signal 11, e2e du 24 au 26/09). Contrôler le droit avec `has_function_privilege`, et le refus réel par l'API (`curl …/rest/v1/rpc/<fonction>` avec la clé anon, voir `e2e.yml`).

### Règles posées par le lot C1 (réparations des fuites, 2026-09)
- Toute fonction SECURITY DEFINER nouvelle révoque EXECUTE à PUBLIC et à anon (anon seulement pour une liste blanche justifiée dans `rls_and_definer_audit.sql`), sinon cet audit échoue. anon n'écrit plus dans aucune table du schéma public, sauf INSERT sur `contact_submissions` ; une table nouvelle ne lui donne rien.
- Conversations de l'assistant (`agent_conversations`, `agent_messages`) : leur auteur seul. Les actions (`agent_tool_executions`) : l'auteur, plus la lecture par propriétaire et administrateurs (Journal). search-agent-chat et run-agent-search refusent qui n'est pas l'auteur.
- Une ligne `job_candidate_status` ou `outreach_sequences` ne porte que la mission de sa propre organisation (policies RESTRICTIVE `mission_same_org_*`) ; les compteurs de mission (`recompute_mission_stats`) ne comptent que les lignes de l'organisation de la mission. Plus aucune policy d'équipe de mission (`mission_team`) hors de la mission, de ses étapes et de l'équipe.
- Toute écriture serveur sur les lignes candidat filtre par organisation (score-profile-job, process-agent-tasks, auto-analyze-message), et le cache `match_scores` est lu et écrit par organisation.
- Marketplace gelée jusqu'au lot P2 (décision 17) : `MARKETPLACE_FROZEN` dans `src/lib/marketplaceFreeze.ts`, refus serveur avec le HINT `MARKETPLACE_FROZEN` (publication, validation de partenaire, marketplace-admin). Rôle « Collaborateur » gelé jusqu'au lot C2 : refusé sur `organization_invitations` (HINT `COLLABORATOR_FROZEN`), retiré des écrans et de l'outil d'invitation de l'assistant.
- Garde-fous statiques : `npm run test:c1` (`tests/c1/`), joués par la CI de PR.

### État et liaison LinkedIn
Une seule lecture de l'état : `src/lib/linkedinStatus.ts` (liaison stricte par `user_id` via `member_linkedin_accounts`, jamais le compte d'un collègue). Relier et dissocier passent par `unipile-accounts` (`claim_linkedin_account`, `unlink_linkedin_account`), pas par un upsert/delete du navigateur (RLS owner/admin). « Dissocier » ne ferme pas la session chez le prestataire : il retire la liaison et arrête les envois du compte (inscriptions en pause `manual`, étapes gardées en attente et ignorées par le moteur, InMails programmés annulés, compte retiré des rotations multi-expéditeurs ; helper `_shared/linkedin-sending-stop.ts`). Le même arrêt s'applique quand un membre change de compte et avant le retrait d'un membre (`unipile-accounts` action `stop_member_linkedin`, owner/admin).

### Téléphonie : transcription, résumé et tâches proposées d'un appel (2026-10-06)
- **Chaîne** : Aircall (module AI Assist) envoie `transcription.created` ; `aircall-webhook` retrouve l'organisation par le jeton, puis l'appel par son identifiant (`transcriptionCallIdCandidates` : `call_id` d'abord, puis `id`, toujours cherchés dans les appels de CETTE organisation) ; `phone-call-insights` (clé de service) lit `GET /calls/{id}/transcription` avec les identifiants de l'organisation, jamais renvoyés au navigateur ; `normalizeAircallTranscription` met la réponse en répliques ; l'IA Konekt rend résumé et tâches par un outil à sortie structurée, validée par `parseInsightsToolInput` (résumé 1200 caractères au plus, 5 tâches au plus, échéance 0 à 60 jours). Logique pure sans import : `supabase/functions/_shared/aircall-transcript.ts`.
- **Crédits** : action `call_summary`, inscrite dans les deux registres (`_shared/ai-config.ts`, `src/types/aiCredits.ts`). Garde avant le modèle, débit après. Imputés à l'appelant quand c'est un membre ; quand c'est le serveur, à la personne qui a relié Aircall si elle est encore membre, sinon à un propriétaire (aucun : `no_user`, la transcription est gardée sans résumé). Crédits insuffisants : 402 au navigateur, `error_code: credits` au serveur.
- **Rejouable** : un résumé déjà gardé n'est jamais refait sans `force` ; un verrou doux (`summary_started_at`, 3 minutes) évite deux résumés simultanés ; les tâches ne sont proposées qu'une fois par appel. Un état d'échec se relance depuis la fiche (« Réessayer »), et un appel décroché sans ligne se récupère à la main (« Résumé et transcription »).
- **Confidentialité** : le contenu de la conversation (répliques, résumé) n'est jamais écrit dans les journaux, seuls les noms de champs d'une forme inconnue le sont. La transcription est encadrée par `<transcription>` dans la consigne et traitée comme une donnée ; aucun numéro de téléphone n'est transmis au modèle.
- **Liaison** : `aircall-connect` demande `transcription.created` en plus des trois événements d'appel ; si Aircall refuse la création (400 ou 422), elle est refaite avec les trois seuls (`transcription_events: false` dans la réponse). Une liaison créée avant cette fonction doit être reliée de nouveau (« Relier à nouveau ») pour recevoir l'événement.
- **Non vérifié contre un compte réel** (documentation d'Aircall inaccessible au moment de l'écriture) : le nom exact de l'événement, l'adresse et la forme de la réponse de la transcription. La lecture est tolérante ; une forme inconnue donne `failed / format`. Premier vrai appel enregistré avec AI Assist = premier test réel : lire les journaux de `phone-call-insights` (noms de champs seulement) et adapter `normalizeAircallTranscription`.
- **Écrans** : `PhoneCallInsights` (src/components/outreach) sous l'appel dans `PhoneCallHistoryPanel` (fiche profil, hors mode pipeline) et dans `ActivityTab` (fiche du pipeline et panneau de la page mission : l'événement `aircall_call` porte `meta.callId`). Lecture groupée en deux requêtes par `usePhoneCallInsights` (clé `['phone-call-insights', …]`). Textes et échéances dans `src/lib/callTaskSuggestion.ts` (module pur).
- **RGPD** : `export-org-data` exporte les deux tables ; `recordGdprErasure` (étape 11) efface les appels portant les numéros du candidat (`candidate_contacts.phone`, en E.164), donc leur transcription, résumé et tâches proposées par cascade. Limites : un candidat sans numéro enregistré n'a pas d'appel rapproché ; un effacement par e-mail seul ne trouve pas de numéro si aucune ligne du pipeline n'est retrouvée. **Conservation (06/10/2026)** : `rgpd-purge` (étape 6) purge la transcription, le résumé et les tâches proposées d'un appel de plus de 12 mois, par `rgpd_purge_phone_call_insights(p_before, p_dry_run, p_limit)` (service_role seulement, SECURITY INVOKER, fenêtre minimale de 6 mois sinon HINT `PURGE_WINDOW_TOO_SHORT`, 500 lignes par passage). L'âge est celui de l'appel (`started_at`, sinon `created_at` de l'appel), pas celui de la transcription. Comme toutes les étapes de `rgpd-purge`, elle compte sans supprimer tant que le corps ne porte pas `{"dry_run": false}` ; la planification et la durée de 12 mois (valeur de départ, pas un avis juridique) restent à confirmer par un juriste. La ligne de l'appel (`phone_calls` : date, durée, numéro) et les tâches déjà créées (`candidate_reminders`) ne sont pas purgées. Limite connue : après une purge, « Résumé et transcription » sur un appel décroché peut relire la transcription chez Aircall si elle y est encore.
- **Tests** : `tests/c1/telephonie-transcription.test.mjs` (module pur, migration, gardes statiques) et `tests/c1/telephonie-transcription-flux.test.mjs` (exécute la vraie fonction avec un faux réseau : `node --experimental-strip-types --test`), audit SQL `supabase/tests/telephony_audit.sql` (contrôles 16 à 27, dont 23 à 27 pour la purge), `tests/c1/telephonie-purge.test.mjs` (gardes statiques et vraie fonction `rgpd-purge` avec un faux réseau). Branchés dans `ci.yml` et `e2e.yml`.

### Séquences : règles du moteur et de l'interface (audit 2026-09-25, `docs/audit-2026-09-25-sequences.md`)
- **Pause** = `status 'paused'` + `pause_reason` ; les exécutions en attente (`scheduled`, `waiting_event`, `quota_blocked`) gardent leur date et le moteur les ignore. Aucune pause n'annule d'exécution, sauf celles que pose le moteur pour abonnement requis ou compte non rattaché : il annule l'étape courante avec la raison, et la reprise la réarme. Une clôture (réponse, désinscription, rebond, RDV, effacement RGPD) annule toutes les exécutions en attente, jamais `sending`.
- **Reprise** = toujours l'action serveur `resume_enrollments` (ou `re_enroll` pour une inscription close), jamais une réécriture d'exécution depuis le navigateur. La réactivation d'une séquence ne reprend que `sequence_inactive` et `auto_paused`.
- **Séquence désactivée** (`is_active = false`) : le moteur n'envoie jamais rien (filtre dans la sélection et au dernier contrôle) ; aucune reprise automatique (reconnexion, abonnement) ne réactive ses inscriptions.
- **Canaux e-mail et WhatsApp fermés** : le moteur saute ces étapes (« pas encore disponible ») sans appel, jusqu'à une réouverture décidée et testée.
- **Actions membres de `process-sequences`** (JWT, organisation vérifiée) : `nudge_sequences` (actions du jour seulement, `sequence_ids`), `resume_enrollments`, `re_enroll`, `mark_replied`, `skip_execution`. Un collaborateur n'agit que sur ses propres inscriptions ; un candidat effacé (RGPD) n'est jamais repris.
- **Réponse d'un candidat**, quel que soit le chemin (webhook LinkedIn ou e-mail, `check_replies`, vérification avant envoi, `mark_replied`, étape d'attente, « Si pas de réponse ») : inscription `replied`, exécutions en attente annulées, inscriptions sœurs du candidat dans l'organisation arrêtées (identifiants, `resolved_profile_id`, slug exact de `profile_url` ; pour une inscription `completed`, seules les sœurs créées avant sa fin), InMails `pending`/`scheduled` de l'organisation annulés. Côté webhook : `_shared/candidate-reply-closure.ts` (sans pipeline) ; un rejeu refait l'arrêt des sœurs à partir des inscriptions déjà closes (réponse comptée une fois).
- **Pipeline à la réponse (SEQ-006, lot 0b)** : `record_candidate_inbound`, et lui seul, dans une seule mission. Réponse vue par une conversation (webhook, pour tout message du candidat, conversation manuelle comprise, un appel par organisation du compte) : la mission de la conversation (lien `mission_conversations` ; sur un fil partagé, celle du dernier envoi attribué), sinon du profil sur ce compte, de l'inscription, puis des lignes contactées de l'organisation. Réponse vue par une inscription sans conversation (moteur, `mark_replied`, e-mail) : la mission de l'inscription d'abord. « A répondu » suppose « Contacté » : si un envoi Konekt est prouvé dans la mission, la ligne passe « Contacté » puis « A répondu » (origine `system`), sinon elle reste (`not_contacted`). Les autres missions et organisations ne bougent pas. Candidat effacé (RGPD) dans l'organisation : aucune étape écrite, ni par sa réponse, ni par un message propre, ni par l'analyse de la réponse (rattrapage, résumé), ni par un envoi manuel (registre illisible : rejeu au webhook, rien ailleurs). Compte relié à plusieurs organisations (état hérité) : une organisation sans inscription ni InMail sur ce compte n'est écrite que si la conversation ou le candidat y est déjà lié sur ce compte (même règle pour l'analyse et le message propre). Au webhook, seule une erreur transitoire fait rejouer (500) ; un refus métier ou une fonction absente est journalisé.
- **Envoi (lot 0b)** : « Contacté » est posé à l'envoi réel par `record_candidate_outbound` (origine `system`, mission de l'envoi : explicite, de l'inscription ou résolue), avec une ligne À trier créée si le candidat n'en a pas dans la mission. Chemins : moteur (en tête de la branche de succès, invitation comprise), file InMail, `unipile-search` `send_message` (fenêtre de message, fiche, messagerie, assistant) ; chacun pose d'abord un marqueur avant le POST (écho reconnu au webhook). Appel au mieux : un échec est journalisé et ne fait jamais échouer un envoi parti ; un envoi incertain (5xx, délai) n'est pas enregistré. Depuis le lot 0b-2b, le navigateur n'écrit plus « Contacté » (ni à l'inscription, ni après un message de la fiche, de la messagerie ou de la fenêtre de message) ; ses envois portent `project_id`, l'id de la mission sans `project:` (`missionIdOfJob`, `src/hooks/useEnrollmentPreview.ts`), sinon le serveur résout la mission.
- **Message écrit hors Konekt** (depuis le compte du recruteur : `new_message` avec `is_sender`, ou `message_received` de notre propre participant) : `record_own_message`, non bloquant. Écho d'un envoi Konekt (même message, envoi de moins de 10 min, note d'invitation) : rien. Fil déjà rattaché sur ce compte : « Contacté » d'un candidat Retenu, dans la mission de ce lien seulement. Aucun fil rattaché : « Contacté » seulement si le candidat est Retenu dans une seule mission de l'organisation, sinon rien. Ce message ne change jamais la mission d'une réponse à venir.
- **File InMail** : dernier contrôle avant envoi (réponse à l'organisation, InMail déjà répondu, effacement RGPD) ; un InMail répondu reste un contact pour l'anti-doublon de 90 jours (serveur, navigateur, assistant).
- **Gardes en base** : le compte d'envoi d'une inscription est contrôlé à la création et à la modification (`account_id`, `created_by`), et une inscription depuis le compte d'un membre a toujours un auteur ; `assigned_sender_id` n'est écrit que par le moteur ; une inscription effacée (RGPD) ne change plus de statut pour un utilisateur connecté, et un profil effacé (registre ou marqueur de l'organisation) ne peut plus être inscrit (HINT `ENROLLMENT_GDPR_ERASED`) ; la même personne, sous n'importe quel identifiant, ne peut pas figurer deux fois dans une séquence si l'autre inscription est vivante ou close depuis moins de 90 jours (`ENROLLMENT_SAME_PERSON_IN_SEQUENCE`) ; une inscription ne repasse en `active` que par le serveur (`ENROLLMENT_RESUME_SERVER_ONLY`) ; une étape annulée ou en échec ne se réarme que côté serveur, et le navigateur n'insère que la première étape d'une inscription active (`EXECUTION_REARM_SERVER_ONLY`, `EXECUTION_INSERT_SERVER_ONLY`). Conversations et messages de l'assistant : leur auteur seul (lot C1). `agent_tool_executions` : chacun lit ses lignes, owner/admin toute l'organisation ; `executed_at` n'est effaçable que par « Relancer » un échec.
- **Moteur, décisions du 28/09** : un envoi incertain (5xx, délai) ou une lecture de profil impossible ne comptent pas pour l'auto-pause ; la place du plafond LinkedIn est rendue quand rien ne part ; un seul envoi par personne et par cycle, toutes identités confondues ; `check_replies` examine aussi les inscriptions terminées depuis 14 jours (hors RDV et hors effacement) ; seul un rendez-vous postérieur au début de l'inscription l'arrête. Registre RGPD illisible = refus (`isGdprBlocked` lève `GdprRegistryUnavailableError`) ; le moteur reporte l'étape au lieu de l'annuler.
- **Assistant, garde-fous d'envoi (lot 5a)** : `enroll_in_sequence` et `resume_sequence` ne sont jamais automatiques (`NEVER_AUTO_TOOLS` : une politique « auto » enregistrée est ramenée à « approve » par le serveur ; Paramètres › Assistant ne propose plus « Automatique » pour eux). `enroll_in_sequence` refuse une séquence dont une étape à message a `use_ai_personalization` (refus dans `verifyAccess`, raison rendue au modèle : la relecture par inscrit se fait à l'écran). Sa carte d'approbation, et le Journal qui peut aussi l'approuver, montrent le premier message entier, sans troncature (`details.first_step_preview`, `_shared/enroll-preview.ts`, rendu commun `src/components/agent/EnrollFirstMessagePreview.tsx`) : premier texte du parcours après `pickFirstRootStep` (une invitation sans note n'en est pas un, le parcours continue ; une fourche donne un texte par branche, une étape A/B chaque version, tirée à l'inscription comme dans l'interface), variables résolues comme par le moteur (`buildSequenceContext` puis `interpolateAndStrip`) sur une inscription qui porte exactement les champs qu'`execute` écrit, lus dans la ligne du candidat de la mission (organisation et `project_id`, par identifiant puis par slug) : `profile_name`, `profile_headline`, `company_name`, et `job_title` = titre de la mission. Variables de l'heure d'envoi (`{{salutation}}`, `{{periode_jour}}`, dates) : annoncées entre crochets, jamais résolues à la proposition (`SEND_TIME_VARIABLES`). Candidat absent de la mission : aperçu avec son seul nom, annoncé, sans refus. « Modifier » ne rejoue pas `dryRun` : `profile_name` et `profile_url` y sont en lecture seule (`READONLY_FIELDS_BY_TOOL`).
- **Case des destinataires (lot 5a)** : « Je confirme les destinataires » obligatoire dès 5 destinataires (`src/lib/contactRecipientsGuard.ts`, composant `enrollment-preview/RecipientsConfirm.tsx`) dans `EnrollmentPreviewModal` (N = `activeProfiles.length`), `SequenceEnrollModal` (`enrollCount`) et `BulkInMailModal` (`readyCount`), soit le nombre du bouton ; aide reliée par `aria-describedby`, bouton désactivé sans la case, case décochée dès que la liste change, premier message entier au-dessus (premier InMail prêt, objet compris, pour l'InMail groupé). Premier message des fenêtres de séquence : parcours du moteur (`enrollment-preview/firstMessagePath.ts`), branche « Vérifier la relation » choisie d'après la relation connue du candidat, sinon les deux avec leur condition. Une étape à message rédigée par l'IA compte comme message même sans modèle (`hasMessage`, `useEnrollmentPreview.ts`) : la séquence passe par la préparation avec aperçu, et l'étape s'annonce « Message rédigé par l'IA Konekt pour ce candidat : générez-le pour le relire. ». Récapitulatif (plus de 10 candidats) : « Aperçu du premier message » avec ‹ ›. Aucun texte n'annonce une rédaction par l'IA « au moment de l'envoi ». Gardes statiques : `tests/ux/lot5a-destinataires.test.mjs`, `tests/agent/sequence-tools-policy.test.mjs`.
- **Tests du moteur** : `e2e/local-stack` (stack locale, faux prestataires scriptables par compte), `e2e/helpers/sequence-engine.ts`, fichiers `e2e/api/seq-*.spec.ts`, `e2e/flows/seq-*.spec.ts`, `supabase/tests/seq_*_audit.sql`.
- Libellés communs : `src/lib/sequenceLabels.ts` (statuts, raisons de pause), `src/lib/sequenceErrorMessages.ts` (erreurs, `formatSkipReason`), `stepTypeLabel` de `src/components/outreach/sequence/sequenceGraph.ts` (types d'étape).

### Assistant d'entretien en direct : capture audio (05/10/2026)
Le micro seul n'entend pas le candidat quand on porte un casque : sa voix ne passe que dans les écouteurs. `LiveCoachingPanel` propose « Visio ou appel » (micro et audio partagé par `getDisplayMedia`, onglet ou écran entier ; choix gardé sous `konekt.live-capture-mode`) ou « Sur place » (micro seul). Règles pures dans `src/lib/liveAudioCapture.ts`.
- Une connexion de transcription par flux : le micro est le Recruteur, l'audio partagé le Candidat, sans distinction des voix à demander au service (`diarize=false`). Le texte envoyé à `live-coach` et `generate-call-report` porte alors une ligne « [Recruteur] » ou « [Candidat] » à chaque changement de locuteur. Avec une seule piste (« Sur place », navigateur sans partage audio), le texte reste continu et la distinction des voix du service s'applique, comme avant.
- Partage audio : Chrome et Edge sur ordinateur seulement (Firefox, Safari et mobiles l'ignorent). L'audio du système (application installée) n'existe que sous Windows ; sous macOS, seul l'audio d'un onglet se partage. `getDisplayMedia` passe avant `getUserMedia` (il exige un geste récent de la personne). La vidéo du partage est demandée au minimum (160 x 90, 1 image par seconde) et gardée : elle sert de témoin d'arrêt.
- La clé temporaire (`deepgram-temp-key`) est demandée avant la création de la séance et de l'introduction : un démarrage qui échoue ne laisse plus de séance vide ni d'introduction facturée.
- « Relancer le partage » et « Changer le partage » remplacent la source du candidat sans arrêter le micro.
- Garde statique et comportement : `tests/ux/live-capture-audio.test.mjs`.
- Cadence des suggestions (`src/lib/liveCoachCadence.ts`, garde `tests/ux/live-coach-cadence.test.mjs`) : une analyse seulement avec au moins 120 caractères de texte neuf ET 25 s depuis la précédente (la pause de la voix ne déclenche plus rien seule) ; un sujet suivant reste affiché au moins 45 s, une nouvelle suggestion attend l'analyse suivante ; 3 points à creuser au plus à l'écran, les plus récents. L'analyse finale à l'arrêt reste libre.

### Destructive actions — ALWAYS use AlertDialog
```typescript
// ❌ WRONG — breaks design language
if (window.confirm('Supprimer ?')) { ... }

// ✅ CORRECT — use shadcn AlertDialog with French text
<AlertDialog>
  <AlertDialogContent>
    <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
    <AlertDialogDescription>Cette action est irréversible.</AlertDialogDescription>
    <AlertDialogFooter>
      <AlertDialogCancel>Annuler</AlertDialogCancel>
      <AlertDialogAction variant="destructive">Supprimer</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

### Promises — ALWAYS handle rejections
```typescript
// ❌ WRONG — user stuck on infinite spinner if reject
accept(token).then(handleSuccess);

// ✅ CORRECT
accept(token).then(handleSuccess).catch(() => setStatus('error'));
```

### useEffect — avoid object deps
```typescript
// ❌ WRONG — new object ref every render = infinite re-fire
}, [search, activeProject]);

// ✅ CORRECT — use primitive values or refs
}, [activeProject?.id, searchSource]);
```

---

## Common Pitfalls
- **useEffect deps**: use `activeProject?.id` not `activeProject` (object ref never changes)
- **missionSearchCache**: restores ALL state — any hook state changes can be overwritten on tab switch
- **Edge function timeout**: 60s on Supabase — batch LLM calls must fit within this
- **Vercel deploys from main** — must merge PR to main for changes to be visible (~2 min)
- **Edge functions are auto-deployed** by `.github/workflows/deploy-edge-functions.yml` on push to `main` (only the functions changed under `supabase/functions/**`; a `_shared/` change redeploys everything). Manual hotfix: `supabase functions deploy <name> --project-ref crckfywoyjxkawathdff`
- **Two filter formats coexist** — AI format vs LinkedInFiltersState, transformation in useLinkedInSearch
- **Step reordering**: uses temp negative order values to avoid UNIQUE constraint, then reassigns positive
- **Location deferred resolution**: if no LinkedIn account connected, location stays as keyword until account available
- **No /prospection route anymore** — the vivier/CRM page was removed; org-type gating lives in `featureGates.ts` (see Feature gating)
- **/candidates redirects to /pipeline** — one single entry point for candidates

---

## 🛠️ Skills disponibles & quand les utiliser

Les skills locaux du projet (`.claude/skills/`) doivent être invoqués selon le contexte :

| Skill | Quand l'invoquer |
|-------|------------------|
| `edge-function.md` | User demande de créer/scaffolder une nouvelle edge function Supabase |
| `migration.md` | User demande de créer une migration SQL (nouvelle table, ajout colonne, RLS, backfill) |
| `qa.md` | Avant tout merge vers `main`, OU quand l'user veut tester un flow (4 personas Guillaume/Claire/Théo/Sophie). **Obligatoire** si edge function critique, RLS, ou flow client final touché. |
| `systematic-debugging.md` | User dit "ça marche pas" / "bug bizarre" / race condition / RLS permission denied / "marche en local mais pas en prod" / état incohérent après tab switch |

Slash commands disponibles :
- `/deploy` — détecte les edge functions modifiées et donne les commandes deploy
- `/debug` — **natif Claude Code** : debug l'app Claude Code elle-même (logs, daemon), PAS le code Konekt → pour debugger le code, utiliser le skill `systematic-debugging.md`

---

## Apollo API (enrichment sociétés, pedigree)

Apollo n'est **plus une source de sourcing** (voir « Sourcing strategy ») : `database-search`, `apollo-search`, `mapFiltersToApollo`, `bulk_match` et `apolloToLinkedInProfile` n'existent plus. Ce qui reste :

- `APOLLO_API_KEY` en secret Supabase (repli env dans `_shared/resolve-org-credentials.ts`).
- **enrich-company** : `mixed_companies/search` + `organizations/enrich?domain=` (fiche société, effectifs, levée de fonds), `organizations/{id}/job_postings` (postes ouverts), `mixed_people/api_search` (contacts clés) et `news_articles/search` (signaux). `buildSignals()` dérive les badges (levée récente, croissance, recrutement) de la réponse.
- **refresh-pedigree-by-funding-stage** (cron) : `mixed_companies/search` par stade de levée pour rafraîchir les entrées `source='cron_apollo'` du référentiel pedigree.

Rappels API :
- Pas de syntaxe booléenne (AND/OR/NOT) ; `q_keywords` plafonné à 500 caractères, `q_organization_name` à 200.
- `total_entries` est au niveau racine de la réponse, pas dans `pagination`.
- 1 crédit par match sur `people/match` ; n'appeler que pour un candidat/contact actionnable, jamais en browsing.

---

## Unipile API (LinkedIn Integration)

### Architecture
```
Frontend (invokeUnipile) → unipile-search edge function → Unipile API → LinkedIn
```
- Credentials per-org in `organization_integrations` table (unipile_api_key, unipile_dsn)
- Fallback to env vars: `UNIPILE_API_KEY`, `UNIPILE_DSN`
- Base URL: `https://{DSN}/api/v1`
- Auth header: `X-API-KEY: {apiKey}`
- All fetch calls use 15s timeout

### LinkedIn API Types (Licenses)
| License | API Value | Features |
|---------|-----------|----------|
| Classic | `classic` | Basic search, limited filters, no skills/role filter |
| Recruiter | `recruiter` | Advanced search, Boolean keywords, role/skills/seniority, hiring projects, talent pools, spotlights |
| Sales Navigator | `sales_navigator` | Account search, company filters, groups, past roles |

### Main Actions (unipile-search edge function)

**search** — `POST /linkedin/search?account_id={id}`
- Accepts all LinkedIn filter params (keywords, location, role, skills, seniority, etc.)
- Returns `{ success, results: LinkedInProfile[], cursor, total }`
- Error `CONTENT_TOO_LARGE` if keywords >200 chars → auto-truncated
- Auto-retry 3x on `multiple_sessions` error (0ms, 6s, 15s delays)

**get_profile** — `GET /users/{profile_id}?account_id={id}`
- Returns full profile (work_experience, education, skills, summary)
- `profile_url` accepted as alternative → slug extracted
- Profile data normalized (dates, network distance, Boolean flags)

**get_parameters** — `GET /linkedin/search/parameters`
- Autocomplete for filter values (location, company, school, skills...)
- Params: `type`, `service` (RECRUITER/CLASSIC/SALES_NAVIGATOR), `keywords`
- Returns `{ items: [{id, title}] }`

**get_chats** — `GET /chats?account_id={id}`
- Fetches from 3 folders in parallel: INBOX_LINKEDIN_CLASSIC, INBOX_LINKEDIN_RECRUITER, INBOX
- Dedupes by chat ID, sorts newest first
- Returns `{ chats, cursors, cursor }`

**send_message** — `POST /chats/{chat_id}/messages` or `POST /chats` (new)
- Multipart form-data format
- InMail: set `is_inmail: true` + `subject` → uses `linkedin[api]: recruiter`

**get_messages** — `GET /chats/{chat_id}/messages`
- Returns `{ messages, cursor }`

### Webhook Events (unipile-webhook)
| Event | Action |
|-------|--------|
| `new_relation` | Update enrollment connection_status, resolve wait_connection step |
| `message_received` | Mark enrollment as replied, cancel pending steps, auto-analyze |
| `account_connected` | Update account_status → OK |
| `account_disconnected` | Update status → CREDENTIALS, notify user |

### Key Differences by License
| Filter | Classic | Recruiter | Sales Nav | Database |
|--------|---------|-----------|-----------|----------|
| keywords | ✅ | ✅ | ✅ | ✅ (cleaned) |
| location | IDs only | ID+priority+scope+radius | IDs | Names (normalized) |
| role/job_title | ❌ | ✅ Boolean keywords | ✅ | ✅ person_titles |
| skills | ❌ | ✅ ID+priority | ❌ | Text only |
| seniority | Basic mapping | Full mapping + role injection | Full mapping | Apollo mapping |
| company_keywords | ❌ | ✅ keywords+priority+scope | ❌ | ✅ q_organization_name |
| degree | ❌ | ✅ include/exclude | ❌ | ❌ |
| spotlight | ❌ | ✅ (OPEN_TO_WORK, ACTIVE_TALENT...) | ❌ | ❌ |

### Error Handling
- `429 RATE_LIMIT` → retry after 60s, toast "Trop de requêtes"
- `400 CONTENT_TOO_LARGE` → auto-truncate keywords
- `500 multiple_sessions` → auto-retry 3x
- Network errors → French humanized messages
- `CREDENTIALS` account status → prompt user to reconnect

### Deployment Warning
**Edge functions are auto-deployed** by `.github/workflows/deploy-edge-functions.yml` on push to `main` (changed functions only; `workflow_dispatch` accepts a name, a comma-separated list or `all`). Manual hotfix if needed:
```bash
supabase functions deploy --all --project-ref crckfywoyjxkawathdff
# Or individually:
supabase functions deploy <function-name> --project-ref crckfywoyjxkawathdff
```
Supprimer un dossier de `supabase/functions/` ne retire rien en prod : le workflow ignore les dossiers absents, mais l'ancien code (avec sa copie figée de `_shared/`) reste servi. Après merge, pour chaque fonction retirée : `supabase functions delete <nom> --project-ref crckfywoyjxkawathdff`.
**SQL migrations** auto-apply via `.github/workflows/deploy-migrations.yml` on push to `main` (paths `supabase/migrations/**`). This was broken for weeks by a remote tracking-table desync (only 6/219 versions tracked → `supabase db push` refuses with "Found local migration files to be inserted before the last migration on remote"). Recovery: re-run the workflow in `workflow_dispatch` with `repair_tracking=true` (break-glass — marks all local versions `applied` in the tracking table only, no DDL re-run, reversible). Manual application still works as a hotfix and is idempotent:
```bash
supabase db push --linked
```
