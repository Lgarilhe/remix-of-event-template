# Audit fonctionnel — Skalr

Date: 2026-04-16
Branche: `claude/app-audit-jHxht`

Focus : redondances, incohérences, améliorations UX/produit.

---

## 🔴 A. Dead code & pages fantômes

### A1. `src/pages/Admin.tsx` — 397 lignes, JAMAIS référencé
- Pas de `<Route>` dans `src/App.tsx`
- Aucun import dans tout le repo (grep `pages/Admin` = 0)
- **Action** : supprimer, ou router (`/admin`) avec guard.

### A2. `src/pages/Candidates.tsx` — page morte comme UI, vivante comme module de types
- Route `/candidates` → `Navigate /pipeline` (`src/App.tsx:145`) donc JSX jamais rendu
- **Mais** 7 fichiers importent `ShortlistEntry`, `Candidate`, `PIPELINE_STAGES` depuis `@/pages/Candidates`
- Anti-pattern : un `pages/*.tsx` doit être une page. Déplacer types/constants vers `src/types/candidates.ts`.

### A3. `src/pages/Outreach.tsx` — idem
- 49 lignes : 23 pour les types exportés (`LinkedInAccount`, `LinkedInAccountSubscriptions`), 26 pour la page
- 8 fichiers importent `LinkedInAccount` depuis `@/pages/Outreach` (cf. `src/pages/Inbox.tsx:4`, `src/components/outreach/LinkedInSearch.tsx:3`…)
- **Action** : déplacer vers `src/types/linkedin.ts`. Renommer la page `Missions.tsx` (cohérence avec la route `/missions`).

### A4. `/agents` — page stub
- `src/pages/Agents.tsx` (167 l) : liste `agent_conversations`, bouton "Nouvel agent" → redirige vers `/missions`
- Pas dans la sidebar (`src/components/AppSidebar.tsx:28-34`). Route routée mais orpheline.
- **Action** : soit l'intégrer à AgentDrawer (modal "historique"), soit l'activer dans la nav.

### A5. Références aux paths legacy encore vivantes
Les redirects `/outreach → /missions`, `/ats → /pipeline`, `/candidates → /pipeline` existent, **mais** le code continue à générer des URLs legacy :
- `src/components/ats/ScorecardTab.tsx:611` → `navigate('/ats/scorecard/...')`
- `src/components/ats/CandidateCommentsTab.tsx:188` → `link: '/ats?candidate=…'` (dans les notifications)

⇒ L'utilisateur clique et subit un redirect inutile. **Action** : normaliser vers les nouveaux paths.

---

## 🔴 B. Redondances fonctionnelles majeures

### B1. Trois vues "candidat" incompatibles
| Vue | Où | Contenu |
|---|---|---|
| `CandidateDetailModal` | `/pipeline`, `/dashboard` | 6 tabs complets (profil, éval, notes, activité, prep, actions) |
| `ProfileDetailSheet` | `/missions/:id/sourcing` | Sheet horizontal allégé, pas d'historique, pas de notes |
| `ScorecardFullPage` | `/pipeline/scorecard/:id` | Page pleine, focus scoring + coaching IA |

**Impact** : un sourceur dans une mission ne voit PAS les notes ni l'historique du candidat. Trois UX à apprendre, trois implémentations à maintenir.
**Action** : fusionner en un seul composant `<CandidateProfile />` avec props `variant: 'modal' | 'sheet' | 'fullpage'`.

### B2. Deux copilotes IA coexistent
- `AgentDrawer` global (FAB + Cmd+K) — `src/components/agent/AgentDrawer.tsx`
- `MissionCopilot` inline dans MissionWorkspace — `src/components/missions/MissionCopilot.tsx:139`

Les deux donnent des conseils contextuels sur la mission. **Action** : transformer MissionCopilot en simples "nudges" inline, laisser toute l'IA interactive dans AgentDrawer.

### B3. Trois éditeurs de séquence
- `SequenceBuilder.tsx` (1 310 l)
- `VisualSequenceEditor.tsx`
- `WorkflowCanvas.tsx`

Sous `src/components/outreach/sequence/`, coexistent aussi `SequenceWizardStepper`, `InteractiveFlowDiagram`. Probable évolution historique. **Action** : identifier lequel est la source de vérité, supprimer les autres ou les documenter comme "stepper vs canvas vs builder".

### B4. Trois sources de "candidat"
| Hook | Source | Utilisé dans |
|---|---|---|
| `useATSData` | table `candidates` (pipeline interne) | `/pipeline`, `/dashboard` |
| `useNotionCandidates` | Notion (client Konekt) | `ScorecardFullPage`, ShortlistSpace |
| `useVivierCandidates` | table vivier | `/prospection` |

Ce ne sont pas vraiment des doublons techniques (3 sources distinctes), mais 3 définitions différentes de ce qu'est un "candidat" pour l'utilisateur. **Action** : unifier la surface API (un type canonique `CandidateView`) avec adaptateurs par source.

### B5. Cinq hooks "profile"
- `useProfileEnrichment` — enrichissement Unipile/Apollo
- `useProfileActivity` — log d'activité
- `useCandidateHistory` — historique contacts
- `useCandidateContext` — agrégation contexte pour IA
- `useCandidateFullProfile` — profil complet

Consommés par 14 composants différents, parfois 2-3 à la fois. **Action** : créer un `useCandidate(id)` façade qui retourne `{ profile, history, activity, context, enrichment }`.

### B6. Trois états pour la recherche LinkedIn
1. `missionSearchCache` (in-memory Map) — `src/hooks/useLinkedInSearch.ts`
2. `OutreachSearchContext` (legacy) — `src/contexts/OutreachSearchContext.tsx`
3. React Query cache (implicite via `useLinkedInSearchActions`)

CLAUDE.md note déjà que OutreachSearchContext est "mostly replaced". **Action** : achever la migration et supprimer.

---

## 🟠 C. Incohérences de navigation / UX

### C1. Inbox fragmentée en 3 canaux
- `/inbox` — MessagesInbox global (LinkedIn unifié)
- `MissionOutreach` tab — séquences de la mission
- `InlineAIPanel` dans MessageView — coaching IA contextuel

Aucune vue "tous mes envois + réponses + relances" unifiée. L'utilisateur jongle.

### C2. Changement de stage candidat à 3 endroits
1. Drag/drop dans `MissionPipeline`
2. Drag/drop dans `/pipeline` (ATS Kanban)
3. Selector dans `CandidateDetailModal`

Tous passent par `handleStageChange` de `useATSData`. Cohérent niveau data, mais 3 patterns d'interaction. Au moins documenter lequel est "canonique".

### C3. Configuration de compte à deux niveaux
- Settings > Mon compte : LinkedIn, WhatsApp, Email, EmailSignatures, LinkedInQuota
- MissionConfig tab : HuntMode (override de quota?), client portal, notes
- Certains quotas existent aux 2 niveaux sans hiérarchie claire.

### C4. Sourcing vs Prospection
- `/missions/:id/sourcing` : recherche LinkedIn contextuelle d'une mission
- `/prospection` : vivier/CRM agency-only (VivierList 2 362 lignes)

Un candidat trouvé dans "sourcing" n'atterrit pas automatiquement dans "prospection" et vice-versa. L'agence Konekt qui active les deux doit faire du copier-coller mental. **Action** : bouton "Ajouter au vivier" depuis sourcing + bouton "Lancer sourcing ciblé" depuis prospection.

### C5. Settings à 9 tabs
`src/pages/Settings.tsx:113-123` : Général, Mon compte, Équipe, Abonnement, Crédits IA, Connecteurs, Intégrations, Agence, Marketplace.

Confusion "Connecteurs" vs "Intégrations" (les deux touchent à des systèmes externes — Notion, Airtable, Apollo, etc.). **Action** : fusionner en "Intégrations" unique, avec sous-groupes.

### C6. `/marketplace` = page + `Settings > Marketplace` tab
Le tab Settings est pour **activer** son statut de freelance/agency ; la page `/marketplace` est pour **parcourir** les missions. Noms identiques, usages différents. **Action** : renommer le tab Settings en "Marketplace – mon profil" pour lever l'ambiguïté.

---

## 🟠 D. Dettes architecturales visibles côté UX

### D1. 61 hooks dans `src/hooks/`
Sans sous-dossiers (à part `linkedin/`). Nommage inconsistant (`useATSData` vs `useSourcingProjects` vs `useOrganization`). **Action** : ranger par domaine (`candidates/`, `missions/`, `outreach/`, `org/`).

### D2. 39 composants > 500 lignes
Mélange de containers et de présentations. Les plus gros (VivierList, SequenceBuilder, ATSDashboard) mélangent fetch + UI + actions. **Action** : séparer data-hook / presenter.

### D3. Pas de feature flags dynamiques
`featureGates.ts` est figé dans le code. Impossible d'activer une feature pour un client sans re-déploiement.

### D4. `/dashboard` = mini-ATS
`src/pages/Dashboard.tsx` importe 4 composants ATS (ATSDashboard, ATSStatsSkeleton, CandidateDetailModal, JobDetailSheet). Le "dashboard" est un deuxième /pipeline avec un angle d'attaque différent. Risque de divergence entre les deux.

---

## 🎯 E. Top 8 améliorations prioritaires

1. **Supprimer le dead code** : `Admin.tsx`, déplacer les types hors de `Candidates.tsx` et `Outreach.tsx` (A1–A3).
2. **Unifier la vue candidat** : un seul `<CandidateProfile>` avec variants (B1).
3. **Un seul copilote IA** : intégrer MissionCopilot dans AgentDrawer (B2).
4. **Une seule inbox** : regrouper messages + outreach + relances dans `/inbox` avec filtres par mission (C1).
5. **Intégrer Sourcing ↔ Prospection** : bouton "Ajouter au vivier" / "Sourcer cette ICP" (C4).
6. **Normaliser les URLs legacy** : supprimer les `/ats/...` dans le code app (A5).
7. **Simplifier Settings** : 5 tabs max (Général, Compte, Équipe, Facturation, Intégrations) (C5).
8. **Clarifier `/agents`** : soit le tuer, soit le mettre dans la sidebar avec un vrai contenu (A4).

---

## 📊 Bilan numérique

- Pages : 24 (dont **3 dead/quasi-dead**, 1 stub)
- Composants > 500 l : 39 (mélangent logique et présentation)
- Hooks : 61 (pas de structure par domaine)
- Copilotes IA coexistants : 2
- Vues candidat : 3
- Éditeurs de séquence : 3
- Sources de candidat : 3 (ATS / Notion / Vivier)
- Inbox : 3 canaux non unifiés
- Settings tabs : 9 (plusieurs fusionnables)
- Redirects legacy actifs : 3 (mais encore utilisés dans le code)
