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
/inbox                   → Inbox : conversations et, depuis le lot 5f-3 (12/10/2026), l'onglet Invitations (invitations LinkedIn reçues, accepter ou décliner), pour tous, sans
                           interrupteur : /inbox?onglet=invitations (les onglets de la liste gardent a-repondre, a-relancer, en-attente). Interrupteur des séquences allumé,
                           le panneau Prise de contact de la mission n'a plus l'onglet et ?outreach=invitations y mène ici ; éteint, le panneau provisoire garde son onglet.
/calendar                → CalendarPage
/tasks                   → TasksPage
/sequences               → SequencesPage (lot 5c-2) : séquences de l'organisation, onglets ?onglet= (toutes, a-venir,
                           modeles, statistiques). /sequences/:id → SequenceDetailPage (&depuis=mission:<id>), onglets
                           ?onglet= (etapes, candidats avec ?statut= et ?parcours=, statistiques, journal, reglages) ;
                           statut d'un inscrit par src/lib/enrollmentStatusLine.ts, Parcours sur le graphe
                           (src/lib/sequenceJourney.ts), Journal, « À venir » et Candidats paginés par curseur
                           (src/lib/journalCursor.ts), gestes de src/lib/sequenceActions.ts et du lot 5b.
                           /sequences/nouvelle?mission=<id>&depart=zero|modele:<clé>|copie:<id>|ia (rédaction par l'IA, lot 5e ;
                           &proposition=<id> : séquence proposée par l'assistant, relue dans agent_tool_executions) → même page en création
                           (lot 5d-2, onglets Étapes et Réglages) : rien n'est écrit avant « Enregistrer ». Éditeur unique
                           (lot 5d-2) : l'onglet Étapes est le seul éditeur sous l'interrupteur (src/components/sequences/editor/ :
                           fil en liste, palette jugée par isStepAllowedAt, panneau d'étape, variables de
                           src/lib/sequenceVariables.ts, aperçu réel par preview_values, validateSequence seule règle,
                           enregistrement explicite par useSequenceSave, brouillon local) ; « Modifier », « Créer une
                           séquence » et « Dupliquer » (copie puis sa page, lot 5h) du panneau de mission y mènent
                           (NewSequenceDialog) ; interrupteur éteint, SequenceBuilder reste le seul éditeur. Interrupteur
                           konekt.sequences-v2 (src/lib/sequencesBeta.ts : clé locale, ?sequences-v2=1|0), allumé par
                           défaut depuis le lot 5h (bascule du 07/10/2026, demande du propriétaire, avant 5f et 5g) ;
                           secours ?sequences-v2=0 ou clé à '0' jusqu'au lot 5j : l'ancien parcours, SequencesGate renvoie
                           vers /missions et aucun lien n'y mène. /outreach mène à /sequences (secours : /missions ;
                           ?sequences-v2= suit la redirection, onlySequencesBetaParam).
                           Notifications d'une séquence sans mission : /sequences/<id>, plus /missions ; l'alerte
                           « Relances non arrêtées » sans séquence (InMails seuls, y compris ceux d'une mission)
                           ouvre la fiche du candidat (/pipeline?candidate=<id>, décision du 07/10/2026).
/marketplace             → Marketplace
/settings                → Settings, coquille à deux portes (src/pages/Settings.tsx, registre src/components/settings/shell/sections.tsx).
  Mon compte : /settings/account/connections | writing | journal (provisoire, part dans /agents au lot 9).
  Mon organisation (propriétaire et admin) : /settings/org/general | team | billing | assistant.
  Anciens ?tab= redirigés par resolveLegacySettingsUrl (src/lib/settingsRoutes.ts), paramètres conservés.
/qualification/:id       → Qualification session (deep-linked from modals)
Public (no AppLayout): / (landing), /auth, /onboarding (protected, no org guard), /portal/:token (CandidatePortal),
  /client/:token (ClientPortalV2), /r/:slug (RecruiterPublicProfile), /unsubscribe, /privacy, /privacy-extension,
  /pricing (page tarifs publique, lisible sans session : SELECT anon sur subscription_plans)
Legacy: /outreach → /sequences (lot 5h ; secours : /missions), /ats → /pipeline, /index → /
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
                             Garde stage_write_guard (lot 0b), en refus depuis le lot 0b-5 (11/10/2026) : une écriture
                             directe qui change l'étape dérivée (jeton authenticated, service_role ou anon, ou SET ROLE) lève
                             l'erreur 42501 (HINT STAGE_DIRECT_WRITE, DETAIL = ligne et couples). Pendant l'observation
                             (28/09 au 11/10), elle était journalisée dans jcs_direct_write_log (rôle, utilisateur, ligne,
                             couples, x-client-info ; fermé à anon et authenticated) et le journal est resté vide ; en refus,
                             rien n'y est plus écrit (l'écriture est annulée), l'écrivain fautif se lit dans l'erreur et les
                             journaux de l'API. Le navigateur signe x-client-info de son build : `konekt/<7 caractères du commit
                             Vercel>`, ou `konekt/dev` (src/integrations/supabase/client.ts, define de vite.config.ts).
                             Passent sans refus : set_candidate_stage(s), insertion À trier, note, changement
                             de mission au couple intact, replace_process_steps, contextes sans jeton (migration, psql, cron).
                             Mode : jcs_stage_write_mode() (off, observe, refuse), posé par une migration (la dernière gagne ;
                             0b-1 ne rétrograde jamais un refus déjà posé). Arrêt d'urgence neutre : ALTER TABLE
                             public.job_candidate_status DISABLE TRIGGER stage_write_guard; puis, le jour même, un fichier de
                             migration qui repose le mode voulu ET réactive le déclencheur (règle 1) ; runbook complet dans
                             l'en-tête de la migration du lot 0b-5. Le bloc S8 de candidate_stage_writers_audit.sql exige refuse.
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
                             depuis le compte LinkedIn relié à un autre membre, HINT ENROLL_ACCOUNT_OF_OTHER_MEMBER ;
                             effacement RGPD, 11/10/2026 : l'étape 7 bis de recordGdprErasure retire tracking_data.message_overrides
                             (textes retouchés pour le candidat) des inscriptions retrouvées, marqueurs gardés ; effacements
                             passés rattrapés par la migration 20261012112803 (décision du 12/10/2026 : inscriptions au marqueur
                             gdpr_erased_at non vide, seule la clé message_overrides part, updated_at gardé))
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
phone_call_transcripts     — transcription d'un appel (lot A5), une ligne par appel (call_id, ON DELETE CASCADE avec l'appel) :
                             utterances jsonb [{ who: agent | contact | unknown, start, end, text }], char_count, language. Lue par
                             les membres de l'organisation active, écrite seulement par record_phone_call_transcript (service_role,
                             rejouable : un rejeu ne relance pas une analyse faite ou en cours). Aircall n'envoie pas le texte dans
                             `transcription.created` (enveloppe resource conversation_intelligence, data.call_id) : aircall-webhook le
                             lit par GET /v1/calls/:id/transcription (_shared/aircall-transcript-ingest.ts, identifiants de
                             organization_integrations, appel relu chez Aircall s'il manquait), puis lance analyze-phone-call en arrière-plan.
                             Exige l'option AI Assist d'Aircall ; un abonnement créé avant le lot A5 doit être relié à nouveau (réglages).
phone_call_insights        — analyse d'un appel (lot A5), une ligne par appel : status pending | analyzing | done | failed | skipped
                             (+ reason : too_short, insufficient_credits, unreadable, error), summary, tags (vocabulaire fermé
                             _shared/phone-call-insight.ts : INSIGHT_TAGS), facts { availability, salary, location, remote, motivation,
                             other_processes }, next_steps [{ action, owner recruiter | contact, when }], mission_id + mission_fit
                             (mission du candidat rapproché dont l'appel parle clairement, seulement parmi celles fournies au modèle).
                             Même visibilité et mêmes droits que la transcription. claim_phone_call_analysis (service_role) prend
                             l'analyse pour un seul traitement à la fois (reprise après 5 minutes, `p_force` pour « Analyser à nouveau »).
                             L'analyse n'écrit rien d'autre : aucune étape, aucune note, aucun message vers le candidat (les suites sont
                             des suggestions affichées). Contexte donné au modèle : le candidat dont le numéro est le seul à correspondre
                             (candidateIdForNumber, même prudence qu'à l'écran) et au plus 3 de ses missions (kind = mission).
                             Conservation et effacement (lot A6, décisions du 06/10/2026 proposées par Claude et déléguées par Laurent,
                             À CONFIRMER par un avis juridique) : transcription 6 mois après l'APPEL (la CNIL plafonne à 6 mois
                             l'enregistrement des appels au travail), appel + analyse 24 mois après l'appel, par rgpd-purge (étapes 6 et 7,
                             « compte seulement » par défaut, `_shared/phone-call-erasure.ts` : durées et `retentionCutoff`). Effacement d'un
                             candidat : `recordGdprErasure` étape 11 supprime les appels de ses numéros (candidate_contacts, par
                             identifiants connus ou adresse e-mail), transcriptions et analyses par cascade, SAUF un numéro qu'un autre
                             candidat de l'organisation porte aussi (`planCallErasure`, rendu dans `keptSharedNumbers`). Les coordonnées
                             (candidate_contacts) ne sont pas effacées par ce chemin, ni l'enregistrement chez Aircall (réglage Aircall).
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
member_calendar_accounts   : agenda relié par un membre (agenda Outlook, lot I3, demande A ; Google plus tard). Une ligne par
                             compte du service de connexion (unique par organisation et `account_id`) et par personne et
                             fournisseur : provider (outlook, google), email_address, status (reflet de l'état du compte),
                             last_synced_at, last_error. Lue par la personne tant qu'elle est membre, et par les propriétaires
                             et administrateurs de l'organisation (une policy SELECT) ; écrite par les fonctions serveur
                             seulement (clé de service). Supprimée avec l'organisation, exportée par export-org-data (sans
                             `account_id`). Aucune fonction ne la lit encore (demandes B et C du plan).
qualification_sessions     : séances d'entretien. Colonnes d'agenda (lot I3, demande A) : .source (manual, agenda, invitation,
                             booking ; les séances Calendly existantes sont passées à booking) ; .calendar_account_id (agenda
                             d'origine, ON DELETE SET NULL : un agenda retiré laisse la séance) ; .external_event_id. Index
                             unique partiel (calendar_account_id, external_event_id) : un événement ne crée qu'une séance.
                             RGPD : étape 12 de recordGdprErasure (séances du candidat, trouvées par identifiant, adresse du
                             profil et invitee_email, supprimées avec leurs extraits knowledge_chunks), purge à 24 mois (étape 8
                             de rgpd-purge, en compte seulement par défaut), export-org-data. Plan :
                             docs/refonte-mission/agenda-outlook-construction-2026-10-05.md. Séquences (11/10/2026) : une
                             séance source = agenda n'arrête jamais une séquence (voir « Moteur, décisions du 28/09 ») ;
                             manual, invitation et booking l'arrêtent.
candidate_reminders        : rappels et tâches sur un candidat (nom affiché, mission, note libre, échéance). organization_id
                             peut manquer (rappels de l'extension Chrome, candidate_id de forme linkedin:{slug}). RGPD
                             (11/10/2026) : étape 12 bis de recordGdprErasure, rappels trouvés par les identifiants connus du
                             candidat et par ses séances (source_event_id, lu avant leur suppression), jamais par le nom ; un
                             rappel sans organisation n'est supprimé que si son auteur n'est membre que de l'organisation de
                             l'effacement (résultat deletedReminders). Exportée par export-org-data, filtrée par organisation
                             (10 000 lignes au plus, _meta.candidate_reminders_count et candidate_reminders_truncated), donc
                             sans les rappels sans organisation. Purge à 24 mois (décision du 12/10/2026) : rgpd-purge, étape 9,
                             24 mois après la dernière activité (la plus tardive de created_at, updated_at, due_at et
                             completed_at, `_shared/reminder-retention.ts`), rappels sans organisation compris, en « compte
                             seulement » par défaut comme les autres étapes (reminders_purged, reminders_without_org_purged).
candidate_evaluations      : grille d'entretien (« scorecard » dans le code). Refonte scorecard et assistant en direct, lot 1
                             (05/10/2026) : .project_id (mission) et .process_step_id (étape d'entretien de cette mission), tous deux
                             ON DELETE SET NULL ; .candidate_id est l'identifiant du profil (job_candidate_status.candidate_id), jamais
                             l'id d'une ligne (les avis du portail client portaient l'id de la ligne jusqu'au lot 1, repris par la
                             migration). Lecture : toute l'organisation. Écriture : l'auteur seul (policies RESTRICTIVE
                             evaluations_author_*, created_by imposé à l'insertion ; les permissives par organisation, héritées de la
                             base neuve comme de la prod, laissaient tout membre modifier ou supprimer la grille d'un collègue).
                             Mission, étape : celles de l'organisation de la ligne, l'étape celle de la mission (mission_same_org_*).
call_coaching_sessions     : séance de l'assistant d'entretien en direct (live-coach, generate-call-report). Lot 1 : .project_id,
                             .process_step_id, .evaluation_id (grille alimentée, remplace à terme .scorecard_id, texte sans clé
                             étrangère), .qualification_session_id (événement d'origine), .candidate_consent_at (instant du serveur
                             au premier enregistrement, immuable ensuite), .transcript_expires_at (création + 90 jours, NOT NULL) et
                             .transcript_purged_at. Un utilisateur connecté ne fixe ni l'expiration ni la purge (déclencheur
                             call_coaching_sessions_retention_guard, SECURITY INVOKER, current_user authenticated ou anon) ; la clé de
                             service et les contextes sans jeton écrivent librement (purge au lot 6). Droits d'écriture comme
                             candidate_evaluations (coaching_author_*, mission_same_org_*), lecture par l'organisation. generate-call-report
                             refuse une séance qui n'est pas celle de l'appelant (SEC-023), avant l'appel au modèle.
```
RPC (SECURITY DEFINER, authenticated) : `get_subscription_state(org)` (plan effectif, essai, sièges, limites ;
expire un essai échu à la lecture), `get_org_contact_usage(org)` (contacts inclus utilisés / forfait),
`get_linkedin_quota_status(account)` (compteurs jour/semaine, facteur de montée en charge via `linkedin_ramp_factor`).
Cron : `expire-subscription-trials` (horaire) → `expire_subscription_trials()`.
`get_sequence_enrollment_counts(p_sequence_ids)` (SECURITY INVOKER, compte par séquence, statut et raison de pause, borné par la RLS),
`find_recent_org_contacts(p_org, p_values, p_slugs, p_since)` (SECURITY DEFINER, anti-doublon sur toute l'organisation de l'appelant, collaborateur compris, colonnes minimales),
`save_sequence_steps` (refus HINT STEP_HAS_HISTORY pour une étape déjà envoyée, SEQUENCE_NOT_OWNER pour la séquence d'autrui côté collaborateur ; seule écriture de `sequence_steps` dans `src/` et `supabase/functions/` : l'éditeur par `useSequenceSave`, la copie de `sequenceActions.ts` et `create_sequence` de l'assistant, avec la clé de service, depuis le lot 5e).
`client_portal_candidates(token)` (lot C1 : seule lecture des candidats du portail client, retenus et au-delà de l'organisation du lien ; service_role seulement, appelée par client-portal-data). `client_portal_candidate_profile_id(token, row_id)` (refonte scorecard, lot 1 : identifiant du profil d'une ligne visible, par `client_portal_candidates`, service_role seulement ; sert à écrire l'avis du client sous l'identifiant du profil, jamais renvoyé au navigateur car il désigne un candidat que le portail peut anonymiser). Tout lien de portail expire (90 jours par défaut, `expires_at` NOT NULL).
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
Depuis le 11/10/2026, `get_org_analytics` compte le pipeline sur mission_candidate_rows (étape générale, un candidat par mission,
jamais ouverts exclus, sous les sept libellés de l'interface, zéros compris ; même forme `{ total_candidates, by_stage }`).
`get_sequences_status`, et les inscriptions de `get_org_analytics` pour un collaborateur, lisent `sequence_enrollments.job_id` sous ses
trois formes : id de la mission, `project:<id>` et job rattaché (`missionEnrollmentJobIds`, copie de celle de
`src/lib/sequenceErrorMessages.ts`, même périmètre que les écrans). Garde : `tests/c1/correctifs-textes-assistant.test.mjs` ;
e2e : `e2e/api/seq-assistant.spec.ts` (cas `gss-formes-identifiant-mission`, `goa-pipeline-etape-generale`,
`goa-collaborateur-formes-identifiant-mission`).
Écrans (lots 0c-3 et 0c-4) : le kanban et le tableau de l'ancienne page mission (`useProjectCandidates`) et le `/pipeline`
(`useATSData`) lisent `mission_candidate_rows`, rangent par `general_stage` (`missionColumnOf`, `atsColumnOf`, `src/lib/stageDisplay.ts`)
et écrivent tout le groupe (`group_ids`) ; « Dans cette étape depuis N j » compte sur `stage_entered_at`. La liste des missions et le
tableau de bord lisent `get_mission_stage_counts` (`useMissionStageCounts`), Analyses et l'entonnoir passent par
`src/lib/missionStatsAdapter.ts`. Gardes statiques : `tests/c1/lot0c-socle-ecrans.test.mjs`, `lot0c3-*.test.mjs`, `lot0c4-*.test.mjs`.
Carte « Maintenant » (lot 3, 04/10/2026) : une seule règle de prochaine action, `src/lib/missionNextAction.ts` (module pur : rangs 0, 3, 6, 7, 8, 8b, 10 et 11, justification de « Pourquoi maintenant ? », ligne « Ensuite », colonne « Prochaine action » par `rowNextAction`, une ligne par mission par `missionListAction`), servie par `useMissionNow` (carte), `useMissionAttention` (RPC `get_mission_attention`, clé sous `['mission-stage-counts', 'attention', …]`) et `useMissionActionSnoozes` (« Plus tard »). `get_mission_attention(p_project_ids, p_item_limit, p_interview_days, p_reply_days)` : SECURITY INVOKER, authenticated seulement, une ligne par mission de l'organisation de l'appelant ; réponses non traitées lues dans `mission_conversations` (`last_inbound_at` postérieur à `last_outbound_at`, plafond de 30 jours) sur le compte LinkedIn de la personne connectée (les réponses d'un collègue sont comptées à part), entretiens sans mouvement depuis plus de 5 jours, profils notés à trier dont recommandés (`is_go_recommendation`), poste décrit (`job_details_is_described`, alignée sur `canScoreProfiles`). Cette lecture par liens diffère du chiffre d'« À traiter » de la barre latérale (notifications non lues, fenêtre de 3 jours ouvrés) : les deux peuvent dire des choses différentes pour une même réponse. `mission_action_snoozes` : « Plus tard » par personne (unique par personne, mission et clé d'action ; son auteur seul ; écriture refusée hors de l'organisation de la mission), échéance le lendemain 06:00 heure du navigateur ; un message du candidat postérieur au report annule le report d'une réponse ; jamais d'écriture sur `notifications`, `candidate_reminders` ni sur une clé `['sidebar', …]`. Gardes statiques : `tests/c1/lot3-*.test.mjs`, comportement : `tests/ux/lot3-maintenant.test.mjs`. Allégée le 04/10/2026 (retour du propriétaire : « trop chargé ») : la carte montre une phrase, un seul bouton plein et deux liens discrets ; la proposition, la règle appliquée, la liste « Ensuite » et « Non suivi » ne s'affichent que sous « Pourquoi maintenant ? ». Écran Pipeline : puces en une rangée sans titres de groupe ni effectif nul (le nom accessible garde le « 0 »), boutons Bilan et Prise de contact discrets, liste sans colonne « Depuis » (l'ancienneté passe sous l'étape, en orange à partir de 7 jours), action écrite seulement quand il y en a une (`rowNextAction` ne change pas : l'affichage ignore son texte de repos), visage du candidat (sa photo LinkedIn enregistrée, sinon ses initiales : voir « Visages des candidats » plus bas) et note en anneau. Même allègement pour le Cadrage et le Sourcing de la nouvelle page (04/10/2026) : Cadrage sans cartes (`SectionHeader`, `sectionUi.ts` : `SECTION_CLASS`, `REVEAL_ON_ROW`, `TOUCH`, `TOUCH_FIELD`, `useReturnFocus`), bandeau d'état en une ligne (anneau, titre, une phrase), corbeille, « Rédhibitoire » et poignée visibles au survol, au focus ou au toucher (l'opacité seule change, jamais `display`), « Qui recrute » sur une ligne avec « Préciser », colonne « En ce moment » des étapes seulement s'il y a des candidats ; Sourcing en puces d'état et bascule sans cadre, « Noter les N profils » seul bouton plein, tableau sans carte avec colonnes par défaut réduites (nom et titre, lieu, expérience, note ; choix enregistré sous `konekt_table_columns_v3_*`, jamais dans la clé de l'ancienne page). Les composants partagés avec l'ancienne page ne changent que derrière un drapeau, défaut identique à l'ancien rendu : `variant="mission-v3"` (CompactResultsTable, LinkedInResultCard, CardActions, CardStatusBadges, SmartOverlays, VoiceDictation), `embedded` (MissionConfigV2, MissionHuntMode, MissionClientPortal, MissionTeamSection de `process/shared.tsx`), `quiet` (SequenceEnrollButton, AddToProjectButton). En-tête de mission et liste des missions, même jour : en-tête avec le logo du client (`missionClientName` de `shell/missionClient.ts` : `job_details.client.name` d'abord, sinon `client_name`, comme l'accueil et la liste), statut sans cadre ni point de couleur placé à droite avant le menu « ... », client écrit seulement s'il reste 6 rem après le nom, fil « Missions » masqué de 1024 à 1279 px (reste dans le menu du nom et la barre latérale), un seul « Réactiver » par écran sur une mission archivée (bandeau `MissionStateBanner`, `ArchivedNotice` sans cadre et sans bouton sauf `withAction` dans le panneau plein écran) ; liste des missions (`ProjectsListV2`) avec logo du client, visages des candidats en entretien (`useInterviewingPeople` : une lecture bornée de `mission_candidate_rows`, 300 lignes au plus, RLS de l'appelant), sous-titre sans zéro, colonnes d'effectifs à partir de 1280 px et seulement si elles ont un nombre (en dessous : une phrase sous le nom), activité écrite à partir d'une heure (`QUIET_ACTIVITY_MS` de `missionListFormat.ts`), menu de ligne visible au survol, au focus ou au toucher (`REVEAL_ON_ROW`), ligne d'action orange seulement quand une réponse attend. Aucun calcul de chiffre n'a changé. Visages des candidats (05/10/2026) : la liste de Pipeline, la section À trier, le kanban (colonnes de 224 px) et l'en-tête de la fiche montrent la photo LinkedIn déjà enregistrée (`MissionCandidateRow.pictureUrl`, extraite côté base par `picture:linkedin_profile_data->>profile_picture_url` dans `MISSION_ROW_LIGHT_COLUMNS`, jamais le profil entier), sinon les initiales, y compris quand le lien a expiré (`PersonAvatar`). Le /pipeline global fait de même (06/10/2026) : carte du kanban, tableau et chronologie montrent la photo de la ligne de mission (`ATSCandidate.pictureUrl`, même extraction côté base dans `MCR_DISPLAY_COLUMNS`) ; un candidat de séquence ou d'InMail sans ligne n'a pas de photo, donc ses initiales. Copie privée des photos (lot P, 05/10/2026) : ces visages passent `candidateId` à PersonAvatar et montrent d'abord la copie (voir `candidate_photos`), jamais une photo devinée. Les adresses de photo expirent (paramètre `e=`) : P-0b (05/10/2026) les garde fraîches pour la copie privée (`claim_candidate_photos` lit l'adresse de `linkedin_profile_data`). `batchDiscover` appelle `refresh_candidate_pictures(p_job_ids, p_items)` (SECURITY INVOKER, authenticated et service_role, jamais anon ; 200 profils au plus, HINT `PICTURE_BATCH_TOO_LARGE`, `PICTURE_JOBS_INVALID`, `PICTURE_ITEMS_INVALID`, `PICTURE_AUTH_REQUIRED`) : elle fusionne côté base la petite et la grande adresse dans `linkedin_profile_data` des lignes de l'appelant seulement (`created_by = auth.uid()`), qui ont déjà un profil objet, quand l'adresse enregistrée manque ou échoit dans moins de 3 jours et que la nouvelle est en https sur licdn.com, plus tardive et pas échue dans moins d'un jour (`candidate_picture_should_replace`) ; aucune écriture sinon, jamais une autre clé du profil ni une colonne d'étape. Côté navigateur : `src/lib/pictureUrl.ts` (filtre des adresses envoyées, lots de 200), `serializeProfileForStorage` (module `src/lib/serializeProfile.ts`, hors du hook de notation pour ne pas alourdir les chunks de la messagerie et du Pipeline) écrit le même profil que la notation, afin que « Retenir » (`AddToProjectButton`, prop `profile`) et l'inscription en séquence (`EnrollmentPreviewModal`) créent leur ligne avec le profil entier, photo comprise, jamais une photo seule (un profil réduit à une photo rendrait la ligne éligible à la notation de fond pour un profil vide) ; la fiche ne retire plus la photo en enregistrant le profil visité. Coût mesuré en local : 200 lignes rafraîchies en 224 ms, 200 appels `pg_net` d'ingestion (21 ko chacun), sans effet sur les empreintes de `ingest-context` (la photo n'entre pas dans le texte ingéré). Audit : `supabase/tests/candidate_pictures_audit.sql` (câblé dans `e2e.yml`), `e2e/api/candidate-pictures.spec.ts`, tests `tests/ux/photos-candidats.test.mjs`. L'avance de `updated_at` par ce remplacement est voulue : `claim_candidate_photos` relance une copie « expirée », « en échec » ou « ignorée » quand `updated_at` de la ligne dépasse son dernier contrôle, puis compare l'empreinte de l'adresse ; sans cette avance, une adresse rafraîchie ne serait jamais recopiée (contrat verrouillé par `candidate_pictures_audit.sql`, B13). Coût connu : « Dernière action » du /pipeline, « Mis à jour » du portail client et l'horloge d'inactivité de `rgpd_purge_candidate_rows` avancent pour une ligne dont seule la photo a changé.

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
`src/components/AppSidebar.tsx` : trois onglets (À traiter par défaut, Missions, Assistant ; `src/lib/sidebarTabs.ts`), panneau de l'onglet actif, rangée basse (Tâches, Agenda, Séquences (décision 8 du 05/10, lot 5c-2 ; pour tous depuis le lot 5h, absente seulement avec le secours ?sequences-v2=0), Appels (dès un premier appel), Marketplace, Paramètres, Aide ; disposition selon le nombre de cibles : à sept, deux lignes de quatre colonnes de 44 px sur téléphone et cibles de 32 px de large sur ordinateur, garde `e2e/flows/sidebar.spec.ts`), menu de l'avatar. Même interrupteur pour l'entrée « Séquences » de la palette Ctrl J, le raccourci « G puis S » (`GoShortcuts`, ligne de `KeyboardShortcutsDialog`) et les liens de `SequencesList` (page de chaque séquence, « Toutes les séquences de l'organisation »). Plus de cloche. La bulle ronde de l'assistant est revenue le 2026-10-05 (`src/components/agent/AssistantLauncher.tsx`, montée par `AppLayout`, masquée sur /agents et /inbox, `openAgent()`) ; Ctrl K reste.
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
                    process-scheduled-actions, sequence-send-email, sequence-email-track, sequence-webhooks-handler,
                    draft-sequence (lot 5d-1 : action preview_values, valeurs des variables calculées comme le moteur
                    pour 20 candidats au plus ; gratuite, n'écrit rien. Lot 5e : actions prepare (gratuite, sans IA) et
                    draft (payante, clé sequence_draft, une correction au plus, seule écriture : le débit), voir
                    « Rédaction par l'IA » plus bas)
Inbox:              auto-analyze-message, auto-categorize-chats, analyze-response
Email transactionnel: send-transactional-email, process-email-queue, handle-email-suppression, handle-email-unsubscribe
Enrichment & sociétés: enrich-company, enrich-candidate-contact, get-enrichment-status, process-enrichment-queue,
                    resolve-pedigree-directory, refresh-pedigree-by-funding-stage
LinkedIn accounts:  unipile-accounts, unipile-webhook, unipile-manage-webhooks, unipile-migration (bascule des identifiants de compte v1 vers v2, administrateurs de la plateforme seulement, page /settings/admin/bascule)
Missions / pipeline: add-to-shortlist, submit-application (neutralisée au lot C1 : répond 410, à supprimer en prod), client-portal-data,
                    accept-mission-invitation, accept-invitation, send-team-invitation, marketplace-admin, resolve-client-logo (logo du client enregistré dans le brief, copie dans org-logos/{org}/clients/, appelée à l'affichage de la liste et de la mission),
                    fetch-job-source (Brief IA : lit une offre, ou les offres d'une société, depuis une adresse web ; trois niveaux, interface publique d'un ATS (Greenhouse, Lever, Ashby, Recruitee), lecture directe avec données JobPosting, Firecrawl en secours ; garde SSRF dans `guard.ts`, aucun appel de modèle, aucun crédit débité ; LinkedIn jamais lu)
Notion:             notion-mcp-oauth (connexion Notion de l'assistant)
Autres intégrations: stripe-webhook, create-checkout-session, create-portal-session, aircall-webhook (reçoit les appels et `transcription.created`, organisation retrouvée par le jeton de la liaison), aircall-connect (relier ou délier le compte Aircall d'une organisation, owner/admin), analyze-phone-call (analyse d'un appel à partir de sa transcription : clé de service depuis le webhook, ou membre de l'organisation pour relancer ; action de crédits `phone_call_analysis`, Haiku, refus de crédits avant le modèle, imputée à la personne qui a relié Aircall quand elle est automatique), calendly-webhook,
                    setup-calendly-webhook, backfill-calendly
Extension Chrome:   extension-token, extension-quick-add, extension-pipeline-status
RGPD / données:     export-org-data, rgpd-erase-contact, rgpd-purge (compte seulement par défaut, lot 0c-2)
Photos:             capture-candidate-photos (copie privée des photos LinkedIn des candidats, cron toutes les 2 min, lot P)
Suite d'entretien:  generate-interview-followup (rédaction du message au candidat et de la présentation au manager), send-candidate-email (envoi depuis la boîte reliée de la personne connectée)
```
82 fonctions (2026-10-12, dossiers de `supabase/functions/` hors `_shared` ; unipile-migration ajoutée par la bascule Unipile v2, 81 avant elle) ; 78 au 2026-10-06 (analyze-phone-call ajoutée par la téléphonie lot A5 ; 77 avec generate-interview-followup et send-candidate-email ajoutées par la suite d'entretien ; 75 avec draft-sequence ajoutée par le lot 5d-1 ; 74 au 2026-10-05, fetch-job-source ajoutée par le Brief IA ; 73 avec aircall-connect ajoutée par la téléphonie lot A1 ; 72 après resolve-client-logo puis capture-candidate-photos ; 70 au 2026-09-28, après le retrait de Notion hors connexion de l'assistant ; create-portal-session ajoutée par le lot P0-C, marketplace-admin par le lot M). Supprimées lors des nettoyages : database-search, apollo-search, pdl-search, enrich-contact, enrich-vivier-contacts, puis le 2026-09-06 (aucun appelant) : analyze-linkedin-profile, backfill-knowledge-lake, chat-filter-assistant, estimate-search-count, fetch-aircall, fetch-airtable, fetch-notion-schema, n8n-create-workflow, nurturing-analyzer, preview-transactional-email, process-debrief, scan-career-pages, scrape-job-url, screen-candidate, sequence-snippets-crud, sequence-templates-crud, check-invitation-status, audit-employer-brand, generate-recruiter-bio, scan-recruiter-linkedin, puis le 2026-09-28 (retrait de Notion hors MCP) : fetch-notion-jobs, fetch-notion-candidates, update-notion-job, notify-notion, update-candidate-stage. Liste à jour : `ls supabase/functions/`.

---

## Supabase secrets (edge functions)

Configurer via dashboard : https://supabase.com/dashboard/project/crckfywoyjxkawathdff/settings/functions
ou CLI : `supabase secrets set --project-ref crckfywoyjxkawathdff KEY=value`.

### Auto-provisionnés par Supabase (ne pas toucher)
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `SUPABASE_PUBLISHABLE_KEY`.

### CRITICAL — à setter absolument, sinon fonctionnalités core cassées
| Secret | Utilisé par (principales) |
|--------|---------------------------|
| `ANTHROPIC_API_KEY` | **tous les appels AI** — le helper `_shared/call-claude.ts` est l'unique passerelle vers les LLM depuis la migration Lovable → Anthropic direct (2026-04-21). Ancien Lovable Gateway Gemini remplacé par Claude Haiku 4.5. Lu par 23 fonctions (2026-10-06) : ai-chat-completion, analyze-response, auto-analyze-message, auto-categorize-chats, detect-profile-fraud, draft-sequence (actions prepare et draft, lot 5e), enrich-company, generate-call-report, generate-client-competitors, generate-outreach-message, generate-reply-suggestions, generate-scorecard, generate-search-filters, ingest-user-file, live-coach, nl-filter-edit, process-sequences, refine-search-filters, retrieve-context, score-profile-job, search-agent-chat, sequence-send-email, text-action ; plus agent-tool-action et process-scheduled-actions via `_shared/agent-tools-mutations.ts` (import dynamique de call-claude.ts) |
| `OPENAI_API_KEY` | generate-embedding, ingest-context, ingest-user-file, retrieve-context (embeddings seulement) |
| `UNIPILE_V2_API_KEY` | clé unique de l'API v2 (aucune clé ni DSN par organisation), lue à chaque appel par `_shared/unipile/config.ts` ; absente, tout appel au prestataire est refusé (`UnipileConfigError`, aucun repli). Utilisée par toutes les fonctions qui touchent LinkedIn, WhatsApp ou e-mail (via `_shared/unipile/`) |
| `UNIPILE_V2_WEBHOOK_TOKEN` | jeton `?v2_token=` de l'adresse de réception des notifications : unipile-webhook, unipile-manage-webhooks, sequence-webhooks-handler (`_shared/unipile/webhooks.ts`). Absent, repli sur un dérivé de `UNIPILE_WEBHOOK_SECRET` ; aucun des deux : 503 |
| `UNIPILE_HOSTED_DOMAIN` | nom de domaine à la marque (sans `https://`) des pages de connexion hébergées : unipile-accounts. Absent, la connexion hébergée est refusée (`config`), sauf `CONNECTION_ALLOW_VENDOR_HOSTED_LINK=1` (tests locaux, jamais en production) |
| `CONNECTION_NATIVE_ENABLED` | `1` active les écrans de connexion directe de unipile-accounts (identifiants saisis dans Konekt). Laisser éteint tant que le parcours n'est pas validé avec un vrai compte |
| `UNIPILE_API_KEY` + `UNIPILE_DSN` | **Retirés (bascule v2)** : plus lus par aucune fonction (`unipile-migration` ne lit que leur présence, contrôle « Anciennes clés du service »). À supprimer des secrets à la fin de la bascule, voir `docs/unipile-v2-bascule.md` |
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
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook |
| `AIRCALL_WEBHOOK_TOKEN` | **Retiré (téléphonie, lot A1)** : plus lu par aucune fonction, chaque liaison a son jeton propre (empreinte dans `telephony_connections`). À supprimer des secrets existants |
| `CALENDLY_WEBHOOK_SIGNING_KEY` | calendly-webhook (vérifie la signature), setup-calendly-webhook (la pose sur l'abonnement, refus s'il manque) |
| `UNIPILE_WEBHOOK_SECRET` | repli seulement : `_shared/unipile/webhooks.ts` en dérive le jeton de réception quand `UNIPILE_V2_WEBHOOK_TOKEN` est absent. Inutile une fois le jeton dédié posé et les notifications réenregistrées |
| `SEQUENCE_WEBHOOK_SECRET` | **Retiré (bascule v2)** : plus lu par aucune fonction ; sequence-webhooks-handler s'authentifie par le jeton `?v2_token=`. À supprimer des secrets existants |
| `PROCESS_SEQUENCES_SECRET` | auth des crons : process-sequences, process-email-queue, process-inmail-queue, process-scheduled-actions, process-agent-tasks, process-enrichment-queue, agent-daily-digest, refresh-pedigree-by-funding-stage, resolve-pedigree-directory, capture-candidate-photos |
| `KONEKT_PLATFORM_ADMIN_USER_IDS` | ids user séparés par des virgules : unipile-migration (porte fermée sans ce secret), unipile-manage-webhooks (`list_deliveries` et `replay_event` fermés sans lui ; `register` et `delete` : sans lui owner/admin de l'org suffit — SEC-031), unipile-accounts (revendiquer un compte LinkedIn relié à personne), marketplace-admin, rgpd-erase-contact |
| `NOTION_TOKEN_ENCRYPTION_KEY` | `_shared/notion-secret-crypto.ts` (chiffrement des tokens Notion ; importé par notion-mcp-oauth et `_shared/notion-mcp-connection.ts`) |
| `NOTION_ALLOWED_RETURN_ORIGINS` | notion-mcp-oauth (origines de retour OAuth autorisées) |
| `APP_URL` | agent-daily-digest, create-checkout-session, create-portal-session, notion-mcp-oauth, send-transactional-email, sequence-email-track, sequence-send-email, `_shared/agent-tools-mutations.ts` (= https://konekt-app-navy.vercel.app) |
| `EMAIL_SITE_NAME` + `EMAIL_SENDER_DOMAIN` + `EMAIL_FROM_DOMAIN` | send-transactional-email (défauts : « Konekt », `notify.konekt.fr`, `konekt.fr`) |
| `RESEND_WEBHOOK_SECRET` | handle-email-suppression (Svix signature verif, format `whsec_...`) |
| `EMAIL_LINK_SIGNING_SECRET` (+ `EMAIL_LINK_SIGNING_SECRET_PREVIOUS` pour une rotation) | sequence-send-email, sequence-email-track : signature des liens suivis et du pixel des e-mails de séquence. Repli sur la clé de service si absent |

### OPTIONAL — fallback/dev
`DEEPGRAM_API_KEY` + `DEEPGRAM_PROJECT_ID` (deepgram-temp-key), `PERPLEXITY_API_KEY` (enrich-company), `FIRECRAWL_API_KEY` (enrich-company, et fetch-job-source en dernier recours : une page lue y est facturée, plafond de 60 par utilisateur et par jour via `check_rate_limit`, sans clé le niveau est simplement ignoré), `CANDIDATE_PHOTO_ORIGINS` (capture-candidate-photos : origines de photos ajoutées à https://media.licdn.com, banc local seulement, jamais en prod).

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
- Rédacteurs de prise de contact : modèle tiré du niveau choisi (`modelForLevel`, table `WRITING_LEVEL_MODELS` de `ai-config.ts`), jamais de `_ai_model` ni d'un identifiant écrit dans la fonction (voir « Style et niveau de l'IA qui rédige (lot 5e-2) »)
- **NEVER hardcode deprecated IDs** like `claude-sonnet-4-20250514`
- Génération 5 (`claude-sonnet-5-5`, `claude-opus-5-5`) : température refusée (400), réflexion active par défaut, premier bloc de la réponse = `thinking`. Lire le bloc `type: "text"` (jamais `content[0]`), régler `output_config: { effort }`, laisser de la marge sur `max_tokens`. Modèle par défaut seulement pour `scoring` et `brief_analysis` (`autoDefault`) : ne jamais le poser sur une action partagée avec un appelant qui lit `content[0].text` (c'est le cas de `filter_generation`, utilisée par `nl-filter-edit`).

### Provider API v2 (replaces the DSN rules)
- No DSN and no per-org credentials: the base URL is the constant `UNIPILE_BASE_URL` (`https://api.unipile.com/v2`), the key is `UNIPILE_V2_API_KEY`. `resolveUnipileCredentials` no longer exists.
- NEVER build a provider URL by hand or call `fetch` toward it: go through `_shared/unipile/index.ts` (the only `fetch` is in `http.ts`; guard `tests/c1/unipile-client.test.mjs`).
- Every account id is `acc_...` (`assertV2AccountId`); an id from a request must pass `assertAccountOwnedByOrg` before any call (the key is global to all tenants).

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
Audits SQL rejoués par la CI e2e (base neuve) : `supabase/tests/rls_two_orgs_audit.sql`, `org_writes_audit.sql`, `org_member_emails_audit.sql`, `member_quotas_self_service.sql`, `job_favorites_audit.sql`, ceux du lot C1 : `assistant_conversations_audit.sql`, `client_portal_audit.sql`, `partner_engagements_audit.sql`, `rls_and_definer_audit.sql`, et pour les séquences `seq_db_audit.sql`, `seq_scheduled_1_audit.sql`, `seq_steps_1_audit.sql`, `seq_engine_1_audit.sql`, `seq_identity_audit.sql`, `seq_decisions_db_audit.sql`, et pour le modèle des étapes candidat (refonte mission, lot 0a) `candidate_stage_model_audit.sql`, puis pour les écrivains du lot 0b `candidate_stage_writers_audit.sql`, et pour les lectures du lot 0c `candidate_stage_readers_audit.sql`, puis pour la carte Maintenant (lot 3) `mission_attention_audit.sql` et `mission_action_snoozes_audit.sql`, et pour la copie privée des photos (design simplifié, lot P) `candidate_photos_audit.sql`, puis pour le rafraîchissement des adresses de photo (lot P, P-0b) `candidate_pictures_audit.sql`, puis pour les grilles et les séances en direct (refonte scorecard, lot 1) `scorecard_live_lot1_audit.sql` (`client_portal_audit.sql` couvre aussi `client_portal_candidate_profile_id`), et pour la téléphonie (lots A1 et A5) `telephony_audit.sql` et `telephony_transcripts_audit.sql`, et pour l'agenda Outlook (lot I3, demande A) `calendar_accounts_audit.sql`. `org_logos_storage_audit.sql` se lance à la main (tables internes du stockage).
Dans un audit, ne jamais appeler sous `SET ROLE anon` ou `authenticated` une fonction refusée à ce rôle : dans l'image Postgres locale (17.6.1.106), supautils ajoute un indice au refus et le serveur tombe (signal 11, e2e du 24 au 26/09). Contrôler le droit avec `has_function_privilege`, et le refus réel par l'API (`curl …/rest/v1/rpc/<fonction>` avec la clé anon, voir `e2e.yml`).

### Règles posées par le lot C1 (réparations des fuites, 2026-09)
- Toute fonction SECURITY DEFINER nouvelle révoque EXECUTE à PUBLIC et à anon (anon seulement pour une liste blanche justifiée dans `rls_and_definer_audit.sql`), sinon cet audit échoue. anon n'écrit plus dans aucune table du schéma public, sauf INSERT sur `contact_submissions` ; une table nouvelle ne lui donne rien.
- Conversations de l'assistant (`agent_conversations`, `agent_messages`) : leur auteur seul. Les actions (`agent_tool_executions`) : l'auteur, plus la lecture par propriétaire et administrateurs (Journal). search-agent-chat et run-agent-search refusent qui n'est pas l'auteur.
- Une ligne `job_candidate_status` ou `outreach_sequences` ne porte que la mission de sa propre organisation (policies RESTRICTIVE `mission_same_org_*`) ; les compteurs de mission (`recompute_mission_stats`) ne comptent que les lignes de l'organisation de la mission. Plus aucune policy d'équipe de mission (`mission_team`) hors de la mission, de ses étapes et de l'équipe.
- Toute écriture serveur sur les lignes candidat filtre par organisation (score-profile-job, process-agent-tasks, auto-analyze-message), et le cache `match_scores` est lu et écrit par organisation.
- Marketplace gelée jusqu'au lot P2 (décision 17) : `MARKETPLACE_FROZEN` dans `src/lib/marketplaceFreeze.ts`, refus serveur avec le HINT `MARKETPLACE_FROZEN` (publication, validation de partenaire, marketplace-admin). Rôle « Collaborateur » gelé jusqu'au lot C2 : refusé sur `organization_invitations` (HINT `COLLABORATOR_FROZEN`), retiré des écrans et de l'outil d'invitation de l'assistant.
- Garde-fous statiques : `npm run test:c1` (`tests/c1/`), joués par la CI de PR.

### Suite d'un entretien : message au candidat et présentation au manager (05/10/2026)
Sous le compte rendu de l'assistant d'entretien, `InterviewFollowUp` (`src/components/ats/`) propose une suite d'après la recommandation (`suggestedAction`, `src/lib/interviewFollowUp.ts` : GO, entretien suivant ; NO_GO, refus ; sinon précisions), un message au candidat et, pour un cabinet ou un freelance, la présentation du candidat au manager. Ce composant utilise l'e-mail depuis la boîte personnelle (`member_email_accounts`). Le parcours `candidate-actions` de la messagerie et des fiches prend également en charge WhatsApp depuis une connexion personnelle autorisée par le propriétaire le 07/10/2026 (`member_whatsapp_accounts`, Paramètres → Connexions), en remplacement de la restriction antérieure pour ce nouveau parcours. Le bouton « Programmer l'entretien suivant » vit dans `InterviewFollowUp` et ouvre la même fenêtre qu'avant.
- Rédaction : `generate-interview-followup` (action de crédits `interview_followup`, 1 crédit au minimum, modèle rapide). Elle ne persiste ni n'envoie rien. Le type d'organisation et les crédits sont refusés avant l'appel au modèle.
- Envoi : `send-candidate-email`, après relecture et confirmation dans une boîte de dialogue. Ordre des refus : corps de la demande (`validateSendPayload`), type d'organisation et accord pour une présentation, candidat effacé (RGPD, échec fermé : un registre illisible refuse, HINT `GDPR_UNVERIFIED`), liste d'exclusion `suppressed_emails`, boîte de la personne (jamais celle d'un collègue), puis l'envoi chez le prestataire. Une note est déposée dans `candidate_notes` (envoi, destinataire, date, accord déclaré). Aucun changement d'étape du pipeline.
- Présentation : types d'organisation du portail client (`MANAGER_PRESENTATION_ORG_TYPES`, miroir de `hasFeature(orgType, 'client_portal')`), jamais proposée pour NO_GO ni pour « Refus ». La case « Le candidat a accepté d'être présenté » est obligatoire : le serveur exige `candidate_consent_confirmed === true` et date l'accord dans la note. Le modèle ne reçoit que résumé, raison de la recommandation, points forts et critères avec note et commentaire (`managerReportView`), jamais points d'alerte, verbatims, questions ouvertes ni message de suivi. Le manager et le client viennent du brief (`job_details.client`, « Qui recrute ») ; sans eux, la saisie reste libre.
- Messages d'erreur : le navigateur réécrit tout message qui contient un nombre comme 500 ou 403 ou un mot comme forbidden ou not found (`humanizeError`). Les phrases du serveur n'en contiennent pas, et le code métier passe par `error_code`.
- Gardes : `tests/c1/interview-followup.test.mjs` (ordre des refus, configuration, messages) et `tests/ux/interview-followup.test.mjs` (contenu transmis au modèle, accord, composant). Un envoi réel et la qualité des brouillons ne sont pas couverts.

### État et liaison LinkedIn
Une seule lecture de l'état : `src/lib/linkedinStatus.ts` (liaison stricte par `user_id` via `member_linkedin_accounts`, jamais le compte d'un collègue). Relier et dissocier passent par `unipile-accounts` (`claim_linkedin_account`, `unlink_linkedin_account`), pas par un upsert/delete du navigateur (RLS owner/admin). « Dissocier » ne ferme pas la session chez le prestataire : il retire la liaison et arrête les envois du compte (inscriptions en pause `manual`, étapes gardées en attente et ignorées par le moteur, InMails programmés annulés, compte retiré des rotations multi-expéditeurs ; helper `_shared/linkedin-sending-stop.ts`). Le même arrêt s'applique quand un membre change de compte et avant le retrait d'un membre (`unipile-accounts` action `stop_member_linkedin`, owner/admin).

Signalement d'une panne hors des cartes (12/10/2026) : un seul prédicat, `linkedInOutageKind` et `myLinkedInOutage` de `src/lib/linkedinStatus.ts` (hook `useLinkedInOutage`, qui remplacent `myLinkedInNeedsAction`), lu par le bandeau du tableau de bord, la ligne d'« À traiter » et son chiffre : `reconnect` (« à reconnecter », avec « Reconnecter »), `partial` (PARTIAL : un produit demande une nouvelle authentification, phrase de la carte, avec « Reconnecter »), `locked` (LOCKED, sans « Reconnecter ») ou rien, dans cet ordre de priorité. DEGRADED (un produit tourne pendant qu'un autre est en erreur) reste un état de carte : reprise automatique, ni bandeau, ni notification, ni toast. Le toast en direct vient de `disconnectToastFor` (`src/components/connections/disconnectToast.ts`, même table de causes que les cartes). LOCKED a un seul vocabulaire sur la carte, le toast, le bandeau, la ligne et la notification (« restreint par LinkedIn », se reconnecter n'y change rien), sans bouton ni adresse d'assistance. Les trois cartes de Paramètres › Connexions rendent un compte retiré chez le prestataire de la même façon (« À reconnecter ») et ont une phrase par cause (`viewOfAccount` de `src/components/connections/connectionView.ts`, `causeReason` de `connectionCopy.ts`) ; la carte e-mail liste toutes les boîtes du membre (`useMemberEmailList`, partagée avec `useDashboardConnections`, qui la relit toutes les 5 minutes : seul appelant du navigateur de `list_email`) ; une entrée de `list` que le serveur n'a pas pu lire chez le prestataire porte `unverified: true` (« État à vérifier » sur la carte) seulement si son dernier état connu est OK, DEGRADED, absent ou inconnu ; CREDENTIALS, ERROR, PARTIAL et LOCKED reviennent avec cet état et sans la clé, et la carte montre l'état réel avec son geste (`unverifiedLinkEntry`, `unipile-accounts/account-list.ts`). « Offre : ... » ne s'imprime que si `licenceWasRead` (`connectionView.ts`) : chaque entrée LinkedIn de `list` porte `licences_read` (booléen, vrai seulement si les contrats du compte ont été lus dans l'appel ; faux, `subscriptions` n'est qu'une estimation) et ce champ fait foi ; absent (serveur plus ancien), la classe de santé en décide ; la marque `unverified` (qui ne dit rien des licences) et un identifiant d'ancien format l'emportent toujours. L'encart rouge de « Plafonds du jour » vient de `quotaNoticeOf` (`QUOTA_NOTICE` de `connectionCopy.ts`), une phrase par cause d'accord avec la carte du compte. La ligne de panne d'« À traiter » porte la phrase entière dans son texte de survol (`hint` de `SidebarRow`, `ROW_HINT` de `LinkedInOutageSection`), son sous-titre reste à 30 caractères au plus. Une boîte e-mail absente d'une liste ancienne (relecture en échec) lit « État à vérifier » (`buildMailboxRows`, argument `listStale`), jamais « À reconnecter ». Les textes de ces écrans sont vouvoyés (`tests/ux/lot12a-parametres-compte.test.mjs`) ; l'ancienne page mission et l'ancien hero de recherche gardent leur tutoiement à dessein (`tests/ux/lot12-sourcing.test.mjs`) : ne pas les aligner.

`member_whatsapp_accounts.removed_by_member_at` (migration `20261012222732`, à appliquer avant ou avec `unipile-accounts` ; si la fonction passe la première, `disconnect_whatsapp` rejoue sans la colonne, journalise un avertissement et répond succès, et la reprise de la migration masque ensuite la ligne ; le repli ne vaut que pour une colonne manquante : `PGRST204`, `42703`, ou un message sans code SQL qui nomme la colonne et dit qu'elle manque, alors que droit refusé, type, contrainte et déclencheur restent un 500) n'est posée que par `disconnect_whatsapp` : la liaison reste en `DELETED` (la policy de lecture des messages WhatsApp du membre et le refus de reprendre un ancien identifiant la lisent). `list_whatsapp` rend `removed_by_member` (vrai si `DELETED` et date posée) et la carte masque ces lignes ; un compte disparu chez le prestataire (webhook `account.remove`, lecture 404) reste `DELETED` sans la date et s'affiche « À reconnecter ».

Connexion d'un compte (API v2) : actions `connection_*` de `unipile-accounts`, table `connection_attempts` (son `id` est le `state` envoyé au prestataire, 30 minutes), lien hébergé sur `UNIPILE_HOSTED_DOMAIN` par défaut, connexion directe derrière `CONNECTION_NATIVE_ENABLED`. `claim_linkedin_account` n'accepte plus un compte relié à personne, sauf pour un administrateur de la plateforme. Architecture : `docs/unipile-v2-architecture.md`. Bascule des identifiants et mise en production : `docs/unipile-v2-bascule.md` (page `/settings/admin/bascule`, `KONEKT_PLATFORM_ADMIN_USER_IDS`). Les lots d'une conversion s'annulent du plus récent au plus ancien (HINT `REMAP_BATCH_NEWER_OPEN`), et une conversion qui ne réécrit aucune ligne ne crée pas de lot (HINT `REMAP_BATCH_EMPTY` à l'annulation d'un lot vide) ; migrations `20261012051307` et `20261012173252`.

### Séquences : règles du moteur et de l'interface (audit 2026-09-25, `docs/audit-2026-09-25-sequences.md`)
- **Pause** = `status 'paused'` + `pause_reason` ; les exécutions en attente (`scheduled`, `waiting_event`, `quota_blocked`) gardent leur date et le moteur les ignore. Aucune pause n'annule d'exécution, sauf celles que pose le moteur pour abonnement requis ou compte non rattaché : il annule l'étape courante avec la raison, et la reprise la réarme. Une clôture (réponse, désinscription, rebond, RDV, effacement RGPD) annule toutes les exécutions en attente, jamais `sending`.
- **Reprise** = toujours l'action serveur `resume_enrollments` (ou `re_enroll` pour une inscription close), jamais une réécriture d'exécution depuis le navigateur. La réactivation d'une séquence ne reprend que `sequence_inactive` et `auto_paused`.
- **Séquence désactivée** (`is_active = false`) : le moteur n'envoie jamais rien (filtre dans la sélection et au dernier contrôle) ; aucune reprise automatique (reconnexion, abonnement) ne réactive ses inscriptions.
- **Canaux e-mail et WhatsApp fermés** : le moteur saute ces étapes (« pas encore disponible ») sans appel, jusqu'à une réouverture décidée et testée.
- **Actions membres de `process-sequences`** (JWT, organisation vérifiée) : `nudge_sequences` (actions du jour seulement, `sequence_ids`), `resume_enrollments`, `re_enroll`, `mark_replied`, `skip_execution`, `stop_enrollments` et `undo_stop_enrollments` (lot 5b). Un collaborateur n'agit que sur ses propres inscriptions ; un candidat effacé (RGPD) n'est jamais repris.
- **Arrêt manuel (lot 5b, décision 3)** : `stop_enrollments` { organization_id, enrollment_ids, 200 au plus (sinon 400 `too_many`) } clôt une inscription `active` ou `paused` en `completed`, `pause_reason` vide, `tracking_data.completion_reason = 'manual_stop'` et `tracking_data.manual_stop` { token, by, at, previous_status, previous_pause_reason } ; écriture conditionnelle sur le statut et l'`updated_at` relus, un nouvel essai après relecture, sinon `changed`. Les exécutions en attente sont annulées « Arrêt manuel » (réarmable), jamais `sending` : un message déjà parti est enregistré sans planifier la suite ; si le dernier contrôle du moteur (avant l'envoi) lit l'arrêt, rien ne part et l'étape est annulée « Arrêt manuel » avec son contenu d'avant le verrou (réarmée par le moteur ou la reprise si l'arrêt a été annulé entre-temps, `rearmManualStopCancellation`). Réponse : `token`, `stopped_at`, `expires_at`, `expires_in_ms` et un résultat par inscription (`stopped`, `not_eligible`, `gdpr_erased`, `forbidden`, `changed`, `not_found`, `error`). Une inscription arrêtée reste un contact pour l'anti-doublon de 90 jours (serveur, navigateur, assistant) et passe « répondu » sur une réponse tardive (webhook ou `check_replies`). `undo_stop_enrollments` { organization_id, enrollment_ids, token } : par l'auteur de l'arrêt, 2 minutes après `manual_stop.at`, délai lu une seule fois à la réception de la demande (200 annulations traitées après l'échéance restent acceptées) ; refus `expired`, `not_author`, `moved_since` (plus terminée par ce jeton), `gdpr_erased` (marqueur, étape annulée ou registre), `replied` (statut « répondu », `mission_conversations.last_inbound_at` postérieur à l'arrêt pour ce candidat dans l'organisation, ou `replied_at` postérieur sur une inscription sœur) ; sinon retour en pause avec la raison d'avant (`paused`) ; une raison levée par un événement passé pendant l'arrêt (`account_disconnected` sur un compte redevenu `OK`, `subscription_required` avec envoi permis, `sequence_inactive` ou `auto_paused` sur une séquence active : `pauseCauseHolds`) n'est pas remise, l'inscription reprend comme une inscription active ; si elle était active, `resumeOneEnrollment` comme `resume_enrollments` (`resumed` ; `resume_refused` avec `reason` `account_unlinked`, `sequence_inactive`, `gdpr_registry_unavailable`, `gdpr_erased` ou `other`, l'inscription restant en pause `manual` ; `finished`). Aucune seconde logique de réarmement : le dernier contrôle de réponse du moteur reste le filet. « Relancer la séquence » (`re_enroll`) réarme l'étape annulée et retire `completion_reason` et `manual_stop`. Réarmement d'une attente (acceptation, réponse, `wait_for_event`, `wait_until_connected` : `waitsForEvent` de `_shared/sequence-resume.ts`) : à sa date d'origine, jamais repoussée d'une minute, pour que son délai garde son point de départ. Règles pures : `_shared/enrollment-stop.ts` ; tests : `enrollment-stop.test.ts`, `e2e/api/seq-stop.spec.ts`. Annuler une pause passe par `resume_enrollments` avec les seuls identifiants rendus par la pause.
- **Écrans de l'arrêt et de la pause (lot 5b)** : gestes immédiats, sans fenêtre (exception à la règle AlertDialog, voir « Destructive actions »), puis un toast « Annuler » commun (`useUndoableEnrollmentAction` : `showUndoToast`, `offerUndoPause`, `stopEnrollments`) : sonner, `role="status"`, 8 s (`UNDO_TOAST_DURATION_MS`) prolongées tant qu'il a le survol ou le focus, fermé d'office à 1 min 50 s au plus (`UNDO_TOAST_MAX_MS`, `toast.dismiss` programmé) et 10 s avant la fin du jeton d'un arrêt (`expires_in_ms`), Échap le ferme sans annuler ; aucun texte ne promet que rien n'est parti (une étape `sending` part). « Mettre en pause pour ce candidat » (même libellé dans le suivi, la fiche et la messagerie) et pause groupée (masquée au collaborateur) : écriture `paused`/`manual` gardée par `.eq('status','active')` avec `.select('id')`, « Annuler » = `resume_enrollments` sur les seuls identifiants rendus, par lots de 25 (« Pause annulée. »), offert aussi après une pause partielle (titre en avertissement). Interrupteur « Mettre en pause la séquence » : chemin `deactivateSequence` gardé (inscriptions en `sequence_inactive` avant l'interrupteur, recompte, jamais de succès sans preuve), toast « Séquence mise en pause : N candidats en pause. » ; « Annuler » remet l'interrupteur avec les contrôles d'offre de « Réactiver » (décision 32), puis reprend les seuls identifiants rendus (une pause `auto_paused` antérieure reste) ; verrouillé pour un collaborateur. « Arrêter pour ce candidat » (« Actions pour X » du suivi, « Actions de l'inscription » de la fiche ; aide « Le candidat reste compté comme contacté pendant 90 jours. Vous pourrez le relancer plus tard. ») et « Arrêter (N) » du suivi (en cours ou en pause, 200 au plus, masqué au collaborateur) : `stop_enrollments`, toast « Séquence arrêtée pour X. », « Annuler » = `undo_stop_enrollments` avec le jeton ; « Arrêt impossible pour l'instant : rien n'a changé. » avec « Réessayer » pour `changed` et `error`. Après un arrêt : statut « Arrêtée par X le JJ/MM » (`readManualStop`, `manualStopLabel` de `sequenceLabels.ts`, nom par `useMemberName` de `useTeamMembers.ts`) dans le suivi, la fiche, la messagerie (`EnrollmentStatusBadge` `manualStop`), le Pipeline (carte et tableau, `sequenceManualStop` de `useATSData`) et la chronologie du profil, et « Relancer la séquence » (`re_enroll`, étape « Arrêt manuel » réarmée). `formatSkipReason(reason, { manualStop })` : « Séquence arrêtée pour ce candidat » seulement si l'inscription porte `tracking_data.manual_stop` (`hasManualStopTrace`) ; sinon « Candidat mis en pause » (motif écrit par une simple pause avant le 28/09). Vocabulaire de l'interrupteur : « mettre la séquence en pause », raison `sequence_inactive` affichée « En pause (séquence en pause) ». Bilans : `summarizeStopResponse`, `summarizeUndoStopResponse`, `summarizeUndoPause` de `sequenceErrorMessages.ts`. Le navigateur n'écrit jamais `status: 'active'` ni `'completed'`, ni une exécution. Gardes : `tests/ux/lot5b-arret-pause.test.mjs`, `e2e/flows/sequences-enrollments.spec.ts` (pause, arrêt et pause de séquence annulés).
- **Réponse d'un candidat**, quel que soit le chemin (webhook LinkedIn ou e-mail, `check_replies`, vérification avant envoi, `mark_replied`, étape d'attente, « Si pas de réponse ») : inscription `replied`, exécutions en attente annulées, inscriptions sœurs du candidat dans l'organisation arrêtées (identifiants, `resolved_profile_id`, slug exact de `profile_url` ; pour une inscription `completed`, seules les sœurs créées avant sa fin), InMails `pending`/`scheduled` de l'organisation annulés. Côté webhook : `_shared/candidate-reply-closure.ts` (sans pipeline) ; un rejeu refait l'arrêt des sœurs à partir des inscriptions déjà closes (réponse comptée une fois).
- **Pipeline à la réponse (SEQ-006, lot 0b)** : `record_candidate_inbound`, et lui seul, dans une seule mission. Réponse vue par une conversation (webhook, pour tout message du candidat, conversation manuelle comprise, un appel par organisation du compte) : la mission de la conversation (lien `mission_conversations` ; sur un fil partagé, celle du dernier envoi attribué), sinon du profil sur ce compte, de l'inscription, puis des lignes contactées de l'organisation. Réponse vue par une inscription sans conversation (moteur, `mark_replied`, e-mail) : la mission de l'inscription d'abord. « A répondu » suppose « Contacté » : si un envoi Konekt est prouvé dans la mission, la ligne passe « Contacté » puis « A répondu » (origine `system`), sinon elle reste (`not_contacted`). Les autres missions et organisations ne bougent pas. Candidat effacé (RGPD) dans l'organisation : aucune étape écrite, ni par sa réponse, ni par un message propre, ni par l'analyse de la réponse (rattrapage, résumé) (registre illisible : rejeu au webhook, rien ailleurs) ; un envoi manuel lui est refusé avant tout envoi (correctif 4, voir « Envoi (lot 0b) »). Compte relié à plusieurs organisations (état hérité) : une organisation sans inscription ni InMail sur ce compte n'est écrite que si la conversation ou le candidat y est déjà lié sur ce compte (même règle pour l'analyse et le message propre). Au webhook, seule une erreur transitoire fait rejouer (500) ; un refus métier ou une fonction absente est journalisé.
- **Envoi (lot 0b)** : « Contacté » est posé à l'envoi réel par `record_candidate_outbound` (origine `system`, mission de l'envoi : explicite, de l'inscription ou résolue), avec une ligne À trier créée si le candidat n'en a pas dans la mission. Chemins : moteur (en tête de la branche de succès, invitation comprise), file InMail, `unipile-search` `send_message` (fenêtre de message, fiche, messagerie, assistant) ; chacun pose d'abord un marqueur avant le POST (écho reconnu au webhook). Appel au mieux : un échec est journalisé et ne fait jamais échouer un envoi parti ; un envoi incertain (5xx, délai) n'est pas enregistré. Depuis le lot 0b-2b, le navigateur n'écrit plus « Contacté » (ni à l'inscription, ni après un message de la fiche, de la messagerie ou de la fenêtre de message) ; ses envois portent `project_id`, l'id de la mission sans `project:` (`missionIdOfJob`, `src/hooks/useEnrollmentPreview.ts`), sinon le serveur résout la mission. Correctif 4 (11/10/2026) : `send_message` contrôle d'abord son destinataire (`checkSendRecipient`), pour tout appelant (fiche, messagerie, fenêtre de message, assistant), avant le plafond LinkedIn, le marqueur et l'envoi. Destinataire : avec `chat_id` (lu comme l'envoi le lit, par `chatRef` de `_shared/unipile/ids.ts`), le candidat du lien de la conversation, sinon son participant lu chez le prestataire, quel que soit `recipient_id` ; sans conversation, `recipient_id` et `recipient_profile_url`. Chaque forme d'identité est jugée au registre (le nom public tiré de `recipient_id`, que suit l'envoi, et l'adresse de `recipient_profile_url` : l'un ne masque pas l'autre), y compris pour un interlocuteur que le chat v2 ne donne que par son nom public ou son adresse (jugé, puis envoyé sans enregistrement faute d'identifiant). Candidat effacé (RGPD) dans l'organisation : 403, `error_code` `CANDIDATE_ERASED` ; registre illisible : 503, `GDPR_UNVERIFIED` (échec fermé) ; rien ne part, aucune place du plafond prise, aucun lien ni « Contacté ». Candidat inconnu (groupe, conversation sans identité) : le message part sans enregistrement, comme avant ; lecture de la conversation en panne passagère (réseau, 5xx, limite) : 503, `GDPR_UNVERIFIED` (échec fermé, décision du 13/10/2026), alors qu'un refus du prestataire (conversation introuvable, compte) laisse l'envoi rendre sa propre erreur. L'assistant affiche la phrase du serveur ; la fenêtre de message (`OutreachMessageModal`), le fil de la fiche (`CardMessageThread`) et la messagerie (`useMessagesInbox`) aussi (ces deux codes lus avant l'échec générique), sans nouvel essai, texte saisi gardé, quota non compté. Gardes : `tests/c1/correctifs-envois.test.mjs`, `e2e/api/seq-correctifs-envois.spec.ts`, `tests/ux/correctif4-ecrans.test.mjs`, `e2e/flows/inbox-loading.spec.ts` (messagerie et fiche).
- **Message écrit hors Konekt** (depuis le compte du recruteur : `new_message` avec `is_sender`, ou `message_received` de notre propre participant) : `record_own_message`, non bloquant. Écho d'un envoi Konekt (même message, envoi de moins de 10 min, note d'invitation) : rien. Fil déjà rattaché sur ce compte : « Contacté » d'un candidat Retenu, dans la mission de ce lien seulement. Aucun fil rattaché : « Contacté » seulement si le candidat est Retenu dans une seule mission de l'organisation, sinon rien. Ce message ne change jamais la mission d'une réponse à venir.
- **Inscription en séquence (lot 5f-1, 12/10/2026)** : un seul écrivain navigateur de `sequence_enrollments` et des premières exécutions, `src/lib/enrollCandidates.ts` (client passé en paramètre, ni React ni toast). `SequenceEnrollModal` l'appelle en `mode: 'batch'` (écriture groupée, reprise candidat par candidat sur `ENROLLMENT_GDPR_ERASED` et `ENROLLMENT_SAME_PERSON_IN_SEQUENCE`, retrait de tout le lot si la première exécution échoue, heure dans la fenêtre d'envoi de l'étape) et `EnrollmentPreviewModal` en `mode: 'one_by_one'` (un candidat après l'autre, retouches lues au moment du candidat et écrites dans `tracking_data`, retrait de ce seul candidat, délai brut avec les réglages par étape). Les fenêtres gardent leurs gardes (organisation, compte d'envoi, case des destinataires, relecture IA), leurs états et leurs toasts ; la bibliothèque rend `refused` (rien d'écrit, texte à afficher), `done` (compteurs `EnrollResults`, `enrolledIds`, `schedulingFailure` en écriture groupée) ou `failed` (exception, compteurs partiels). Une séquence sans première étape à planifier retire l'inscription dans les deux modes. Piège de l'écriture groupée : ne jamais mêler des lignes avec et sans `tracking_data` (postgrest-js envoie NULL pour la clé absente, colonne NOT NULL) ; les retouches ne sont acceptées qu'en `one_by_one`. **Règle Retenu (lot 5f-2a, 12/10/2026, sans drapeau)** : une fois l'inscription faite, les candidats réellement inscrits (jamais un lot retiré, un refusé ni un déjà inscrit) passent en Retenu s'ils étaient À trier ou Écartés (`fromStages ['to_sort', 'rejected']`, jamais en arrière : un contacté ou plus loin garde son étape), dans la mission du `job` (sans mission, rien n'est écrit). `src/lib/retainCandidates.ts` crée la ligne absente (profil entier, sans colonne d'étape ; lecture sous les deux formes de `job_id` « project:<uuid> » et uuid nu, sur les lignes de l'organisation quel qu'en soit l'auteur depuis la relecture du lot 5f-2c : un candidat que la mission a déjà, sourcé par un collègue, garde sa ligne et reçoit l'étape sur elle, jamais une seconde ligne à profil réduit qui deviendrait la ligne canonique) puis écrit l'étape par `setCandidateStages` (origine `user`, surface `enrollment`) ; c'est le seul écrivain des lignes de mission côté inscription, partagé avec « Présélectionner sans message » (`handleShortlist`, qui garde `RETAIN_FROM_STAGES` avec Retenu). Un échec de Retenu ne défait pas l'inscription : `retained: { saved, failed }` dans le résultat, toast d'avertissement (`retainFailedLabel`), lectures d'étape rafraîchies (`invalidateStageReaders`). « Contacté » reste posé par le serveur au premier envoi réel, après Retenu. Gardes : `tests/c1/lot5f-inscription.test.mjs` (joué par la CI, dont 5F1-S6 et les cas 5F1-RT), `e2e/flows/seq-retenu.spec.ts`.
- **Onglet « Contactés » et pastille de Prise de contact (lot 5f-2b, 12/10/2026, interrupteur des séquences allumé)** : le panneau Prise de contact de la mission a deux onglets, « Contactés » puis « Séquences » (éteint : l'ancien panneau, Séquences et Invitations, inchangé). Adresse `?outreach=contactes|sequences` ; sans valeur, « Contactés » s'ouvre s'il a une ligne, « Séquences » sinon (lecture en échec comprise), et un onglet choisi, « Séquences » compris, s'écrit dans l'adresse. `src/lib/contactedGroups.ts` (module pur) range une ligne par candidat de la mission en quatre groupes : A répondu (inscription répondue, arrêtée parce qu'il a répondu ailleurs, terminée par un rendez-vous pris, ou étape Répondu du Pipeline), Bloqués (compte déconnecté, abonnement requis, plafond atteint, candidat injoignable, échec d'envoi, auto-pause, message rédigé par l'IA à relire), En attente (en cours, pause manuelle ou de séquence, étape reportée par le plafond), Sans suite (terminée, arrêtée, annulée, non distribuée, données effacées ; replié au départ). Les inscriptions d'une même personne sont réunies par `profile_id`, `provider_id`, `resolved_profile_id` ou adresse LinkedIn ; la réponse la plus récente la représente, sinon la plus récente des inscriptions en cours ou en pause (c'est elle qui peut demander un geste), sinon la dernière. Un candidat Contacté ou Répondu au Pipeline sans inscription est listé « Contacté hors séquence », sauf pour un collaborateur (`includeManual` faux : la RLS lui cache les inscriptions de ses collègues, ils passeraient pour contactés à la main) ; un Retenu sans inscription n'est pas contacté et n'y est pas. Statut et geste de chaque ligne viennent de `enrollmentStatusLine` (une seule règle). `src/hooks/useMissionContacted.ts` lit sous la RLS (un collaborateur : ses inscriptions) les inscriptions de la mission sous les trois formes de son id (`missionEnrollmentJobIds`, 500 au plus avec une ligne de plus lue pour savoir qu'on coupe, dit à l'écran ; au-delà, les inscriptions des candidats des lignes du Pipeline sont lues quand même), les exécutions utiles au statut des inscriptions actives, en pause ou arrêtées, les liens de conversation et les lignes du Pipeline (`mission_candidate_rows`, jamais ouverts exclus) ; clé `['mission-contacted', id]` (`MISSION_CONTACTED_KEY` de `stageDisplay.ts`), volontairement hors de `invalidateStageReaders` (lecture lourde que les gestes d'étape ne changent pas) : relue par `invalidateMissionContacted` après une inscription (les deux fenêtres), à chaque ouverture du panneau et au retour sur l'onglet. L'onglet de départ est tranché une fois par la première lecture, puis gardé. `ContactedList` n'écrit rien d'elle-même : « Mettre en pause » passe par `createEnrollmentActions` (écriture gardée, toast « Annuler »), « Arrêter pour ce candidat » par `stop_enrollments`, un collaborateur n'agit que sur ses lignes ; relire, reprendre, réessayer et réactiver ouvrent la page de la séquence (« Ouvrir la séquence », gardé par l'interrupteur et déclaré dans `GATED` de `seq-v2-socle`). Pastille du bouton « Prise de contact » du Pipeline (`useContactBadge`, `contactBadge`) : « 2 réponses » (réponses non traitées sur votre compte LinkedIn, `get_mission_attention`, la lecture de la carte « Maintenant ») sinon « 1 bloqué » (groupe Bloqués), jamais de zéro, rien tant qu'une lecture n'a pas abouti ; le nom du bouton reste « Prise de contact », le texte complet (« 2 réponses, 1 bloqué ») est sa description ; ce chiffre peut différer de « À traiter » de la barre latérale. Pas de pastille interrupteur éteint ni mission archivée. Gardes : `tests/ux/lot5f2b-contactes.test.mjs` (joué par la CI dans le job Node 22 : sous Node 20 ses contrôles de comportement se sauteraient), `e2e/flows/seq-v2-contactes.spec.ts`. Suite du lot 5f-2 : voir le point suivant (5f-2c) et `docs/refonte-mission/lot5f2b-conception.md`.
- **Panneau Contacter (lot 5f-2c, 13/10/2026, interrupteur des séquences allumé)** : « Contacter » de la barre d'actions du Pipeline, et celui de la fiche d'un Retenu (même composant `ContactSelectionButton`, qui remplace alors la sélection par ce candidat), n'ouvre plus le menu « Séquence » mais le panneau Prise de contact en mode Contacter (`?panneau=contact&contacter=1` ; `contacter` est un paramètre local de `MissionWorkspaceV3`, retiré par `closePanel`, `openCandidate`, `openContactPanel` et le choix d'un onglet ; `openContactFlow` du contexte de la mission). Éteint (`?sequences-v2=0`) : le menu d'avant, inchangé. La sélection du Pipeline vit au-dessus de l'écran et du panneau (`MissionSelectionProvider` dans `MissionShell`, `useMissionSelection` : contexte à part, la valeur de `MissionV3Context` a 19 abonnés) ; elle survit au changement d'écran seulement tant que le panneau est en mode Contacter, sinon l'écran quitté la vide comme avant ; rechargé sur `?contacter=1` sans sélection (elle n'est qu'en mémoire), le panneau s'ouvre sur « Contactés ». `useContactCandidates` relit les lignes cochées à chaque ouverture (400 au plus, lots de 100, colonnes légères : jamais la distance de réseau ni l'identifiant du fournisseur d'un instantané, car le moteur lit `network_distance` de l'inscription comme une preuve de connexion) et garde les candidats déjà lus pendant une relecture (`refreshing` désactive l'inscription). `ContactFlow` (`src/components/sequences/contact/`) : séquence choisie d'avance (`missionSequenceMenu` : la plus récente des séquences actives non vides de la mission ; aucune : pas de présélection et la porte « Rédiger une séquence pour cette mission », qui s'ouvre dans un nouvel onglet pour garder la sélection ; liste relue au retour sur la fenêtre), compte d'envoi et première action (`firstActionSummary`), candidats en trois groupes par `classifyContactEntries` (ordre des raisons : sans profil LinkedIn, déjà dans la séquence ou déjà passé, effacé, contacté depuis moins de 90 jours, incompatible avec la séquence, message IA à relire ; dérogations par catégorie « Inscrire quand même » (propriétaire et administrateur) et « Inclure quand même », jamais pour déjà dans la séquence, passé ou effacé ; remises à zéro dès que la séquence ou les candidats changent), aperçu du premier message par `preview_values` (balayage de tous les candidats par paquets de 20, un à la fois : c'est lui qui révèle les profils effacés avant le clic ; le déclencheur de la base refuse de toute façon un effacé), jauge du plafond (`quotaGauge` : invitations de la fenêtre glissante de 7 jours pour une première étape d'invitation, actions visibles du jour pour un message ; estimation, le moteur reporte l'excédent ; aucune jauge pour un InMail, une rotation d'expéditeurs ou une première étape reportée d'un jour ou plus), pied avec `RecipientsConfirm` (dès 5) puis « Inscrire N candidats » = `enrollCandidates` en mode `batch`, `business_hours` (aucune autre écriture, pas d'appel à `retainCandidates` : la règle Retenu passe par `enrollCandidates`). Une séquence à message rédigé par l'IA ne s'inscrit pas dans le panneau : tous les candidats sont « à compléter », aucune dérogation n'y est proposée et « Relire les messages (N) » ouvre `EnrollmentPreviewModal` (génération, relecture, inscription un par un, ses propres dérogations). Succès : toast « N candidats inscrits dans la séquence « X » » avec « Ouvrir la séquence » (sans « Annuler »), puis les avertissements des fenêtres actuelles ; les inscrits quittent la sélection, le panneau passe sur « Contactés » seulement s'il est encore monté en mode Contacter à la fin de l'écriture. Formule gratuite : invitation à passer à un plan payant. Gardes : `tests/ux/lot5f2c-*.test.mjs` (CI, job Node 22), `e2e/flows/seq-v2-contacter.spec.ts` (14 parcours, dont le moteur : un envoi par inscrit, aucun pour un exclu). Conception : `docs/refonte-mission/lot5f2c-conception.md`. Restent (5f-2d) : Sourcing de la mission, « Contacter les N » de Maintenant (garde son focus sur le bouton de la barre), page séquence, hors mission et messagerie.
- **File InMail** : dernier contrôle avant envoi (réponse à l'organisation, InMail déjà répondu, effacement RGPD) ; un InMail répondu reste un contact pour l'anti-doublon de 90 jours (serveur, navigateur, assistant).
- **Gardes en base** : le compte d'envoi d'une inscription est contrôlé à la création et à la modification (`account_id`, `created_by`), et une inscription depuis le compte d'un membre a toujours un auteur ; `assigned_sender_id` n'est écrit que par le moteur ; une inscription effacée (RGPD) ne change plus de statut pour un utilisateur connecté, et un profil effacé (registre ou marqueur de l'organisation) ne peut plus être inscrit (HINT `ENROLLMENT_GDPR_ERASED`) ; la même personne, sous n'importe quel identifiant, ne peut pas figurer deux fois dans une séquence si l'autre inscription est vivante ou close depuis moins de 90 jours (`ENROLLMENT_SAME_PERSON_IN_SEQUENCE`) ; une inscription ne repasse en `active` que par le serveur (`ENROLLMENT_RESUME_SERVER_ONLY`) ; une étape annulée ou en échec ne se réarme que côté serveur, et le navigateur n'insère que la première étape d'une inscription active (`EXECUTION_REARM_SERVER_ONLY`, `EXECUTION_INSERT_SERVER_ONLY`). Conversations et messages de l'assistant : leur auteur seul (lot C1). `agent_tool_executions` : chacun lit ses lignes, owner/admin toute l'organisation ; `executed_at` n'est effaçable que par « Relancer » un échec.
- **Moteur, décisions du 28/09** : un envoi incertain (5xx, délai) ou une lecture de profil impossible ne comptent pas pour l'auto-pause ; la place du plafond LinkedIn est rendue quand rien ne part ; un seul envoi par personne et par cycle, toutes identités confondues ; `check_replies` examine aussi les inscriptions terminées depuis 14 jours (hors RDV et hors effacement) ; seul un rendez-vous postérieur au début de l'inscription l'arrête, et une séance lue dans un agenda relié (`qualification_sessions.source = 'agenda'`, n'importe quelle réunion) n'en est jamais un (11/10/2026 : `meetingBase` filtre `.neq('source', 'agenda')` ; saisie, invitation et réservation arrêtent comme avant, même motif ; e2e `e2e/api/seq-correctifs-envois.spec.ts`). Registre RGPD illisible = refus (`isGdprBlocked` lève `GdprRegistryUnavailableError`) ; le moteur reporte l'étape au lieu de l'annuler.
- **Assistant, garde-fous d'envoi (lot 5a)** : `enroll_in_sequence` et `resume_sequence` ne sont jamais automatiques (`NEVER_AUTO_TOOLS` : une politique « auto » enregistrée est ramenée à « approve » par le serveur ; Paramètres › Assistant ne propose plus « Automatique » pour eux). `enroll_in_sequence` refuse une séquence dont une étape à message a `use_ai_personalization` (refus dans `verifyAccess`, raison rendue au modèle : la relecture par inscrit se fait à l'écran). Sa carte d'approbation, et le Journal qui peut aussi l'approuver, montrent le premier message entier, sans troncature (`details.first_step_preview`, `_shared/enroll-preview.ts`, rendu commun `src/components/agent/EnrollFirstMessagePreview.tsx`) : premier texte du parcours après `pickFirstRootStep` (une invitation sans note n'en est pas un, le parcours continue ; une fourche donne un texte par branche, une étape A/B chaque version, tirée à l'inscription comme dans l'interface), variables résolues comme par le moteur (`buildSequenceContext` puis `interpolateAndStrip`) sur une inscription qui porte exactement les champs qu'`execute` écrit, lus dans la ligne du candidat de la mission (organisation et `project_id`, par identifiant puis par slug) : `profile_name`, `profile_headline`, `company_name`, et `job_title` = titre de la mission. Variables de l'heure d'envoi (`{{salutation}}`, `{{periode_jour}}`, dates) : annoncées entre crochets, jamais résolues à la proposition (`SEND_TIME_VARIABLES`). Candidat absent de la mission : aperçu avec son seul nom, annoncé, sans refus. « Modifier » ne rejoue pas `dryRun` : `profile_name` et `profile_url` y sont en lecture seule (`READONLY_FIELDS_BY_TOOL`).
- **Case des destinataires (lot 5a)** : « Je confirme les destinataires » obligatoire dès 5 destinataires (`src/lib/contactRecipientsGuard.ts`, composant `enrollment-preview/RecipientsConfirm.tsx`) dans `EnrollmentPreviewModal` (N = `activeProfiles.length`), `SequenceEnrollModal` (`enrollCount`) et `BulkInMailModal` (`readyCount`), soit le nombre du bouton ; aide reliée par `aria-describedby`, bouton désactivé sans la case, case décochée dès que la liste change, premier message entier au-dessus (premier InMail prêt, objet compris, pour l'InMail groupé). Premier message des fenêtres de séquence : parcours du moteur (`enrollment-preview/firstMessagePath.ts`), branche « Vérifier la relation » choisie d'après la relation connue du candidat, sinon les deux avec leur condition. Une étape à message rédigée par l'IA compte comme message même sans modèle (`hasMessage`, `useEnrollmentPreview.ts`) : la séquence passe par la préparation avec aperçu, et l'étape s'annonce « Message rédigé par l'IA Konekt pour ce candidat : générez-le pour le relire. ». Récapitulatif (plus de 10 candidats) : « Aperçu du premier message » avec ‹ ›. Aucun texte n'annonce une rédaction par l'IA « au moment de l'envoi ». Gardes statiques : `tests/ux/lot5a-destinataires.test.mjs`, `tests/agent/sequence-tools-policy.test.mjs`.
- **Aucun message IA sans relecture (lot 5a-2)** : le moteur ne rédige plus jamais à l'envoi. Une exécution d'une étape à message (`needsMessage`) avec `use_ai_personalization`, sans texte relu (retouche validée à l'inscription `tracking_data.message_overrides[step_id]`, ou correction du Journal `final_message` d'une étape programmée ; une copie périmée du modèle n'en est pas un), ne part pas : règle pure `aiReviewRequired` (`_shared/sequence-send-rules.ts`), garde placée juste après `aiWillGenerate`, avant `hasTimeToLock`, le verrou et `checkQuotaForAction`. Effet : exécution laissée `scheduled`, `scheduled_at` + 1 h, `error_message` = « Message rédigé par l'IA à relire avant l'envoi. » (`AI_REVIEW_REQUIRED_MESSAGE`), comptée `skipped` ; ni appel au modèle, ni débit, ni place du plafond LinkedIn, ni pause, ni échec, ni `retry_count`, ni auto-pause. `generatePersonalizedMessage` reste dans le code, injoignable à l'envoi. Préparation (`EnrollmentPreviewModal`) : « Inscrire N candidats » désactivé tant qu'un candidat à inscrire n'a pas le texte de chaque étape IA (`aiReviewMissingCount`, `useEnrollmentPreview.ts`), avec « Générer tous les aperçus » ; puis case « J'ai relu les messages rédigés par l'IA » obligatoire quel que soit N, décochée par toute génération ou régénération (`aiGenerationVersion`) ; dès 5 candidats une seule case « Je confirme les destinataires et j'ai relu les messages rédigés par l'IA » (`sendConfirmation`, `contactRecipientsGuard.ts`) ; Récapitulatif : « Messages rédigés par l'IA » candidat par candidat (‹ ›). Après l'inscription : « Relire le message » sur l'étape reportée, dans le suivi (`SequenceEnrollmentsPanel`) et le Journal (collaborateur : ses inscriptions), ouvre `EditScheduledMessageModal` en relecture (modèle prérempli, « Proposer avec l'IA » : même génération d'aperçu, coût annoncé, `activity-log/proposeAiMessage.ts`, lectures seulement) ; « Enregistrer » n'écrit que `final_message` et `final_subject` d'une étape encore programmée, jamais `tracking_data` ; le moteur l'envoie au premier passage, au plus une heure plus tard, et la raison n'est plus affichée (`isAiReviewPending`, `scheduledExecutionError`, libellé `AI_REVIEW_REQUIRED_LABEL` de `sequenceErrorMessages.ts`). Aperçus (`generate-outreach-message`, correctif 2) : aucune rémunération dans le prompt, `detectSequenceViolations` passé sur l'aperçu (violations bloquantes corrigées une fois, puis revérifiées sur le texte final) ; une violation restante refuse l'aperçu (422, `error_code` `PREVIEW_NOT_COMPLIANT`, phrase française affichée sous l'aperçu, à régénérer). Gardes : `tests/ux/lot5a2-relecture-ia.test.mjs`, `sequence-send-rules.test.ts`, `e2e/api/seq-ai-review-guard.spec.ts`, `e2e/flows/seq-ai-review.spec.ts`.
- **Aperçu réel (lot 5d-1)** : `draft-sequence`, action `preview_values` (`requireAuth`, `verifyOrgMembership`, mission et `sequence_id` lus dans l'organisation, 20 candidats au plus ; erreurs `{ error, error_code }` : `PREVIEW_TOO_MANY`, `PREVIEW_INVALID_INPUT`, `PREVIEW_FORBIDDEN`, `MISSION_NOT_FOUND`, `SEQUENCE_NOT_FOUND`, `PREVIEW_ACCOUNT_OF_OTHER_MEMBER`, `PREVIEW_FAILED`). `keys` obligatoire : variables des textes de la séquence (`templateKeys` de `src/lib/templatePreview.ts`, 50 au plus), seules rendues. `enrollment_ids` lus avec le jeton de l'appelant (une inscription hors de sa RLS est absente de la réponse) ou `profiles` (colonnes que le navigateur écrira à l'inscription, expéditeur = l'appelant, `account_id` d'un autre membre refusé). Contexte construit par `buildSequenceContext` exactement comme le moteur (`_shared/sequence-preview-values.ts` ; `assigned_sender_id` hérité ignoré comme `isLegacyAssignedSender`), sans les variables de l'heure d'envoi (rendues à part dans `send_time`, `SEND_TIME_VARIABLES`). Jamais de valeur des variables personnelles (`user_template_variables`) d'un expéditeur qui n'est pas l'appelant, ni de l'expéditeur que la rotation multi-expéditeurs choisira à l'envoi (prénom, nom, signature, poste compris) : annoncées entre crochets dans `at_send`, gardées telles quelles dans une retouche (`keptForSendKeys`). Relevé facultatif de `buildSequenceContext` (`trace` : expéditeur, clés personnelles, lectures en échec ; sans effet sur le moteur) : une lecture en échec exclut le candidat (`preview_failed`, à réessayer), jamais un texte faux. Candidat effacé ou registre illisible : dans `excluded`, sans valeurs. Le navigateur rend le texte avec `renderTemplatePreview(texte, valeurs)` (copie de `interpolateAndStrip`) et coupe la note d'invitation affichée à 300 caractères (`inviteNoteText`, copie de `smartTruncate`) ; parité prouvée par `tests/fixtures/template-render-cases.json` (`cases`, `invite_note_cases`), joué en Node (`tests/ux/lot5d1-rendu-apercu.test.mjs`) et en Deno (`sequence-preview-values.test.ts`) : toute modification de l'un se fait dans l'autre. Écrans : « Relire les messages » (`EnrollmentPreviewModal`) rend les étapes écrites par `usePreviewValues` (`src/hooks/usePreviewValues.ts` : `request` pour les candidats de l'écran par pages de 10, `ensure` pour un candidat dont l'IA a besoin, hors écran compris ; colonnes que l'inscription écrira par `previewProfileOf` ; mission inconnue du serveur rejouée sans mission) ; squelette pendant la préparation, raison du serveur (effacement, échec) avec « Réessayer » à la place du texte, jamais de texte deviné (`resolveVariables` retiré). Une étape écrite n'a rien à générer : elle compte prête seulement avec ses valeurs ou une retouche (bandeau, liste, récapitulatif ; « Générer tous les aperçus » les demande aussi, gratuitement), n'est plus enregistrée dans `message_overrides` sans retouche (le moteur la rend à l'envoi avec la même règle) ; sa première retouche part du texte ET de l'objet rendus, avec `{{salutation}}`, les autres variables de l'heure d'envoi, `{{calendly_link}}` et les variables annoncées gardés pour le moteur (`previewEditableText`) ; retouchée, son bouton est « Revenir au modèle » (aucune génération). Retouches, aperçus IA et relecture du lot 5a-2 inchangés ; l'IA reçoit le texte rendu des étapes écrites (`buildPrevSentSteps`, valeurs attendues), jamais le modèle non rendu tant que le serveur les donne. Gardes : `tests/ux/lot5d1-apercu-ecrans.test.mjs`. e2e : `e2e/api/seq-preview-values.spec.ts`, `e2e/flows/seq-ui-1.spec.ts` (« lot 5d-1 »).
- **Client anonymisé (correctif 1, 11/10/2026)** : `buildSequenceContext` (`_shared/template-interpolation.ts`) lit l'anonymisation par `pickBriefFacts` de `sequence-draft.ts` (même `anonymize_client`, même alias, mêmes noms : colonne `client_name`, `job_details.client.name`, `job_details.client_name`). Client anonymisé : `{{client}}` rend l'alias, sinon « notre client » (`ANONYMIZED_CLIENT_FALLBACK`) s'il y a un nom à cacher, jamais le nom réel, au moteur comme dans l'aperçu (`preview_values`) et la carte de l'assistant ; le texte de secours écrit dans le modèle (`{{client | fallback:"…"}}`) ne s'applique plus dans ce cas, la variable ayant une valeur. Rendu inchangé, donc parité navigateur et moteur intacte. Limites : une retouche enregistrée avant ce correctif peut contenir le nom en clair, et le moteur l'envoie telle quelle ; `{{poste_recherche}}` rend toujours l'intitulé enregistré, qui peut nommer le client. Tests : `template-interpolation.test.ts`, `sequence-preview-values.test.ts`, `e2e/api/seq-correctifs-donnees.spec.ts` (journal du faux LinkedIn et aperçu).
- **Rédaction par l'IA (lot 5e)** : une seule rédaction, `_shared/sequence-draft.ts` (module pur, test Deno `sequence-draft.test.ts`). Le serveur fixe la forme (`buildDraftSkeleton` : visite facultative, invitation avec note, attente de l'acceptation 14 jours, messages « Si connecté » à 0, 4 puis 7 jours ; ou InMail puis relances par InMail à 5 puis 7 jours ; 1 à 3 relances), le modèle n'écrit que les textes, `use_ai_personalization` toujours faux. `pickBriefFacts` : liste fermée des champs du poste (jamais rémunération, critères, profils de référence, brief brut, contacts du manager, entreprises ciblées) ; client anonymisé remplacé par son alias sous ses deux noms (colonne `client_name` et `job_details.client.name`, `company.hiddenNames`), `{{poste_recherche}}` refusé si l'intitulé enregistré nomme ce client (`titleRevealsClient`). `checkDraftTexts` (textes de secours des variables compris) : refus (texte vidé, étape « À rédiger », `validateSequence` option `aiDraft` bloque l'enregistrement) pour rémunération (`findRemuneration` : montant en euros, « brut », « net », « par mois », fourchette, salair*, rémunér*, package, TJM, prime ; « 500 k utilisateurs » permis), valeurs gardées pour l'équipe (`briefForbiddenValues` : montants `salary_*`, contacts du manager, entreprises ciblées, libellés des critères, profils de référence, sauf s'ils figurent dans les faits), nom de prestataire, Notion, lien, « Konekt » hors du nom de l'organisation, nom réel du client, `{{client}}`, variable inconnue, lien de rendez-vous hors relance, longueurs, tutoiement (refus depuis le lot 5e-2, `hasTutoiement`) ; signalement « À relire » (critère discriminatoire, premier message qui suppose l'invitation, secours manquant). `draft-sequence` : `prepare` (gratuite : faits, les plus forts d'abord par `factsByStrength`, « Vos messages », trois angles sans IA, coût) et `draft` (membre, mission de l'organisation sinon 404, poste trop peu décrit 422 `DRAFT_JOB_TOO_THIN`, argument ajouté interdit 422 `DRAFT_ARGUMENT_REFUSED`, crédits 402 sans appel, `call-claude.ts` 30 s sans nouvelle tentative, une correction s'il reste 30 s sur 60, `settleCredits` des jetons consommés ; rien n'est écrit hors du débit). Clé de crédits `sequence_draft` (plancher 3, environ 7 000 jetons ; `_shared/ai-config.ts`, miroir `src/types/aiCredits.ts`). `text-action` en contexte séquence (`context: 'sequence'`, actions `rewrite`, `shorten`, `hook`, `proofread`, une proposition) : vouvoiement imposé (`tone: 'casual'` refusé 400 `SEQUENCE_TONE_REFUSED`, autre action 400 `SEQUENCE_ACTION_UNSUPPORTED`), proposition passée par `reviewTextProposal` (un interdit ou un tutoiement qu'elle ajoute : 422 `PROPOSAL_NOT_COMPLIANT`, jetons débités), modèle indisponible 503 `PROPOSAL_UNAVAILABLE`, aucune nouvelle tentative du modèle. `create_sequence` (assistant, sans drapeau) : même forme et mêmes contrôles (`planCreateSequence`, valeurs gardées comprises), jamais automatique (`NEVER_AUTO_TOOLS`), étapes écrites par `save_sequence_steps` ; le modèle de la conversation rédige à partir des seuls faits rendus par la lecture `get_sequence_draft_facts` (liste fermée), jamais de `get_mission_brief`. `draft_outreach_message` (correctif 3) : poste par `pickBriefFacts`, tons vouvoyés seulement (`professional`, `concise` ; `casual` et `enthusiastic` hérités ramenés au vouvoiement), brouillon passé par `checkDraftTexts` (tutoiement refusé), sans nouvelle tentative. Écrans (drapeau `konekt.sequences-v2`) : `src/components/sequences/ai/` (`AIDraftWizard` : « Le poste », « L'angle », double clic et second Entrée sans effet ; `AIDraftDoor` : portes 1 et 2 ; `AskAIMenu`, `AIProposal` dans le panneau d'étape), `src/hooks/useSequenceAI.ts`, `src/lib/sequenceDraft.ts` ; `draft-sequence` dans `HEAVY_AI_FUNCTIONS` (90 s, preview_values compris). Carte d'approbation et Journal : `SequenceDraftPreview` (textes entiers, variables en puces) ; sous l'interrupteur, « Ouvrir la séquence » rejette la proposition avec la note « Reprise dans l'éditeur » puis ouvre `/sequences/nouvelle?depart=ia&proposition=<id>` (éditeur rempli, non enregistré). Gardes : `tests/c1/lot5e-redaction.test.mjs`, `tests/ux/lot5e-redaction-ecrans.test.mjs` ; e2e : `e2e/api/seq-draft.spec.ts`, `e2e/api/seq-draft-skeleton.spec.ts`, `e2e/api/seq-assistant.spec.ts` (create_sequence, draft_outreach_message), `e2e/flows/seq-v2-redaction.spec.ts`.
- **Style et niveau de l'IA qui rédige (lot 5e-2)** : toute rédaction de prise de contact par l'IA, et elle seule : `draft-sequence` (`draft`), `text-action` en contexte séquence (« Demander à l'IA », plus l'action `restyle` « Réécrire dans votre style »), `generate-outreach-message` (messages IA par candidat : aperçus de la préparation et de « Relire le message », `OutreachMessageModal`, `BulkInMailModal`), et les outils de l'assistant `draft_outreach_message` et `create_sequence`. Règles pures : `_shared/writing-style.ts` (test Deno `writing-style.test.ts`) ; lecture des réglages de l'appelant : `_shared/writing-settings.ts` (`loadWritingSettings`, lecture en échec = refus, jamais un niveau supposé) ; miroir navigateur `src/lib/writingStyle.ts`, données par `useWritingPreferences`, composants `src/components/ai/` (`WritingStyleFields`, `WritingSettingsLine`, `AiLevelPicker`). **Style** : cinq valeurs fermées, Longueur (`court`, `standard`, `detaille`), Ton (`formel`, `chaleureux`, `direct`) et sa spontanéité (`ecrit`, `naturel`, `spontane`), Accroche (`parcours`, `entreprise`, `poste`), Appel à l'action (`echange`, `question`, `agenda`) ; défaut standard, formel, naturel, parcours, court échange (le rendu d'avant). Longueurs cibles par type de message (`LENGTH_TARGETS` : note d'invitation, premier message, relance, InMail), note d'invitation plafonnée à 300 caractères à toutes les longueurs. Lien d'agenda (`ctaFor`) : en séquence, seulement en relance et si la mission a un lien (`{{lien_calendly}}`, jamais l'adresse) ; en fenêtre hors séquence, l'adresse fournie ; sinon repli annoncé sur le court échange. Vouvoiement imposé : première ligne de chaque consigne (`buildStyleInstructions`), aucune valeur ne tutoie (anciens tons lus par `styleFromLegacyTone`, `casual` et `tu` donnent chaleureux au vouvoiement), tutoiement refusé à la sortie (`hasTutoiement`, noms propres connus masqués : `checkDraftTexts`, et dans `generate-outreach-message` une correction puis 422 `PREVIEW_NOT_COMPLIANT`). Défauts par personne : `profiles.ai_context.writing_style` (Paramètres › Rédaction, carte « Votre style », `WritingStyleCard`, ancre `#style` ; écriture relue puis fusionnée, les consignes gardées). Chaque rédaction part de ces défauts et accepte `style` pour elle seule (partiel ; valeur inconnue : 400 `STYLE_INVALID`) : « Le poste » de l'assistant de rédaction, « Demander à l'IA », préparation, « Relire le message » ; l'assistant de conversation prend les défauts de la personne (`draft_outreach_message`, `get_sequence_draft_facts` qui rend `style_rules`). Le ton des consignes (« Ton de la messagerie et de l'assistant », sans « Tutoiement ») ne s'applique plus à ces rédacteurs (`loadAndBuildAiContext` option `omitTone`) ; le sélecteur de ton des étapes IA et le `ModelPicker` des fenêtres sont retirés (`aiTone` reste dans la charge enregistrée). **Niveaux** : `rapide`, `equilibre` (défaut, le niveau d'avant), `avance`. Une seule table, `WRITING_LEVEL_MODELS` de `_shared/ai-config.ts` : Rapide → `claude-haiku-4-5`, Équilibré → `claude-sonnet-4-6`, Avancé → `claude-opus-5-5` (miroir `src/types/aiCredits.ts`, dont les libellés du sélecteur de modèle suivent les mêmes mots ; `levelOfModel` range un modèle par sa gamme). Coût par niveau = formule du garde (`levelCredits`) : rédaction de séquence 3, 7, 11 ; message par candidat et brouillon de l'assistant 2, 5, 8 ; « Demander à l'IA » 1, 2, 3 ; affiché avant chaque lancement, pour chaque niveau permis. **Plafond de l'organisation** : `organizations.agency_permissions.ai_writing` `{ level, max }` (jsonb existant, aucune migration), écrit par le propriétaire seul (Paramètres › Règles de l'assistant, carte « Niveau de l'IA qui rédige », `AiLevelSettings`, ancre `#niveau-ia`, `updateOrganization` avec relecture et fusion ; administrateur en lecture, refus `ORG_OWNER_ONLY` du garde `organizations_update_guard`, contrôles 4b et 10b de `org_writes_audit.sql`) ; lecture tolérante (`normalizeOrgLevels` : absent, Équilibré par défaut et Avancé au plus ; un défaut au-dessus du plafond est lu comme le plafond). **Contrôle serveur**, même ordre partout : organisation vérifiée, `resolveAiLevel` (absent : défaut de l'organisation ; hors liste : 400 `AI_LEVEL_INVALID` ; au-dessus du plafond : 403 `AI_LEVEL_NOT_ALLOWED`, jamais rétrogradé), style, `assertCredits` sur le modèle du niveau (402), appel, `settleCredits` sur le modèle appelé ; aucun appel au modèle ni débit avant un refus ; `_ai_model` et `_ai_action` ignorés par ces rédacteurs. `generate-outreach-message` exige une organisation vérifiée (corps, sinon organisation active ; 403 `AI_ORG_REQUIRED` ou `AI_ORG_FORBIDDEN`). `draft_outreach_message` n'a pas d'`ai_level` : niveau par défaut de l'organisation, jamais celui du modèle de la conversation, montré sur la carte avec le style et le coût ; l'approbation rédige au niveau de la carte, et refuse sans appel si le plafond est passé dessous (« Le niveau de rédaction a changé, demandez une nouvelle proposition. »). `create_sequence` : textes écrits par le modèle de la conversation, refusé dans `verifyAccess` si son niveau (`ToolContext.modelId`, posé par `search-agent-chat`) dépasse le plafond. Limite écrite : le plafond ne tient pas le texte libre de la conversation de l'assistant. Gardes : `tests/c1/lot5e2-style-niveau.test.mjs`, `tests/ux/lot5e2-style-niveau.test.mjs` ; e2e : `e2e/api/seq-style-niveau.spec.ts` (journal du faux modèle : modèle par niveau, consigne par réglage, plafond sans appel ni débit, coût annoncé = coût débité), `e2e/flows/seq-style-niveau.spec.ts`. Plan et questions ouvertes au propriétaire (dont le barème d'Avancé, environ 1,5 fois Équilibré avec la formule actuelle) : `docs/refonte-mission/lot5-plan.md`, section 5e-2.
- **Réponses proposées dans la messagerie (11/10/2026)** : `generate-reply-suggestions` et `analyze-response` (suggestions de réponse, et questions de qualification qu'un clic insère dans le message au candidat) vouvoient toujours le candidat, même s'il tutoie. Consigne en tête du prompt (`VOUVOIEMENT_RULE`, seconde tentative comprise) ; ancien ton « Décontracté » (`casual`) lu comme chaleureux au vouvoiement (`styleFromLegacyTone`, `toneLines`) ; dans `generate-reply-suggestions`, un réglage « Tutoiement » des consignes est lu comme vouvoiement, les autres tons des consignes s'appliquent toujours. À la sortie, une suggestion ou une question qui tutoie est écartée (`hasTutoiement`, noms propres connus masqués, adresses retirées avant le contrôle), sans nouvel appel ; si toutes les suggestions sont écartées, trois réponses de secours vouvoyées. Ces deux fonctions ne sont pas des rédacteurs du lot 5e-2 (ni niveau ni style). Même règle pour `text-action` hors séquence quand il rédige un message au candidat (`cta_reply`, `rewrite`, `translate` vers le français, qui remplace le message en cours) : `VOUVOIEMENT_RULE` en tête, `casual` chaleureux au vouvoiement, réglage « Tutoiement » lu comme vouvoiement ; à la sortie, `hasTutoiement` après retrait des adresses web et e-mail, noms connus masqués (chaque suite d'au moins deux mots du nom comprise), texte manifestement anglais non jugé ; s'il tutoie, une seule correction s'il reste 30 s sur 60, `rewrite` garde les variantes qui vouvoient, sinon 422 `PROPOSAL_NOT_COMPLIANT`, jetons débités (correction comprise). Limite : une analyse gardée par le navigateur (`message_analysis_cache`, moins de 24 h) garde ses anciennes suggestions. Gardes : `tests/c1/correctifs-textes-assistant.test.mjs`, `tests/c1/correctifs-text-action.test.mjs`, `e2e/api/seq-draft.spec.ts`.
- **Fonctions et `config.toml`** : toute fonction nouvelle sous `supabase/functions/` a sa section `[functions.<nom>]` avec `verify_jwt = false` (sauf `submit-application`, `verify_jwt = true`) ; contrôlé par `tests/c1/fonctions-config.test.mjs` (aucune section absente, orpheline ni en double).
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
**Exception écrite (lot 5b, décision 3 du plan `docs/refonte-mission/lot5-plan.md`), pour ces seuls gestes des séquences** : mise en pause d'un candidat (suivi des inscrits, fiche candidat, messagerie), « Mettre en pause tous les candidats actifs », « Mettre en pause la séquence » (l'interrupteur), « Arrêter pour ce candidat » et « Arrêter » groupé partent sans fenêtre, avec « Annuler » dans un toast (`src/hooks/useUndoableEnrollmentAction.ts`). Gardent leur AlertDialog : « Ne pas envoyer cette étape ? », « Réactiver cette séquence ? », « Supprimer cette séquence ? », « Marquer comme ayant répondu », « Reprendre », « Relancer », et la pause de l'ancien tableau de mission (`ProjectCandidatesTableEnhanced`, jusqu'aux lots de retrait de l'ancienne page). Toute autre action destructive suit la règle ci-dessus.

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

## Unipile API v2 (LinkedIn, WhatsApp, e-mail)

Détails : `docs/unipile-v2-architecture.md` (développeurs), `docs/unipile-v2-bascule.md` (mise en production, propriétaire). Seuls les essais sans compte ont été joués contre le vrai service (12 octobre 2026, application « Development », `docs/unipile-v2-contrat-essais.md`) : tout ce qui demande un compte relié reste à confirmer, liste en partie 10 de l'architecture. Ne pas fusionner la branche de bascule avant le guide : la fusion déploie un code qui n'accepte que les identifiants `acc_...`.

### Architecture
```
Frontend (invokeUnipile) → unipile-search / unipile-accounts → _shared/unipile/ (http.ts, seul fetch) → https://api.unipile.com/v2 → LinkedIn / WhatsApp / boîte e-mail
```
- Une clé globale `UNIPILE_V2_API_KEY` (en-tête `X-API-KEY`), ni DSN ni clé par organisation (colonnes `organization_integrations.unipile_*` conservées, sans lecteur)
- Le compte est dans le chemin : `/v2/{acc_...}/...` ; `/v2/accounts`, `/v2/auth/*`, `/v2/webhooks/*` sont communs à l'application
- Délai 15 s (30 s `heavy`) ; 2 reprises au plus, GET/PATCH/DELETE seulement (réseau, 429, 502 à 504) ; un envoi n'est jamais repris : délai ou 5xx = `uncertain`, jamais compté envoyé
- Erreurs : genres fermés `ErrorKind`, texte français neutre `userSafeMessage`, le texte du prestataire n'est jamais rendu

### Licences LinkedIn
| Licence | Recherche de personnes (`POST /{acc}/linkedin/...`) | Notes |
|---------|------|-------|
| Classic (`classic`) | `search/people` (curseur) | Recherche de base, filtres limités |
| Recruiter (`recruiter`) | `recruiter/search/people` (curseur) | Mots-clés booléens, intitulé, compétences, séniorité, projets, spotlights |
| Sales Navigator (`sales_navigator`) | `sales-navigator/search/people` (décalage, sans curseur) | Recherche de sociétés, filtres société |

Licence déduite de `GET /{acc}/linkedin/contracts` (Classic toujours possible). Recruiter et Sales Navigator s'excluent sur un compte : `POST .../contracts/{id}/select` avant de chercher avec l'autre. Un filtre que la licence ne sait pas exprimer est rendu dans `filters_dropped`, un filtre approché dans `filters_adjusted` (`toKonektFilters`) ; l'agent de sourcing continu refuse plutôt que de chercher plus large (422 `FILTERS_UNSUPPORTED`). Une recherche à la main affiche ces deux listes au-dessus des résultats (`src/lib/searchFilterNotice.ts`, rangées dans `ExecutedSourcingSearch.filtersNotice`). L'ancienne matrice des filtres par licence (colonne « Database » comprise) est retirée : lire `_shared/unipile/normalize/search.ts`.

### Main Actions (unipile-search edge function)
**search** — corps compilé par licence (`_shared/unipile/normalize/search.ts`) → `{ success, results, cursor, total }` ; mots-clés Classic/Sales Navigator coupés à 200 caractères
**search_from_url** (adresse de recherche collée), **list_recruiter_projects**, **list_sent_invitations**, **withdraw_invitation** (réservée au titulaire du compte)
**get_profile** — `GET /{acc}/users/{ref}` + sections ; `ref` = nom court puis identifiant du prestataire ; `profile_url` accepté. Lire un profil n'est pas une visite : `visitProfile` est un appel explicite (étape `profile_visit`)
**get_parameters** — paramètres de recherche par licence → `{ items: [{id, title}] }`
**get_chats / get_messages** — par compte et par boîte (`inboxes`), dédoublonnés ; une conversation v2 ne porte pas son compte
**send_message** — `POST /{acc}/chats/{chat}/messages/send` ou `POST /{acc}/chats/send` (nouvelle) ; InMail selon la licence (Recruiter : objet et signature, Sales Navigator : objet, Classic : crédit `classic`) ; réservée au titulaire du compte
Compte : `unipile-accounts` (`connection_*`, `list`, `inmail_balance`, `list_contracts`, `select_contract`...) ; connexion hébergée par défaut, directe derrière `CONNECTION_NATIVE_ENABLED`
**Usage des comptes de l'équipe** (12/10/2026, à confirmer par le propriétaire) : un collaborateur ne se sert, pour AUCUNE action, que du compte qu'il a relié, et la règle ne nomme aucune action (une action ajoutée plus tard est couverte). `unipile-search` : `account_id` est obligatoire avant le contrôle, donc toute action porte un compte ; refus 403 `ACCOUNT_NOT_YOURS` par `collaboratorOwnAccountRefusal` (`account-rules.ts`, sans paramètre d'action), avant tout quota et tout appel au prestataire. `unipile-accounts` : toute requête dont `account_id` ou `reconnect_account_id` désigne un compte relié à un autre membre (LinkedIn, e-mail ou WhatsApp), refus 403 `error_code: account_not_yours` par `assertCollaboratorUsesOwnAccount` (`ownership.ts`, avant le `switch`). `send_message`, `withdraw_invitation`, `add_reaction`, `delete_message`, `delete_chat` et `disconnect_whatsapp` restent réservés à son propre compte pour tout rôle ; `claim_linkedin_account`, un compte orphelin et ceux des autres organisations gardent leurs règles. Propriétaire, administrateur et membre se servent des comptes de l'organisation, un rôle absent ou inconnu vaut collaborateur, la clé de service n'est pas concernée. Les uuid d'organisation et de titulaire se comparent par `sameId` (`canonicalUuid`, copie identique dans `unipile-search/account-rules.ts`), jamais par `===` : la base lit comme le même uuid les majuscules, les accolades et l'absence de tirets. L'action `list` rend encore à un collaborateur les comptes de l'équipe (noms, photos, offres) : décision en attente. Gardes : `supabase/functions/unipile-search/account-rules.test.ts`, `unipile-accounts/handler.test.ts`, `e2e/api/account-read-access.spec.ts`.

### Webhook Events (unipile-webhook, jeton `?v2_token=`, 17 événements souscrits)
| Event v2 | Action |
|----------|--------|
| `relation.new` | Update enrollment connection_status, resolve wait_connection step |
| `message.new` | Mark enrollment as replied, cancel pending steps, auto-analyze ; message propre = `record_own_message` |
| `email.new` | Réponse retrouvée par `in_reply_to` / `thread_id` |
| `account.add`, `account.reconnect` | Claim de la tentative `connection_attempts` (`state`), reprise des inscriptions en pause |
| `account.status.running`, `.degraded`, `.partial` | account_status → OK, DEGRADED, PARTIAL. DEGRADED : état de carte seul (ni bandeau, ni notification). PARTIAL (un produit demande une nouvelle authentification) : une notification « Connexion LinkedIn partielle » à chaque passage, bandeau et ligne d'« À traiter » (sous-titre « Reconnectez le compte ») avec « Reconnecter ». Avec `is_locked` vrai → LOCKED, comme `account.locked` ; avec `is_locked` faux, l'événement fait foi et rien n'est relu. Sans `is_locked` sur une liaison LinkedIn stockée LOCKED, l'état est relu chez le prestataire (voir `account.unlocked`) ; relecture impossible : la liaison reste LOCKED et l'événement est rejoué (500) |
| `account.status.disconnected`, `.errored` | account_status → CREDENTIALS, ERROR, notify user (« Compte LinkedIn déconnecté » ; « Problème de connexion LinkedIn » pour ERROR) |
| `account.locked`, `account.unlocked` | LOCKED (remplace OK, DEGRADED, PARTIAL, sans statut ou statut inconnu ; jamais CREDENTIALS, ERROR ni les statuts hérités à reconnecter) avec une notification « Compte LinkedIn restreint » par passage ; `account.unlocked` lit d'abord les liaisons enregistrées (`hasLockedBinding`) et n'appelle le prestataire que si l'une est LOCKED (aucune lecture pour une liaison OK, PARTIAL, CREDENTIALS, ERROR ou DEGRADED) ; il relit alors l'état du compte (`readReportedStatus`, 8 s) : les liaisons LOCKED (LinkedIn, e-mail, WhatsApp) prennent cet état, un retour en PARTIAL, CREDENTIALS ou ERROR prévient une fois, un compte encore verrouillé ne change pas ; relecture impossible (erreur, 404, délai, réponse sans statut) ou lecture des liaisons en échec : rien n'est écrit, elles restent LOCKED (un doute ne laisse rien partir) et l'événement est rejoué (500) |
| `account.remove` | Compte supprimé chez le prestataire : délier et arrêter les envois (pas une déconnexion récupérable) |

Un passage d'état ne notifie que pour l'écriture qu'il a faite, jamais d'après une lecture : LOCKED s'écrit par une mise à jour conditionnelle sur le statut d'avant (`moveLinkedInAccount` : filtre `.or` et `.select()`), les autres statuts par `applyLinkedInStatus` (lecture, puis écriture seulement si le statut est encore celui qui a été lu, 25 essais au plus), y compris `disconnected`, `errored` et `account.add` ou `account.reconnect` sans tentative de connexion : des livraisons simultanées ne notifient qu'une fois, et un événement ne recouvre jamais un événement plus récent. Un passage qui n'est pas appliqué en entier (lecture ou écriture de liaison en échec, 25 essais contestés, relecture impossible) lève `TransientEventError` : la ligne de dédoublonnage est libérée, la livraison répond 500 et le prestataire rejoue l'événement ; seuls les échecs d'écriture de `moveLinkedInAccount` (LOCKED) et des liaisons e-mail et WhatsApp restent journalisés avec un 200. Un `account.add` ou `account.reconnect` sans tentative de connexion qui ne porte ni statut connu du prestataire ni `is_locked` vrai ne change rien (statut enregistré gardé, ni notification, ni reprise d'inscription : `informedStatus`). La phrase de PARTIAL est celle de la carte, copiée dans le récepteur (`PARTIAL_CONNECTION_SENTENCE`, qui ne peut pas importer `src/`) ; `tests/ux/etat-compte-alertes.test.mjs` compare les deux.

### Error Handling
- `429` → reprises avec `Retry-After` (5 s au plus) sur les appels idempotents ; sur un envoi, refus sans reprise ; toast « Trop de requêtes »
- `uncertain` (délai, 5xx, 2xx illisible sur un envoi) → ni enregistré comme envoyé ni renvoyé
- `provider_limit` → compte en pause pour la journée ; le plafond vient du registre `linkedin_action_log` (la v2 ne donne plus de pourcentage d'usage)
- `account_degraded` (DEGRADED, PARTIAL, LOCKED) → envois retenus 6 h, sans mise en pause des inscriptions ; DEGRADED n'est signalé que sur la carte, PARTIAL comme un compte à reconnecter (notification, bandeau, ligne d'« À traiter », avec « Reconnecter »), LOCKED sans « Reconnecter »
- `CREDENTIALS` et `ERROR` / `account_disconnected` (ou ancien identifiant non `acc_`) → inscriptions en pause `account_disconnected` (porte `disconnected` de `accountSendGate`), reprise quand le compte revient OK, reconnexion demandée
- Clé absente → `config` ; erreurs réseau → messages français humanisés

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
