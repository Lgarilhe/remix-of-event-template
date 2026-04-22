# Airtable removal plan

Date : 2026-04-22
Contexte : Konekt utilisait Airtable comme ATS interne. La plateforme se commercialise comme produit universel — chaque client doit pouvoir brancher SON ATS (Greenhouse, Lever, Workable, Recruitee, Notion, Airtable…) via le système de connecteurs (`connector_instances`).

## État actuel : 20 fichiers + 13 tables + 1 edge function

### Tables `airtable_*` (à dépréquer) — toutes dans `MIGRATION_CLEAN.sql`
1. `airtable_appointments`
2. `airtable_candidates`
3. `airtable_companies`
4. `airtable_contacts`
5. `airtable_glossary`
6. `airtable_jobs`
7. `airtable_kpi`
8. `airtable_notes`
9. `airtable_placements`
10. `airtable_shortlists`

### Edge function
- `fetch-airtable` (sync depuis l'API Airtable vers les tables `airtable_*`)

### Fichiers frontend impactés
- **Settings** : `src/components/settings/IntegrationsSettings.tsx` (toggle Airtable)
- **Hooks** : `useAirtableMatch.ts`, `useAircallHistory.ts`, `useCandidateHistory.ts`, `useCandidateFullProfile.ts`, `useOrganizationIntegrations.ts`, `useProfileActivity.ts`, `useVivierCandidates.ts`, `useVivierEnrichment.ts`
- **UI badges Airtable** : `CardStatusBadges.tsx`, `CardExpandedContent.tsx` (badge "déjà rencontré" basé sur match Airtable)
- **Profil candidat** : `ProfileDetailSheet.tsx`, `ProfileTab.tsx`, `CandidateHistoryPanel.tsx`
- **ATS** : `JobDetailSheet.tsx`
- **Vivier** : `VivierList.tsx` (dépend lourdement de `airtable_candidates`)
- **Recherche** : `LinkedInResultCard.tsx`, `SearchResultsPanel.tsx`

## Stratégie : abstraction "Connector" — pas suppression bulk

L'objectif n'est PAS de supprimer Airtable de l'app, c'est de le **transformer en connecteur optionnel** parmi d'autres. Les tables `airtable_*` deviennent un **cache de connecteur Airtable** (1 table par client qui a activé le connecteur), pas une dépendance hardcodée.

### Phase 1 — Abstraction (1-2 jours)
1. **Créer un modèle "candidate" générique** : table `external_candidates` (org_id, source: 'airtable'|'notion'|'greenhouse'|'manual', external_id, normalized_data jsonb, last_synced_at)
2. **Créer un modèle "interaction historique" générique** : `candidate_interactions` (org_id, candidate_id, type: 'call'|'email'|'meeting'|'note', source, payload jsonb)
3. **Hook `useCandidateHistory`** : query `candidate_interactions` au lieu de joins sur `airtable_*`
4. **Hook `useAirtableMatch`** → renommer en `useCandidateMatch` qui interroge `external_candidates` quel que soit la source

### Phase 2 — Connecteurs configurables (2-3 jours)
1. **Settings → Integrations** : transformer la liste hardcodée (Notion/Airtable/Aircall) en une liste dynamique alimentée par `connector_registry`
2. **Connector instances** : par org, l'admin active/désactive ses connecteurs et configure les credentials
3. **Sync workers** : edge functions `sync-connector-{notion|airtable|greenhouse|...}` qui poussent vers les tables génériques `external_candidates` + `candidate_interactions`

### Phase 3 — Migration data (1 jour)
1. Script migration : `airtable_candidates` → `external_candidates` (source='airtable'), `airtable_notes` → `candidate_interactions` (type='note', source='airtable'), etc.
2. Validation : 0 régression UI sur les 20 fichiers
3. DROP des tables `airtable_*` après 30j de double-écriture safe

### Phase 4 — Notion ditto (1 jour)
Même playbook pour Notion (4 fonctions touchées : `fetch-notion-jobs`, `fetch-notion-candidates`, `fetch-notion-schema`, `submit-application`, `add-to-shortlist`).

## Quick wins immédiats (pas dans ce commit, à scheduler)

- [ ] Marquer fonctions edge `fetch-airtable`, `fetch-notion-*` comme deprecated dans CLAUDE.md
- [ ] Ajouter un toggle global "use external connectors" pour les nouvelles orgs (cache sync OFF par défaut tant que pas configuré côté client)
- [ ] Documenter la liste des connecteurs cibles à supporter à terme : Greenhouse, Lever, Workable, Recruitee, Teamtailor, SmartRecruiters, Ashby, Notion, Airtable, Calendly, Google Calendar, Outlook Calendar, Aircall, Ringover, Slack, Microsoft Teams, Gmail, Outlook Mail.

## Risques

- **High** : casser le badge Airtable sur les candidats (Konekt l'utilise tous les jours pour repérer les profils déjà rencontrés)
- **High** : casser le Vivier (`VivierList` lit directement `airtable_candidates`)
- **Medium** : perte d'historique d'appels Aircall (joinable via Airtable → `airtable_candidates.aircall_calls`)
- **Low** : UI Settings (juste un toggle)

## Estimation

- Phase 1 : 1-2 jours dev (un développeur)
- Phase 2 : 2-3 jours
- Phase 3 : 1 jour + monitoring
- Phase 4 : 1 jour
- **Total : 5-7 jours dev** + 2-3 semaines de double-écriture safe avant DROP

⚠️ NE PAS faire ce chantier en mode "auto" / 1 session — risque trop élevé de régression. Doit être un sprint dédié avec QA manuel après chaque phase.
