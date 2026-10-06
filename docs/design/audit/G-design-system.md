# Audit G : Design system

> Revue du 25 septembre 2026, en lecture seule, sur `main` au commit `5882084` (instantané `git archive`), avant les lots 1 et 2 du chantier design. Les scripts et mesures cités (`ds-scan.cjs`, `gencheck.py`, `contrast2.py`, `rt/`) sont restés dans le répertoire de travail de la session et ne sont pas versionnés. Priorités propres à cette revue : P0 ici correspond au P1 des autres annexes, P1 au P2, P2 au P3. Statut de chaque constat : `docs/design/02-constats.md`.

Code relu : `main` au commit `58820844`, le 25 septembre 2026.
Référence : inventaire du 9 septembre (branche origin/claude/app-details-exhaustifs-s6nf9t, docs/design-system/).
Cible : maquette « Konekt Design System » du 21 septembre, maquette Mission du 25 septembre.

État : terminé le 25/09 (reprise après interruption du premier auditeur ; scripts et sorties dans le scratchpad).

## 0. Méthode

- Code audité : **main = HEAD 58820844** (origin/main identique au 25/09). Pendant l'audit, les lots 1 et 2 du chantier design modifiaient l'arbre de travail du dépôt (`src/index.css`, `tailwind.config.ts`, `src/main.tsx`, `index.html`, `package.json`, `.github/workflows/ci.yml`, nouveaux `docs/design/` et `scripts/design/ratchet.mjs`, horodatés 08:43 à 08:54). Ces changements ne sont pas audités ici, et cet audit n'a rien écrit dans le dépôt. Toutes les mesures portent sur un instantané `git archive 58820844` extrait dans le scratchpad (`snap/`).
- Relevés de classes : `ds-scan.cjs` parcourt l'AST TypeScript des 578 fichiers `.ts/.tsx` de `src/` (384 `.tsx`, 195 `.ts`, 148 863 lignes) et ne compte que les classes présentes dans des chaînes (littéraux, gabarits), pas dans les commentaires. Une classe est comptée par occurrence, variantes (`md:`, `hover:`, `dark:`) retirées pour les totaux par utilitaire. Sortie : `ds-scan.json`.
- Primitives : `ast-audit.cjs` (repris du premier auditeur, repointé sur l'instantané) et `btn-heights.cjs`.
- CSS réel : compilation Tailwind 3.4.17 avec la configuration du dépôt (`tw/main.css`, identique octet pour octet à une compilation faite avant la modification concurrente). `gencheck.py` liste les classes du code absentes du CSS compilé.
- Rendu : `rt/runtime-check.mjs` charge le CSS compilé dans Chromium 1194 (Playwright) et lit les styles calculés en sombre (`:root`) et en clair (`.light`). Sortie : `rt/runtime-check.out.json`.
- Contrastes : WCAG 2.x, calculés sur les valeurs HSL des jetons, composition alpha comprise (`contrast2.py`).

## 1. Chiffres

| Mesure | 9 sept. (inventaire) | main, 25 sept. |
|---|---:|---:|
| Fichiers `.ts/.tsx` sous `src/` | 532 | 579 (384 `.tsx`) |
| `<Button>` / `<button>` bruts | 341 / 625 | **325 / 633** (178 fichiers) |
| `Button` surchargés en hauteur par `className` | 4 relevés dans le kit | **155 (48 %)** ; `Input` 106 (71 %) ; `SelectTrigger` 65 (79 %) |
| `variant="primary"` du Button | | **0** |
| Tailles `text-[Npx]` | 1 122 | **1 124** (24 valeurs, 155 fichiers) |
| `text-[10px]` / `text-3xs` (même taille) | 380 / 181 | 379 / 180 |
| Variantes `dark:` (toutes mortes) | non relevé | **53** (17 fichiers) |
| Classes cassées en sombre (opacité sur jeton à alpha) | non relevé | **96** (≥ 24 fichiers) |
| Variables appelées sans exister | `--k-bad` | `--k-bad`, **`--success`, `--info`** (12 appels) |
| Classes sans CSS généré | non relevé | 6 motifs, 14 occurrences |
| Couleurs de palette brute | 394 | 433 (relevé AST, préfixes élargis) ; `bg-emerald-500` 76 |
| Rayons distincts (tous les coins) | 7 + arbitraires | 16 valeurs ; 60 % des 1 759 classes sur les 3 paliers cibles |
| z-index arbitraires | 10 valeurs | 10 valeurs, 27 occurrences ; 13 calques plein écran faits main |
| Familles de police chargées / utilisées | 5 déclarées | 6 chargées, 5 utilisées (Space Grotesk jamais) |
| Fichiers framer-motion / respectant le mouvement réduit | | 54 / **6** (+ 2 fichiers hors framer : `JobScoreDisplay`, `useCountUp`) |
| États vides écrits à la main (« Aucun/Aucune ») / `EmptyState` | 189 / 6 fichiers | 194 (118 fichiers) / 6 fichiers |
| Fichiers morts dans `ui/` | 15 | **16** (1 508 lignes) + 4 dans `layout/` |
| Systèmes de toast montés | 1 (inexact) | **2** (sonner depuis le 4 sept.) |

Contrastes relevés (WCAG, § 3) : anneau de focus 2,28:1 (sombre) et 2,69:1 (clair), pour un seuil de 3 ; statuts en texte dans le thème clair de 1,90 à 3,47:1 ; `text-destructive` en sombre 3,54:1 ; les 290 `text-muted-foreground/NN` de 1,44 à 3,88:1.

## 2. Jetons (src/index.css)

### 2.1 Inventaire (main, 82 variables sur `:root`, 68 redéclarées sous `.light`)

| Jeu | Variables | Définition | Consommation réelle |
|---|---:|---|---|
| shadcn (`--background` … `--ring`, `--radius`) | 20 | triplets HSL, mappés en couleurs Tailwind | massive : `text-muted-foreground` 2 392, `border-border` 1 492, `text-foreground` 1 427, `bg-muted` 702, `bg-background` 446, `bg-foreground` 415, `destructive` 747 classes |
| `--sidebar-*` | 8 | triplets HSL | 119 classes dans 15 fichiers ; `sidebar-primary` et `sidebar-primary-foreground` : 0 |
| `--status-*` (success, warning, info × DEFAULT, foreground, muted) | 9 | triplets HSL | 1 244 classes (success 489, warning 454, info 301) ; les trois `-muted` : 0 classe, 21 `var()` |
| `--skalr-*` (marque) | 5 | triplets HSL, exposés en `brand.*` | `brand-purple` 123 (25 fichiers), `brand-pink` 11, `brand-cyan` 8, `brand-blue` 2, `brand-green` 0 |
| `--brand-linkedin*`, `--brand-whatsapp` | 3 | triplets HSL | 56 classes |
| `--landing-*` | 3 | triplets HSL | 1 usage chacun (landing) |
| `--chart-1..5` | 5 | triplets HSL, identiques en clair | **0 usage** (`chart.tsx` mort) |
| `--k-*` (refonte recherche) | 19 | valeurs entières `hsl()`/`rgba()` | 421 `var()` dans **7 fichiers**, tous sous `outreach/search` ou `outreach/FilterComponents.tsx` |
| `--shadow-*` | 8 | ombres entières | via `shadow-*` (voir § 10) |
| `--tracking-normal`, `--spacing` | 2 | | **0 usage** |

Tableau détaillé variable par variable : `tokens-usage.txt` (scratchpad).

### 2.2 Doublons entre jeux

| Valeur | Déclarée sous |
|---|---|
| `142 71% 45%` | `--status-success`, `--skalr-green` (et `--brand-whatsapp` à 1 point près : `142 70% 49%`) |
| `217 91% 60%` | `--status-info`, `--skalr-blue` |
| `40 3% 18%` (sombre), `40 3% 95%` (clair) | `--secondary`, `--muted` |
| `0 0% 98%` / `40 3% 11%` | `--primary` = `--foreground` = `--card-foreground` = `--popover-foreground` = `--accent-foreground` = `--sidebar-primary` |
| surfaces sombres | `--k-surface` 11 % ≈ `--background` 11 % ; `--k-surface-2` = `--card` 14 % ; `--k-surface-3` 16,5 % ≈ `--popover` 16 % ; `--k-bg` 8,5 % ≈ `--sidebar-background` 8 % |
| textes sombres | `--k-text` 97 % ≈ `--foreground` 98 % ; `--k-text-muted` 55 % ≈ `--muted-foreground` 56 % |
| filets sombres | `--k-hairline-hover` `rgba(255,255,255,.10)` = `--border` `0 0% 100% / 10%` |
| statuts | `--k-success` `145 55% 48%` vs `--status-success` `142 71% 45%` ; `--k-warn` `38 92% 55%` vs `--status-warning` `45 93% 47%` : deux verts et deux ambres |
| redéclarations inutiles sous `.light` | 13 variables identiques au sombre (`--destructive`, `--destructive-foreground`, `--chart-1..5`, `--status-success`, `--status-warning`, `--status-info` et leurs `-foreground`) |

Hors jetons : 433 classes de palette Tailwind brute dans 78 fichiers (emerald 156 dans 48 fichiers, amber 89, green 28, purple 28, violet 27, blue 24, cyan 23, red 17…), en tête `bg-emerald-500` 76. Fichiers les plus chargés : `outreach/JobScoreDisplay.tsx` 46, `dashboard/CandidateAvatar.tsx` 24, `dashboard/MissionCompanyLogo.tsx` 24, `pages/Calendar.tsx` 19, `hooks/useChatIntents.ts` 18. 35 littéraux hexadécimaux dans 9 fichiers (13 légitimes dans `assistant-ui/connector-logos.tsx`).

### 2.3 Jetons appelés sans exister

| Appel | Où | Effet mesuré |
|---|---|---|
| `hsl(var(--success))`, `hsl(var(--success) / 0.15)` | `dashboard/Sparkline.tsx:30` (ton `positive`), `outreach/JobScoreDisplay.tsx:195`, `onboarding/SceneOrganization.tsx:513`, `onboarding/SceneLaunch.tsx:45` | Chromium : `stroke` calculé `none`, fond `transparent`, couleur héritée. Les courbes `positive` du Dashboard (`DashboardWeekHighlight.tsx:355,365`) et l'anneau de score ≥ 70 ne sont pas tracés, dans les deux thèmes. |
| `hsl(var(--info))` | `dashboard/Sparkline.tsx:33` (ton `info`, utilisé `DashboardWeekHighlight.tsx:346`) | idem, `stroke: none` |
| `var(--k-bad,#e06666)` | `outreach/search/SourcingFlow.tsx:724,873,889` | la variable n'est déclarée nulle part : le repli `#e06666` s'applique toujours (rgb 224,102,102), identique en clair et en sombre |

Cause : la couleur Tailwind s'appelle `success` mais la variable s'appelle `--status-success`. Le nom de la classe ne permet pas de deviner celui de la variable.

### 2.4 Jetons à alpha intégré : 96 classes cassées en sombre

En sombre, `--border` (`0 0% 100% / 10%`), `--input`, `--ring`, `--sidebar-border`, `--sidebar-ring` portent déjà leur alpha. Tailwind génère `border-border/50 { border-color: hsl(var(--border) / 0.5) }` (vérifié dans le CSS compilé), soit `hsl(0 0% 100% / 10% / 0.5)` : valeur invalide au calcul, la propriété retombe sur sa valeur initiale.

Mesuré dans Chromium, thème sombre :

| Classe | Attendu | Rendu |
|---|---|---|
| `border-border` | filet blanc 10 % | `rgba(255,255,255,0.1)` (correct) |
| `border-border/50` | filet blanc 5 % | **`rgb(250,250,250)`**, bordure blanche opaque (`currentColor`) |
| `divide-border/60` | séparateur 6 % | **`rgb(250,250,250)`** |
| `bg-border/40` | trait 4 % | **transparent**, le trait disparaît |
| `ring-border/40` | anneau 4 % | **`box-shadow: none`** |

En clair, `--border` est opaque et les mêmes classes rendent correctement (`rgba(230,230,229,0.5)`).

Occurrences : 96 dans au moins 24 fichiers. `border-border/60` 32, `border-border/50` 18, `border-border/30` 11, `border-border/40` 10, `border-border/70` 5, `border-border/5` 4, `bg-border/40` 3, `border-border/8` 2, `divide-border/60` 2, `divide-border/40` 2, `border-border/25` 2, `ring-border/40` 2, `bg-border/60` 2, `divide-border/30` 1. Exemples : `agent/AgentChatPanel.tsx:440`, `ai/CreditCostBadge.tsx:39`, `ats/ATSDroppableColumn.tsx:71`, `outreach/CandidateHistoryPanel.tsx:95`, `assistant-ui/thread.tsx:444`, `outreach/inbox/ChatListItem.tsx:172`, `outreach/inbox/MessageView.tsx:1017`.

### 2.5 Classes qui ne génèrent aucun CSS (compilation réelle)

| Classe | Occ. | Où | Pourquoi |
|---|---:|---|---|
| `bg-foreground/8` | 4 | `outreach/CandidateSequencesPanel.tsx:51`, `outreach/SequencesList.tsx:782,929` | échelle d'opacité Tailwind 3.4 : pas de 5 (`/8` n'existe pas) ; rendu `transparent` vérifié |
| `border-border/8` | 2 | `agent/AgentConversationsList.tsx:40,97` | idem |
| `bg-destructive/8` | 1 | `outreach/inbox/MessageView.tsx:742` | idem |
| `w-4.5`, `h-4.5` | 3 + 3 | `outreach/sequence/nodes/WorkflowStepNode.tsx:85,87,89` | pas de palier 4.5 dans l'échelle d'espacement : les icônes lucide gardent leur taille native de 24 px |
| `line-clamp-8` | 1 | `pages/ScorecardFullPage.tsx:688` | l'échelle `line-clamp` s'arrête à 6 |
| `animate-[shimmer-spin_…]` | 1 | `magicui/shimmer-button.tsx:55` | la classe est générée, mais le `@keyframes shimmer-spin` n'est déclaré nulle part : aucune animation |

### 2.6 Variantes `dark:` mortes : 53 occurrences, 17 fichiers

`tailwind.config.ts:4` déclare `darkMode: ["class"]`, mais aucune classe `.dark` n'est jamais posée : le sombre vit sur `:root`, le clair sous `.light`, posée par `main.tsx:108-109`, `AppSidebar.tsx:79-80`, `layout/NavigationPalette.tsx:83-85` et forcée par `SkalrLanding.tsx:90`. Toutes les variantes `dark:` sont donc inertes, et c'est la valeur « claire » qui s'affiche dans le thème sombre par défaut.

| Fichier | Occ. | Valeur rendue en sombre (thème par défaut) |
|---|---:|---|
| `dashboard/CandidateAvatar.tsx:32-39` | 8 | initiales `text-{blue,emerald,violet,amber,rose,cyan,indigo,pink}-700` sur tuile `/15` |
| `dashboard/MissionCompanyLogo.tsx:48-55` | 8 | `text-*-600` / `amber-700` sur tuile `/10` |
| `outreach/JobScoreDisplay.tsx:574,617,619,641,642,651,696,697` | 8 | `text-emerald-600`, `text-amber-600` |
| `hooks/useChatIntents.ts:52-77` | 6 | pastilles d'intention `text-{emerald,red,blue,purple,amber}-700`, `text-gray-600` |
| `calendar/CandidateAutocomplete.tsx:109,218,230` | 3 | `text-emerald-600/700` |
| `calendar/EventDetailSheet.tsx:64,78,238` | 3 | `text-violet-600`, `text-cyan-600` |
| `outreach/search/LinkedInReconnectBanner.tsx:62,63,79` | 3 | **`text-amber-900`** sur `bg-amber-500/10` |
| `pages/Calendar.tsx:93,109,805` | 3 | `text-violet-600`, `text-cyan-600` |
| `layout/NavigationPalette.tsx:182-183` | 2 | `dark:hidden` / `dark:block` : l'icône Soleil s'affiche toujours, la Lune jamais |
| `pages/Tasks.tsx:336,358` | 2 | `text-emerald-600/700` |
| `assistant-ui/tool-uis.tsx:216`, `outreach/LinkedInSearch.tsx:1284`, `outreach/inbox/ChatListItem.tsx:282`, `outreach/result-card/ProfileDetailSheet.tsx:976`, `pedigree/PedigreeRequirementsEditor.tsx:248`, `settings/PedigreePresetsSettings.tsx:75`, `sidebar/todo/FirstStepsSection.tsx:145` | 1 chacun | `text-amber-700`, `text-gray-600`, `text-emerald-600/700`, `text-green-600` |

Il n'existe plus de `bg-white dark:bg-…` dans main (toutes les variantes `dark:` portent sur `text-*`, sauf NavigationPalette). Mais 7 `bg-white` restent codés en dur, qui rendent une surface blanche dans le thème sombre : `assistant-ui/connector-menu.tsx:107`, `assistant-ui/tool-uis.tsx:139,183`, `candidates/CompanyLogo.tsx:51`, `dashboard/MissionCompanyLogo.tsx:113`, `outreach/enrollment-preview/CandidateContextHeader.tsx:61`, `settings/NotionConnectionCard.tsx:125` (pastilles de logo, intentionnelles pour la plupart). Contrastes de ces valeurs claires sur fond sombre : § 3.3.

Deux bascules de thème coexistent : `AppSidebar.tsx:76-86` persiste le choix dans `localStorage['konekt-theme']`, `NavigationPalette.tsx:80-89` ne le persiste pas et ne met pas à jour l'état `isDark` de la barre latérale. `index.html:9` annonce `theme-color #0a0a0a`, alors que le fond vaut `#1d1c1b`.

### 2.7 Toasts : deux systèmes montés, thème et calques

- `App.tsx:149-150` monte **les deux** : `<Toaster />` (Radix, `ui/toaster.tsx`) et `<Sonner />` (`ui/sonner.tsx`). L'inventaire du 9 septembre affirmait que sonner n'était pas monté : c'était faux, `<Sonner />` est monté depuis le commit 405d2eb8 du 4 septembre (ligne 149 de `App.tsx` sur la branche d'inventaire elle-même). Sonner sert 132 fichiers (`import { toast } from 'sonner'`). Le Toaster Radix ne sert plus que `pages/Auth.tsx` et `pages/SkalrLanding.tsx` via `@/hooks/use-toast`.
- **Thème des toasts sonner** : `ui/sonner.tsx:7` lit `useTheme()` de next-themes 0.3.0, sans aucun `ThemeProvider` dans l'arbre (0 occurrence dans `src/`). next-themes renvoie alors son contexte par défaut `{ setTheme, themes: [] }` (vérifié dans `node_modules/next-themes/dist/index.mjs`), donc `theme = "system"` : sonner pose `data-theme` d'après `prefers-color-scheme` du système d'exploitation, pas d'après le thème de l'application. Les `classNames` de `sonner.tsx:15-19` recolorent le fond, le texte et le filet avec les jetons, mais le bouton de fermeture, les couleurs `richColors` et les variables internes suivent le thème du système. Sur un poste en thème clair avec l'application en sombre (le défaut), le toast mélange les deux thèmes.
- **Calques** : sonner injecte `[data-sonner-toaster] { z-index: 999999999 }` (runtime CSS de sonner 1.7.4). Les toasts passent donc **au-dessus** des dialogues (`z-[9998]`/`z-[9999]`). Le Toaster Radix reste à `z-[100]` (`ui/toast.tsx:17`), sous les dialogues, mais il ne sert que deux pages sans dialogue.
- **Mesuré** (banc `rt/sonner/` : React 18.3.1, sonner 1.7.4, next-themes 0.3.0, `@radix-ui/react-dialog` 1.1.15 assemblés par esbuild et rendus dans Chromium, application en sombre). next-themes renvoie `theme = "system"`. Sonner pose `data-theme="light"` quand l'OS est clair et `"dark"` quand il est sombre : **le toast suit l'OS, pas l'application**. Son conteneur est rendu dans `#root` avec `z-index: 999999999`, donc au-dessus des dialogues. Mais quand un dialogue Radix modal est ouvert, `body` passe en `pointer-events: none`, et sonner ne rétablit pas `pointer-events: auto` sur ses toasts. `elementFromPoint` au centre du bouton « Annuler » renvoie le voile du dialogue. Un vrai clic souris **ne déclenche pas l'action du toast et ferme le dialogue** (clic extérieur). 11 toasts de l'application portent une action (`LinkedInAccountsContext.tsx:150`, `lib/invokeWithCredits.ts:32`, `hooks/useATSData.ts:451`, `hooks/useMessagesInbox.ts:1573`, `sidebar/todo/ApprovalsSection.tsx:102`, `hooks/useLinkedInSearchActions.ts:1080,1115`, `outreach/EnrollmentPreviewModal.tsx:221`, `outreach/SequencesList.tsx:350`, `outreach/AddToPipelineModal.tsx:169,177`). `AddToPipelineModal` ferme son dialogue juste après le toast (l.186), et `EnrollmentPreviewModal` est un calque fait main (`fixed inset-0 z-[4000]`, l.631) qui ne bloque pas les clics. Le défaut touche tout toast à action émis pendant qu'un dialogue Radix reste ouvert, par exemple le toast de crédits de `invokeWithCredits.ts`, qui peut partir de n'importe où.

## 3. Contraste (clair et sombre)

Ratios WCAG 2.x calculés sur les jetons de main, alpha composé sur le fond réel (`contrast2.py`). Presque tout le texte de l'application mesure entre 10 et 14 px, c'est donc le seuil de 4,5:1 qui s'applique (3:1 pour les indicateurs non textuels). Valeurs en gras : sous le seuil.

Couleurs de référence. Sombre : fond `#1d1c1b`, carte `#252423`, muted `#2f2e2d`, texte secondaire `#91908d`. Clair : fond `#fafafa`, carte `#ffffff`, muted `#f3f2f2`, texte secondaire `#797672`. Statuts identiques dans les deux thèmes : success `#21c45d`, warning `#e7b008`, info `#3c83f6`, destructive `#dc2828`.

### 3.1 Texte secondaire

| Paire | Sombre | Clair |
|---|---:|---:|
| `muted-foreground` / `background` | 5,29 | **4,31** |
| `muted-foreground` / `card` | 4,83 | 4,50 (4,5006) |
| `muted-foreground` / `popover` | 4,52 | 4,50 |
| `muted-foreground` / `muted` | **4,21** | **4,03** |
| `muted-foreground` / `accent` (fond de survol) | **3,91** | **3,86** |
| `muted-foreground/80` / `background` | **3,88** | **3,02** |
| `muted-foreground/70` / `background` | **3,28** | **2,56** |
| `muted-foreground/60` / `background` | **2,76** | **2,19** |
| `muted-foreground/50` / `background` | **2,31** | **1,89** |
| `muted-foreground/40` / `background` | **1,93** | **1,65** |
| `muted-foreground/30` / `background` | **1,61** | **1,44** |
| `--k-text-muted` / `--k-surface` | 5,18 | **3,62** |
| `--k-text-placeholder` / `--k-surface` | **3,01** | **2,63** |
| `sidebar-foreground` / `sidebar` | 12,95 | 7,70 |

Le texte secondaire nu passe en sombre et frôle le seuil en clair. Mais il est très souvent atténué : 290 `text-muted-foreground/NN` dans 99 fichiers (`/70` 86, `/60` 61, `/40` 50, `/30` 43, `/50` 30, `/80` 18), plus 197 `text-foreground/NN` dans 69 fichiers. **Toutes ces atténuations échouent dans les deux thèmes.**

### 3.2 Statuts

| Paire | Sombre | Clair |
|---|---:|---:|
| `text-success` / `background` | 7,39 | **2,20** |
| `text-warning` / `background` | 8,56 | **1,90** |
| `text-info` / `background` | 4,68 | **3,47** |
| `text-info` / `card` | **4,27** | **3,63** |
| `text-destructive` / `background` | **3,54** | 4,59 |
| `text-destructive` / `card` | **3,23** | 4,80 |
| `text-brand-purple` / `background` | **3,15** | 5,16 |
| `text-success` sur `bg-success/10` | 6,29 | **2,02** |
| `text-warning` sur `bg-warning/10` | 7,10 | **1,78** |
| `text-info` sur `bg-info/10` | **4,16** | **3,11** |
| `text-destructive` sur `bg-destructive/10` | **3,31** | **3,95** |
| `text-success` sur `success-muted` | 5,02 | **2,14** |
| `text-warning` sur `warning-muted` | 5,70 | **1,87** |
| `text-info` sur `info-muted` | **4,04** | **3,15** |
| aplat : `success-foreground` (blanc) / `success` (Badge `success`) | **2,30** | **2,30** |
| aplat : `info-foreground` (blanc) / `info` (Badge `info`) | **3,63** | **3,63** |
| aplat : `warning-foreground` / `warning` | 8,82 | 8,82 |
| aplat : `destructive-foreground` / `destructive` | 4,59 | 4,59 |
| `text-success-foreground` employé comme texte sur `bg-success/15` | 13,13 | **1,18** |
| `text-warning-foreground` employé comme texte sur `bg-warning/15` | **1,39** | 15,20 |

Les statuts ont une seule valeur pour les deux thèmes, calibrée pour le sombre. En clair, success, warning et info échouent tous en texte : 770 `text-{success,warning,info,destructive}` dans 164 fichiers, et 363 fonds teintés `bg-*/5|10|15` qui les accompagnent. En sombre, c'est `destructive` qui échoue en texte (3,54), et c'est la couleur de toutes les erreurs (305 `text-destructive`). Les aplats success et info portent du blanc à 2,30 et 3,63. 112 `text-*-foreground` servent de couleur de texte hors de leur aplat : le blanc de `success-foreground` sur une teinte claire donne 1,18, le quasi-noir de `warning-foreground` sur une teinte sombre donne 1,39 (exemple : `outreach/search/RefineSearchModal.tsx`, relevé par l'auditeur C).

### 3.3 Valeurs claires rendues en sombre (variantes `dark:` mortes)

| Emplacement | Couleur rendue | Ratio (sombre) |
|---|---|---:|
| `outreach/search/LinkedInReconnectBanner.tsx:63` (texte d'alerte) | `text-amber-900` sur `amber-500/10` | **1,57** |
| `LinkedInReconnectBanner.tsx:62,79` (icônes) | `text-amber-700` | **2,84** |
| `dashboard/CandidateAvatar.tsx:32-39` (initiales, 8 teintes) | `text-*-700` sur `*-500/15` | **1,84 à 2,56** |
| `dashboard/MissionCompanyLogo.tsx:48-55` | `text-*-600` sur `*-500/10` | **2,44 à 2,92** |
| `hooks/useChatIntents.ts:52-77` (pastilles d'intention de l'inbox) | `text-*-700`, `text-gray-600` sur `*/10` | **2,03 à 2,84** |
| `outreach/inbox/ChatListItem.tsx:282` (« Archivée ») | `text-gray-600` sur `gray-500/10` | **2,03** |
| `outreach/JobScoreDisplay.tsx` | `text-emerald-600` sur carte | **4,11** |

### 3.4 Indicateurs non textuels (seuil 3:1)

| Paire | Sombre | Clair |
|---|---:|---:|
| anneau de focus `--ring` / `background` | **2,28** (blanc 25 % → `#555554`) | **2,69** (`#9c9a96`) |
| anneau de focus `--ring` / `card` | **2,28** | **2,81** |
| `border` / `background` | 1,34 | 1,20 |
| `input` (bord de champ) / `background` | **1,44** | **1,20** |
| `--k-hairline-focus` / `--k-surface` (focus des champs `--k`) | **1,54** | **1,75** |

Mesure Chromium : le `:focus-visible` global (`index.css:223-226`) rend `outline: 2px solid rgba(255,255,255,0.25)` en sombre et `rgb(156,154,150)` en clair. Aucun des deux ne franchit 3:1. Le bord des champs (1,44 et 1,20) n'identifie pas le champ (WCAG 1.4.11). Le filet décoratif `border` n'est pas soumis au seuil.

## 4. Typographie

### 4.1 Familles : chargées, déclarées, utilisées

| Famille | Chargée (`index.html:22-30`) | Déclarée | Utilisée |
|---|---|---|---|
| Instrument Sans | 400, 500, 600, 700 | `font-sans` (défaut du `body`, `index.css:235`) | tout le texte courant ; `font-sans` explicite 2 fois |
| Outfit | 400 à 900 (6 graisses) | `font-display` ; règle globale `h1, h2, h3 { font-family: 'Outfit'; font-weight: 700 }` (`index.css:241-244`) ; repli de `font-brand` | 161 `font-display` dans 62 fichiers (ats 44, missions 27, dashboard 18) ; tous les titres h1/h2/h3 et les titres de primitives (voir 4.2) |
| Space Mono | 400, 700 | `font-mono` | 103 `font-mono` dans 40 fichiers (`SourcingFlow.tsx` 21, `MyLinkedInAccount.tsx` 11) + 2 `style={{ fontFamily }}` (`onboarding/SceneLaunch.tsx:55,61`) |
| Instrument Serif | romain et italique | `font-serif`, `.font-editorial` (`index.css:296-298`) | 19 `font-editorial` dans 12 fichiers (onboarding 8, `SkalrLanding`, `ClientPortalV2`, `CreateMissionV2`, `ProjectsListV2`) ; `font-serif` 0 |
| Bricolage Grotesque | 600, 700, 800 (axe opsz) | `font-brand` | 3 usages : `SkalrLanding.tsx`, `landing/LandingProductDemo.tsx` |
| **Space Grotesk** | 300 à 700 (5 graisses) | **nulle part** | **0** : chargée pour rien (`index.html:22,27`) |

Soit 6 familles et 22 variantes (famille × graisse × style) déclarées, en 4 feuilles Google Fonts préchargées sur toutes les pages (`rel=preload` puis bascule en feuille de style, donc non bloquantes). Le navigateur ne télécharge un fichier de police que si une page l'emploie : le coût tient surtout aux 4 requêtes et au mélange de trois familles de titrage (Outfit, Instrument Serif, Bricolage). La cible n'en garde que 2 (Instrument Sans 500/600/700, Space Mono 400/700), plus Bricolage éventuellement pour le titrage de marque.

### 4.2 La règle globale Outfit 700

- 184 titres bruts dans le JSX (33 `h1`, 61 `h2`, 90 `h3`). **179 redéfinissent leur graisse** par une classe (`font-bold` 114, `font-semibold` 49, `font-normal` 8, `font-black` 7, `font-medium` 1). Seuls 5 `h2` héritent vraiment du 700 de la règle.
- 56 de ces titres ajoutent `font-display`, ce qui est redondant avec la règle (10 `h1`, 19 `h2`, 27 `h3`). 12 la contournent par `font-editorial`.
- Les titres des primitives héritent aussi de la famille Outfit : `DialogTitle` (h2 Radix, 36 usages), `AlertDialogTitle` (h2, 44), `SheetTitle` (h2, 8), `CardTitle` (`<h3>`, 30), `EmptyState` (`<h2>`, `ui/EmptyState.tsx:46`), `PageHeader` (`<h1>`, `layout/PageHeader.tsx:50`). Leur `font-semibold` gagne sur la graisse, pas sur la famille.
- Effet : environ 300 titres rendus en Outfit, alors que la cible réserve toute l'interface à Instrument Sans. La règle n'apporte rien que les classes ne fassent déjà. Il suffit de la retirer pour que les titres basculent en Instrument Sans, sauf les 161 `font-display` à migrer.

### 4.3 Tailles

| Classe | Occ. | Fichiers | Taille |
|---|---:|---:|---|
| `text-xs` | 1 797 | 237 | 12/16 |
| `text-sm` | 664 | 206 | 14/20 (dont 43 dans 25 primitives de `ui/`) |
| `text-3xs` | 180 | 35 | 10/14 |
| `text-2xs` | 155 | 25 | 11/15 |
| `text-lg` | 80 | 49 | 18/28 |
| `text-base` | 62 | 42 | 16/24 (dont `Input` et `Textarea` : `text-base md:text-sm`) |
| `text-xl` / `text-2xl` / `text-3xl` / `text-4xl` / `text-5xl` / `text-6xl` / `text-7xl` | 51 / 44 / 16 / 25 / 16 / 5 / 1 | | titres, landing |

**Tailles arbitraires `text-[Npx]` : 1 124 occurrences dans 155 fichiers, 24 valeurs distinctes** : `text-[10px]` 379 (100 fichiers), `text-[11px]` 259 (73), `text-[12px]` 133, `text-[13px]` 112, `text-[11.5px]` 69, `text-[10.5px]` 39, `text-[14px]` 33, `text-[12.5px]` 27, `text-[15px]` 27, puis 9, 9.5, 13.5, 16, 17, 18, 20, 22, 24, 26, 28, 30, 32 px, `0.8rem`, `5.25rem`. `text-[10px]` (379) reste plus de deux fois plus fréquent que `text-3xs` (180), qui vaut exactement la même chose. Le commentaire « Bannit l'usage de text-[Npx] arbitraires » (`tailwind.config.ts:146`) n'a pas été suivi.

Fichiers les plus chargés : `pages/ClientPortalV2.tsx` 61, `outreach/EnrollmentPreviewModal.tsx` 55, `ats/candidate-detail/OverviewTab.tsx` 45, `missions/v2/CreateMissionV2.tsx` 36, `missions/v2/MissionBriefV2.tsx` 33, `missions/MissionHuntMode.tsx` 32, `assistant-ui/thread.tsx` 29, `outreach/search/SourcingFlow.tsx` 29, `missions/process/shared.tsx` 28, `outreach/search/SearchResultsPanel.tsx` 26. Par zone : outreach 371, missions 231, ats 165, pages 92, settings 70.

Graisses : `font-medium` 843, `font-bold` 706, `font-semibold` 446, `font-normal` 52, `font-black` 29, `font-extrabold` 2. Le `body` est déjà en 500 (vérifié : `font-weight` calculé 500), donc la plupart des 843 `font-medium` ne font rien. Autres signaux : `uppercase` 723 dans 162 fichiers, `tracking-wider` 640, `tabular-nums` 226.

### 4.4 Effet d'un passage de `text-sm` à 13 px

`text-sm` porte 664 occurrences, dont les primitives les plus rendues : base de `Button`, `SelectTrigger`, `SelectItem`, items de `DropdownMenu` et `Command`, `TabsTrigger`, `TooltipContent`, descriptions de `Dialog`/`AlertDialog`/`Sheet`/`Card`, `Table`, `Label`, `Toggle`, `Alert`, `Toast`, et `md:text-sm` d'`Input` et `Textarea`. Redéfinir `fontSize.sm` à `13px/19px` fait passer d'un coup tout le texte de contrôle et de menu au palier `body` de la cible, sans toucher au JSX. Ce passage est cohérent avec l'usage réel : `text-[13px]` compte déjà 112 occurrences et `text-[14px]` seulement 33. Risques : 20 variantes responsives de taille (`sm:text-sm` 8, `sm:text-xs` 6, `sm:text-base` 4, `md:text-sm` 2) changent aussi, et `text-base` (16 px) reste nécessaire sur les champs mobiles contre le zoom d'iOS. Voir § 12.4.

## 5. Primitives

Le kit `src/components/ui/` n'a presque pas bougé depuis le 9 septembre. Entre la branche d'inventaire et main, seul `ui/sidebar.tsx` change (cookie d'un an, `SheetTitle`/`SheetDescription` en mobile, Ctrl+B laissé aux éditeurs). Les descriptions de classes de `01-ui-kit.md` restent donc exactes. Ce qui change, ce sont les usages, recomptés ci-dessous (éléments JSX hors `ui/`, `prim-usage.cjs`).

### 5.1 Button, et les `<button>` bruts

`ui/button.tsx:9-26`. Base `rounded-full text-sm font-medium`, focus `focus-visible:ring-2 ring-ring ring-offset-2` (anneau à 2,28:1 en sombre, § 3.4).

| Variante | Classes | Usages |
|---|---|---:|
| `default` (implicite) | `border border-border bg-transparent hover:bg-accent` | 82 + 4 explicites |
| `outline` | **identique à `default`** | 111 |
| `ghost` | `hover:bg-accent` | 120 |
| `primary` | `bg-primary text-primary-foreground` | **0** |
| `secondary` | `bg-secondary` | 0 (1 conditionnel) |
| `destructive` | `bg-destructive` | 1 |
| `link` | souligné | 0 |
| conditionnelles | | 7 |

| Taille | Hauteur | Usages |
|---|---|---:|
| `default` | `h-10` 40 px | 85 (+ conditionnelles) |
| `sm` | `h-9` 36 px | 193 |
| `icon` | `h-10 w-10` | 36 |
| `xs` | `h-8` 32 px | **0** |
| `lg` | `h-11` 44 px | **0** |

- 325 `<Button>` dans 96 fichiers, contre **633 `<button>` bruts dans 178 fichiers** (outreach 238, missions 102, ats 83, calendar 21, sidebar 17). Le 9 septembre : 341 contre 625.
- 155 `<Button>` (48 %) surchargent la hauteur par `className` : `h-7` 80, `h-8` 34, `h-9` 20, `h-6` 13, `h-5` 3, `h-11` 3, `h-10` 2. 39 surchargent le rayon (`rounded-lg` 26, `rounded-md` 6, `rounded-full` 7 redondants). 18 se repeignent en aplat inversé `bg-foreground` (20 en comptant les variantes `hover:`), 9 en `bg-linkedin`.
- **Le bouton principal plein n'existe pas dans le kit utilisé** : `primary` n'a aucun usage. 125 `<button>` bruts et 18 `<Button>` recomposent l'aplat inversé `bg-foreground text-background` à la main. Hauteurs des `<button>` bruts : `h-9` 88, `h-8` 86, `h-7` 66, `h-6` 18, `h-10` 9, plus `h-[28px]` 6, `h-[42px]` 5, `h-[38px]` 4, `h-[32px]` 3. Rayons : `rounded-full` 144, `rounded-md` 110, `rounded-lg` 57, `rounded` 14, `rounded-xl` 8, et `[10px]`, `[7px]`, `[6px]`, `[8px]`.
- Focus des `<button>` bruts : 615 sur 633 n'ont aucun style de focus propre et reposent sur le contour global à 25 % de blanc. 349 n'ont pas d'attribut `type`.
- 81 boutons icône sans nom accessible (ni `aria-label`, ni `title`, ni texte), relevé AST.
- Bug latent, toujours présent : avec `asChild`, `loading` ne rend pas le spinner et `disabled` part sur le `Slot` (`ui/button.tsx:47-52`).

### 5.2 Champs : Input, Textarea, Select

| Primitive | Hauteur | Rayon | Focus | Usages | Écarts |
|---|---|---|---|---:|---|
| `Input` (`ui/input.tsx:16`) | `h-10` | `rounded-lg` 12 | `focus-visible:ring-2` | 149 dans 54 f. | **106 surcharges de hauteur (71 %)** : `h-8` 54, `h-9` 31, `h-7` 17, `h-11` 3 ; 27 surcharges de rayon. 65 `<input>` bruts. |
| `Textarea` (`ui/textarea.tsx:11`) | `min-h-[80px]` | `rounded-lg` | `focus-visible:` | 34 dans 28 f. | pas de prop `error` (contrairement à `Input`) ; 11 `<textarea>` bruts |
| `SelectTrigger` (`ui/select.tsx:20`) | `h-10` | `rounded-lg` | **`focus:`** (anneau aussi au clic) | 82 dans 31 f. | **65 surcharges de hauteur (79 %)** : `h-9` 22, `h-7` 19, `h-8` 14, `h-6` 6, `h-5` 1 ; aucun état d'erreur ; 16 `<select>` natifs |
| `SelectContent` (`:69`) | | `rounded-xl` 16 | | 83 | `z-[9999]` |
| `SelectItem` (`:108`) | `py-1.5` | `rounded-sm` 8 | `focus:bg-accent` seul | | surlignage `accent` sur `popover` : **1,16:1** en sombre, 1,17:1 en clair |

`Input` et `SelectTrigger` sont conçus à 40 px, l'usage réel les ramène à 32 ou 36 px. La cible (md 36) correspond à l'usage, pas au défaut du kit.

### 5.3 Surfaces : Card, Dialog, AlertDialog, Sheet, Drawer, Popover, Tooltip, HoverCard, DropdownMenu, Command

| Primitive | Rayon | Fond | Ombre | z-index | Focus / états | Usages |
|---|---|---|---|---|---|---:|
| `Card` (`ui/card.tsx:6`) | `rounded-xl` 16 | `bg-card` | `shadow-sm` | | `CardTitle` `text-2xl`, surchargé partout | 43 (22 f.), contre **142 éléments natifs** qui recomposent `bg-card` + `border` + `rounded-*` dans 63 fichiers |
| `DialogContent` (`ui/dialog.tsx:39`) | `rounded-xl` | `bg-card` | `shadow-lg` | `z-[9999]`, overlay `z-[9998] bg-black/80` | fermeture `focus:ring-2` (pas `-visible`), `aria-label="Fermer"` | 36 (33 f.) ; 10 surcharges de rayon (`rounded-xl` 5, `rounded-lg` 4, `rounded-none` 1) |
| `AlertDialogContent` (`ui/alert-dialog.tsx:37`) | `rounded-xl` | `bg-card` | `shadow-lg` | idem, classes recopiées de Dialog | **`AlertDialogAction` = `buttonVariants()` = bouton transparent à filet, identique à `AlertDialogCancel`** (`:76`, `:86`) | 44 (38 f.). Actions : 33 repeintes `bg-destructive`, 3 d'une autre couleur, **11 sans classe, donc indiscernables d'« Annuler »** |
| `SheetContent` (`ui/sheet.tsx:32`) | **aucun** | `bg-background` | `shadow-lg` | `z-[9999]` | fermeture `focus:ring-2` | 9 (8 f.) ; 4 ajoutent un rayon |
| `Drawer` (vaul) | `rounded-t-xl` | `bg-background` | | `z-[9999]` | overlay sans animation | **0 : mort** |
| `PopoverContent` (`ui/popover.tsx:20`) | `rounded-xl` | `bg-popover` | `shadow-md` | `z-[9999]` | `outline-none` | 19 (16 f.) |
| `TooltipContent` (`ui/tooltip.tsx:20`) | `rounded-lg` (≠ popover) | `bg-popover` | `shadow-md` | `z-[9999]` | | 46 (24 f.) ; 155 `title=` natifs dans 68 fichiers en parallèle |
| `HoverCardContent` | `rounded-xl` | `bg-popover` | `shadow-lg` | `z-[9999]` | `sideOffset` 6 (4 ailleurs) | 2 (1 f.) |
| `DropdownMenuContent` (`ui/dropdown-menu.tsx:64`) | `rounded-xl` | `bg-popover` | `shadow-md` (sous-menu `shadow-lg`, `:47`) | `z-[9999]` | items `focus:bg-accent` (1,16:1) | 18 (16 f.), 54 items |
| `Command` (`ui/command.tsx:16`) | `rounded-md` (≠ popovers) | `bg-popover` | | via Dialog | champ `h-11` | 1 seul usage (`NavigationPalette`) |

Quatre surfaces flottantes, trois rayons (Tooltip 12, Popover/Dropdown/HoverCard/Select 16, Command 10). Deux fonds de modale (Dialog `card`, Sheet `background`). Un voile d'overlay `bg-black/80` recopié quatre fois, hors jeton. Aucune variante plein écran : d'où les modales faites main du § 9.

### 5.4 Badge, Tabs, Table, Skeleton, Switch, Checkbox, Toggle

| Primitive | Mesures | Usages | Écarts |
|---|---|---:|---|
| `Badge` (`ui/badge.tsx:7`) | `rounded-full px-2.5 py-0.5 text-xs font-semibold`, pas de taille | 121 (49 f.) | **`focus:`** au lieu de `focus-visible:`. Variantes : `outline` 65, `secondary` 31, `default` 17 (pastille blanche pleine en sombre), `destructive` 4, **`success`/`warning`/`info`/`muted` : 0**. Les statuts sont peints à la main, 1 244 classes `success/warning/info`. 44 surcharges de hauteur (`h-4` 30, `h-5` 8, `h-3.5` 5, `h-6` 1). Les variantes de statut écrivent `bg-[hsl(var(--status-*))]` au lieu de `bg-success`. |
| `Tabs` (`ui/tabs.tsx:15,30`) | liste `h-10 rounded-full bg-muted`, onglet actif `bg-background` | 7 (5 f.) | onglet actif sur piste : **1,26:1** en sombre, **1,07:1** en clair ; surcharges `h-8`, `h-6`, `rounded-lg`, `rounded-none`. Les onglets de la mission V2 et des Paramètres sont faits main. |
| `Table` (`ui/table.tsx:49`) | `TableHead h-12 px-4`, cellules `p-4` | 4 fichiers | trop aérée ; `CompactResultsTable` (1 344 l.) et le pipeline écrivent leur `<table>` |
| `Skeleton` (`ui/skeleton.tsx:4`) | `animate-pulse rounded-md bg-muted` | 53 (11 f.) | contre 200 `<Loader2>` dans 100 fichiers, 244 `animate-spin` dans 120 fichiers, 22 `BrutalLoader` dans 19 fichiers, 43 `animate-pulse` à la main |
| `Switch` (`ui/switch.tsx:12`) | `h-6 w-11` | 22 (15 f.) | piste éteinte `bg-input` sur carte : **1,46:1** (sombre), 1,25:1 (clair) ; pouce éteint sur piste : 1,60 / 1,20 |
| `Checkbox` (`ui/checkbox.tsx:14`) | `h-4 w-4 rounded-sm` (8 px sur 16 px), icône `h-4 w-4` dans la boîte | 34 (16 f.) | bord `border` sur carte : **1,36:1** / 1,25:1, la case vide est presque invisible ; pas d'état `indeterminate` |
| `Toggle` / `ToggleGroup` | `rounded-md`, `h-10`/`h-9`/`h-11` | **0 : morts** (le 9 septembre : 1) | |

### 5.5 Sidebar et toasts

- `ui/sidebar.tsx` (642 l.) ne sert plus que de coquille : `AppSidebar.tsx:21-27` importe `Sidebar`, `SidebarContent`, `SidebarHeader`, `SidebarFooter`, `useSidebar` ; `AppLayout` `SidebarProvider` ; `AppHeader` `SidebarTrigger`. `SidebarMenuButton`, `SidebarMenu*`, `SidebarGroup*`, `SidebarInput`, `SidebarRail` : **0 usage**. La barre des lots 5 et 6 (22 fichiers, 2 644 lignes) écrit ses rangées elle-même : **0 `<Button>`, 19 `<button>`**, 37 `text-[Npx]` (`12px` 15, `13px` 6, `10px`, `11px`, `11.5px` 4 chacun, `9px`, `10.5px`, `12.5px`), `rounded-md` dominant. Elle a le mérite d'appliquer des cibles tactiles de 44 px (`min-h-11 md:min-h-7`, 18 fois) et `focus-visible:ring-sidebar-ring`.
- Paramètres (lots 1 à 4, 28 fichiers, 8 941 lignes) : 94 `<Button>` contre 14 `<button>`, mais 71 `text-[Npx]` (`10px` 46, `11px` 21), 22 `rounded` nus à 4 px, 37 `uppercase`. L'état d'erreur y passe par `marketplace/ErrorBox.tsx` (7 fichiers).
- Toasts : voir § 2.7. `ui/toast.tsx:17` `z-[100]`, `rounded-md`, `p-6`, `ToastAction` réimplémente un bouton. `ui/use-toast.ts` (réexport de 2 lignes) n'a aucun importeur. Auth et la landing importent directement `@/hooks/use-toast`.

## 6. Composants décoratifs ou morts

Importeurs comptés sur tout `src/` (`.ts` et `.tsx`), barils compris.

| Composant | Lignes | Importeurs réels | Verdict |
|---|---:|---|---|
| `ui/AnimatedOrb.tsx` (canvas, palette « skalr » RGB en dur) | 177 | `assistant-ui/thread.tsx`, `agent/AgentChatPanel.tsx` (6 éléments) | vivant, hors jetons, animation infinie sans `prefers-reduced-motion` |
| `ui/AnimatedFunnel.tsx` | 161 | `pages/ATS.tsx` (1) | quasi mort |
| `ui/AnimatedCompass.tsx` | 152 | 0 | **mort** |
| `ui/AnimatedChatBubble.tsx` | 141 | 0 | **mort** |
| `ui/background-paths.tsx` | 85 | 0 | **mort** |
| `ui/text-rotate.tsx` | 74 | 0 | **mort** |
| `ui/brutal-loader.tsx` | 161 | 19 fichiers, 22 éléments (Paramètres 8, `missions/` 3, `outreach/` 3, pages 5 : `Agents`, `SourcingSearches`, `SourcingSearch`, `Pricing`, `MissionWorkspace`) | vivant ; nom et registre « brutal » (carré, `border-foreground`) contraires à la cible |
| `magicui/number-ticker.tsx` | 74 | `outreach/search/SearchResultsPanel.tsx`, `onboarding/SceneLaunch.tsx` | vivant, marginal (bandeau inatteignable en mission selon l'auditeur C) |
| `magicui/shimmer-button.tsx` | 78 | `missions/EmptyMissionState.tsx` (1) | quasi mort ; `var(--bg)`, ombres `rgba` en dur |
| `layout/PageLayout.tsx` | 50 | `pages/Calendar.tsx`, `pages/Dashboard.tsx`, `pages/Tasks.tsx` | vivant (3 pages sur 31 routes) |
| `layout/PageHeader.tsx` | 74 | 0 | **mort**, API saine (icône, titre h1, méta, sous-titre, actions) |
| `layout/EmptyState.tsx` | 82 | 0 | **mort**, API saine (`icon`, `title`, `description`, `action`, `variant`, `role="status"`), style brutal (sans rayon, titre capitales grasses) |
| `layout/StatTile.tsx` (+ `StatGrid`) | 129 | 0 | **mort** |
| `layout/Section.tsx` | 60 | 0 | **mort**. Les 41 `<Section>` du code sont des composants locaux homonymes, dans 7 fichiers. |
| `ui/EmptyState.tsx` | 63 | 6 fichiers (7 éléments : `ats/candidate-detail/*` 4, `CandidateSequencesPanel`, `pages/ATS`) | vivant mais **doublon** du précédent, avec une autre API (`actionLabel`/`actionHref`, bouton natif, icône `Settings` codée en dur) |
| `ui/IconTile.tsx` | 69 | 3 fichiers (4 éléments) | sous-employé : 76 `bg-emerald-500` le recomposent à la main |
| `marketplace/ErrorBox.tsx` | 36 | 11 fichiers (marketplace 3, Paramètres 7, `MissionHuntMode`) | **l'état d'erreur partagé de fait**, rangé dans `marketplace/`, sans rayon ni `role="alert"` |

Autres fichiers morts du kit : `accordion` (52 l.), `aspect-ratio` (5), `breadcrumb` (90), `calendar` (54), `carousel` (224), `chart` (303), `drawer` (87), `form` (129), `slider` (23), `toggle-group` (49), `toggle` (37, importé seulement par `toggle-group`), `use-toast.ts` (3). **16 fichiers morts dans `ui/`, 1 508 lignes**, plus 4 dans `layout/` (345 lignes) et `src/App.css` (42 lignes, gabarit Vite jamais importé). Quasi morts : `UpgradePrompt`, `command` (palette seulement), `hover-card`, `sonner`/`toaster` (un seul montage chacun, c'est normal).

États d'écran, pour mémoire : 194 « Aucun/Aucune » dans 118 fichiers, contre 7 `EmptyState`. Chargement : 53 `Skeleton` (11 fichiers), 200 `<Loader2>` (100 fichiers), 22 `BrutalLoader`, 43 `animate-pulse` à la main. Erreur : `ErrorBox` (11), `ErrorBoundary`, `SectionErrorBoundary`, aucun `ErrorState` dans le kit.

## 7. Classes utilitaires de index.css

| Classe | Usages | Où |
|---|---:|---|
| `konekt-fade-up` (480 ms) | 26 | `missions/v2/CreateMissionV2` 7, `missions/MissionPipeline` 4, `missions/process/shared` 3, `MissionOverviewV2` 3, `ClientPortalV2` 3, `MissionProcessV2` 2, `MissionClientPortal`, `MissionBriefV2`, `DynamicSummaryBanner`, `SourcingSearches` |
| `konekt-skalr-bg` (dégradé violet-rose-bleu **animé 8 s en boucle**) | 26 | `CreateMissionV2` 9, `ClientPortalV2` 6, `EnrollmentPreviewModal` 5, `MissionProcessV2` 2, `BatchScoringReport` 2, `MissionBriefV2`, `ProjectsListV2` |
| `konekt-shine` (reflet **infini 2,5 s**) | 20 | `CreateMissionV2` 6, `EnrollmentPreviewModal` 5, `ClientPortalV2` 3, `MissionProcessV2` 2, `MissionBriefV2`, `SceneLaunch`, `BatchScoringReport`, `ProjectsListV2` |
| `konekt-shimmer-text` (infini 2,4 s) | 4 | `assistant-ui/thread` 2, `SceneOrganization`, `SourcingFlow` |
| `konekt-glow` (halo violet infini) | 3 | `EnrollmentPreviewModal` |
| `konekt-skalr-text` | 2 | `CreateMissionV2` |
| `konekt-skalr-bg-soft` | 1 | `CreateMissionV2` |
| `skalr-gradient-bg` / `-text` / `-border` | 3 / 1 / 1 | `pages/Pricing` ; `landing/LandingProductDemo` |
| `landing-sky-gradient` | 2 | `SkalrLanding` |
| `interactive-card` | 2 | `MissionPipeline`, `SourcingSearches` |
| `interactive-row` | **0** | |
| `stagger-in` | 1 | `outreach/search/FilterFacets` |
| `focus-ring-brutal` | **0** | |
| `perspective-1000` / `perspective-800` | 2 / **0** | `EmptyMissionState` |
| `thin-scrollbar` | 2 | `MissionPipeline` |
| `no-scrollbar` / `scrollbar-hide` (doublons) | 9 / 8 | |
| `font-editorial` | 19 | onboarding, landing, portail client (§ 4.1) |
| `skip-to-content` | 1 | `AppLayout` |

Le dégradé de l'ancienne marque (« skalr », violet `271 81% 56%`, rose, bleu) est écrit en dur dans 7 règles de `index.css` (l.283-294, 394-407, 377), hors des jetons `--skalr-*` qui portent pourtant les mêmes valeurs. Il habille le cœur du parcours mission V2 : `CreateMissionV2` (18 usages), `MissionBriefV2`, `MissionProcessV2`, l'aperçu d'enrôlement. La cible (un seul accent indigo, rationné) l'exclut. Les trois classes `interactive-row`, `focus-ring-brutal` et `perspective-800` sont mortes.

## 8. Mouvement

| Mesure | Valeur |
|---|---|
| Durées Tailwind | `duration-200` 38, `duration-150` 25, `duration-300` 21, `duration-500` 12, `duration-700` 3 (99 dans 56 fichiers) ; `delay-*` 0 |
| Courbes | `ease-out` 9, `ease-in-out` 4, `ease-linear` 4 ; le reste prend le défaut Tailwind |
| Transitions | `transition-colors` 552, `transition-all` 144, `transition-opacity` 63, `transition-transform` 39, `transition-shadow` 11 |
| Animations CSS | `animate-spin` 244 (120 fichiers), `animate-pulse` 43, `animate-in` 25, `animate-out` 14, `animate-fade-in` 7, `animate-ping` 4, 11 `animate-[…]` arbitraires (shimmer 1,4 à 2 s infini, `kIndet` inline dans `SourcingFlow`) |
| Keyframes maison | `tailwind.config.ts:150-244` (accordion, zoom-in, fade-zoom-in 1 s, fade-in 0,6 s, slide-in 0,25 s, scroll-left 40 s et 110 s infinis, scan, shimmer) ; `index.css:368-391` (`konektPulseDot`, `konektBgPan`, `konektGlow`, `konektShine`, `konektFadeUp`, `konektShimmerText`) |
| framer-motion | **54 fichiers, 251 éléments `motion.*`, 28 `AnimatePresence`, 21 ressorts, 17 `repeat: Infinity` dans 9 fichiers**. Durées JS : 0,4 s ×47, 0,5 ×22, 0,3 ×18, 0,15 ×13, 0,6 ×9, 0,35 ×8, 0,7 ×7, 0,8 ×6 |
| `prefers-reduced-motion` | CSS : un seul bloc, `index.css:451-457`, qui ne couvre que `.interactive-card` (2 usages), `.interactive-row` (0) et `.stagger-in` (1). JS : 8 fichiers seulement (`AppLayout` pour la transition de page, `JobScoreDisplay`, `useCountUp`, `ChapterInterstitial`, `OnboardingBackdrop`, `ConfettiBurst`, `LandingProductDemo`, `pages/Onboarding`). `dashboard/LivePulse.tsx:8` l'annonce dans son commentaire mais boucle sans test (`repeat: Infinity`, l.38). **48 des 54 fichiers framer-motion l'ignorent**, aucun `MotionConfig reducedMotion="user"`, aucune variante `motion-safe:`/`motion-reduce:` |

Ce qui tourne sans fin sans tenir compte de la préférence : 244 spinners, `konekt-skalr-bg` (8 s), `konekt-shine`, `konekt-glow`, `konekt-shimmer-text`, `AnimatedOrb` (canvas `requestAnimationFrame`), les 17 boucles framer. Neuf durées différentes pour des micro-transitions équivalentes.

## 9. Échelle z-index

| Valeur | Occ. | Fichiers | Rôle |
|---|---:|---:|---|
| `999999999` | | | toasts sonner (CSS injecté par la bibliothèque) |
| `z-[9999]` | 11 | 10 | contenus Radix : Dialog, AlertDialog, Sheet, Drawer, Popover, Tooltip, HoverCard, Select, DropdownMenu ; + `outreach/SequenceEnrollButton.tsx:159` (redondant) ; + `skip-to-content` (`index.css:230`) |
| `z-[9998]` | 4 | 4 | voiles d'overlay (Dialog, AlertDialog, Sheet, Drawer) |
| `z-[6000]` | 1 | 1 | `outreach/filter-wizard/FilterWizard.tsx:230` (modale faite main) |
| `z-[4000]` | 4 | 4 | modales plein écran faites main : `SequenceBuilder.tsx:1236`, `EnrollmentPreviewModal.tsx:631`, `missions/FilterWizard.tsx:513`, `missions/FilterReviewModal.tsx:340` |
| `z-[2100]` | 1 | 1 | `outreach/MessagesInbox.tsx:168` (conversation plein écran mobile) |
| `z-[200]` | 1 | 1 | `ats/BulkActionsBar.tsx` |
| `z-[100]` | 2 | 2 | `ui/toast.tsx:17` (Toaster Radix), `ats/CandidateCommentsTab.tsx` |
| `z-[70]` | 1 | 1 | `outreach/JobSelector.tsx` |
| `z-[60]` | 1 | 1 | `SkalrLanding.tsx:232` (menu mobile) |
| `z-50` | 21 (+1 `zIndex: 50` inline) | 12 | modales faites main (`CreateProjectModal.tsx:505`, `ICPFormModal`, `SkalrLanding.tsx:636,665`, `ClientPortalV2.tsx:358`), `ConfettiBurst`, `file-upload`, menus déroulants faits main |
| `z-40` | 6 | 4 | `SourcingFlow`, `SmartOverlays`, `ChapterInterstitial`, `ClientPortalV2` |
| `z-30` | 5 | 4 | `CompactResultsTable` (en-tête collant), onboarding, `ClientPortalV2.tsx:984` (voile) |
| `z-20` | 13 | 11 | `ui/sidebar` (rail), calendrier, table compacte, cartes |
| `z-10` | 71 | 41 | en-têtes collants, superpositions locales, `ui/sidebar` (panneau fixe) |
| `z-[1]` | 1 | 1 | `missions/FilterWizard.tsx` |

Collisions et incohérences :
1. Tous les contenus flottants Radix et les boîtes de dialogue partagent `z-[9999]`. Qui passe devant dépend de l'ordre d'insertion des portails dans le DOM, pas d'une règle.
2. Le Toaster Radix (`z-[100]`) passe sous tout dialogue ouvert (sans effet visible aujourd'hui : il ne sert que Auth et la landing). Sonner, à `999999999`, respecte bien la cible « toast au-dessus du modal ».
3. **13 calques plein écran faits main** (`fixed inset-0`) avec des z-index de 30 à 6 000, hors `Dialog`. Les quatre modales outreach/missions contrôlées (`SequenceBuilder`, `EnrollmentPreviewModal`, `outreach/filter-wizard/FilterWizard`, `CreateProjectModal`) n'ont ni `role="dialog"`, ni `aria-modal`, ni gestion d'Échap (0 référence à `Escape`), ni piège à focus. Il manque une variante plein écran à `Dialog`.
4. Une modale faite main à `z-50` (`CreateProjectModal`, `ICPFormModal`) passe sous un overlay Radix à 9998. Une modale faite main à 4 000 ou 6 000 passe sous tout popover Radix (voulu) mais au-dessus de la barre latérale et du tiroir de l'assistant.
5. Le lien d'évitement partage `z-[9999]` avec les dialogues.
6. `FilterWizard.tsx` utilise à lui seul `z-[1]`, `z-[4000]` et `z-[6000]`.

## 10. Rayons et ombres

Avec `--radius: 0.75rem` (`tailwind.config.ts:136-142`) : `sm` 8 px, `md` 10 px, `lg` 12 px, `xl` 16 px, `2xl` 24 px. `rounded` nu reste à 4 px (défaut Tailwind), `3xl` à 24 px (identique à `2xl`).

| Classe | px | Occ. | Fichiers | Cible |
|---|---:|---:|---:|---|
| `rounded-full` | plein | 556 | 158 | pill |
| `rounded-lg` | 12 | 460 | 141 | surface |
| `rounded-md` | 10 | 327 | 102 | hors cible (→ control 8) |
| `rounded-xl` | 16 | 199 | 88 | hors cible (→ surface 12) |
| `rounded` | 4 | 104 | 53 | hors cible, sauf « pill sous 20 px » |
| `rounded-sm` | 8 | 39 | 23 | control |
| `rounded-[10px]` / `[8px]` / `[7px]` / `[6px]` / `[2px]` / `[1.75rem]` / `[inherit]` | | 23 / 4 / 4 / 1 / 2 / 1 / 1 | | arbitraires, 36 au total (`SearchFiltersPanel`, `SourcingFlow`…) |
| `rounded-2xl` / `rounded-3xl` | 24 | 21 / 2 | 11 / 2 | hors cible |
| `rounded-none` | 0 | 2 | 2 | |
| partiels (`rounded-t-xl`…) | | 13 | | |

Total : 1 759 classes de rayon, 16 valeurs pour l'ensemble des coins. Seuls `rounded-full`, `rounded-lg` et `rounded-sm` (1 055, soit 60 %) tombent sur les trois paliers cibles. Les primitives elles-mêmes emploient cinq rayons (§ 5.3).

| Ombre | Occ. | Fichiers |
|---|---:|---:|
| `shadow-sm` | 86 | 47 |
| `shadow-md` | 39 | 26 |
| `shadow-lg` | 39 | 30 |
| `shadow` | 6 | 3 |
| `shadow-xl` / `shadow-2xl` | 4 / 4 | 4 / 2 |
| `shadow-2xs`, `shadow-xs` | **0** | |
| arbitraires `shadow-[…]` | 10 | 7 (`rgba` en dur : `SearchFiltersPanel.tsx:183,195`, `SearchPromptBar.tsx:120`, `SourcingFlow.tsx:115`, `Calendar.tsx:541`, `CalendarDayView.tsx:153`, `shimmer-button.tsx:36`, `LandingProductDemo.tsx:187`, `ui/sidebar.tsx`) |

189 ombres au total. Les jetons `--shadow-*` d'`index.css:117-124` et `196-203` alimentent `shadow-sm` à `shadow-2xl`. En sombre, les ombres noires à 15-40 % sur un fond à 11 % de luminosité se voient à peine : la hiérarchie des surfaces repose en pratique sur les fonds `card` et `popover` et sur les filets.

## 11. Constats (G-xx)

Priorités : **P0**, défaut visible ou blocage d'accessibilité aujourd'hui ; **P1**, incohérence du système qui coûte à chaque écran ; **P2**, nettoyage.

| ID | P | Constat | Preuve | Correctif |
|---|---|---|---|---|
| G-01 | P0 | En sombre (thème par défaut), 96 classes d'opacité sur des jetons à alpha intégré produisent une valeur invalide : bordures blanches opaques au lieu de filets, séparateurs et anneaux effacés. | `index.css:38-40,51-52` ; CSS compilé `.border-border\/50 { border-color: hsl(var(--border) / 0.5) }` ; Chromium : `border-border/50` → `rgb(250,250,250)`, `bg-border/40` → transparent, `ring-border/40` → `none`. Exemples : `agent/AgentChatPanel.tsx:440`, `ai/CreditCostBadge.tsx:39`, `ats/ATSDroppableColumn.tsx:71`, `assistant-ui/thread.tsx:444`, `outreach/inbox/MessageView.tsx:1017` | Immédiat : remplacer les 96 `*-border/NN` par `border-border`, ou par un jeton `--rule-subtle`. À terme : jetons « teinte + alpha » (`hsl(var(--rule) / calc(var(--rule-a) * <alpha-value>))`, vérifié au rendu dans les deux thèmes, § 12.4). |
| G-02 | P0 | Variables appelées qui n'existent pas. Les courbes « positive » et « info » du Dashboard et l'anneau de score ≥ 70 ne sont pas tracés ; le rouge d'exclusion de la recherche tombe toujours sur son repli. | `dashboard/Sparkline.tsx:30,33` (utilisé `DashboardWeekHighlight.tsx:346,355,365`), `outreach/JobScoreDisplay.tsx:195`, `onboarding/SceneOrganization.tsx:513`, `onboarding/SceneLaunch.tsx:45` → `stroke` calculé `none` ; `var(--k-bad,#e06666)` dans `SourcingFlow.tsx:724,873,889` | Renommer les variables comme les couleurs Tailwind (`--success`, pas `--status-success`). Ajouter au cliquet un contrôle « toute `var(--x)` du code est déclarée dans `index.css` ». |
| G-03 | P1 | Classes sans CSS généré : fond ou filet absent, icônes de nœud de séquence à 24 px. | `bg-foreground/8` (`CandidateSequencesPanel.tsx:51`, `SequencesList.tsx:782,929`), `border-border/8` (`AgentConversationsList.tsx:40,97`), `bg-destructive/8` (`MessageView.tsx:742`), `w-4.5 h-4.5` (`sequence/nodes/WorkflowStepNode.tsx:85,87,89`), `line-clamp-8` (`ScorecardFullPage.tsx:688`) | Valeurs de l'échelle (`/5`, `/10`, `size-4`/`size-5`). Contrôle en CI : compiler et lister les classes du code absentes du CSS (`gencheck.py`). |
| G-04 | P0 | Les 53 variantes `dark:` (17 fichiers) sont mortes : `darkMode: ["class"]` alors que le sombre vit sur `:root`. En sombre s'affichent les valeurs claires : texte d'alerte LinkedIn à **1,57:1**, initiales d'avatar de 1,84 à 2,56:1, pastilles d'intention de l'inbox de 2,03 à 2,84:1. | `tailwind.config.ts:4` ; `outreach/search/LinkedInReconnectBanner.tsx:62-63,79` ; `dashboard/CandidateAvatar.tsx:32-39` ; `hooks/useChatIntents.ts:52-77` ; `layout/NavigationPalette.tsx:182-183` | Une ligne : `darkMode: ['selector', ':root:not(.light)']`. Vérifié à la compilation et au rendu : `dark:text-amber-200` s'applique en sombre, rien en clair. Puis relire les 53 valeurs et les remplacer par des jetons (§ 12). |
| G-05 | P0 | Contrastes. Les statuts ont une seule valeur pour les deux thèmes : en clair, success 2,20, warning 1,90, info 3,47 en texte ; en sombre, destructive 3,54. Badge `success` : blanc sur vert à 2,30. Les 290 `text-muted-foreground/NN` échouent tous (de 1,44 à 3,88). Texte secondaire nu sur `muted` : 4,21 et 4,03. | § 3.1, 3.2 ; `index.css:67-75,205-213` ; `ui/badge.tsx` | Texte de statut distinct par thème, aplats remplacés par teinte + texte (§ 12.2). Interdire l'opacité sur les jetons de texte : trois niveaux `ink`, `ink-2`, `ink-3`. |
| G-06 | P0 | Focus sous le seuil. L'anneau `--ring` (blanc 25 %) vaut 2,28:1 en sombre et 2,69:1 en clair. `SelectTrigger`, `Badge` et la fermeture de `Dialog`/`Sheet` réagissent à `focus:` et non à `focus-visible:`. 615 des 633 `<button>` bruts n'ont que le contour global. Le surlignage des menus au clavier vaut 1,16:1. | `index.css:40,158,223-226` ; `ui/select.tsx:20`, `ui/badge.tsx:7`, `ui/dialog.tsx:45`, `ui/sheet.tsx:89`, `ui/dropdown-menu.tsx:82` ; Chromium : `outline 2px rgba(255,255,255,0.25)` | Anneau = accent plein 2 px, décalage 2 px (5,99:1 en sombre, 4,72:1 en clair), halo facultatif. **Le halo de 3 px à 30 % prévu par la planche échoue seul (1,68 et 1,48:1)**. Uniformiser `focus-visible:`. Surlignage de menu : `bg-hover` + filet accent à gauche, ou texte `ink`. |
| G-07 | P1 | Le bouton principal plein n'existe pas dans l'usage. `variant="primary"` : 0 usage. `default` et `outline` sont identiques (197 boutons). 125 `<button>` et 18 `<Button>` recomposent l'aplat inversé à la main. `AlertDialogAction` rend un bouton transparent : 11 confirmations sur 47 sont indiscernables d'« Annuler ». | `ui/button.tsx:13-16` (`default` = `outline`), `:14` (`primary`) ; `ui/alert-dialog.tsx:76,86` ; relevé AST | Nouvelle API `Button` : `primary` (défaut), `secondary`, `ghost`, `destructive`, `link`. `AlertDialogAction` avec prop `variant` (`primary` par défaut, `destructive` pour les suppressions). |
| G-08 | P1 | Hauteurs de contrôle : le kit est calé à 40 px, l'usage à 28-36 px. 48 % des `Button`, 71 % des `Input` et 79 % des `SelectTrigger` surchargent leur hauteur. Les tailles `xs` et `lg` ne servent jamais. Six hauteurs en circulation, sans compter les `h-[42px]`, `h-[38px]`… des boutons bruts. | `ui/button.tsx:22-26`, `ui/input.tsx:16`, `ui/select.tsx:20`, `ui/toggle.tsx:16-18` ; § 5.1-5.2 | Échelle commune `xs` 28, `sm` 32, `md` 36, `lg` 40 pour `Button`, `IconButton`, `Input`, `SelectTrigger`, `Toggle`, `Tabs` ; défaut `md` ; supprimer `h-*` des `className` (cliquet). |
| G-09 | P1 | Typographie : 1 124 `text-[Npx]` (24 valeurs, 155 fichiers), `text-[10px]` deux fois plus fréquent que `text-3xs`. La règle globale impose Outfit à environ 300 titres, mais 179 des 184 titres bruts redéfinissent leur graisse. Six familles chargées, dont Space Grotesk (5 graisses) qui ne sert nulle part. | `index.css:241-244` ; `index.html:22-30` ; `tailwind.config.ts:143-149` ; § 4 | Paliers nommés `caption` à `title` (§ 12.4). Retirer la règle `h1-h3`. Ne charger qu'Instrument Sans (500/600/700) et Space Mono (Bricolage en option, pages publiques). Codemod `text-[10px]`→`text-caption`, `text-[11px]`→`text-micro`, etc. |
| G-10 | P1 | Deux systèmes de toast montés. Sonner suit le thème de l'OS, pas celui de l'application (next-themes sans provider). Mesuré dans Chromium : avec un dialogue Radix ouvert, cliquer l'action d'un toast (« Annuler ») ne la déclenche pas et ferme le dialogue. | `App.tsx:149-150` ; `ui/sonner.tsx:7` ; banc `rt/sonner/` (`data-theme` suit l'OS ; `elementFromPoint` sur le bouton du toast = voile du dialogue ; `actionClicked: false`, dialogue fermé) | Garder sonner seul (migrer `Auth` et `SkalrLanding`, supprimer `toast.tsx`, `toaster.tsx`, `use-toast`). Passer `theme` depuis l'état de l'application. Ajouter `[data-sonner-toaster] { pointer-events: auto }` et rendre le toaster en portail. |
| G-11 | P1 | Aucune échelle de calques. Tous les flottants Radix partagent 9999. 13 calques plein écran faits main vont de 30 à 6 000. Les modales `SequenceBuilder`, `EnrollmentPreviewModal`, `FilterWizard` (outreach) et `CreateProjectModal` n'ont ni `role="dialog"`, ni `aria-modal`, ni Échap, ni piège à focus. | § 9 ; `outreach/SequenceBuilder.tsx:1236`, `outreach/EnrollmentPreviewModal.tsx:631`, `outreach/filter-wizard/FilterWizard.tsx:230`, `outreach/projects/CreateProjectModal.tsx:505` | `zIndex` nommés `base` 0, `sticky` 100, `overlay` 200, `modal` 300, `toast` 400 (plus `popover` 350, au-dessus des modales dont ils sortent). `Dialog` gagne `size="fullscreen"` et remplace les 13 calques. |
| G-12 | P1 | Deux jeux de jetons qui se doublonnent. Les 19 `--k-*` (421 `var()` dans 7 fichiers) recopient les valeurs shadcn sous d'autres noms. `--k-success`/`--k-warn` diffèrent des statuts. `--secondary` = `--muted`. `--status-success` = `--skalr-green`, `--status-info` = `--skalr-blue`. `--chart-*` : 0 usage. 13 redéclarations inutiles sous `.light`. | § 2.1-2.2 ; `index.css:96-114,176-194` | Un seul jeu, correspondance au § 12.3. Les composants `--k` passent aux classes Tailwind (`bg-surface`, `border-rule`…), ce qui supprime les 418 `…-[var(--k-…)]`. |
| G-13 | P1 | Le nom `accent` désigne aujourd'hui un **gris** (`--accent: 40 3% 20%`) : 232 `bg-accent` servent de fond de survol, 9 `text-accent` écrivent en gris. La cible appelle « accent » l'indigo. | `index.css:32,150` ; `SourcingReadinessPanel.tsx:93,113,146` (relevé C) | Codemod d'abord (`bg-accent`→`bg-hover`, `text-accent-foreground`→`text-ink`), puis réaffecter `--accent` à l'indigo. Sans cet ordre, 256 classes deviennent violettes d'un coup. |
| G-14 | P1 | Rayons : 16 valeurs, 60 % des 1 759 classes sur les trois paliers cibles. Les primitives en emploient cinq (Tooltip 12, Popover/Dropdown/Select/Dialog 16, Command 10, Toggle 10, Sheet 0). `rounded` nu (104) vaut 4 px et ne dérive pas du jeton. | § 10 ; `ui/tooltip.tsx:20`, `ui/popover.tsx:20`, `ui/command.tsx:16`, `ui/sheet.tsx:32` | `borderRadius` : `control` 8, `surface` 12, `full`, et `xs` 4 pour les éléments de moins de 20 px (case, pastille, barre de squelette). Codemod `rounded-md`→`rounded-control`, `rounded-xl`→`rounded-surface`. |
| G-15 | P1 | Mouvement : `prefers-reduced-motion` ne couvre que 3 classes CSS (dont une inutilisée) et 8 fichiers JS. 48 des 54 fichiers framer-motion l'ignorent (`LivePulse.tsx` l'affirme en commentaire sans le faire). 244 spinners, dégradés animés en boucle. | `index.css:451-457` ; § 8 | `<MotionConfig reducedMotion="user">` à la racine. Règle CSS globale `@media (prefers-reduced-motion: reduce) { *, ::before, ::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important } }`. Durées nommées (§ 12.4). |
| G-16 | P1 | L'ancien dégradé de marque « skalr » (violet-rose-bleu), codé en dur dans 7 règles CSS, habille 60 éléments du cœur du parcours mission (`CreateMissionV2` 18). `brand-purple` : 123 classes. Tout cela contredit « un seul accent ». | `index.css:283-294,377-378,394-407` ; § 7 | Remplacer par l'accent (aplat ou teinte à 14 %), supprimer `konekt-skalr-*`, `skalr-gradient-*`, `konektGlow`, `--skalr-*`. |
| G-17 | P1 | Couleurs brutes : 433 classes de palette Tailwind dans 78 fichiers (`bg-emerald-500` 76, en tuiles d'icône), 7 `bg-white`, 35 hexadécimaux. `IconTile` existe mais sert 4 fois. | § 2.2 ; `ui/IconTile.tsx` (ton `default` = `bg-emerald-500/15`) | `IconTile` à cinq tons (neutre, accent, success, warning, danger) sur jetons ; codemod des 76 tuiles. |
| G-18 | P1 | Pas de primitives d'état. Deux `EmptyState` concurrents (`ui/` 7 usages, `layout/` 0), 194 « Aucun/Aucune » écrits à la main. L'erreur passe par `marketplace/ErrorBox.tsx` (11 importeurs, sans rayon ni `role="alert"`). Trois systèmes de chargement (Skeleton 53, Loader2 200, BrutalLoader 22). | § 6 | `ui/EmptyState`, `ui/ErrorState` (promotion d'`ErrorBox`), `ui/LoadingState` (squelettes de liste et de table, spinner d'action), API au § 12.6. |
| G-19 | P2 | Code mort : 16 fichiers de `ui/` (1 508 l.), 4 de `layout/` (345 l.), `App.css`, les classes `interactive-row`, `focus-ring-brutal`, `perspective-800`, le doublon `scrollbar-hide`/`no-scrollbar`, et `ui/sidebar.tsx` en grande partie inutilisé (`SidebarMenuButton` 0). | § 6, § 7, § 5.5 | Supprimer, après avoir ranimé `breadcrumb` (fil d'Ariane de la maquette Mission), `PageHeader` et `Section`, et décidé du sort de `form.tsx` (champ + libellé + erreur). |
| G-20 | P2 | Deux bascules de thème désynchronisées. La palette ne persiste pas le choix et ne prévient pas la barre latérale. Son icône (`dark:hidden`) ne change jamais. `theme-color #0a0a0a` ne correspond pas au fond `#1d1c1b`. | `AppSidebar.tsx:76-86`, `layout/NavigationPalette.tsx:80-89,182-183`, `index.html:9` | Un seul hook `useTheme` local (classe `.light` + `localStorage` + `meta theme-color`), consommé par la barre, la palette et sonner. |
| G-21 | P2 | Contrôles d'état peu visibles : case vide à 1,36:1, piste d'interrupteur éteint à 1,46:1, onglet actif à 1,26:1 (1,07:1 en clair), bord de champ à 1,44:1 (1,20:1 en clair). | § 3.4, § 5.4 | Jeton `--field` à 3:1 (§ 12.2) pour les bords de champ, de case et d'interrupteur ; onglet actif marqué par le texte `ink` et un trait, pas par un fond. |

## 12. Proposition d'implémentation de la cible

### 12.1 Principes

1. Un seul jeu de jetons, en triplets HSL. Les filets et voiles se déclarent en **teinte + alpha** (`--rule` + `--rule-a`), consommés par `hsl(var(--rule) / calc(var(--rule-a) * <alpha-value>))`. C'est le moyen le plus simple de garder un filet en alpha sur fond sombre (voulu par la maquette) sans casser les modificateurs d'opacité (G-01). Vérifié dans Chromium : `border-rule/50` rend `rgba(255,255,255,0.04)` en sombre et `rgba(230,230,229,0.5)` en clair.
2. Les noms des variables égalent ceux des couleurs Tailwind (`--success` ↔ `success`). Fin des `--status-*` et `--skalr-*`.
3. Deux thèmes dessinés, pas inversés. Chaque statut a une valeur de texte par thème ; la teinte de fond vient de la couleur pleine à 14 % (10-11 % en clair).
4. Transition sans casse : les anciens noms (`background`, `foreground`, `muted-foreground`, `card`…) restent un temps comme **alias** des nouveaux jetons dans `tailwind.config.ts`. Le lot des jetons ne touche pas au JSX. Seule exception : `accent` (G-13), qui demande un codemod préalable.
5. `darkMode: ['selector', ':root:not(.light)']`, pour que les `dark:` restants fonctionnent pendant la migration.

### 12.2 Jetons cibles (valeurs vérifiées)

Sombre sur `:root`, clair sous `.light`. Teinte des neutres 40°, saturation 3 %. Les valeurs hexadécimales viennent de la maquette Mission du 25 septembre (sombre) et de la planche du 21 septembre (clair), ajustées là où un seuil WCAG n'était pas atteint (colonne « ajusté »).

| Jeton | Rôle | Sombre | Clair | Ajusté |
|---|---|---|---|---|
| `--ground` | fond de page | `40 3% 11%` #1d1c1b | `0 0% 98%` #fafafa | |
| `--ground-deep` | barre latérale, rail | `40 3% 8%` #151514 | `40 3% 96%` | |
| `--surface` | cartes | `40 3% 14%` #252423 | `0 0% 100%` | |
| `--surface-raised` | popovers, menus, dialogues | `40 3% 16%` #2a2928 | `0 0% 100%` (+ ombre) | |
| `--surface-sunk` | champs, segments | `40 3% 12%` #201f1e | `40 3% 95%` | |
| `--rule` / `--rule-a` | filet décoratif | `0 0% 100%` / `0.08` | `40 3% 90%` / `1` | |
| `--rule-strong` / `-a` | filet du bouton secondaire | `0 0% 100%` / `0.12` | `40 3% 86%` / `1` | |
| `--field` / `--field-a` | bord de champ, case, interrupteur | `0 0% 100%` / `0.36` | `40 3% 53%` / `1` | oui : 3,20 à 3,33:1 et 3,16 à 3,52:1 (les filets de champ de la maquette, 6 à 12 % de blanc, donnent 1,18 à 1,45:1) |
| `--hover` / `--hover-a` | survol du bouton discret, des lignes | `0 0% 100%` / `0.06` | `40 3% 11%` / `0.05` | |
| `--scrim` / `--scrim-a` | voile de modale | `0 0% 0%` / `0.55` | `40 3% 11%` / `0.40` | |
| `--ink` | texte principal | `0 0% 98%` #fafafa | `40 3% 11%` | |
| `--ink-2` | texte secondaire | `40 4% 73%` #bdbbb7 | `40 3% 32%` #54524f | |
| `--ink-3` | texte discret, métadonnées | `40 3% 57%` #95928e | `40 3% 42%` #6e6c68 | oui : 4,69 sur raised en sombre ; 4,68 sur sunk en clair (46 % échouait) |
| `--ink-placeholder` | exemples de saisie, désactivé | `40 3% 48%` | `40 3% 52%` | 3,94 / 3,26:1, réservé à du texte non porteur d'information |
| `--primary` / `--primary-fg` / `--primary-hover` | bouton principal monochrome | `0 0% 98%` / `40 3% 11%` / `36 9.4% 89.6%` #e7e5e2 | `40 3% 11%` / `0 0% 98%` / `40 3% 24%` | |
| `--accent` | signal, sélection, filtre indispensable, focus | `247.8 53.1% 71.6%` #9a90dd | `247.4 45.1% 57.8%` #6f63c4 | |
| `--accent-hover` / `--accent-press` | | `247.3 55% 76.5%` / `247 51.2% 67.1%` | `247.6 41.8% 52.2%` #5f52b8 / `249.4 37.2% 43.7%` | |
| `--accent-fg` | texte sur aplat d'accent | `250 28% 12%` | `0 0% 100%` | |
| `--accent-text` | texte sur teinte d'accent | `248.2 63% 84.1%` #c4bdf0 | `247 45% 48%` | |
| `--ring` | anneau de focus (2 px plein) | = `--accent` | = `--accent` | oui : le halo seul à 30 % donne 1,68 / 1,48:1 |
| `--success` / `--success-solid` | texte / pastille | `144.5 55.7% 67.3%` #7ddaa3 / `143.3 54.9% 47.8%` #37bd6b | `142 60% 27%` / `142 71% 45%` | |
| `--warning` / `--warning-solid` | | `38 89.7% 69.6%` #f7c46c / `37 91.3% 55.1%` #f5a524 | `32 90% 30%` / `37 91.3% 55.1%` | oui (clair) : 5,92:1 |
| `--danger` | erreur d'état (texte, teinte) | `0 76.5% 80%` #f3a5a5 | `0 62% 40%` | |
| `--info` | | `224.2 79.2% 81.2%` #a9bdf5 | `217 75% 38%` | |
| `--destructive` / `-hover` / `-fg` | action irréversible (aplat) | `0 67.4% 42.2%` #b42323 / `0 67.4% 37%` / `0 0% 100%` | idem | |

Contrastes de la proposition (script `proposal.py`, sortie `proposal-contrasts.md`) :

| Paire | Seuil | Sombre | Clair |
|---|---:|---:|---:|
| `ink-2` / ground, surface, raised | 4,5 | 8,86 / 8,09 / 7,57 | 7,42 / 7,75 / 7,75 |
| `ink-3` / ground, surface, raised, sunk, deep | 4,5 | 5,50 / 5,02 / 4,69 / 5,34 / 5,93 | 5,00 / 5,23 / 5,23 / 4,68 / 4,79 |
| `primary-fg` sur `primary`, sur `primary-hover` | 4,5 | 16,25 / 13,50 | 16,25 / 10,25 |
| `accent` en texte / ground, surface | 4,5 | 5,99 / 5,47 | 4,72 / 4,93 |
| `accent-fg` / `accent` (aplat) | 4,5 | 6,25 | 4,93 |
| `accent-text` / teinte d'accent | 4,5 | 7,72 | 6,26 |
| `success` / ground, surface, teinte | 4,5 | 10,09 / 9,21 / 7,98 | 6,01 / 6,28 / 5,47 |
| `warning` / ground, surface, teinte | 4,5 | 10,64 / 9,72 / 8,10 | 5,92 / 6,19 / 5,51 |
| `danger` / ground, surface, teinte | 4,5 | 8,70 / 7,95 / 8,09 | 6,88 / 7,19 / 5,73 |
| `info` / ground, surface, teinte | 4,5 | 9,07 / 8,28 / 6,77 | 7,28 / 7,60 / 6,11 |
| `destructive-fg` / `destructive` | 4,5 | 6,55 | 6,55 |
| anneau accent 2 px / ground, surface | 3 | 5,99 / 5,47 | 4,72 / 4,93 |
| `field` / sunk, surface | 3 | 3,31 / 3,26 | 3,16 / 3,52 |

`index.css` cible (extrait) :

```css
@layer base {
  :root {
    --ground: 40 3% 11%; --ground-deep: 40 3% 8%;
    --surface: 40 3% 14%; --surface-raised: 40 3% 16%; --surface-sunk: 40 3% 12%;
    --rule: 0 0% 100%; --rule-a: 0.08; --rule-strong: 0 0% 100%; --rule-strong-a: 0.12;
    --field: 0 0% 100%; --field-a: 0.36; --hover: 0 0% 100%; --hover-a: 0.06;
    --scrim: 0 0% 0%; --scrim-a: 0.55;
    --ink: 0 0% 98%; --ink-2: 40 4% 73%; --ink-3: 40 3% 57%; --ink-placeholder: 40 3% 48%;
    --primary: 0 0% 98%; --primary-fg: 40 3% 11%; --primary-hover: 36 9.4% 89.6%;
    --accent: 247.8 53.1% 71.6%; --accent-hover: 247.3 55% 76.5%; --accent-press: 247 51.2% 67.1%;
    --accent-fg: 250 28% 12%; --accent-text: 248.2 63% 84.1%; --ring: var(--accent);
    --success: 144.5 55.7% 67.3%; --success-solid: 143.3 54.9% 47.8%;
    --warning: 38 89.7% 69.6%; --warning-solid: 37 91.3% 55.1%;
    --danger: 0 76.5% 80%; --info: 224.2 79.2% 81.2%;
    --destructive: 0 67.4% 42.2%; --destructive-hover: 0 67.4% 37%; --destructive-fg: 0 0% 100%;
    --linkedin: 201 100% 35%; --whatsapp: 142 70% 49%;
    --radius-control: 0.5rem; --radius-surface: 0.75rem;
    --shadow-overlay: 0 12px 32px -8px hsl(0 0% 0% / 0.5), 0 0 0 1px hsl(0 0% 100% / 0.06);
  }
  .light {
    --ground: 0 0% 98%; --ground-deep: 40 3% 96%;
    --surface: 0 0% 100%; --surface-raised: 0 0% 100%; --surface-sunk: 40 3% 95%;
    --rule: 40 3% 90%; --rule-a: 1; --rule-strong: 40 3% 86%; --rule-strong-a: 1;
    --field: 40 3% 53%; --field-a: 1; --hover: 40 3% 11%; --hover-a: 0.05;
    --scrim: 40 3% 11%; --scrim-a: 0.4;
    --ink: 40 3% 11%; --ink-2: 40 3% 32%; --ink-3: 40 3% 42%; --ink-placeholder: 40 3% 52%;
    --primary: 40 3% 11%; --primary-fg: 0 0% 98%; --primary-hover: 40 3% 24%;
    --accent: 247.4 45.1% 57.8%; --accent-hover: 247.6 41.8% 52.2%; --accent-press: 249.4 37.2% 43.7%;
    --accent-fg: 0 0% 100%; --accent-text: 247 45% 48%;
    --success: 142 60% 27%; --success-solid: 142 71% 45%;
    --warning: 32 90% 30%; --danger: 0 62% 40%; --info: 217 75% 38%;
    --shadow-overlay: 0 12px 32px -8px hsl(40 3% 11% / 0.16), 0 0 0 1px hsl(40 3% 11% / 0.06);
  }
  :focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) {
    *, ::before, ::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
  }
}
```

### 12.3 Correspondance des jetons existants

| Existant (usages) | Cible | Action |
|---|---|---|
| `--background` (700 classes) | `--ground` | alias Tailwind `background` → `ground` pendant la migration |
| `--foreground` (1 988), `--card-foreground`, `--popover-foreground` | `--ink` | alias `foreground` ; `text-foreground/NN` (197) → `ink-2` ou `ink-3` selon l'opacité (≥ 70 → `ink-2`, sinon `ink-3`) |
| `--muted-foreground` (2 409) | `--ink-3` | alias ; valeur modifiée (56 → 57 % sombre, 46 → 42 % clair) ; `text-muted-foreground/NN` (290) → `ink-3` ou `ink-placeholder` |
| `--card` (188) | `--surface` | alias |
| `--popover` (12) | `--surface-raised` | alias |
| `--muted` (710), `--secondary` (11) | `--surface-sunk` | alias ; `--secondary` supprimé |
| `--accent` shadcn **gris** (256 : `bg-accent` 232) | `--hover` (fond de survol) ou `--surface-sunk` (tuile) | **codemod avant** de réaffecter `--accent` à l'indigo (G-13) |
| `--accent-foreground` (14) | `--ink` | remplacement |
| `--primary` / `--primary-foreground` (160 / 16) | `--primary` / `--primary-fg` | garder ; `bg-foreground text-background` à la main (143 boutons) → `Button variant="primary"` |
| `--destructive` (747) | **scinder** : `--danger` (texte et teinte d'erreur : `text-destructive` 305, `bg-destructive/5..15` 158) et `--destructive` (aplat d'action : `bg-destructive` 69 + 33 `AlertDialogAction`) | alias `destructive` → `danger` pour `text-` et les teintes ; revue manuelle des aplats |
| `--destructive-foreground` (29) | `--destructive-fg` | renommer |
| `--border` (1 552), `--sidebar-border` | `--rule` (+ `--rule-a`) | alias `border` → `rule` au motif alpha : corrige G-01 sans toucher les 96 classes |
| `--input` (8) | `--field` | renommer |
| `--ring` (61), `--sidebar-ring` (23) | `--ring` = accent | valeur changée (G-06) |
| `--sidebar-background` / `-foreground` / `-accent` / `-accent-foreground` | `--ground-deep` / `--ink-2` / `--hover` / `--ink` | alias |
| `--sidebar-primary`, `--sidebar-primary-foreground` | | supprimer (0 usage) |
| `--status-success` / `-warning` / `-info` (1 244 classes) | `--success` / `--warning` / `--info` (texte par thème) + `*-solid` | renommer (corrige G-02). `bg-success` (50) → `bg-success-solid` ou teinte ; `text-*-foreground` (112) → `ink` sur teinte |
| `--status-*-foreground`, `--status-*-muted` | | supprimer ; teinte = `bg-success-solid/14` |
| `--skalr-purple` (`brand-purple` 123) | `--accent` | remplacer ; `brand-pink` 11, `brand-cyan` 8, `brand-blue` 2, `brand-green` 0 : supprimer |
| `--brand-linkedin`, `--brand-linkedin-hover`, `--brand-whatsapp` | `--linkedin`, `--whatsapp` | garder (marques tierces), renommer pour libérer le préfixe `brand` |
| `--chart-1..5` | | supprimer (0 usage) ; si `chart.tsx` est ranimé, palette de données dédiée validée par thème |
| `--landing-*` | | garder, cantonnés aux pages publiques |
| `--k-bg` / `--k-surface` / `-2` / `-3` | `--ground-deep` / `--ground` / `--surface` / `--surface-raised` | les 7 fichiers `--k` passent aux classes Tailwind (418 classes arbitraires) |
| `--k-hairline` / `-hover` / `-focus` | `--rule` / `--rule-strong` / `--field` | idem |
| `--k-text` / `-2` / `-muted` / `-placeholder` | `--ink` / `--ink-2` / `--ink-3` / `--ink-placeholder` | idem |
| `--k-accent` / `-hover` / `-press` / `-ring` / `-tint` / `--k-on-accent` | `--accent` / `-hover` / `-press` / `--ring` / `accent/14` / `--accent-fg` | idem |
| `--k-success`, `--k-warn`, `--k-bad` (non déclaré) | `--success-solid`, `--warning-solid`, `--danger` | idem |
| `--shadow-2xs` … `--shadow-2xl` (8) | `--shadow-overlay` (+ `shadow-sm` pour les cartes en clair) | réduire à 2 niveaux |
| `--radius` | `--radius-control` 8 px, `--radius-surface` 12 px | |
| `--tracking-normal`, `--spacing` | | supprimer (0 usage) |

Les alias Tailwind ne couvrent pas les **192 appels directs `hsl(var(--x))`** écrits dans le code (34 fichiers : styles en ligne, SVG, graphiques ; `--status-success` 32, `--status-warning` 19, `--foreground` 17, `--primary` 16, `--muted-foreground` 16, `--status-info` 14, `--skalr-purple` 13, `--destructive` 10…). Pendant la migration, les anciennes variables restent déclarées comme alias CSS (`--background: var(--ground)`, `--status-success: var(--success-solid)`…). Exception : `--border` et les autres jetons à alpha, dont l'alias doit composer l'alpha (`--border: 0 0% 100% / 0.08` reste invalide avec un modificateur, G-01) ; ses 7 appels directs et les 2 d'`index.css` passent à `hsl(var(--rule) / var(--rule-a))`.

### 12.4 Configuration Tailwind

```ts
// tailwind.config.ts (extrait cible)
const c = (v: string) => `hsl(var(--${v}) / <alpha-value>)`;
const ca = (v: string) => `hsl(var(--${v}) / calc(var(--${v}-a) * <alpha-value>))`;
export default {
  darkMode: ['selector', ':root:not(.light)'],   // ranime les dark: restants (vérifié)
  theme: { extend: {
    colors: {
      ground: { DEFAULT: c('ground'), deep: c('ground-deep') },
      surface: { DEFAULT: c('surface'), raised: c('surface-raised'), sunk: c('surface-sunk') },
      rule: { DEFAULT: ca('rule'), strong: ca('rule-strong') },
      field: ca('field'), hover: ca('hover'), scrim: ca('scrim'),
      ink: { DEFAULT: c('ink'), 2: c('ink-2'), 3: c('ink-3'), placeholder: c('ink-placeholder') },
      primary: { DEFAULT: c('primary'), fg: c('primary-fg'), hover: c('primary-hover') },
      accent: { DEFAULT: c('accent'), hover: c('accent-hover'), press: c('accent-press'), fg: c('accent-fg'), text: c('accent-text') },
      success: { DEFAULT: c('success'), solid: c('success-solid') },
      warning: { DEFAULT: c('warning'), solid: c('warning-solid') },
      danger: c('danger'), info: c('info'),
      destructive: { DEFAULT: c('destructive'), hover: c('destructive-hover'), fg: c('destructive-fg') },
      ring: c('ring'), linkedin: c('linkedin'), whatsapp: c('whatsapp'),
      // alias de migration, à retirer au dernier lot
      background: c('ground'), foreground: c('ink'), card: c('surface'), popover: c('surface-raised'),
      muted: { DEFAULT: c('surface-sunk'), foreground: c('ink-3') }, border: ca('rule'), input: ca('field'),
    },
    fontFamily: {
      sans: ['Instrument Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      mono: ['Space Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      brand: ['Bricolage Grotesque', 'Instrument Sans', 'sans-serif'],   // pages publiques seulement
    },
    fontSize: {
      caption: ['0.625rem', { lineHeight: '0.875rem' }],      // 10/14
      micro: ['0.6875rem', { lineHeight: '0.9375rem' }],      // 11/15
      'body-sm': ['0.75rem', { lineHeight: '1.0625rem' }],    // 12/17
      body: ['0.8125rem', { lineHeight: '1.1875rem' }],       // 13/19
      'body-lg': ['0.875rem', { lineHeight: '1.25rem' }],     // 14/20
      'title-sm': ['1rem', { lineHeight: '1.375rem', fontWeight: '600' }],   // 16
      title: ['1.25rem', { lineHeight: '1.625rem', fontWeight: '600' }],     // 20
      'title-lg': ['1.5rem', { lineHeight: '1.875rem', fontWeight: '700' }], // 24
      'title-xl': ['2rem', { lineHeight: '2.375rem', fontWeight: '700' }],   // 32
      '3xs': ['0.625rem', { lineHeight: '0.875rem' }], '2xs': ['0.6875rem', { lineHeight: '0.9375rem' }], // alias
    },
    borderRadius: {
      xs: '0.25rem', control: 'var(--radius-control)', surface: 'var(--radius-surface)',
      // convergence immédiate des classes existantes, avant codemod :
      DEFAULT: '0.25rem', sm: 'var(--radius-control)', md: 'var(--radius-control)',
      lg: 'var(--radius-surface)', xl: 'var(--radius-surface)', '2xl': '1rem', '3xl': '1rem',
    },
    spacing: { 'control-xs': '1.75rem', 'control-sm': '2rem', 'control-md': '2.25rem', 'control-lg': '2.5rem' },
    zIndex: { base: '0', raised: '10', sticky: '100', overlay: '200', modal: '300', popover: '350', toast: '400' },
    transitionDuration: { DEFAULT: '150ms', fast: '150ms', base: '200ms', slow: '300ms' },
    transitionTimingFunction: { DEFAULT: 'cubic-bezier(0.2, 0, 0, 1)', out: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    boxShadow: { overlay: 'var(--shadow-overlay)' },
  } },
};
```

Points de décision :
- **`popover` 350 est un ajout nécessaire à l'échelle à cinq calques** de la maquette. Radix rend les listes, menus et info-bulles en portail à la racine : placés au niveau `overlay` 200, ils passeraient sous une modale (300) quand ils s'ouvrent depuis elle. Le toast reste au-dessus de tout, à 400.
- `text-sm` : le redéfinir à 13/19 fait passer d'un coup les 664 usages et les 25 primitives au palier `body` (§ 4.4). C'est cohérent avec l'usage (`text-[13px]` 112 contre `text-[14px]` 33), mais c'est un changement visuel global à valider sur les captures. Garder `text-base` à 16 px pour les champs mobiles (zoom d'iOS).
- La convergence des rayons par la configuration (md → 8, xl → 12) harmonise 526 classes sans toucher le JSX. Le codemod vers `rounded-control` / `rounded-surface` vient ensuite, pour que le nom dise l'intention.

### 12.5 API cible des primitives

| Primitive | API | Notes |
|---|---|---|
| `Button` | `variant: 'primary' \| 'secondary' \| 'ghost' \| 'destructive' \| 'link'` (défaut `primary`) ; `size: 'xs' \| 'sm' \| 'md' \| 'lg'` = 28/32/36/40 (défaut `md`) ; `loading`, `iconLeft`, `iconRight`, `asChild` | `rounded-control` ; primary `bg-primary text-primary-fg hover:bg-primary-hover` ; secondary `border-rule-strong hover:bg-hover` ; ghost `hover:bg-hover` ; focus `ring-2 ring-ring ring-offset-2 ring-offset-ground`. Corriger `loading` + `asChild` (`Slottable`) |
| `IconButton` (nouveau) | mêmes `variant`/`size`, carré, `rounded-full`, **`aria-label` obligatoire au typage** | remplace les 36 `size="icon"` et les 81 boutons icône sans nom |
| `Input`, `Textarea`, `SelectTrigger` | `size: 'sm' \| 'md'` (32/36, défaut `md`) ; `invalid` | fond `surface-sunk`, bord `field`, focus bord `accent` + anneau ; `Textarea` gagne `invalid` |
| `Field` (nouveau, ou `form.tsx` ranimé) | `label`, `hint`, `error`, `required`, `children` | câble `id`, `htmlFor`, `aria-describedby`, `aria-invalid` (1 seul `aria-describedby` aujourd'hui) |
| `Badge` | `tone: 'neutral' \| 'accent' \| 'success' \| 'warning' \| 'danger' \| 'info'` ; `variant: 'soft' \| 'outline' \| 'dot'` ; `size: 'sm' \| 'md'` (20/24) | pas de focus (non interactif) ; `soft` = teinte `*-solid/14` + texte `*` ; rayon `full`, `xs` sous 20 px |
| `Chip` (nouveau) | `pressed`, `onRemove`, `tone` | filtre interactif, `aria-pressed`, cible 28 px |
| `IconTile` | `tone` (5 tons de la maquette), `size: 24 \| 28 \| 36 \| 48` | remplace les 76 `bg-emerald-500/15` |
| `Card` | `variant: 'plain' \| 'interactive'`, `padding: 'sm' \| 'md'` | `rounded-surface bg-surface border-rule` ; `CardTitle` en `body-lg` 600 |
| `Dialog` | `size: 'sm' \| 'md' \| 'lg' \| 'fullscreen'` | `bg-surface-raised rounded-surface`, voile `bg-scrim`, `z-modal` ; la variante `fullscreen` remplace les 13 calques faits main |
| `AlertDialog` | `tone: 'default' \| 'destructive'` | `Action` = `Button primary` ou `destructive` ; `Cancel` = `secondary` |
| `Sheet` | `side`, `size` | rayon `surface` sur le bord libre, fond `surface-raised` |
| Surfaces flottantes (`Popover`, `Tooltip`, `DropdownMenu`, `HoverCard`, `SelectContent`, `Command`) | classe commune `surface-raised rounded-surface border-rule shadow-overlay z-popover` | items `h-8 rounded-control`, surlignage `bg-hover text-ink` plus marque d'accent au clavier |
| `Tabs` | `variant: 'underline' \| 'segmented'`, `size: 'sm' \| 'md'` | onglet actif = texte `ink` + trait accent (underline) ou fond `surface` + filet (segmented) |
| `Table` | `density: 'compact' \| 'default'` (lignes de 32/40) | en-tête `body-sm` 600 `ink-3`, sans capitales |
| `Switch`, `Checkbox`, `RadioGroup` | inchangé | bord et piste éteinte `field` (3:1), coché `primary` (l'accent reste aux signaux), `indeterminate` pour `Checkbox` |
| `Skeleton` | `shape: 'line' \| 'block' \| 'circle'` | `rounded-xs` pour les barres de moins de 20 px |
| `Spinner` (nouveau) | `size: 'xs' \| 'sm' \| 'md'`, `label` | remplace `Loader2 animate-spin` (200) et `BrutalSpinner` ; statique si mouvement réduit |
| Toasts | `toast.success/error/info/warning`, `action` | sonner seul, thème de l'application, `z-toast`, `pointer-events: auto` |

### 12.6 Primitives partagées à créer ou ranimer

| Primitive | Origine | API |
|---|---|---|
| `EmptyState` | fusion de `ui/EmptyState` (7 usages) et `layout/EmptyState` (0, meilleure API) | `icon` (IconTile), `title`, `description`, `action`, `secondaryAction`, `size: 'sm' \| 'md'`, `role="status"` ; cible : les 194 états « Aucun… » |
| `ErrorState` | **à créer**, par promotion de `marketplace/ErrorBox.tsx` (11 importeurs) | `title` (ce qui n'a pas pu être chargé), `description` (quoi faire), `detail` (message technique, repliable), `onRetry`, `action`, `role="alert"` ; ton `danger` ; distingue enfin une panne d'une liste vide |
| `LoadingState` | **à créer** | `variant: 'list' \| 'table' \| 'card' \| 'inline'`, `rows`, `aria-busy`, délai d'affichage de 150 ms ; remplace `BrutalLoader` (22) |
| `PageHeader` | ranimer `layout/PageHeader` (0 usage) | `breadcrumb`, `title`, `meta`, `description`, `actions` ; titre en `title-lg` Instrument Sans 600 |
| `Breadcrumb` | ranimer `ui/breadcrumb.tsx` (mort) | fil d'Ariane de la maquette Mission ; corriger « More » en « Plus » |
| `Section` | ranimer `layout/Section` (0 usage) | `title`, `description`, `action`, `as` ; remplace les 41 `Section` locales |
| `PageLayout` | garder (3 pages) | largeurs nommées ; retirer l'animation d'entrée en mouvement réduit |
| `SaveIndicator` | **à créer** (maquette Mission : l'enregistrement automatique est muet) | `status: 'idle' \| 'saving' \| 'saved' \| 'error'`, `aria-live="polite"` |
| `Kbd` | à extraire (raccourcis de la barre latérale et de la palette) | `font-mono text-caption` |
| `StatTile` | décider : ranimer (Dashboard, Insights) ou supprimer | `label`, `value` (Space Mono tabulaire), `tone`, `trend` |

### 12.7 Ordre de mise en œuvre et garde-fous

1. **Lot 0, correctifs P0 sans refonte (≈ 1 jour)** : `darkMode` en mode `selector` (G-04) ; déclarer `--success`, `--info` et `--k-bad`, ou corriger les 12 appels (G-02) ; remplacer les 96 `*-border/NN` (G-01), les 14 classes non générées et le keyframe manquant (G-03) ; anneau de focus accent et `focus-visible:` dans `select`, `badge`, `dialog`, `sheet` (G-06) ; thème et `pointer-events` de sonner (G-10) ; `MotionConfig` et règle CSS de mouvement réduit (G-15).
2. **Lot 1, jetons** : nouvel `index.css`, configuration avec alias, polices (Instrument Sans et Space Mono ; retirer Outfit, Space Grotesk, Instrument Serif), suppression de la règle `h1-h3`. Aucun JSX modifié hors codemod `accent` (G-13). Contrôle : captures avant/après des 36 écrans déjà capturés dans `captures/avant/` (sombre et clair, bureau et mobile).
3. **Lot 2, primitives** : `Button`/`IconButton`, champs + `Field`, `Badge`/`Chip`/`IconTile`, surfaces flottantes, `Dialog fullscreen`, `AlertDialog`, `Tabs`, `Spinner`/`Skeleton`, les trois primitives d'état, `PageHeader`/`Section`/`Breadcrumb`.
4. **Lot 3, migration par zone**, en commençant par `/missions/:id` (maquette Mission) : codemods `text-[Npx]` → paliers, rayons, `bg-foreground` → `Button primary`, fichiers `--k` → classes, tuiles emerald → `IconTile`, calques faits main → `Dialog fullscreen`.
5. **Lot 4, nettoyage** : Toaster Radix, 16 fichiers morts de `ui/`, 4 de `layout/`, `App.css`, classes `konekt-skalr-*`/`skalr-*`, alias de migration.

Compteurs à verrouiller par cliquet (valeurs de main au 25/09) :

| Compteur | Valeur |
|---|---:|
| `text-[Npx]` | 1 124 |
| `<button>` bruts | 633 |
| `*-border/NN` et autres opacités sur jeton à alpha | 96 |
| `var(--x)` non déclarées | 3 noms (`--success`, `--info`, `--k-bad`), 12 appels |
| classes absentes du CSS compilé | 6 motifs, 14 occurrences (+ 1 keyframe manquant) |
| variantes `dark:` | 53 |
| couleurs de palette brute | 433 |
| `z-[N]` arbitraires | 27 |
| rayons arbitraires `rounded-[…]` | 36 |
| surcharges `h-*` sur `Button`/`Input`/`SelectTrigger` | 155 / 106 / 65 |
| `text-muted-foreground/NN` + `text-foreground/NN` | 487 |
| fichiers framer-motion sans mouvement réduit | 48 |

## 13. Note : commit 8ff8b9a6 (branche d'audit, hors main ; devenu `b90f07a1` après rebasage sur `main`)

Pendant l'audit, le chantier design a commité « Design, lots 1 et 2 : socle commun et coquille de l'application » (8ff8b9a6, 09:43) sur `claude/design-ux-audit-g8ovch`. main reste à 58820844. Ce commit n'est pas audité ici, mais une vérification rapide (`git show` / `git grep` en lecture seule) le situe par rapport aux constats :

- **Déjà traité** : jetons de filet en teinte + alpha (`tailwind.config.ts:69-73`, G-01) ; `darkMode: ["variant", "&:not(.light *)"]` (l.7, G-04) ; `--success`, `--info`, `--k-bad` déclarés (`index.css:92,94,155`, G-02) ; toasts sonner qui suivent le thème de l'application (`useAppTheme`, G-10 en partie) ; `text-sm` à 13 px, calques nommés, polices, mouvement réduit, `ErrorState` et `Spinner` (d'après le message de commit).
- **Encore présent dans 8ff8b9a6** :
  - les classes sans CSS généré (G-03) : `bg-foreground/8` (`CandidateSequencesPanel.tsx:51`, `SequencesList.tsx:782,929`, `MessageView.tsx:724`), `border-border/8` (`AgentConversationsList.tsx:40,97`), `w-4.5`/`h-4.5` (`WorkflowStepNode.tsx`), `line-clamp-8` (`ScorecardFullPage.tsx:688`) ;
  - le `@keyframes shimmer-spin` manquant (`magicui/shimmer-button.tsx:55`) ;
  - **l'action d'un toast reste inopérante par-dessus un dialogue Radix ouvert**. Aucune règle `pointer-events: auto` n'est posée pour sonner (`ui/sonner.tsx` du commit), or c'est le défaut mesuré au § 2.7 : le clic tombe sur le voile et ferme le dialogue.
- À recontrôler sur ce commit avec les scripts du scratchpad (`gencheck.py` après recompilation, `rt/runtime-check.mjs`, `contrast2.py`, `proposal.py`) : les contrastes des nouvelles valeurs, et le fait que le halo de focus ne soit pas le seul indicateur (1,68:1 seul, G-06).
