# Audit UX — Skalr

Date : 2026-04-16
Branche : `claude/app-audit-jHxht`
Objectif : rendre l'app claire, évidente et facile à prendre en main.

## Score global

| Axe | Note | Constat |
|---|---|---|
| Onboarding / premier run | 5.5/10 | 10 scènes, LinkedIn connecté trop tard (scène 8/10), pas de tour guidé |
| Clarté de la navigation | 5/10 | Labels ambigus, doublon "Pipeline" (nav ≠ onglet mission), mobile 8 tabs serrés |
| Empty states | 6.5/10 | `EmptyMissionState` excellent ; les autres sont textuels sans CTA |
| Forms & feedback | 5/10 | Auto-save silencieux, tâches longues sans progrès, erreurs génériques |
| Accessibilité | 4/10 | Icon-only sans `aria-label`/tooltip, contraste charts, shortcuts non-découvrables |
| Cohérence design | 6/10 | AlertDialog shadcn OK partout, mais labels EN/FR mélangés et patterns de filtres divergents |

---

## 🔴 Top 10 frictions critiques (à traiter en priorité)

### 1. Onboarding : LinkedIn connecté trop tard
- **Où** : `src/components/onboarding/OnboardingWizard.tsx` — LinkedIn à la scène 8/10.
- **Problème** : l'utilisateur arrive sur `/missions` sans compte connecté ⇒ première recherche impossible, blocage muet.
- **Fix** : déplacer la connexion LinkedIn dans les 3 premières scènes ou proposer un mode "démo avec base Apollo" tant que Unipile n'est pas connecté. Persister un flag `onboarding_blocked_on_linkedin` pour prompter à la 1ʳᵉ recherche.

### 2. Labels de navigation ambigus
- **Où** : `src/components/AppSidebar.tsx:28-34`.
- **Problème** : "Missions", "Prospection", "Pipeline" sans sous-titre ; "Pipeline" dans la sidebar ≠ onglet "Pipeline" dans une mission (kanban local) ⇒ même mot, deux concepts.
- **Fix** : ajouter un sous-titre court par item ("Missions — vos recherches actives", "Prospection — vivier CRM", "Pipeline — candidats tous statuts"). Renommer l'onglet mission "Pipeline" en **"Candidats"** pour lever l'ambiguïté.

### 3. 8 onglets de mission, hiérarchie floue
- **Où** : `src/pages/MissionWorkspace.tsx:35`, `src/components/missions/MissionProgressBar.tsx:20-80`.
- **Problème** : `overview | brief | process | sourcing | outreach | pipeline | insights | config` — mélange workflow (brief→outreach) et meta (config, insights). Sur mobile, inexploitable.
- **Fix** : garder 4 tabs primaires (Brief, Process, Sourcing, Outreach) + regrouper Pipeline/Insights/Config sous un menu "Plus" (ou trailing dropdown). Overview devient le header, pas un onglet.

### 4. Auto-save silencieux, on ne sait jamais si c'est sauvé
- **Où** : `MissionBrief.tsx` (debounce 800 ms, voir CLAUDE.md), `ScorecardTab.tsx` (auto-save timer).
- **Problème** : aucun indicateur "Enregistré", "En cours…", "Erreur". L'utilisateur qui quitte la page a l'impression de perdre son travail.
- **Fix** : ajouter un badge discret `Saved · 12s ago` / `Saving…` / `Offline — draft kept locally` en haut de chaque formulaire auto-sauvegardé. Persister brouillon en `localStorage` par `project.id`.

### 5. Session expirée = brief perdu
- **Où** : `SessionExpiredDialog` + `MissionBrief`.
- **Problème** : si le token expire pendant la rédaction, la modale force une reconnexion qui unmount le formulaire ⇒ perte des non-sauvés.
- **Fix** : flush auto-save local avant de montrer la modale ; restaurer le brouillon au retour. Ajouter un `beforeunload` en cas de modifs pendantes.

### 6. Tâches longues sans progression
- **Où** : scoring IA (`useLinkedInScoring`), enrichissement (`enrich-vivier-contacts`), génération brief (`BriefWizard`).
- **Problème** : 30 s+ sans feedback, juste un spinner. L'utilisateur clique à nouveau, double-lance.
- **Fix** : barre de progression `x/10 profils scorés`, state `queued | running | done` par vague (le hook gère déjà 3 vagues de 10). Désactiver le bouton pendant la durée. Toast final avec nombre de succès/échecs.

### 7. Erreurs génériques sans action
- **Où** : `toast.error("Une erreur est survenue")` — 40+ occurrences.
- **Problème** : pas de cause, pas d'action. L'utilisateur ne sait pas s'il peut relancer ou doit contacter le support.
- **Fix** : normaliser les erreurs via un mapper `humanizeError(err)` (déjà partiel pour Unipile). Chaque toast d'erreur doit avoir : cause courte + action (`Réessayer` / `Configurer` / `Signaler`). Pour 401/403, router automatiquement vers /settings.

### 8. InMail balance : erreur silencieuse
- **Où** : `useInMailBalance` (hook), utilisé dans `MissionOutreach`.
- **Problème** : `error` renvoyée par le hook n'est affichée nulle part. Si la balance échoue à charger, l'utilisateur voit un 0 faux et pense ne plus avoir de crédits.
- **Fix** : afficher l'erreur avec un bouton `Rafraîchir`. Distinguer "balance indisponible" vs "0 crédits".

### 9. Empty states sans CTA
- **Où** : `InboxEmpty`, `PipelineEmpty`, `InsightsEmpty`, `VivierEmpty`.
- **Problème** : juste un texte "Aucun message" / "Aucun candidat". Pas de prochaine étape.
- **Fix** : copier le pattern de `EmptyMissionState` (texte + illustration + CTA principal) :
  - Inbox : `Aucun message — Lancez une séquence` → `/missions/:id/outreach`
  - Pipeline : `Aucun candidat — Sourcez des profils` → `/missions/:id/sourcing`
  - Vivier : `Aucun prospect — Importez un CSV ou connectez Apollo`

### 10. Destructive sans undo
- **Où** : suppression mission, retrait candidat shortlist, archive séquence.
- **Problème** : AlertDialog demande confirmation, puis l'action est irréversible. Double cognitive load (modal + peur de perdre).
- **Fix** : remplacer l'AlertDialog par un snackbar `Mission supprimée · Annuler` (5 s) + soft-delete côté DB (flag `deleted_at`). Garder AlertDialog uniquement pour les suppressions vraiment destructives (facturation, invitations déjà envoyées).

---

## 🟠 Frictions secondaires

### 11. 3 patterns de filtrage coexistent sans guidance
- Manuel (`SearchFiltersPanel`), IA (`AutoFillFiltersButton`), presets (`FilterPresetsManager`).
- Fix : ajouter une 1ʳᵉ étape `Choisir une approche` au 1ᵉʳ usage, puis mémoriser la préférence.

### 12. Boutons icon-only sans `aria-label`
- Spot-check : `LinkedInSearch.tsx`, `MissionBentoDashboard.tsx`, `AppSidebar.tsx:236-249` (Settings/Logout footer).
- Fix : wrapper `<IconButton label="…">` avec Tooltip et `aria-label` obligatoires via TS.

### 13. Ctrl+K non-découvrable
- `AgentDrawer` écoute Ctrl+K mais l'indice n'apparaît que dans la sidebar expanded.
- Fix : modal `?` dans le header listant tous les shortcuts + toast de première visite "Tip: Ctrl+K pour l'assistant".

### 14. Progress bar de mission trop discrète
- `MissionProgressBar` : ratio `5/8` en subtitle minuscule.
- Fix : mini-barre de progrès sous le label + tooltip expliquant les tabs verrouillés ("Complétez le Brief avant Sourcing").

### 15. Settings & Logout relégués en footer
- `AppSidebar.tsx:233-250` : sur mobile collapsed, quasi invisibles.
- Fix : déplacer vers un dropdown `UserMenu` en header (`AppHeader.tsx`) avec avatar + Settings + Logout + Aide.

### 16. Densité d'information excessive
- `VivierList.tsx` (2362 lignes), `ATSDashboard.tsx` (1064 lignes), `ScorecardTab.tsx` (1111 lignes).
- Fix : extraire en sous-composants lazy-loaded ; stats secondaires en drawer, pas dans la vue principale.

### 17. Trois vues candidat différentes
- `CandidateDetailModal`, `ProfileDetailSheet`, `ScorecardFullPage`.
- Fix : unifier sur `ProfileDetailSheet` (déjà le plus complet). Garder `ScorecardFullPage` uniquement pour l'impression.

### 18. Deux copilotes IA
- `AgentDrawer` (global) + `MissionCopilot` (bas de page mission).
- Fix : documenter le rôle de chacun (ou fusionner). Si `MissionCopilot` est contextuel, intégrer son contenu dans `AgentDrawer` comme suggestion par défaut quand en mission.

### 19. Labels en anglais dans une UI en français
- "Dashboard", "Pipeline", "Inbox", "Strong Yes / Maybe / No" (`ScorecardTab.tsx:49-55`).
- Fix : traduire ("Tableau de bord", "Pipeline" reste OK, "Messagerie", "Très favorable / À creuser / Non"). Établir un glossaire `fr.json` central.

### 20. Tutoiement / vouvoiement incohérent
- `OnboardingWizard` tutoie, `MissionCopilot` vouvoie.
- Fix : trancher (le vouvoiement est plus sûr en B2B). Créer une règle CLAUDE.md.

---

## 🟡 Observations légères

- **Mobile** : 8 tabs mission + 5 items sidebar = écrans de 360 px saturés. Prévoir un mode "mission focus" qui cache la sidebar.
- **Contraste** : charts Recharts en `hsl(var(--muted-foreground))` sur fond light → ratio &lt; 4.5:1 probable. Lancer aXe/Lighthouse.
- **Drag & drop** : absent alors que pertinent pour `MissionPipeline` (kanban), `SequenceBuilder` (ordre), `MissionProcess` (étapes — déjà fait via temp negative order).
- **Recherche globale** : pas de `Cmd+K` pour sauter à une mission par nom. La sidebar ne scale pas au-delà de ~20 missions.
- **Notifications** : pas de centre de notifications en-app. Tout passe par toasts éphémères et la page Inbox.

---

## Plan d'action recommandé (3 sprints)

### Sprint 1 — Clarté immédiate (1 semaine)
1. Déplacer LinkedIn connect au début de l'onboarding (#1).
2. Sous-titres sidebar + renommer l'onglet mission "Pipeline" → "Candidats" (#2, #3).
3. Badge "Enregistré" sur tous les auto-save (#4) + flush avant SessionExpiredDialog (#5).
4. Humanizer d'erreurs centralisé + bouton action sur chaque toast (#7).
5. Afficher `useInMailBalance.error` (#8).

### Sprint 2 — Feedback & confiance (1 semaine)
6. Barre de progression sur toutes les tâches >5 s (#6).
7. Empty states avec CTA sur Inbox, Pipeline, Insights, Vivier (#9).
8. Snackbar undo pour suppressions soft-deletable (#10).
9. Modal `?` shortcuts + tip Ctrl+K au premier login (#13).
10. UserMenu dans header (avatar + Settings + Logout + Aide) (#15).

### Sprint 3 — Cohérence & densité (2 semaines)
11. Wizard unifié de filtrage (manuel/IA/preset) (#11).
12. Audit a11y complet + wrapper `IconButton` obligatoire (#12).
13. Découper `VivierList`, `ATSDashboard`, `ScorecardTab` (#16).
14. Unifier sur `ProfileDetailSheet` (#17).
15. Décider sort `AgentDrawer` vs `MissionCopilot` (#18).
16. Glossaire i18n FR centralisé (#19, #20).

---

## Ce qui est déjà solide

- `EmptyMissionState` est un excellent modèle (illustration + texte + CTA).
- `AlertDialog` shadcn utilisé partout pour les destructives (pas de `window.confirm`).
- `ErrorBoundary` au root + `SectionErrorBoundary` par onglet mission.
- Auto-save debounced 800 ms (il manque juste le feedback visuel).
- Code splitting propre : toutes les pages lourdes en `lazy()` (`src/App.tsx:22-42`).
- Animation de transition entre tabs mission (`framer-motion` dans `MissionWorkspace.tsx:162-220`) — sensation fluide.
- `MissionProgressBar` step connectors + locked state — idée juste, exécution à peaufiner.
- `/candidates` redirige vers `/pipeline` — une seule entrée pour les candidats.
- Routes legacy (`/outreach`, `/ats`) redirigées — pas de 404 historiques.
