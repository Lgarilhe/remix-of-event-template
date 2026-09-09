# 06 — PIPELINE / ATS & FICHES CANDIDAT — Inventaire exhaustif

## 0. Cartographie fichiers

| Zone | Fichiers |
|---|---|
| Pages | `src/pages/ATS.tsx` (494 l., route `/pipeline`), `src/pages/ScorecardFullPage.tsx` (811 l., route `/ats/scorecard/:candidateId`), `src/pages/Qualification.tsx` (360 l., route `/qualification/:id`) |
| `components/ats/` (21 fichiers + `candidate-detail/` 13) | ATSCandidateCard, ATSDraggableCard, ATSDroppableColumn, ATSFilters, ATSKanban, ATSKanbanSkeleton, ATSPipelineAnalytics, ATSStats, ATSStatsSkeleton, ATSTable, ATSTableSkeleton, ATSTimeline, AudioSetupGuide, BulkActionsBar, CandidateCommentsTab, CandidateDetailModal, FraudDetectionTab, JobDetailSheet, LiveCoachingPanel (36 Ko), RemindersSidebar, ScorecardTab (70 Ko / 1403 l.) |
| `components/ats/candidate-detail/` | ActionsTab, ActivityTab, CVTab, EvaluationTab, ManualContactsEditor, NotesTab, OverviewTab (40 Ko), PrepSheetTab, ProfileDetailedTab, ProfileTab, ScoringCard, shared.tsx, index.ts |
| `components/candidates/` | CandidateCard, CandidateFilters, CandidateList, CandidatePipeline, CompanyLogo, DraggableCandidateCard, DroppableColumn, PipelineStats, shared/CandidateAvatar |
| `components/pedigree/` | PedigreeRequirementsEditor (1 seul fichier) |
| Sources de vérité | `src/hooks/useATSData.ts` → `ATS_STAGES` ; `src/types/shortlist.ts` → `PIPELINE_STAGES` |

---

## 1. Page `/pipeline` — `src/pages/ATS.tsx`

### 1.1 Structure
- `SEOHead` : title `"ATS - Suivi des candidats | Konekt"`, description `"Centralisez et gérez toutes vos interactions avec les candidats"`.
- Wrapper : `min-h-screen bg-background` > `py-6 pb-8` > `max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8`.
- **Header (1 ligne)** : `<AnimatedFunnel size={32} speed={0.8} />` + `<h1>` **"Pipeline"** (`font-display text-xl sm:text-2xl font-bold tracking-tight`).
  - Badge de sync conditionnel (`isFetching && !loading`) : texte **"Sync…"**, `text-[10px] text-info border-info/30 bg-info/10 rounded-full px-2 py-0.5 uppercase tracking-wider font-semibold animate-pulse`.
- **Actions header** (boutons natifs, pas `<Button>`) :
  - **"Actualiser"** — `RefreshCw w-3.5` (`animate-spin` si loading), `h-8 px-3 rounded-full border border-border bg-background hover:bg-accent text-[11.5px]`, `disabled={loading}` → `disabled:opacity-30`. Label masqué `<sm`.
  - **"Rappels"** — `Bell w-3.5`, toggle ; actif = `bg-foreground text-background border-foreground`. Label masqué `<sm`.
- **Bandeau stats** : `<ATSStats>` (ou `<ATSStatsSkeleton>` si `loading && candidates.length===0`).
- **Sélecteur de vue** — pill segmented control `inline-flex bg-muted/40 p-0.5 rounded-full border border-border overflow-x-auto scrollbar-hide`. 5 onglets, chacun `h-8 px-3 rounded-full text-[11.5px] font-medium` + icône 3D webp `w-4 h-4` :

| value | label FR | icône |
|---|---|---|
| `kanban` | **Kanban** | `icon-kanban-3d.webp` |
| `table` | **Table** | `icon-table-3d.webp` |
| `timeline` | **Timeline** | `icon-timeline-3d.webp` |
| `shortlist` | **Shortlist Client** | `icon-timeline-3d.webp` *(doublon d'icône)* |
| `analytics` | **Analytics** | `icon-analytics-3d.webp` |

  Actif : `bg-foreground text-background shadow-sm`. Inactif : `text-muted-foreground hover:text-foreground hover:bg-muted/60`. Synchronisé à l'URL (`?view=`, `kanban` supprime le param).
- **Filtres** : `<ATSFilters>` à droite du segmented control.
- **Deep-links** : `?candidate=ID`, `?tab=evaluation`, `?prepareInterview=1`.

### 1.2 États
- **Erreur** : carte `rounded-xl bg-destructive/5 border-destructive/30 p-6 text-center`, message `{error}` + bouton **"Réessayer"** (`h-9 px-5 rounded-full border border-border`).
- **Pipeline vide** (`!loading && candidates.length===0`) : `<EmptyState>` icône `icon-ats-3d.webp` `w-7 h-7`, titre **"Aucun candidat dans l'ATS"**, description **"Les candidats apparaîtront ici automatiquement lorsque vous les contacterez via Outreach ou les ajouterez manuellement."**, CTA **"Aller sur Outreach"** → `/missions`.
- **Loading** : `ATSStatsSkeleton`, `ATSKanbanSkeleton`, `ATSTableSkeleton`. ⚠️ **Timeline et Analytics n'ont AUCUN skeleton**.
- **Shortlist loading** : `Loader2 w-8 h-8 animate-spin` centré `py-20` (pas de skeleton).
- **Shortlist vide** : `<EmptyState>` `Users w-7 h-7`, **"Aucune shortlist client"**, **"Connectez Notion dans les paramètres pour synchroniser votre base candidats."**, CTA **"Paramètres"** → `/settings?tab=integrations`.

### 1.3 Vue "Shortlist Client" (sous-toolbar propre)
- Segmented control secondaire (même style) : **Pipeline** (`LayoutGrid`) / **Liste** (`List`).
- `<CandidateFilters>` (composant DIFFÉRENT de ATSFilters — voir §7).
- `<PipelineStats>` puis `<CandidatePipeline>` ou `<CandidateList>`.

---

## 2. Étapes / stages (libellés + couleurs)

### `ATS_STAGES` — `hooks/useATSData.ts` (10 colonnes kanban)
| key = label FR | `color` (déclaré mais **jamais consommé** par ATSDroppableColumn) |
|---|---|
| Nouveau | `bg-muted border-border` |
| Contacté | `bg-info/10 border-info/30` |
| Répondu | `bg-brand-cyan/10 border-brand-cyan/30` |
| Pressenti | `bg-muted border-border` |
| Pré-qualif | `bg-brand-cyan/10 border-brand-cyan/30` |
| CV envoyé | `bg-brand-purple/10 border-brand-purple/30` |
| ITW en cours | `bg-warning/10 border-warning/30` |
| Offre | `bg-brand-purple/10 border-brand-purple/30` |
| Gagné | `bg-success/10 border-success/30` |
| Perdu | `bg-destructive/10 border-destructive/30` |

### `PIPELINE_STAGES` — `types/shortlist.ts` (6 colonnes, shortlist Notion)
Pressenti (`bg-muted`), CV envoyé (`bg-info/10`), ITW en cours (`bg-warning/10`), Offre (`bg-brand-purple/10`), Gagné (`bg-success/10`), Perdu (`bg-destructive/10`).
⚠️ **"CV envoyé" a une couleur différente entre les deux tables** (`info` vs `brand-purple`).

### `GUIDE_TIMES` (seuils de stagnation, en jours) — **dupliqués à l'identique dans 3 fichiers**
`ATSCandidateCard.tsx` (l.49), `ATSTable.tsx` (l.134, inline dans le JSX), `ATSPipelineAnalytics.tsx` (l.20) :
`Nouveau:3, Contacté:5, Répondu:3, Pressenti:5, Pré-qualif:7, CV envoyé:5, ITW en cours:10, Offre:7`.
Une 4ᵉ variante existe dans `OverviewTab.tsx` sous le nom `STAGNATION_THRESHOLDS_DAYS`.

---

## 3. Vue Kanban

### 3.1 `ATSKanban.tsx`
- `DndContext` @dnd-kit, `rectIntersection`, `PointerSensor` avec `activationConstraint: { distance: 5 }`.
- Conteneur : `ScrollArea` + `flex gap-4 pb-4 min-w-max` + `ScrollBar orientation="horizontal"`.
- `DragOverlay dropAnimation={null}` : `w-[280px] opacity-90` rendant `<ATSCandidateCard isDragging>`.
- Handlers : `onDragStart` (set activeCandidate), `onDragOver` (set activeOverColumn), `onDragEnd` (→ `onStageChange`, no-op si même colonne), `onDragCancel`.

### 3.2 `ATSDroppableColumn.tsx`
- Largeur fixe `w-[280px] flex-shrink-0 rounded-xl border bg-card`.
- État survol (`isOver`) : `border-foreground/40 ring-2 ring-foreground/20 shadow-lg scale-[1.02] bg-muted/30`.
- `aria-label="Colonne {label}, {n} candidat(s)"`, `role="region"`.
- **Header sticky** : `sticky top-0 z-10 p-3 border-b rounded-t-xl bg-muted/40 backdrop-blur-sm` ; titre `font-display font-bold text-[13px] tracking-tight truncate` ; **compteur** pill `min-w-[22px] h-5 px-1.5 rounded-full text-[11px] bg-foreground/10 font-bold tabular-nums`.
- Zone cartes : `p-2 space-y-2 min-h-[200px] max-h-[600px] overflow-y-auto`.
- **Colonne vide** : `border-2 border-dashed rounded-lg py-8 text-[11px] uppercase tracking-wider` → texte **"Aucun candidat"**, ou **"⬇️ Déposer ici"** (emoji en dur) quand `isOver` (`text-foreground border-foreground bg-foreground/5 font-bold`).
- **Pagination** : `INITIAL_VISIBLE = 10`, `LOAD_MORE_COUNT = 10`. Footer `p-2 border-t bg-muted/20` :
  - **"Voir plus (N)"** `ChevronDown w-3`, `h-7 px-3 rounded-full text-[11px] border border-border`.
  - **"Réduire"** `ChevronUp w-3`, même style.

### 3.3 Anatomie carte candidat kanban — `ATSCandidateCard.tsx`
Conteneur : `group rounded-xl bg-card border p-3 cursor-pointer hover:shadow-md hover:border-foreground/20 relative`, `role="button" tabIndex={0}`, Enter/Espace = ouvrir, `aria-label="Candidat {name}, score {n}%, étape {stage}"`.

États :
- **sélectionné** : `border-foreground/40 ring-2 ring-foreground/20 bg-accent/30`
- **en cours de drag** : `shadow-lg border-foreground/30` + wrapper `opacity-50` (ATSDraggableCard)
- **stagnant** : `border-l-4 border-l-destructive`

Éléments (dans l'ordre) :
1. **Checkbox bulk** (si `onToggleSelect`) — `absolute top-1.5 left-1.5 w-4 h-4 rounded-md border-2`, `opacity-0 group-hover:opacity-100`, cochée = `bg-foreground border-foreground` + SVG check `w-3 h-3`. `role="checkbox" aria-checked`, `aria-label="Sélectionner {name} pour action groupée"`. ⚠️ **Pas d'avatar sur la carte kanban ATS.**
2. **Nom** `h4 font-display font-bold text-[14px] tracking-tight leading-tight truncate`.
3. **Headline** `text-xs text-muted-foreground truncate`.
4. **Indicateurs (droite)** :
   - **Score** pill `text-2xs font-bold tabular-nums px-1.5 py-0.5 rounded-full border`, seuils : ≥70 `success`, ≥40 `warning`, sinon `destructive`. `title="Score IA : {n}/100"`.
   - `Bell w-3.5 text-primary` si `hasReminder`.
   - `StickyNote w-3.5` + compteur si `notesCount > 0`.
5. **Badge source** (`SOURCE_CONFIG`) : `shortlist`→**Pipeline** `FileText` · `sequence`→**Séquence** `GitBranch` · `inmail`→**InMail** `Send` · `outreach`→**Outreach** `Target`. Style `text-2xs px-1.5 py-0.5 rounded-full border-border bg-foreground/[0.06] uppercase tracking-wider font-semibold`.
6. **Badge outreachStatus** : **Intéressé** (`ThumbsUp`, success) · **Pas intéressé** (`ThumbsDown`, destructive) · **Répondu** (`MessageCircle`, info).
7. **Badge poste** (`jobTitle`) — tronqué à 20 car. + `...`, cliquable → `onJobClick(jobId)` (`stopPropagation`), `max-w-[140px]`.
8. **Séquence** : `GitBranch w-3` + `sequenceName` + badge `sequenceStatus` **brut non traduit** (`text-3xs`).
9. **Tags** : 3 max, `bg-accent/20 border-accent/40`, puis `+N`.
10. **Alerte stagnation** : `AlertTriangle w-3` + **"Inactif depuis {n}j (max {guide}j)"** `text-xs text-destructive font-medium`.
11. **Expertise** : 3 max, `bg-foreground/[0.06] border-border`, puis `+N`.
12. **Footer** : logo LinkedIn (`linkedin-logo.webp` `w-3 h-3`), `Mail w-3` (`aria-label="Email disponible"`), et à droite temps relatif **"il y a Xj"** (`formatDistanceToNowStrict` locale fr) ; > 30j → date courte `fr-FR {day, month:short}`. `title` = date complète. Rouge si stagnant.

### 3.4 `BulkActionsBar.tsx` (barre d'actions groupées)
- Visible dès 1 sélection. `fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] rounded-full bg-foreground text-background shadow-xl`, `animate-in fade-in-0 slide-in-from-bottom-4 duration-200`. `role="toolbar"`.
- `CheckCheck w-4` + **"{n} sélectionné(s)"** `text-[12px] font-bold tabular-nums`.
- Séparateur `w-px h-5 bg-background/30`.
- Bouton **"Déplacer vers…"** (`Button variant="ghost" size="sm" h-8`, icône `ArrowRight` ou `Loader2 animate-spin` si loading) → `DropdownMenu` `align="center" side="top"` avec `DropdownMenuLabel` **"Choisir une étape"**, séparateur, puis les 10 `ATS_STAGES` en items.
- Bouton icône `X` — `aria-label="Tout désélectionner"`, `Button variant="ghost" size="icon" h-8 w-8`.
- **Toasts** : succès `"{n} candidat(s) déplacé(s) vers \"{stage}\""` · erreur `"Erreur lors du déplacement groupé"`.
- ⚠️ Bulk move exécuté **séquentiellement** (boucle `for await`) dans ATS.tsx.

---

## 4. Vue Table — `ATSTable.tsx`

Conteneur `rounded-xl bg-card border overflow-hidden`. Header `bg-accent/50 border-b`.

| # | En-tête exact | Largeur | Triable (`SortKey`) |
|---|---|---|---|
| 1 | **Candidat** | `w-[250px]` | ✅ `name` |
| 2 | **Étape** | `w-[120px]` | ✅ `stage` |
| 3 | **Source** | `w-[100px]` | ✅ `source` |
| 4 | **Poste** | `w-[200px]` | ✅ `jobTitle` |
| 5 | **Séquence** | `w-[150px]` | ❌ |
| 6 | **Activité** | `w-[100px]` | ✅ `lastActivity` |
| 7 | **Score** | `w-[70px]` | ❌ |
| 8 | **Actions** | `w-[80px]` | ❌ |

- Tri par défaut : `lastActivity` / `desc`. Clic sur la même colonne inverse le sens ; nouvelle colonne → `desc`. Icône unique `ArrowUpDown w-3` **sans indication du sens actif** (pas de chevron directionnel).
- Ligne : `cursor-pointer hover:bg-accent/20`, clic = ouvre la modale.
- Cellule Candidat : nom `font-medium text-sm truncate` + `Bell` + `StickyNote`+compteur ; headline `text-xs max-w-[200px]`.
- Cellule Étape : pill `text-[10.5px] px-2 py-0.5 rounded-full border bg-foreground/[0.06] uppercase tracking-wider font-semibold` + `AlertTriangle w-3 text-destructive` si stagnant (`title="Inactif {n}j (max {g}j)"`).
- Cellule Source : `SOURCE_LABELS` = Pipeline / Séquence / InMail / Outreach + icônes.
- Cellule Poste : lien hover `hover:underline` → `onJobClick`. Vide = `—`.
- Cellule Séquence : `GitBranch` + nom `max-w-[120px]`. Vide = `—`.
- Cellule Activité : date `fr-FR {day, month:short}` (⚠️ **pas** de temps relatif, contrairement au kanban).
- Cellule Score : pill `text-[11px] font-bold tabular-nums` seuils 70/40. Vide = `—`.
- Cellule Actions : 2 boutons carrés `h-7 w-7 rounded-lg border border-border hover:bg-accent` — logo LinkedIn (ouvre l'URL), `Mail w-4` (`mailto:`). Pas de menu contextuel.
- **Aucun résultat** : `<TableCell colSpan={8}>` **"Aucun candidat trouvé"** `text-center py-12 text-muted-foreground text-xs uppercase tracking-wider`.
- ⚠️ Pas de checkbox de sélection en table → **le bulk ne marche qu'en kanban**.

**`ATSTableSkeleton`** : ne rend que **6 colonnes** au lieu de 8, et la 6ᵉ est `text-right` alors que le vrai tableau ne l'est pas → **mismatch visuel loading/loaded**.

---

## 5. Vue Timeline — `ATSTimeline.tsx`

- Conteneur `rounded-xl bg-card border` + `ScrollArea h-[600px]` + `p-4`.
- Groupes calculés (date-fns) : **"Aujourd'hui"**, **"Hier"**, **"Cette semaine"**, **"Ce mois"**, **"Plus ancien"**. Tri décroissant sur `lastActivity`.
- En-tête de groupe : `h3 font-display font-bold text-[13px]` + trait `flex-1 h-px bg-border` + compteur pill (`min-w-[22px] h-5 bg-foreground/10`).
- Rail : `relative pl-6`, ligne `absolute left-[9px] top-2 bottom-2 w-px bg-border`.
- **Dot** : `absolute -left-[26px] top-3.5 w-5 h-5 rounded-full bg-foreground text-background ring-4 ring-card` contenant l'icône de source (`SOURCE_CONFIG` **local, réduit à 3 entrées** : shortlist/sequence/inmail — pas d'`outreach`).
- Carte : `rounded-xl bg-card border p-3 hover:shadow-md hover:border-foreground/20` — nom `font-display font-bold text-[14px]`, `Bell`, `StickyNote`+n, headline, puis badges `text-[10.5px]` : étape, poste (cliquable), séquence.
- Droite : heure `format 'HH:mm'` locale fr `tabular-nums`, logo LinkedIn `w-3.5`.
- **Vide** : `rounded-xl border p-12 text-center`, `Calendar w-12 h-12 text-muted-foreground/40`, **"Aucune activité à afficher"**. Pas de skeleton.

---

## 6. Vue Analytics — `ATSPipelineAnalytics.tsx`

**Aucune lib de charting** (pas de Recharts) : tout est en barres CSS.

### 6.1 KPI cards (grid `grid-cols-2 lg:grid-cols-4 gap-3`)
`KPICard` : `rounded-xl bg-card border p-4`, icon-tile `h-9 w-9 rounded-lg`, label `text-[10px] uppercase tracking-wider`, valeur `font-display text-2xl font-bold tabular-nums`, hint `text-xs`.
Tons : `default: bg-emerald-500/15` ⚠️, `success: bg-success/10 text-success`, `warning`, `destructive`.

| Label | Icône | Valeur | Hint |
|---|---|---|---|
| **Pipeline actif** | `Users` | nb non-terminaux | "{n} gagné(s) au total" |
| **Taux de win** | `Target` | `{n}%` | "Très bon ratio" (≥30) / "À optimiser" |
| **Cycle moyen** | `Activity` | `{n}j` | "Temps moyen en stage actif" |
| **Stagnants** | `AlertTriangle` | n | "Aucun blocage" / "Candidats à relancer" |

### 6.2 Bloc "Goulots d'étranglement" (conditionnel)
Carte `border-destructive/30`, header `bg-destructive/5`, titre **"Goulots d'étranglement"**, sous-titre **"{n} étape(s) avec des candidats bloqués"**. Lignes `divide-y` : dot `w-2 h-2` (`bg-destructive` si `critical`, `bg-warning` sinon), nom d'étape, **"{n} candidat(s) bloqué(s) · > {guide}j"**, badge droite **"~{n}j moy."**. Sévérité `critical` si `stagnantCount ≥ 5 || avgDays > guideTime*2`.

### 6.3 SectionCard "Temps moyen par étape"
Icône `Clock`, sous-titre **"Volume actuel et durée moyenne dans chaque étape, vs. temps cible"**.
Une ligne par stage actif (8, sans Gagné/Perdu) : label `w-24`, **barre horizontale** `h-8 bg-muted/40 rounded-full border` remplie par `bg-gradient-to-r from-foreground/15 to-foreground/25` (ou `from-destructive/40 to-destructive/60` si `avgDays > guideTime`), largeur = `count / maxCount`. Overlay : compteur à gauche, **"{avg}j / {guide}j"** à droite. Badge `AlertTriangle` + n si stagnants.

### 6.4 SectionCard "Taux de conversion entre étapes"
Icône `TrendingDown`, sous-titre **"Pourcentage de candidats qui passent d'une étape à la suivante"**.
Ordre du funnel (**8 étapes, hardcodé, exclut "Pressenti"**) : `Nouveau → Contacté → Répondu → Pré-qualif → CV envoyé → ITW en cours → Offre → Gagné`.
Ligne : `from` (`w-24`), `ArrowRight w-3`, `to` (`w-24`), barre `h-7 rounded-full` colorée : ≥50 % `success`, ≥20 % `foreground`, sinon `destructive` ; `{rate}%` centré ; à droite `{fromCount} → {toCount}`.

### 6.5 SectionCard "Santé du pipeline"
Icône `Gauge`, sous-titre **"Indicateurs combinés pour évaluer la qualité de votre flux"**. 3 tuiles `rounded-xl bg-muted/20 border p-4` :
- **Vélocité** → "Rapide" (≤5j) / "Modérée" (≤10j) / "Lente" ; sous-texte "{n}j en moyenne par étape".
- **Fluidité** → "Excellente" (0) / "Bonne" (<3) / "Moyenne" (<8) / "Faible" ; "{n} candidat(s) stagnant(s)".
- **Conversion finale** → "{winRate}%" ; "{n} placement(s) confirmé(s)".

⚠️ Analytics n'a **ni skeleton ni empty state** : avec 0 candidat, affiche des zéros et des barres vides.

---

## 7. Filtres

### 7.1 `ATSFilters.tsx` (vues kanban/table/timeline/analytics)
`flex items-center gap-1.5 overflow-x-auto scrollbar-hide`.
- **Recherche** : `<Input>` `placeholder="Rechercher…"` (ellipsis unicode), `pl-9 w-48 sm:w-56 rounded-full h-8 text-[12px]`, icône `Search w-3.5` en absolute. Filtre sur name/email/headline/jobTitle.
- **`FilterButton`** générique : `h-8 px-3 rounded-full border text-[11.5px]` ; actif (`count>0`) = `bg-foreground text-background border-foreground` + pastille compteur `min-w-[18px] h-[18px] bg-background text-foreground text-[10px] font-bold`. Popover `w-56 p-3 rounded-xl` `align="start"` avec `<Checkbox>` shadcn + label `text-sm`.
  - **"Étape"** → options dynamiques = stages présents dans les données.
  - **"Source"** → `SOURCE_LABELS` **local, 3 entrées seulement** : `shortlist:"Pipeline Notion"`, `sequence:"Séquences"`, `inmail:"InMails"` (⚠️ 3ᵉ jeu de libellés source, différent de ATSCandidateCard et ATSTable ; `outreach` non mappé → clé brute affichée).
  - **"Poste"** (si jobs) → liste `max-h-64 overflow-y-auto`.
  - **"Tags"** (si tags) → idem.
- **Toggle "Rappels"** (`Bell w-3.5`) — booléen `hasReminder`, même style actif.
- **"Effacer (N)"** — `X w-3.5`, `border-destructive/40 bg-destructive/5 text-destructive`. Visible si `activeFiltersCount > 0` (n'inclut PAS la recherche).

### 7.2 `CandidateFilters.tsx` (vue Shortlist) — **design system totalement différent**
`flex flex-wrap gap-3`, hauteur `h-9` (vs `h-8`), pas de `rounded-full`.
- Recherche : `placeholder="Rechercher..."` (3 points ASCII ≠ `…`), `w-[200px] h-9 text-sm`.
- 4 `<Select>` shadcn **mono-valeur** (alors que le state est `string[]`) :
  - **Poste** `w-[180px]` — item par défaut **"Tous les postes"**.
  - **Étape** `w-[140px]` — **"Toutes les étapes"**.
  - **Entité** `w-[120px]` — **"Toutes"**.
  - **Expertise** `w-[150px]` — **"Toutes"**.
- Bouton **"Effacer"** — `<Button variant="ghost" size="sm">` + `X w-4` (vs bouton natif rouge côté ATS).

---

## 8. `ATSStats.tsx` — bandeau de stats

`grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4`. Tuile : `flex items-center gap-2 px-3 py-2 rounded-xl border bg-card hover:bg-muted/30`, icon-tile `h-7 w-7 rounded-lg bg-emerald-500/15` ⚠️, valeur `font-display text-[14px] font-bold tabular-nums`, label `text-[10px] uppercase tracking-wider font-semibold`.

| key | Label FR | Icône | Suffixe | Calcul |
|---|---|---|---|---|
| total | **Total** | `Users` | — | `candidates.length` |
| contacted | **Contactés** | `Send` | — | `isContacted()` |
| responseRate | **Réponse** | `MessageCircle` | `%` | replied/contacted |
| inProgress | **En cours** | `UserCheck` | — | stages Pré-qualif→Offre |
| won | **Gagnés** | `Trophy` | — | stage === Gagné |
| conversionRate | **Conv.** | `Trophy` ⚠️ *(même icône que "Gagnés")* | `%` | won/(won+lost) |

⚠️ `ATSStatsSkeleton` utilise `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6` — **grille différente du composant réel** (`grid-cols-3 sm:grid-cols-6`) → saut de layout au chargement.

---

## 9. `RemindersSidebar.tsx`

- Panneau latéral `w-80 bg-background rounded-xl border overflow-hidden` (dans le flux, pas un Sheet).
- Header : `Bell w-5 text-warning` + **"Rappels"** (`font-semibold`) + `<Button variant="ghost" size="icon">` `X` `aria-label="Fermer les rappels"`.
- Filtre : `<Checkbox>` + label **"Afficher terminés"**.
- Liste : `ScrollArea h-[500px]`.
  - Loading : `Loader2 w-6 h-6 animate-spin` `py-12`.
  - Vide : `Bell w-10 h-10 text-muted-foreground/30` + **"Aucun rappel en attente"** (ou **"Aucun rappel"** si `showCompleted`).
  - Item : `p-3 rounded-lg border`, terminé → `bg-muted opacity-60` + titre `line-through`. Checkbox de complétion (stopPropagation), titre, nom candidat, poste, `<Badge>` échéance :
    | Condition | Label | Classe |
    |---|---|---|
    | passé & pas aujourd'hui | **En retard** | `bg-destructive/10 text-destructive` |
    | aujourd'hui | **Aujourd'hui** | `bg-warning/10 text-warning` |
    | demain | **Demain** | `bg-info/10 text-info` |
    | sinon | `format 'd MMM'` fr | `bg-muted text-foreground` |
    + `<Badge variant="outline">` **"Terminé"** (`CheckCircle2`, `text-success`) si complété.
- **Toasts** : `"Rappel terminé"` / `"Rappel réactivé"` / `"Erreur lors du chargement des rappels"` / `"Erreur lors de la mise à jour"`.

---

## 10. `CandidateDetailModal.tsx` — modale candidat

⚠️ **Thin wrapper** autour de `ProfileDetailSheet` (`components/outreach/result-card/ProfileDetailSheet`, hors périmètre de ce dossier) avec `hideStandardTabs`. Adapter : `atsCandidateToProfile()`.

**`pipelineMeta`** passé au Sheet : `stage`, `stageOptions` (= `ATS_STAGES` ou override mission), `onStageChange`, `score`, `onScoreClick` → **toast.info("Voir l'onglet Évaluation")** *(action non fonctionnelle, ne switch pas réellement d'onglet — commentaire de code l'admet)*, `tags` + `onTagsChange`, `onCreatePortalLink`, `manualEmail`/`manualPhone`, `contactsEditor` (`ManualContactsEditor`).

**9 onglets injectés** (`extraTabs`) :
| key | label | shortLabel | icône | contenu | count |
|---|---|---|---|---|---|
| overview | **Aperçu** | Aperçu | `LayoutDashboard` | `OverviewTab` | — |
| profile | **Profil** | Profil | `User` | `ProfileDetailedTab` | — |
| evaluation | **Évaluation** | **Eval** | `Target` | `EvaluationTab` | — |
| cv | **CV** | CV | `FileText` | `CVTab` | — |
| sequences | **Séquences** | **Séq.** | `GitBranch` | `CandidateSequencesPanel` | nb enrollments |
| messages | **Messages** | **Msg** | `MessageSquare` | `CardMessageThread` | — |
| activity | **Activité** | **Act.** ⚠️ | `Activity` | `ActivityTab` | nb events |
| notes | **Notes** | Notes | `StickyNote` | `NotesTab` | nb notes |
| actions | **Actions** | **Act.** ⚠️ | `Zap` | `ActionsTab` | rappels actifs |
⚠️ **`shortLabel` "Act." dupliqué** entre Activité et Actions.

**Toasts de la modale** : `"Note ajoutée"`, `"Note supprimée"`, `"Erreur lors de l'ajout de la note"`, `"Erreur lors de la suppression"`, `"Rappel créé"`, `"Rappel supprimé"`, `"Erreur lors de la création du rappel"`, `"Lien portail copié !"`, `"Erreur : {message}"`, `"Organisation introuvable, recharge la page"`.

---

## 11. Onglets de la fiche candidat (`candidate-detail/`)

### 11.1 `OverviewTab.tsx` (40 Ko)
- **AlertsPanel** — 5 règles, chacune avec `severity: critical|warning|info`, icône, titre, détail, bouton **"✓ Traité"** (`onDismiss`, optimistic + rollback) :
  1. `stagnation` — `Clock` — **"Stagnation : {n} jours sur \"{stage}\""** / "Seuil habituel à {t} j — il faut faire bouger ou archiver."
  2. `unanswered_reply` — `MailWarning` — **"Répondu il y a {n}j — sans réponse de ta part"**
  3. `missing_contacts` — `FileQuestion` — **"Manque email / téléphone / CV"**
  4. `no_score` — `Target` — **"Pas encore scoré par l'IA"**
  5. `invite_unaccepted` — `PhoneOff` — **"Invitation LinkedIn pas acceptée depuis {n}j"**
  Toast : `"Alerte traitée"` / `"Erreur"`.
- **ProfileSummaryCard** (résumé LinkedIn + forces/points d'attention).
- **4 StatCards** `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` : **Engagement** (`Phone`, tone info — "{n} appel(s)" / "Aucun appel"), **CV / Documents** (`FileText`, tone brand — "Aucun CV" / "1 CV" / "{n} versions", `highlight` si 0), **Séquences** (`GitBranch`, tone success — "Aucune" / "{n} active(s)"), **Prochain rappel** (`Bell`, tone warning/muted).
- **SectionCards** : "Postes liés" (eyebrow "{n} mission(s)"), "Activité récente" ("{n} événements · onglet Activité pour tout voir"), "À prévoir", "À propos" (eyebrow "Résumé LinkedIn"), "Expérience récente" ("{n} positions"), "Formation" ("{n} école(s)"), "Compétences" ("{n} skills"), "Langues", "Dernières notes" ("{n} note(s) · voir tout dans Notes").

### 11.2 `EvaluationTab.tsx`
- **ScoreHero** (si `score > 0`) : anneau SVG `size=80 stroke=6` animé (framer-motion, `duration 0.9`, ease `[0.22,1,0.36,1]`), score `font-display text-[22px]` + `/100`. Eyebrow **"Score IA · mission active"**, badge reco : `shortlist`→**Recommandé**, `skip`→**Non recommandé**, `maybe`→**À évaluer**. Verdict : ≥70 **"Bon score sur la mission active"**, ≥50 **"Score moyen — à examiner"**, sinon **"Score faible"**.
  ⚠️ **Couleurs HSL en dur** : `hsl(142 76% 36%)` / `hsl(38 92% 50%)` / `hsl(0 84% 60%)` — bypasse totalement les tokens.
- **SectionCard "Scorecard d'entretien"** (`Award`, eyebrow "Évaluation manuelle après le call") → `ScorecardTab`.
- **CollapsibleCard "Préparer le call"** (`Phone`, "Questions à poser, points à creuser") → `PrepSheetTab`.
- **CollapsibleCard "Vérification du profil"** (`ShieldCheck`, "Détection de signaux suspects (CV, LinkedIn, dates...)") → `FraudDetectionTab`.
- **CollapsibleCard "Historique des scorings"** (`History`, "{n} scoring(s) précédent(s)") → `ScoringCard[]`.
- Header collapsible : icon-tile `h-8 w-8 rounded-lg bg-emerald-500/15` ⚠️, chevron `rotate-180` quand ouvert.

### 11.3 `CVTab.tsx`
- **Empty / DropZone** : `min-h-[280px] sm:min-h-[360px] rounded-xl border-2 border-dashed`, icon-tile `h-14 w-14 rounded-2xl bg-emerald-500/15` (→ `bg-emerald-500/25` au hover, `bg-foreground text-background scale-110` en drag). Titres : **"Aucun CV pour ce candidat"** / **"Lâche le fichier ici"** (drag) / **"Upload en cours…"**. Sous-texte **"Glisse-dépose un PDF ici, ou clique pour parcourir."** + **"PDF uniquement · max 10 MB"**.
- **Toolbar CV actif** : `IconTile FileText`, nom `text-[13px] font-semibold`, badge **"Principal"** (`Star`, success), meta "taille · Uploadé {d MMM yyyy à HH:mm}". 3 `<Button variant="outline" size="sm" h-7 px-2>` : `Download` (title "Télécharger"), `Upload` + label **"Ajouter"** (title "Uploader un nouveau CV", `Loader2` si upload), `Trash2` (title "Supprimer ce CV", hover destructive).
- **Notes inline** : `<Textarea>` `placeholder="Note libre (ex: v3 envoyée par mail le 12/04, manque les diplômes)"`, boutons **Annuler** / enregistrer ; état vide **"Ajouter une note sur ce CV…"**.
- **AlertDialog** : titre **"Supprimer ce CV ?"**, description **"{fileName} sera supprimé définitivement. Cette action est irréversible."**, boutons **"Annuler"** / **"Supprimer"** (`bg-destructive`).
- **Erreur** : bloc `bg-destructive/5 border-destructive/30`, **"Erreur de chargement"** + `<Button variant="outline" size="sm">` **"Réessayer"** (`RefreshCw`).
- **Toasts** : `"CV uploadé"`, `"CV supprimé"`, `"{fileName} défini comme CV principal"`, `"Note enregistrée"`, `"Impossible de générer le lien de prévisualisation"`, `"Organisation non détectée"`, `"Type non supporté : {type}. PDF uniquement."`, `"Fichier trop volumineux (max 10 MB)"`, `"Téléchargement impossible"`.

### 11.4 `NotesTab.tsx`
- Toggle segmenté carré (`flex gap-0`, bordures accolées `-ml-px`, **pas de rounded**) : **"💬 Équipe"** / **"📝 Perso"** (emojis en dur), actif = `bg-foreground text-background`, `text-xs font-bold uppercase tracking-wider`.
- Mode Équipe → `CandidateCommentsTab`. Mode Perso → `AiTextarea` `placeholder="Ajouter une note personnelle... (tape /ai pour les commandes IA)"` + bouton carré `Plus`/`Loader2`.
- Vide : `EmptyState` `StickyNote w-7 h-7` **"Aucune note personnelle"**.
- Note : `p-3 border bg-foreground/[0.02]`, `Trash2` en `opacity-0 group-hover:opacity-100`, horodatage relatif fr.

### 11.5 `CandidateCommentsTab.tsx`
- `<Textarea>` `placeholder="Ajouter un commentaire... Tapez @ pour mentionner"` `min-h-[60px] rounded-lg` + bouton d'envoi carré (`Send` / `Loader2`) accolé `-ml-px`.
- **Autocomplete @mention** : dropdown `absolute top-full mt-1 border shadow-lg z-[100] max-h-40 rounded-sm`, item actif `bg-accent text-accent-foreground`, avatar carré `h-6 w-6 bg-foreground text-background` (initiale).
- Rendu mention : `bg-primary/10 text-primary rounded-sm` + `AtSign w-2.5`.
- Vide : `MessageCircle w-8 h-8 opacity-40`, **"Aucun commentaire"** + **"Soyez le premier à commenter"**.
- Toasts : `"Commentaire ajouté"`, `"Commentaire supprimé"`, `"Erreur lors de l'ajout"`, `"Erreur lors de la suppression"`.

### 11.6 `ActionsTab.tsx`
- Section **"Actions IA"** — grille 2 cols, 4 boutons carrés `border p-3 text-left active:scale-[0.97]` :
  **Résumé IA** (`Brain`, "Générer un résumé du candidat") · **Brief client** (`FileText`, "Préparer une présentation") · **Messagerie** (`Send`, "Ouvrir la messagerie" → `/missions?tab=messages`) · **Scoring** (`Target`, "Analyser le profil", conditionnel LinkedIn).
- Section **"Rappels"** — lien **"+ Ajouter"** ; formulaire : `<Input placeholder="Titre du rappel...">`, `<Input type="datetime-local">`, bouton **"Créer le rappel"** (`h-8 bg-foreground text-background text-xs font-bold uppercase`, disabled si champs vides).
- Vide : `EmptyState` `Bell w-7 h-7` **"Aucun rappel"** (description vide, `compact`).
- Item : `Calendar w-4`, titre (barré si complété), date `d MMM yyyy à HH:mm` + distance relative `text-primary`, `Trash2` en hover.

### 11.7 `ActivityTab.tsx`
Timeline `relative pl-6 space-y-4`, ligne `left-[9px] w-0.5 bg-foreground/15`, dot **carré** `w-5 h-5` (pas rounded). `ACTIVITY_TYPE_CONFIG` : `scored`(Target), `messaged`(Send), `sequence_enrolled`(GitBranch), `sequence_step`(Send, `bg-foreground/80`), `inmail_sent`(Send), `qualification_scheduled`(Calendar, `bg-accent`), `qualification_verdict`(Award, `bg-accent`), `shortlist_added`(FileText), `appointment`(Calendar). Vide : **"Aucune activité enregistrée"**.

### 11.8 `ScoringCard.tsx`
`DIMENSION_LABELS` (11) : Compétences, Expérience, Séniorité, Localisation, Formation, Culture fit, Motivation, Leadership, Communication, Problem solving, Salaire.
Sections : **"Dimensions"**, **"Analyse IA"**, **"Compétences matchées"** (success), **"Compétences manquantes"** (warning), **"Forces"** (success), **"Points d'attention"** (warning), lignes "Expérience :", "Localisation :", "Score LLM :".

### 11.9 `PrepSheetTab.tsx`
Loading : **"Préparation du brief d'appel..."**. Vide : **"Aucune donnée disponible."**
Header **"Brief de préparation"** + 3 métriques : **Score IA**, **Skills matchés**, **À vérifier**.
Sections : **"Points à aborder"** (talking points `strength`/`risk`/`question`, dont "Prétentions salariales", "Disponibilité", "Rôle actuel : {title} chez {company}"), **"Appels précédents"**, **"Évaluations précédentes"**, **"Notes des collègues"**.

### 11.10 `ManualContactsEditor.tsx`
Popover/dialog `title="Ajouter ou modifier email / téléphone manuellement"`. Champs : email `placeholder="prenom.nom@example.com"`, téléphone `placeholder="+33 6 12 34 56 78"`, note `placeholder="Ex: email pro, téléphone perso, pas de SMS le soir…"`. Bouton d'effacement `title="Effacer tous les contacts manuels"`.
Toasts : `"Contacts enregistrés"`, `"Contacts effacés"`, `"Organisation non détectée"`, `"Erreur d'enregistrement"`, `"Erreur"`.

### 11.11 `ProfileTab.tsx` / `ProfileDetailedTab.tsx`
`ProfileTab` sections : **À propos**, **Expériences**, **Formation**, **Compétences**, **Langues**, **Qualifications**, **Historique CRM** (lignes "Statut Airtable", "Expérience"), **Contact** (lien "Voir le profil"), **Historique** ("Créé le", "Dernière activité"). Micro-labels `text-xs font-bold uppercase tracking-wider text-muted-foreground` : Localisation / Expérience / Entreprise / Poste.
`ProfileDetailedTab` : sections **À propos** (`Sparkles`), **Expérience**, **Formation**, **Compétences**, **Langues** ; état vide **"Profil LinkedIn non disponible"**. ⚠️ **ProfileTab et ProfileDetailedTab sont deux implémentations concurrentes du même écran** ; seul ProfileDetailedTab est branché dans la modale, ProfileTab reste exporté par `index.ts`.

---

## 12. Scorecard — `ScorecardTab.tsx` (1403 lignes)

### 12.1 Constantes
- `INTERVIEW_STAGES` (labels **en anglais**) : `phone_screen`→**Phone Screen**, `technique`→**Technique**, `culture_fit`→**Culture Fit**, `final`→**Final**.
- `RECOMMENDATION_OPTIONS` (labels **en anglais**) : **Strong Yes** (`border-success bg-success/10`), **Yes** (`border-success/30 bg-success/5`), **Maybe** (`border-warning/40 bg-warning/10`), **No** (`border-destructive/30 bg-destructive/5`), **Strong No** (`border-destructive bg-destructive/10`).
- `CATEGORY_CONFIG` : `technical`→**Tech** (info) · `soft_skill`→**Soft** (warning) · `culture_fit`→**Culture** (brand-purple) · `motivation`→**Motiv.** (success). Chaque entrée a `color` + `dotColor`.
- Poids : `3`→**Critique** (`AlertTriangle`, destructive), `2`→**Important** (warning), `1`→**Bonus** (success).

### 12.2 Vue LISTE (aucune scorecard active)
- Bouton **"Nouvelle scorecard"** — `w-full h-[38px] border border-dashed text-xs uppercase tracking-wider`, `Plus w-3.5`, + `<CreditCostBadge actionId="generate_scorecard">`.
- `<ModelPicker actionId="generate_scorecard" compact>` en dessous.
- **Vide** : bloc carré `h-14 w-14 bg-foreground text-background` (⚠️ pas de rounded) + `Sparkles w-7`, texte **"Aucune scorecard pour ce candidat. Cliquez sur le bouton ci-dessus pour en créer une."**
- **Item de liste** : `rounded-xl border hover:border-foreground/30`, pastille score `h-10 w-10 rounded-xl` (≥4 success / ≥3 warning / sinon destructive), titre **"{rated}/{total} critères"** ou **"Brouillon"**, badges stage d'entretien + recommandation, sous-titre poste + date `fr-FR {day, month:short, HH:mm}`. À droite : 6 mini-dots `w-1.5 h-1.5` colorés par note, bouton **"Modifier"** (`Pencil w-3`, `h-8 px-3 rounded-full border`), bouton icône `Trash2` (`h-8 w-8 rounded-full border-destructive/30`, `aria-label="Supprimer cette évaluation"`).

### 12.3 Vue GÉNÉRATION (scorecard active sans critères)
- Lien retour **"Retour"** (`ChevronLeft w-3.5`, `text-2xs`).
- Hero `rounded-xl border bg-gradient-to-br from-brand-purple/[0.04] via-brand-pink/[0.02] to-transparent p-6 sm:p-8` ; icon-tile `h-14 w-14 rounded-2xl bg-emerald-500/15` ⚠️ + `Sparkles w-6`.
- Titre **"Nouvelle scorecard"** `font-display text-[18px] sm:text-[20px]` ; description **"L'IA va analyser le profil et le poste pour générer une grille d'évaluation sur mesure (6-8 critères avec questions et red flags)."**
- Label **"Type d'entretien — optionnel"** (`text-3xs uppercase`), 4 pills `h-8 px-3 rounded-full text-[12px]`, actif = `bg-foreground text-background scale-[1.02]`.
- CTA **"Générer la scorecard"** — `h-10 px-6 rounded-full text-[13px] font-bold bg-foreground text-background shadow-md hover:shadow-lg active:scale-[0.98]` ; loading → **"Génération en cours…"** + `Loader2`, `bg-foreground/40 cursor-wait`.
- Sous le CTA : `CreditCostBadge` + `ModelPicker`.

### 12.4 Vue ÉDITION (mode principal)
**Header card** (`rounded-xl border bg-card p-3 sm:p-4`, stack vertical jusqu'à `xl`) :
- Pastille score `h-12/h-14 rounded-xl border-2` (≥4 success / ≥3 warning / sinon destructive) ou placeholder `bg-emerald-500/15 border-dashed` + `Sparkles`.
- **"{rated}/{total} critères évalués"** `font-display text-[14px] tabular-nums` + badge stage (`bg-info/10 text-info`).
- **Barres par catégorie** : 4 mini-barres `h-1` avec label `text-3xs uppercase` + moyenne `{avg.toFixed(1)}`. ⚠️ Couleurs via `style={{color}}` en **`hsl(var(--status-info))`, `hsl(var(--status-warning))`, `hsl(var(--skalr-purple))`, `hsl(var(--status-success))`** — 2ᵉ mapping de couleurs catégorie, différent de `CATEGORY_CONFIG`.
- **4 boutons d'action** (`h-8 px-3 rounded-full text-2xs`, labels masqués `<md`) :
  1. **"Coaching Live"** — `Mic w-3.5`, `border-destructive/40 text-destructive bg-destructive/5` → auto-save puis `navigate('/ats/scorecard/{id}?coaching=1')`.
  2. **"Plein écran"** — `Maximize2 w-3.5`, `border-border` (masqué si `autoOpenFirst`), `title="Ouvrir la scorecard en plein écran avec sidebar candidat + poste"`.
  3. **"Régénérer"** — `RotateCcw w-3.5` / `Loader2`, `disabled={generating}`.
  4. **"Sauvegarder"** — `Check w-3.5` / `Loader2`, `bg-foreground text-background font-bold shadow-sm`, `disabled={saving}`.

**Navigation critères** :
- `<lg` : tabs horizontales scrollables `shrink-0 px-2 py-1 text-xs font-bold uppercase` — libellé **"{n}. {catLabel}"** (⚠️ pas de rounded, `ring-1 ring-offset-1` si actif).
- `lg+` : rail latéral `w-[150px] sticky top-24 max-h-[calc(100vh-120px)]` — titre **"Critères ({n})"**, items `px-2 py-1.5 rounded-lg text-2xs` avec dot `w-1.5 h-1.5` (couleur catégorie si non noté, sinon success/warning/destructive) + label tronqué + pastille de note.
- Checkbox **"Auto-nav"** (`input type=checkbox` natif `accent-foreground`) visible seulement si coaching actif.

**Card critère** (`rounded-xl border bg-card`) :
- Header `px-4 py-3 border-b bg-muted/15` : badge catégorie (dot + label), badge poids (**Critique** / **Important** / **Bonus**), compteur **"{i+1}/{total}"**.
- Titre `h3 font-display font-bold text-[18px] sm:text-[20px]` + description `text-[13px] text-foreground/75`.
- **Échelle de notation** : label **"Évalue ce critère"** (`text-3xs uppercase`), **5 boutons carrés `w-12 h-12 sm:w-14 sm:h-14 rounded-2xl border-2 text-lg sm:text-xl font-display font-bold`** valeurs 1→5. Sélectionné : `scale-110 shadow-lg shadow-{tone}/30` avec `bg-success`/`bg-warning`/`bg-destructive` selon `score>=4 / >=3 / else`. `aria-label="Noter {n} sur 5"`. Légende : **"Très faible"** ← → **"Exceptionnel"**.
- **Rubric de la note choisie** : encart coloré `rounded-xl border px-3 py-2.5` avec pastille de note `h-6 w-6 rounded-lg` + texte `text-[12.5px]`.
- Toggle **"Voir l'échelle complète"** / **"Masquer l'échelle complète"** (`ChevronDown rotate-180`) → liste des 5 niveaux `rounded-xl border bg-muted/10 p-3`, niveau actif `bg-foreground/[0.06]` + pastille `bg-foreground text-background`. Reset à chaque changement de critère.
- **"À vérifier pendant l'entretien"** (`MessageSquare w-3`) — 3 questions max, numérotées en pastilles `h-4 w-4 rounded-full`, nettoyage regex des guillemets et du `?` final.
- **"Red flag"** — `rounded-xl border-destructive/30 bg-destructive/5`, icon-tile `h-6 w-6 bg-destructive/15`, **1 seul red flag affiché** (`redFlags[0]`).
- **"Tes notes"** — `<Textarea>` `placeholder="Observations, exemples concrets, citation textuelle…"`, `text-[12.5px] min-h-[60px] rounded-lg resize-none`.
- Footer nav `px-4 py-2.5 border-t bg-muted/10` : **"Précédent"** (`ChevronLeft`) / compteur **"{i+1} / {n}"** / **"Suivant"** (`ChevronRight`), `disabled:opacity-30`.

**Raccourcis clavier** : `1`–`5` = noter le critère courant, `→`/`↓` = suivant, `←`/`↑` = précédent (désactivés dans INPUT/TEXTAREA/SELECT).

**Section "Verdict final"** (`border-t-2 border-border pt-4 mt-6`) :
- **"Recommandation"** — 5 boutons `px-3 py-1.5 text-xs font-bold uppercase tracking-wider border` (⚠️ **pas de rounded**, `ring-1 ring-offset-1` si actif), toggle (re-clic = désélection).
- **"Résumé / Justification"** — `<Textarea min-h-[80px]>` `placeholder="Résumé de l'entretien et justification de la recommandation..."`.
- **"Points de suivi (prochain round)"** — `<Textarea min-h-[60px]>` `placeholder="Questions à creuser, points à vérifier lors du prochain entretien..."`.

**Persistance** : auto-save debounce **3000 ms** (uniquement si `ev.id` existe), + save explicite, + save silencieux avant navigation plein écran.
**Toasts** : `"{n} critères générés sur mesure"`, `"Évaluation sauvegardée"`, `"Scorecard supprimée"`, `"Copié !"`, `"Profil candidat trop incomplet pour générer une scorecard"`, `"Erreur lors de la génération"`, `"Erreur lors de la sauvegarde"`, `"Erreur lors de la suppression"`.
**Loading global** : `Loader2 w-6 h-6 animate-spin` centré `py-12` (pas de skeleton).

---

## 13. `ScorecardFullPage.tsx` — plein écran

**Header sticky** `h-14 bg-background/95 backdrop-blur-md border-b` :
- Bouton retour rond `h-9 w-9 rounded-full border`, `aria-label="Retour"`, `ArrowLeft w-4`.
- `<Avatar w-8 h-8 ring-2 ring-border>` + fallback `bg-gradient-to-br from-foreground/20 to-foreground/10` (initiales 2 lettres).
- Eyebrow **"Scorecard d'entretien"** (`text-3xs uppercase`, `hidden sm:block`) + `h1` nom `· {jobTitle}`.
- **Progression** (`hidden md:flex`) : **"{rated}/{total}"** + barre `h-1.5 w-24 rounded-full bg-muted/40` remplie `bg-emerald-500/70` ⚠️.
- **Score courant** pill : `Sparkles w-3` + **"{score.toFixed(1)}/5"**.
- **Recommandation** pill (`recoTone`) : **Strong Yes** / **Yes** / **Maybe** / **No** / **Strong No** — ⚠️ 2ᵉ définition locale de la palette de recommandation (dupliquée depuis ScorecardTab).
- **"Coaching Live"** (si `?coaching=1`) : pastille `bg-destructive/10 border-destructive/30` avec point `animate-ping` + `Mic w-3`.
- Toggle sidebar `h-9 w-9 rounded-full border` — `PanelLeftClose`/`PanelLeftOpen`, `title="Réduire la sidebar pour focus"` / `"Afficher la sidebar candidat"`.
- **Mobile** : 2 onglets pleine largeur **"Profil & Poste"** / **"Scorecard"** (`border-b-2 border-foreground` si actif) + mini-barre de progression `h-0.5`.

**Sidebar gauche** `sm:w-[320px] lg:w-[340px]` (collapse → `sm:w-0`), 2 onglets pills : **"Candidat"** (`User`) / **"Poste"** (`Briefcase`).
- *Candidat* : identité (avatar `w-12 h-12`), carte **"Progression"** (barre + **"Score moyen"** `{n}/5` + pill reco), carte **"Score IA initial"** (`h-10 w-10 rounded-lg`, sous-texte **Recommandé** / **Non recommandé** / **À évaluer**), pills meta (entreprise `Building2`, lieu `MapPin`, **"{n} ans"** `Sparkles` success), lien **"Ouvrir LinkedIn"** (`ExternalLink`, `h-8 rounded-full`), sections **"Expérience"** ("{n} positions", 4 max + "+N autres"), **"Formation"** ("{n} école(s)", 3 max), **"Compétences"** ("{n} skills", 14 max + "+N").
- *Poste* : eyebrow **"Mission"**, titre ou **"Poste non spécifié"**, pills séniorité (info) / contrat / **"Remote"** (success), bouton **"Voir tous les détails"** (`ExternalLink`) → `JobDetailSheet`, section **"Compétences obligatoires"** ("{n} skills", pills success `CheckCircle2`), section **"Description du poste"** (`line-clamp-8`).
- `SidebarSection` : icon-tile `h-6 w-6 rounded-md bg-emerald-500/15` ⚠️.
- `CompactExperienceItem` : logo via `exp.logo` puis fallback **`https://logo.clearbit.com/{slug}.com`** (appel réseau tiers en dur), badge **"Actuel"** (success, point `animate-pulse`), dates `{start} → {end}` ou **"→ Présent"**.

**Main** : `ScrollArea` + `max-w-[1400px] mx-auto` + `<ScorecardTab autoOpenFirst>`.
**Polling** : `setInterval(loadEval, 5000)` pour rafraîchir la progression du header ⚠️ (polling DB toutes les 5 s tant que la page est ouverte).
**Loading page** : `Loader2 w-6 h-6` plein écran. **Toast** : `"Candidat introuvable"` → `navigate(-1)`.

---

## 14. `Qualification.tsx` — page de qualification

- **Header sticky** `max-w-6xl` : `<Button variant="ghost" size="icon">` `ArrowLeft w-5`, `h1` **"Qualification — {candidate_name|Candidat}"**, sous-titre `{job_title} • {client_name}`. Bouton **"Sauvegarder"** (`<Button>` par défaut, `Save w-4`, `disabled={saving}` → texte **"Sauvegarde..."**).
- **Grille** `lg:grid-cols-3`, colonne gauche (1/3) / droite (2/3). ⚠️ Utilise `<Card>/<CardHeader>/<CardTitle>/<CardContent>` shadcn — **le seul écran du périmètre à le faire** (tous les autres sont en `div rounded-xl border bg-card`).
- **Card "Candidat"** (`User w-4`) : nom `text-lg`, headline, email, lien **"Profil LinkedIn"** (`Linkedin` + `ExternalLink`, ⚠️ `text-blue-400 hover:text-blue-300` en dur).
- **Card "Rendez-vous"** (`Calendar w-4`) : nom d'événement, date `EEEE d MMMM yyyy 'à' HH:mm` fr, lieu ou lien **"Rejoindre le call"** (`text-info`).
- **Card "Scoring IA"** (`Briefcase w-4`) : score `text-2xl font-bold font-mono tabular-nums` **"{n}/100"** (≥70 success, ≥50 warning, sinon destructive), `<Badge variant="outline">` recommandation brute. Listes **"Points forts"** (`CheckCircle2` success) / **"Points faibles"** (`XCircle` destructive).
- **Card "Notes de qualification"** : sous-titre **"Prends tes notes pendant le call — sauvegarde auto toutes les 10s"** ; `<Textarea min-h-[300px] resize-y bg-muted/30>` `placeholder="Motivation du candidat, disponibilité, prétentions salariales, adéquation au poste..."`. Auto-save `setTimeout` **10 000 ms**.
- **Card "Verdict final"** : sous-titre **"Ta décision mettra automatiquement à jour le statut du candidat"**. Grille `grid-cols-2 sm:grid-cols-4 gap-3`, 4 boutons `px-4 py-3 rounded-lg border text-sm font-medium` :

| value | Label FR (emoji inclus) | Couleur active |
|---|---|---|
| `go` | **Go ✅** | `bg-success/20 text-success border-success/30` |
| `no_go` | **No Go ❌** | `bg-destructive/20 text-destructive border-destructive/30` |
| `maybe` | **À revoir 🤔** | `bg-amber-500/20 text-amber-400 border-amber-500/30` ⚠️ hors tokens |
| `pending` | **En attente ⏳** | `bg-muted text-muted-foreground border-border` |

  Actif : + `ring-2 ring-offset-2 ring-offset-background ring-primary/30`.
- `<Separator />` puis label **"Commentaire du verdict"** + `<Textarea min-h-[100px]>` `placeholder="Raison de ta décision, prochaines étapes..."`.
- **Toasts** : `"Scorecard sauvegardée"`, `"Erreur lors de la sauvegarde"`, `"Session de qualification introuvable"`.
- **Loading** : spinner CSS custom `w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin` (⚠️ n'utilise pas `Loader2` comme partout ailleurs).
- ⚠️ Verdict → sync Notion (`update-candidate-stage`, stages **"Qualifié"/"Rejeté"** qui **n'existent dans aucune des deux tables de stages**).

---

## 15. `JobDetailSheet.tsx` (Sheet poste)

- `<Sheet side="right">`, `sm:w-[540px] sm:max-w-[540px] w-full p-0 border-l`. `SheetTitle` = **"Détail du poste"** en `sr-only` (⚠️ **aucun titre visible** — le titre réel est un `h2` custom).
- Header `border-b-2` : `h2` titre du poste ou **"Poste non spécifié"** (`text-sm font-bold uppercase tracking-wider`), client (`Building2`), ville (`MapPin`), badge de statut (`statusColor()` : active/open/en cours → success ; closed/fermé/pourvu → destructive ; paused/pause → ⚠️ `border-amber-400 text-amber-600 bg-warning/10`), compteur **"{n} candidat(s)"**, lien **"Calendly"** (`CalendarDays`, `h-7 px-2.5 rounded-full`).
- **4 onglets** (pills accolées `border-l-0`, actif `bg-foreground text-background`) : **Fiche** (`FileText`), **Candidats** (`Users`, suffixe `({n})`), **Séquences** (`GitBranch`), **IA** (`Brain`).
- **Fiche** : grille 2 cols avec cartes `Localisation / Contrat / Salaire / TJM / Séniorité / Remote` ; **"Stack technique"** (pills) ; **"Description"** (ou **"Aucune description"**) ; **"Critères"** avec `CriteriaBlock` **Must-have** (`border-red-300`), **Should-have** (`border-amber-300`), **Nice-to-have** (`border-green-300`) ⚠️ **3 couleurs Tailwind brutes** ; **"Filtres de recherche"** (pills `key: value`) ; **"Notes"**.
- **Candidats** : compteurs par étape en pills `{n} {stage}` ; liste `divide-y` de boutons — nom, badge score `{n}%` (⚠️ classes ad-hoc `border-border bg-accent` / `border-destructive`, **différent des seuils 70/40 partout ailleurs**), headline, badge étape, `ChevronRight` en `opacity-0 group-hover:opacity-100`. Vide : `Users w-8` + **"Aucun candidat associé"**.
- **Séquences** : cartes avec 3 métriques **Enrollés / Envoyés / Réponse** (`text-lg font-bold`, `text-success` si ≥20 %). Vide : `GitBranch w-8` + **"Aucune séquence liée"**. Loading : `Loader2 w-5`.
- **IA** : bouton pleine largeur **"Analyser ce poste avec l'Agent"** (`Brain w-4`, `h-10 rounded-full border`) ; carte **"Contexte RAG"** (`Database`) → **"{n} chunk(s) indexé(s) pour ce poste"** ; carte **"Scoring candidats"** (`BarChart3`) → **Score moyen / Scorés / ≥ 70%** ou **"Aucun candidat scoré"**.
- Chargement du header : `Loader2 w-4` + **"Chargement…"**. Sans données : **"Aucune information disponible"**.
- ⚠️ Le Sheet monte lui-même un `<CandidateDetailModal>` → **modale dans un sheet** (empilement).

---

## 16. `FraudDetectionTab.tsx`

- **Pas de données** : `ShieldAlert w-10 h-10` + **"Données de profil indisponibles"** + **"L'analyse nécessite les données LinkedIn enrichies du candidat."**
- **Idle** : `IconTile Shield size="lg" rounded-2xl` + **"Détection de fraude IA"** + **"Analyse automatique du profil pour détecter les incohérences : dates, titres gonflés, diplômes douteux."** + bouton **"Lancer l'analyse"** (`h-9 px-5 rounded-full bg-foreground text-background text-xs`) + `CreditCostBadge actionId="screen_candidate"` + `ModelPicker`.
- **Loading** : `Loader2 w-8 h-8` + **"Analyse en cours…"** (`uppercase tracking-wider`).
- **Résultat** : icône `ShieldCheck` (≥80) / `ShieldAlert` (≥50) / `ShieldX`, score `font-display text-3xl` + **"/100 confiance"**, texte **"Aucune anomalie détectée — profil cohérent."** ou **"{n} anomalie(s) détectée(s)"**, bouton texte **"Relancer"**.
- `CATEGORY_CONFIG` : **Timeline** (`Clock`, info) · **Inflation** (`TrendingUp`, warning) · **Éducation** (`GraduationCap`, brand-purple) · **Cohérence** (`Shuffle`, info).
- `SEVERITY_CONFIG` : **Faible** (info) · **Moyen** (warning) · **Élevé** (destructive).
- Erreur : `<p className="text-xs text-destructive">` inline (pas de toast).

---

## 17. `LiveCoachingPanel.tsx` + `AudioSetupGuide.tsx`

### LiveCoachingPanel (`border bg-foreground/[0.02] max-h-[520px]`, **pas de rounded**)
- Header : point `animate-ping` rouge si enregistrement ; titre **"Live — {n}/{total} critères"** / **"Session terminée"** / **"Coach Live"** ; chrono `tabular-nums`.
- Boutons `h-[28px] px-3 text-xs font-bold uppercase tracking-wider` :
  - **"Démarrer"** (`Mic`, `bg-destructive text-destructive-foreground`)
  - **"Arrêter"** (`Square`, `bg-destructive/80` + `animate-pulse`)
  - **"Générer le CR"** (`FileText`/`Loader2`, `bg-foreground text-background`) + `CreditCostBadge actionId="call_report"` + `ModelPicker`
  - **"CV"** (`User`, `lg:hidden`) → `onOpenProfile`
  - `X` (fermer)
- Sections : bandeau *next topic* (`bg-info/5 border-info/20`) avec bouton copier ; **"Préparation intro…"** ; **"Checklist critères"** ; **"À creuser"** (`title="Retirer"`) ; **"En attente…"** ; puis le rapport : **"Synthèse"**, **"Évaluation par critère"**, **"Forces"** (success), **"Red flags"** (destructive), **"Questions ouvertes"**, **"Message de suivi"** (+ **"Copier"**).
- **"Actions post-entretien"** — 3 boutons `h-[32px] px-4 text-xs font-bold uppercase` avec **emojis en dur** : **"✓ Avancer dans le pipeline"** (si GO), **"✕ Écarter + copier le message"** (si NO_GO), **"📅 Planifier la suite"**.
  ⚠️ Ces 3 actions ne font **que** `toast.success(...)` + `onClose()` — **aucune mutation réelle** (`"Candidat avancé à l'étape suivante"`, `"Entretien suivant à planifier"`).
- **Toasts** : `"Coaching live démarré — parlez naturellement"`, `"Enregistrement arrêté"`, `"Compte-rendu généré"`, `"Copié !"`, `"Message de refus copié"`, `"Non authentifié"`, `"Erreur de connexion Deepgram"`, `"Accès au microphone refusé. Vérifiez les permissions du navigateur."`, `"Aucun microphone détecté. Vérifiez le périphérique audio sélectionné."`, `"Aucune transcription à analyser"`, `"Erreur au démarrage"`, `"Erreur lors de la génération du CR"`.

### AudioSetupGuide
- Titre **"Configuration audio"**, label **"Votre situation"**, CTA **"J'ai compris — lancer le coaching"**.
- 4 scénarios (`SCENARIOS`) avec `label` / `description` / `steps[{text, important}]` / `alternativeTitle` / `alternative` :
  1. **Visio + casque** (`Headphones`) — "Google Meet, Teams, Zoom avec casque audio" — alt *"Alternative : mixeur audio virtuel"* (VB-Cable / BlackHole).
  2. **Visio en salle** (`Monitor`) — "Visio sur écran avec haut-parleurs (salle de réunion)".
  3. **Téléphone + casque** (`Headphones` ⚠️ icône dupliquée) — "Aircall, Ringover ou autre téléphonie IP avec casque" — alt *"Astuce : Aircall"*.
  4. **Entretien sur place** (`Users`) — "Le candidat est physiquement présent".
- Dismiss persisté en `sessionStorage['audio-guide-dismissed']`.

---

## 18. Shortlist Notion — `components/candidates/`

### `PipelineStats.tsx`
Bloc `bg-background border p-4 mb-6 animate-fade-in`, grille `grid-cols-2 sm:grid-cols-4 gap-0` (bordures accolées `border-l-0`, **pas de rounded**) :
**Total** (`Users`, `bg-muted/30`) · **En cours** (`TrendingUp`, `bg-info/5 text-info`) · **Gagnés** (`Award`, `bg-success/5 text-success`) · **Perdus** (`XCircle`, `bg-destructive/5 text-destructive`). Valeurs `text-2xl font-bold`.
Ligne du bas : **"Conversion:"** + barre `h-1.5 max-w-[200px] bg-muted border` remplie `bg-success` + `{n}%`.
⚠️ Formule de conversion **différente** de `ATSStats` : ici `won/total`, là-bas `won/(won+lost)`.

### `CandidatePipeline.tsx` / `DroppableColumn.tsx` / `DraggableCandidateCard.tsx`
- Même moteur dnd-kit, **colonnes `w-[300px]`** (vs 280 côté ATS), **pas de rounded**, `border p-3 bg-background`, header non-sticky, titre `font-semibold uppercase tracking-wide text-sm`, compteur `bg-muted px-2 py-0.5 border` **carré**.
- Vide : **"Aucun candidat"** / **"Déposer ici"** (sans emoji, contrairement à ATS).
- Pagination : `INITIAL_DISPLAY_LIMIT=10`, `LOAD_MORE_INCREMENT=10`, boutons `<Button variant="ghost" size="sm">` **"Voir {n} de plus ({m} restants)"** et **"Réduire"** (≠ **"Voir plus (N)"** côté ATS).
- Carte : `bg-card rounded-lg border p-3 cursor-grab active:cursor-grabbing touch-none`, `opacity: 0.5` inline si drag, `CSS.Translate` (l'ATS n'applique pas de transform). Contient nom, poste (`Briefcase`, `text-info`), expertise (2 max), badge entité (**"Konekt"** → `bg-success/10 text-green-700` ⚠️, autre → `bg-brand-purple/10 text-purple-700` ⚠️), chevron d'expansion, et en expansion : email / téléphone / **"LinkedIn"** (`text-blue-600` ⚠️), commentaires en italique entre guillemets, **"CV présenté: {date}"**.
- **Pas de** : avatar, score, tags, checkbox bulk, alerte de stagnation, temps relatif.
- Toasts : `"Candidat déplacé vers \"{label}\""` / `"Erreur lors de la mise à jour"` (avec rollback optimiste).

### `CandidateCard.tsx` / `CandidateList.tsx`
- 2 variantes (`compact` / full), `bg-background border p-3|p-4` sans rounded. Badges d'entité `text-xs px-2 py-0.5` **sans rounded** en compact, `px-2 py-1` en full.
- Full : badge d'étape `bg-muted border`, chips d'expertise **toutes** affichées (pas de `+N`), liens email/tel/LinkedIn (`text-info`), chevron d'expansion → grille 4 cols de dates : **"Pré-qualif"**, **"CV présenté"**, **"Retour manager"**, **"Offre validée"**, puis **"Commentaires"**.
- `CandidateList` vide : `bg-background border p-12 text-center` + **"Aucune candidature ne correspond à vos critères"** (≠ **"Aucun candidat trouvé"** de l'ATSTable).

### `shared/CandidateAvatar.tsx`
Tailles `xs w-6 / sm w-8 / md w-10 / lg w-12 / xl w-16`, `rounded-full`, initiales 2 lettres, fallback `bg-muted border-border/50`. ⚠️ **Jamais importé par aucun fichier de `ats/` ni de `candidates/`** — primitive orpheline. Son `onError` fait `style.display='none'` (commentaire du code admet que le fallback ne se déclenche pas).

### `CompanyLogo.tsx`
Cascade `logoUrl` → `logo.clearbit.com/{slug}.com` → `google.com/s2/favicons?domain=...&sz=128` → `Building2`. Tailles `sm w-5 / md w-7 / lg w-9`. ⚠️ **Non utilisé dans le périmètre** ; `ScorecardFullPage` ré-implémente sa propre logique Clearbit inline.

---

## 19. `components/pedigree/PedigreeRequirementsEditor.tsx`
(Composant hors-pipeline, monté dans les settings/missions.) Sections `SectionHeader` (`border-b`, `h4 text-sm font-semibold`) :
1. **Écoles & diplômes** (`GraduationCap`) — `CsvInput` "Écoles requises (au moins une suffit)" `placeholder="ex: Polytechnique, Centrale, HEC, EPITA, 42, ESSEC"` + hint ; Select "Origine du diplôme".
2. **Provenance entreprises** (`Briefcase`) — `MultiSelectPills` catégories souhaitées, `CsvInput` "Entreprises spécifiques requises" `placeholder="ex: Stripe, Doctolib, Datadog"`, pills "Catégories à éviter (signal négatif)".
3. **Stade de financement** (`TrendingUp`) — pills + hint "Brackets par montant de la dernière levée. Annuaire mis à jour mensuellement."
4. **Séniorité & mode strict** (`Shield`) — Select "Séniorité minimale" (`placeholder="Pas de minimum"`), `<Switch>` **"Mode strict"** + explication du plafonnement à 50.
5. **Instructions additionnelles (optionnel)** — `<Textarea rows={3} maxLength={400}>` + compteur **"{n} / 400 caractères"**.
- `MultiSelectPills` actif : ⚠️ `border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400` — **seul endroit du repo avec un variant `dark:` explicite** et couleur brute.
- ⚠️ Utilise `<Label>` shadcn — **le seul du périmètre** ; partout ailleurs les labels sont des `<p className="text-3xs uppercase tracking-wider font-bold">`.

---

# ANOMALIES DESIGN

## A. Valeurs de couleur en dur (hors tokens)
1. **`bg-emerald-500/15` comme "icon-tile" par défaut** — 18 occurrences dans 7 fichiers (`ATSStats`, `ATSPipelineAnalytics` ×2 dont le ton `default` de `KPICard`, `ScorecardTab` ×2, `EvaluationTab` ×2, `OverviewTab` ×6, `ProfileDetailedTab` ×3, `CVTab`, `ScorecardFullPage` ×3). C'est **la** couleur d'accent de fond des tuiles d'icônes de tout le module, et elle n'est **pas** tokenisée.
2. **`bg-emerald-500/70`** — barres de progression du header/sidebar de `ScorecardFullPage` (×3) ; ailleurs les barres utilisent `bg-foreground/*` ou `bg-success`.
3. **`hsl(142 76% 36%)` / `hsl(38 92% 50%)` / `hsl(0 84% 60%)`** en dur dans `EvaluationTab.ScoreHero` (ring + bg + border + texte) — équivalents non-tokenisés de success/warning/destructive.
4. **`hsl(var(--skalr-purple))`** dans `ScorecardTab` (catégorie *Culture*) alors que `CATEGORY_CONFIG` du même fichier utilise `brand-purple` → deux noms pour la même couleur, dans un même composant.
5. `Qualification.tsx` : `text-blue-400 hover:text-blue-300` (lien LinkedIn), `bg-amber-500/20 text-amber-400 border-amber-500/30` (verdict "À revoir").
6. `JobDetailSheet.tsx` : `border-red-300` / `border-amber-300` / `border-green-300` (Must/Should/Nice-to-have), `border-amber-400 text-amber-600` (statut "paused" — mélangé avec `bg-warning/10` tokenisé sur la même règle).
7. `DraggableCandidateCard.tsx` : `text-green-700`, `text-purple-700`, `text-blue-600`, `text-blue-700` — mélangés à des `bg-success/10` / `bg-brand-purple/10` tokenisés dans la **même classe**.
8. `PedigreeRequirementsEditor` : `border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400`.
9. `PrepSheetTab` : `text-red-500`.
10. **URLs de logos tierces en dur** : `https://logo.clearbit.com/{slug}.com` dans `ScorecardFullPage` **et** `CompanyLogo` ; `https://www.google.com/s2/favicons?...` dans `CompanyLogo`.

## B. Palettes de statut définies localement (au lieu de tokens partagés)
| Concept | Définitions concurrentes |
|---|---|
| Libellés de source | **3** : `ATSCandidateCard.SOURCE_CONFIG` (Pipeline/Séquence/InMail/Outreach) · `ATSTable.SOURCE_LABELS` (Pipeline/Séquence/InMail/Outreach) · `ATSFilters.SOURCE_LABELS` (**Pipeline Notion / Séquences / InMails**, sans Outreach) · + `ATSTimeline.SOURCE_CONFIG` (icônes seules, 3 entrées) → **4 sources de vérité** |
| Seuils de score | `≥70/≥40` (ATSCandidateCard, ATSTable) · `≥70/≥50` (ScorecardFullPage, EvaluationTab, Qualification) · `≥70` seul + `border-destructive` (JobDetailSheet) → **3 barèmes** |
| Notes 1-5 | `≥4/≥3` dupliqué 5 fois dans ScorecardTab (pastille header, rail, ratingTone, rubric, mini-dots) |
| Recommandation | `RECOMMENDATION_OPTIONS` (ScorecardTab) **+** `recoTone` (ScorecardFullPage) — mêmes 5 valeurs, 2 mappings de classes |
| Catégories de critère | `CATEGORY_CONFIG` (classes Tailwind) **+** `catConf` inline l.698 (variables CSS) — même 4 catégories |
| Temps de garde | `GUIDE_TIMES` ×3 + `STAGNATION_THRESHOLDS_DAYS` ×1 → **4 copies** |
| Stages | `ATS_STAGES` (10) vs `PIPELINE_STAGES` (6) avec **"CV envoyé" de couleur différente** ; `.color` d'`ATS_STAGES` **jamais lu** par le kanban |
| Stages fantômes | `Qualification` écrit **"Qualifié"/"Rejeté"** en base — absents des deux tables |

## C. Duplication de composants candidat entre `ats/` et `candidates/`
- **Kanban dupliqué à ~90 %** : `ATSKanban`+`ATSDroppableColumn`+`ATSDraggableCard`+`ATSCandidateCard` vs `CandidatePipeline`+`DroppableColumn`+`DraggableCandidateCard`. Même DndContext, même `rectIntersection`, même `distance: 5`, même pagination 10+10 — mais colonnes `280px` vs `300px`, `rounded-xl` vs carré, header sticky vs non, libellés de "voir plus" différents, empty state avec/sans emoji.
- **Stats dupliquées** : `ATSStats` (6 tuiles, `rounded-xl`, icon-tile emerald) vs `PipelineStats` (4 tuiles + barre, bordures accolées carrées) — et **formule de conversion divergente**.
- **Filtres dupliqués** : `ATSFilters` (popovers multi-select, pills `h-8 rounded-full`) vs `CandidateFilters` (Selects mono-valeur, `h-9`, pas de rounded) — deux langages visuels sur la **même page**.
- **Fiche profil dupliquée** : `ProfileTab` vs `ProfileDetailedTab` (ProfileTab mort mais toujours exporté par `index.ts`).
- **Primitives orphelines** : `CandidateAvatar` et `CompanyLogo` ne sont utilisés nulle part dans le périmètre ; l'avatar est ré-implémenté en `<Avatar>` shadcn dans `ScorecardFullPage` et le logo en `<img>` + Clearbit inline.

## D. Typographie
- **14 tailles arbitraires distinctes** : `text-[10px]`(37), `[11px]`(29), `[12px]`(26), `[13px]`(21), `[12.5px]`(13), `[10.5px]`(13), `[11.5px]`(11), `[14px]`(10), `[15px]`(8), `[20px]`, `[18px]`, `[16px]`, `[22px]`, `[13.5px]`. Coexistent avec les échelles Tailwind (`text-xs`, `text-sm`, `text-2xs`, `text-3xs`) → **le même niveau visuel s'écrit `text-xs`, `text-[12px]` ou `text-[12.5px]` selon le fichier**.
- Cas flagrants : `text-[11.5px]` réservé aux pills de toolbar d'`ATS.tsx`/`ATSFilters` ; `text-[10.5px]` aux badges d'`ATSTable`/`ATSTimeline` ; `text-[12.5px]` au corps de la card critère.
- Titres : `font-display font-bold tracking-tight` dans `ats/`, mais `font-semibold` sans `font-display` dans `candidates/`, `Qualification` et `RemindersSidebar`.
- `uppercase tracking-wider` appliqué de façon incohérente : `font-bold` ici, `font-semibold` là, `font-medium` ailleurs, pour le même rôle d'eyebrow.

## E. Radius
- 5 radius en circulation : `rounded-full`(136), `rounded-lg`(63), `rounded-xl`(55), `rounded-md`(22), `rounded-2xl`(4), + `rounded-sm`(5) et `rounded`(5) nus.
- **`candidates/`, `Qualification`, `LiveCoachingPanel`, `PipelineStats`, `ActionsTab`, `NotesTab`, `CandidateCommentsTab` sont majoritairement SANS radius** (esthétique "brutaliste" : bordures carrées accolées, `-ml-px`), alors que `ats/` est intégralement `rounded-xl`/`rounded-full`. Les deux cohabitent dans la même page `/pipeline`.
- Boutons : `rounded-full` (ATS), `rounded-lg` (Qualification verdict), aucun radius (ScorecardTab verdict + recommandation, NotesTab toggle, LiveCoaching).
- La **grille de notation 1–5** est en `rounded-2xl` alors que rien d'autre du périmètre ne l'est.

## F. Hauteurs / spacing
- Hauteurs de contrôle : `h-7`, `h-8`, `h-9`, `h-10`, `h-[28px]`, `h-[32px]`, `h-[38px]` — 7 valeurs pour des boutons de même rang. `h-[28px]`≈`h-7`, `h-[32px]`=`h-8`, `h-[38px]`≈`h-9.5` : **valeurs arbitraires redondantes avec l'échelle**.
- `ATSFilters` en `h-8` vs `CandidateFilters` en `h-9` côte à côte.
- Hauteurs de scroll figées : `h-[600px]` (Timeline, colonne kanban), `h-[500px]` (RemindersSidebar), `h-[520px]` (LiveCoaching), `max-h-[calc(100vh-120px)]` (rail scorecard) — aucune logique commune.
- Largeurs figées : `w-[280px]` (colonne ATS), `w-[300px]` (colonne shortlist + panel coaching), `w-[150px]` (rail), `w-[320px]/w-[340px]` (sidebar), `w-[540px]` (sheet), `w-80` (rappels).

## G. Composants : bouton natif vs `<Button>`
- La quasi-totalité du périmètre utilise des `<button>` natifs avec classes ad-hoc. `<Button>` shadcn n'apparaît que dans `BulkActionsBar`, `RemindersSidebar`, `CVTab`, `DroppableColumn` (candidates), `CandidateFilters`, `Qualification`. → **aucune variante/size partagée** ; `variant`/`size` ne sont donc pas des tokens exploitables aujourd'hui.
- Idem cards : `<Card>` shadcn uniquement dans `Qualification.tsx`, `div.rounded-xl.border.bg-card` partout ailleurs.
- Idem loaders : `Loader2 animate-spin` partout sauf `Qualification` (spinner CSS custom) ; skeletons uniquement pour Kanban/Table/Stats (Timeline, Analytics, Shortlist, Scorecard, tous les tabs de la fiche → spinner ou rien).

## H. Accessibilité / UX
- Kanban : `role="button"` + `aria-label` présents ; **Table, Timeline et JobDetailSheet.CandidatsTab n'ont pas d'équivalent** (lignes cliquables sans rôle).
- `ATSTable` : tri sans indicateur de sens ni `aria-sort`.
- `shortLabel` "Act." dupliqué (Activité / Actions) dans les onglets de la modale.
- Icône `Trophy` réutilisée pour "Gagnés" **et** "Conv." dans `ATSStats`.
- Icône `icon-timeline-3d.webp` réutilisée pour "Timeline" **et** "Shortlist Client".
- `SheetTitle` de `JobDetailSheet` en `sr-only` → pas de titre visible normalisé.
- Emojis en dur dans l'UI : `⬇️ Déposer ici`, `💬 Équipe`, `📝 Perso`, `✓ Avancer dans le pipeline`, `✕ Écarter…`, `📅 Planifier la suite`, `Go ✅`, `No Go ❌`, `À revoir 🤔`, `En attente ⏳`.
- Ellipses incohérentes : `Rechercher…` (ATSFilters) vs `Rechercher...` (CandidateFilters) ; `Chargement…` vs `Sauvegarde...`.
- Langue mixte : les labels de scorecard (`Phone Screen`, `Culture Fit`, `Strong Yes`, `Maybe`) restent en anglais dans une UI FR.

## I. Actions non fonctionnelles / dette
- `onScoreClick` de la modale → `toast.info("Voir l'onglet Évaluation")` sans switch d'onglet.
- Les 3 boutons "Actions post-entretien" du LiveCoachingPanel → toast seul, aucune mutation.
- `sequenceStatus` affiché brut (valeurs DB anglaises) sur la carte kanban.
- Bulk actions disponibles **uniquement en kanban** (pas de sélection en table), et exécution séquentielle bloquante.
- `ScorecardFullPage` : polling DB toutes les **5 s** ; `ScorecardTab` : autosave 3 s **inopérant tant que `ev.id` est absent** (fallback in-memory documenté dans le code) ; `Qualification` : autosave 10 s.
- `ATSTableSkeleton` (6 colonnes) et `ATSStatsSkeleton` (grille `2/3/6`) ne correspondent pas aux composants réels (8 colonnes, grille `3/6`) → saut de layout au chargement.
