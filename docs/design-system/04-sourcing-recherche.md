# 04 — Inventaire zone RECHERCHE / SOURCING

## 0. Carte des fichiers

| Rôle | Fichier |
|---|---|
| Liste des recherches | `/home/user/remix-of-event-template/src/pages/SourcingSearches.tsx` (190 l.) |
| Workspace d'une recherche | `/home/user/remix-of-event-template/src/pages/SourcingSearch.tsx` (251 l.) |
| Hero prompt IA | `/home/user/remix-of-event-template/src/components/sourcing/PromptSearchHero.tsx` (181 l.) |
| Orchestrateur | `/home/user/remix-of-event-template/src/components/outreach/LinkedInSearch.tsx` (1414 l.) |
| Flow V3 (hero/plan/chips) | `/home/user/remix-of-event-template/src/components/outreach/search/SourcingFlow.tsx` (1112 l.) |
| Panneau filtres | `/home/user/remix-of-event-template/src/components/outreach/search/SearchFiltersPanel.tsx` (655 l.) |
| Facettes chips | `/home/user/remix-of-event-template/src/components/outreach/search/FilterFacets.tsx` (380 l.) |
| Barre prompt NL | `/home/user/remix-of-event-template/src/components/outreach/search/SearchPromptBar.tsx` (188 l.) |
| Filtres avancés | `/home/user/remix-of-event-template/src/components/outreach/LinkedInFilters.tsx` (903 l.) + `filters/{Basic,Position,Recruiter,Database}FiltersSection.tsx` |
| Auto-fill | `/home/user/remix-of-event-template/src/components/outreach/AutoFillFiltersButton.tsx` (538 l.) |
| Panneau résultats | `/home/user/remix-of-event-template/src/components/outreach/search/SearchResultsPanel.tsx` (1390 l.) |
| Table compacte | `/home/user/remix-of-event-template/src/components/outreach/search/CompactResultsTable.tsx` (1344 l.) |
| Carte profil | `/home/user/remix-of-event-template/src/components/outreach/LinkedInResultCard.tsx` (579 l.) + `result-card/{CardActions,CardStatusBadges,CardExpandedContent,ProfileExperienceList,ProfileEducationList}.tsx` |
| Fiche détail | `/home/user/remix-of-event-template/src/components/outreach/result-card/ProfileDetailSheet.tsx` (1143 l.) |
| Scoring | `/home/user/remix-of-event-template/src/components/outreach/JobScoreDisplay.tsx` (715 l.), `BatchScoringReport.tsx` (491 l.), `BatchScoringStats.tsx`, `ScoringBreakdown.tsx` |
| Surcouches | `/home/user/remix-of-event-template/src/components/outreach/search/SmartOverlays.tsx` (398 l.) |
| Divers | `AppliedFiltersBar.tsx`, `SearchHistory.tsx`, `RefineSearchModal.tsx`, `LinkedInReconnectBanner.tsx`, `BaseKonektDialog.tsx`, `QuotaDisplay.tsx`, `filter-wizard/FilterWizard.tsx` |
| Hooks (états) | `src/hooks/useLinkedInSearch.ts`, `useLinkedInSearchActions.ts`, `useLinkedInScoring.ts`, `useLinkedInQuotaStatus.ts`, `useFilteredResults.ts`, `useSearchHistory.ts` |

---

## 1. Écran « Recherche » — liste (`/sourcing`)

### Structure
`div.w-full.max-w-full.bg-background` > `div.py-6` > conteneur `max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8`.
Header flex `sm:flex-row sm:items-end sm:justify-between gap-4 mb-6`.
Grille : `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3`.

### Textes
- Eyebrow : « Sourcing » (`text-[10px] uppercase tracking-wider`)
- H1 : « Recherche » (`font-display text-2xl font-bold tracking-tight`)
- Sous-titre : « Source des candidats librement — transforme la recherche en mission quand elle devient sérieuse. »
- SEO : title « Recherche | Konekt », description « Sourcez des candidats librement, sans créer de mission »

### Boutons
| Label | Variant/size | Icône | Action | État |
|---|---|---|---|---|
| **Nouvelle recherche** | default, `gap-1.5 shrink-0` | `Plus w-4 h-4` | `createProject({name: buildSearchName(), kind:'search'})` puis `navigate('/sourcing/:id')` | `disabled={isCreating}` |
| **Démarrer une recherche** (empty state) | default, `gap-1.5 mt-4` | `Plus` | idem | `disabled={isCreating}` |
| **Reprendre →** (carte) | ghost sm `h-7 px-2 text-xs gap-1` | `ArrowRight w-3 h-3` | ouvre | — |
| Corbeille (carte) | ghost sm `h-7 w-7 p-0`, `opacity-0 group-hover:opacity-100` | `Trash2 w-3.5 h-3.5` | ouvre AlertDialog | aria-label « Supprimer la recherche » |

### Carte de recherche (`SearchCard`)
`interactive-card group relative rounded-xl border border-border bg-card p-4 flex flex-col gap-3`
- Titre : `font-display font-bold line-clamp-2`, overlay `absolute inset-0` cliquable
- Sous-titre : « Modifiée le {jj mois aaaa} » (`Intl fr-FR`, `text-xs text-muted-foreground`)
- Pills stats (filtrées si 0) : `h-6 px-2 rounded-full bg-muted text-[11.5px]` — `Users` « profils », `Star` « shortlistés », `Send` « contactés »
- Si aucune stat : « Aucune recherche lancée »
- Footer : `border-t border-border/60`

### États
- Chargement : `<BrutalLoader variant="default" rows={3} messages={['Chargement des recherches…']} />`
- Vide : bloc `konekt-fade-up py-16 rounded-xl border border-dashed`, carré `w-14 h-14 rounded-xl bg-foreground text-background` + `Search w-7 h-7`, titre « Aucune recherche pour l'instant », corps « Lance une recherche LinkedIn sans créer de mission : filtres, scoring IA et shortlist fonctionnent pareil. »
- AlertDialog suppression : titre « Supprimer cette recherche ? », description « « {nom} » et les statuts candidats associés (shortlist, scores, contactés) seront supprimés. Cette action est irréversible. », boutons **Annuler** / **Supprimer** (`bg-destructive text-destructive-foreground`, `disabled={isDeleting}`)

Nom auto : `Recherche du {6 juillet}, {14h32}`.

---

## 2. Workspace recherche (`/sourcing/:id`)

### Barre de titre
`flex items-center gap-2 mb-1 flex-wrap` :
1. Bouton retour ghost `h-9 w-9 p-0`, `ArrowLeft w-4 h-4`, aria-label « Retour aux recherches »
2. `Input h-9 font-medium`, placeholder **« Intitulé du poste (ex : Développeur React senior) »**, aria-label « Intitulé du poste recherché », commit sur blur/Enter
3. **Prompt IA** (ghost sm `h-9 gap-1.5`, `Sparkles w-3.5 h-3.5`) — affiché seulement si hero fermé — title « Décrire la cible en langage naturel — l'IA génère les filtres »
4. **Transformer en mission** (outline sm `h-9 gap-1.5`, `Briefcase w-3.5 h-3.5`)

Helper sous la barre (`text-xs text-muted-foreground mb-3 ml-11`) : « L'intitulé sert au scoring IA — il se remplit tout seul quand tu passes par le prompt. »

### Hero prompt IA (`PromptSearchHero`)
Carte `max-w-2xl mx-auto py-8 sm:py-14` > `rounded-xl border border-border bg-card p-5 sm:p-8`, entrée framer-motion (opacity/y 10, 0.3 s).
- Eyebrow : « Recherche assistée par IA »
- H2 : « Décris qui tu cherches » (`font-display text-xl sm:text-2xl font-bold`)
- Corps : « Poste, compétences, expérience, localisation, type d'entreprise… en langage naturel. L'IA construit les filtres LinkedIn pour toi. »
- `Textarea rows={4} resize-none text-sm`, placeholder « Ex : Développeur fullstack React/Node, 5 ans d'expérience minimum, Paris ou full remote, idéalement en scale-up »
- 3 chips exemples (`h-6 px-2 rounded-full bg-muted text-[11.5px]`, tronquées à 52 car. + « … », `title` = texte complet) :
  1. « Développeur fullstack React/Node, 5 ans d'expérience minimum, Paris ou full remote, idéalement en scale-up »
  2. « Head of Sales SaaS B2B, Lyon, habitué aux cycles de vente grands comptes »
  3. « Product designer senior, Figma et design systems, full remote France »
- Avertissement si filtres existants (`text-xs text-warning`) : « Régénérer remplacera les filtres actuels de cette recherche. »
- Boutons : **Générer la recherche** (`Sparkles`) → loading « L'IA analyse ta demande… » (`Loader2 animate-spin`) ; **Configurer les filtres manuellement** (ghost, `SlidersHorizontal`, `text-muted-foreground`)
- Toasts : erreur « Décris un peu plus ta cible (poste, compétences, localisation…) » (< 10 car.) ; « La génération a échoué » + desc « Réessaie dans quelques secondes. » ; succès « Filtres générés » + « Vérifie les filtres appliqués et lance la recherche. »

### Dialog « Transformer en mission »
Titre « Transformer en mission » ; description « La recherche devient une mission complète (brief, process, pipeline, outreach). Les candidats, filtres et statuts sont conservés tels quels. » ; label « Nom de la mission » ; placeholder « Ex : Développeur React senior — Client X » ; **Annuler** (outline) / **Créer la mission** (`disabled={isUpdating || !missionName.trim()}`). Toast succès « Recherche transformée en mission » + « Candidats, filtres et statuts sont conservés. »

### États page
- Chargement : `BrutalLoader variant="default" rows={3} messages={['Chargement de la recherche…']}`
- Introuvable : « Recherche introuvable » / « Elle a peut-être été supprimée. » + bouton outline **Retour aux recherches** (`ArrowLeft`)

---

## 3. Orchestrateur `LinkedInSearch`

Racine : `w-full max-w-full min-w-0 flex flex-col lg:h-[calc(100dvh-5rem)]`.

Machine à états (contexte mission/projet) : `flowMode ∈ 'hero' | 'plan' | 'results'`.
- Hors projet → `AppliedFiltersBar` (barre legacy)
- Projet + hero → `SearchHero`
- Projet + plan → `SearchPlan`
- Projet + results → `FilterChipBar` + `SmartOverlays`
Puis toujours : `LinkedInReconnectBanner`, bandeau pedigree, `Dialog` filtres, `SearchResultsPanel`, `FilterWizard`, `RefineSearchModal`.

### Bandeau pedigree / ICP
`mx-2 sm:mx-0 mb-2 px-3 py-2 border border-foreground/15 bg-foreground/[0.03] rounded-md text-xs` — libellé gras `text-3xs uppercase` : **« Mode chirurgical »** ou **« Filtres ICP »**, puis « N école(s) », « N entreprise(s) », « · dont N concurrent(s) », « · N exclue(s) », « · séniorité min », « injecté(s) dans la recherche LinkedIn », et à droite en ambre : « N non encore résolu(s) (cron mensuel) ».

### Modale filtres
`DialogContent w-full h-full max-w-full max-h-full sm:max-w-3xl sm:max-h-[85vh] overflow-y-auto p-0 gap-0 rounded-none sm:rounded-lg`, `DialogTitle` sr-only « Filtres de recherche », padding interne `p-3 sm:p-5`.

### Toasts propres à l'orchestrateur
- « N profil(s) archivé(s) »
- « Profil archivé »
- « Profils inscrits à la séquence »
- Shortlist : « N profil(s) shortlisté(s) », « N déjà en shortlist », « N introuvable(s) », fallback « Aucun profil à shortlister » ; erreurs « Shortlist impossible : {err}. Votre sélection est conservée. » / « Shortlist impossible. Votre sélection est conservée, réessayez. »
- Refine : « Aucun ajustement suggéré » (info), « Erreur lors de l'analyse », « N ajustement(s) appliqué(s) (N avec prudence) » (4 s)
- Historique : « Filtres de l'historique appliqués, recherche en cours... »
- Affinage NL : « Filtres mis à jour — relance quand tu es prêt. », « Aucun changement à appliquer pour cette instruction. », « Crédits IA insuffisants », « L'affinage a échoué, réessayez. »
- Flow : « La génération a échoué, réessayez. », « Connectez votre compte LinkedIn pour lancer une recherche. », erreur hero « La recherche n'a pas abouti. Vérifiez votre connexion LinkedIn et vos filtres, puis relancez. »
- Blocage scoring en recherche autonome : « Précise d'abord ce que tu cherches (intitulé du poste, en haut de la page) avant de lancer le scoring. »

---

## 4. `SearchHero` (SourcingFlow, état 1)

`flex-1 flex flex-col items-center justify-start pt-10 sm:pt-16 pb-10 px-4 min-h-[480px]` + halo radial `var(--k-accent-tint)` (560×300, `opacity-50`, `top-[-60px]`).

- Pill contexte : `rounded-full border border-[var(--k-hairline)] bg-[var(--k-surface)] pl-1.5 pr-3 py-1 text-xs` — « Mission · **{jobTitle}** · {clientName} », glyphe cible 20×20.
- H2 : **« Qui cherches-tu ? »** `text-xl font-semibold tracking-[-.015em] text-[var(--k-text)]`
- Prompt : `max-w-[640px] rounded-xl border bg-[var(--k-surface)] px-4 py-3.5`, focus → `border-[var(--k-hairline-focus)] shadow-[0_1px_3px_rgba(0,0,0,0.2)]`. Glyphe `AiBurst` 17px qui prend `var(--k-accent)` au focus/armé.
- Textarea `rows={2} min-h-[52px] text-[15px]`, placeholder **« Décris le profil idéal — rôle, séniorité, contexte, lieu. L'IA le traduit en filtres que tu pourras piloter. »**, Enter = lancer, Shift+Enter = saut.
- Raccourcis : `⏎ lancer · / focus` (kbd `border-[var(--k-hairline)]`) ; touche `/` focalise globalement.
- CTA : **« Générer & chercher »** (armé → `bg-[var(--k-accent)] text-[var(--k-on-accent)] hover:bg-[var(--k-accent-hover)]`), ou **« Lancer la recherche avec les filtres du brief »** si `onLaunchWithBriefFilters` et champ vide. `disabled` = `search.loading`.
- Erreur : `<p role="alert" text-xs text-[var(--k-warn)]>`
- Exemples (`Exemples — rôle + séniorité + contexte + lieu`, `font-mono text-[10px] uppercase`) :
  - « Account Manager SaaS B2B, 8-12 ans, grands comptes, Île-de-France, pas d'ESN »
  - « Head of Sales fintech série B, Paris, a scalé une équipe »
- Ligne « ou **régénérer les filtres depuis le brief** / **générer depuis le brief** — sans rien taper » (lien souligné `underline-offset-4`)
- Historique : « Reprendre une recherche » + 3 entrées `rounded-[10px] border` avec horloge, libellé (rôles/keywords/job_title) et « N profils » en `font-mono`.

## 5. `SearchPlan` (état 2 — remplace le spinner)

`flex-1 px-4 py-6 min-h-[420px]`, colonne `max-w-[720px] mx-auto`.
- Rappel de la requête dans une carte `rounded-[10px] border bg-[var(--k-surface)] px-3 py-2.5` + `AiBurst` accent
- Barre indéterminée custom : `h-0.5 rounded bg-[var(--k-hairline)]`, curseur `w-1/3 bg-[var(--k-accent)] opacity-75` animation inline `@keyframes kIndet`
- 3 étapes (`StepIcon`: done = pastille `bg-[var(--k-accent-tint)]` + check ; active = anneau qui tourne ; wait = point + `opacity-45`) :
  1. « Analyse de la demande + brief mission » (toujours done)
  2. « Extraction des filtres » — meta « N filtres — éditables juste après »
  3. « Recherche des profils »
- Étape active : classe `konekt-shimmer-text`
- Chips générés (staggered `animationDelay: min(k,8)*50ms`) : `rounded-full border px-2.5 py-0.5 text-xs`, préfixe `font-mono text-[9px] uppercase` = champ (Poste, Lieu, Exp., Skills, Boîte, Mots-clés), pastille accent 5px si `MUST_HAVE`.

## 6. `FilterChipBar` (état 3 — pilotage)

Conteneur `mb-2 > flex flex-wrap items-center gap-1.5`.

### Anatomie d'une pilule (3–5 segments)
`inline-flex items-stretch rounded-lg border bg-[var(--k-surface)] text-xs font-medium` — bordure `color-mix(in srgb, var(--k-accent) 35%, var(--k-hairline))` si poids `must`, sinon `border-[var(--k-hairline)]`.
1. **Champ** (icône SVG 1.5px + libellé) — cliquable si `canCycle` (Poste, Lieu) : bascule Indispensable ↔ Souhaité ; `title` = « {Indispensable|Souhaité|Exclure} — clic pour basculer »
2. **Opérateur** (`est`, `l'un de`, `l'une de`, `entre`, `contient`, `exclut`, `parmi`, `booléen`, `poste actuel`) — `text-[11.5px] font-normal`
3. **Valeurs** (max 2 affichées + `+N`), `max-w-[220px] truncate` → ouvre le popover valeurs
4. **Portée** (Poste / Boîte uniquement) : `actuel`, `passé`, `act. ou passé` / `actuelle`, `act. ou passée`, `passée`, `ex-employés` + chevron ; title « Portée — poste/entreprise actuel(le), passé(e)… »
5. **×** retirer la facette — aria-label « Retirer {champ} »

Valeur exclue rendue `⌀ {label}` et, dans le popover, `line-through text-[var(--k-bad,#e06666)]`.

### Facettes possibles (`buildChips`)
`poste`, `lieu`, `exp`, `anciennete` (Recruiter/SalesNav), `skills`, `boite`, `secteur`, `taille`, `ecole`, `seniorite`, `langue`, `keywords`, `contact` (Recruiter).

### Popovers
`absolute z-40 top-full mt-1.5 rounded-[10px] border border-[var(--k-hairline-focus)] bg-[var(--k-surface-3)] shadow-lg p-1.5 animate-in fade-in-0 zoom-in-95 duration-150`, en-tête `font-mono text-[10px] uppercase`.

- **Portée** : titre « Portée » ; options Poste = « Poste actuel uniquement » / « Actuel ou passé » / « Passé uniquement » ; Boîte = « Entreprise actuelle » / « Actuelle ou passée » / « Passée » / « Ex-employés (partis depuis) ». Check accent sur l'option courante.
- **Exp.** : deux `input type=number` (0–50) `h-7 w-14 font-mono text-center` placeholders « min » / « max », séparateur `→`, suffixe « ans ».
- **Ancienneté** : idem 0–40, suffixe « ans dans le poste ».
- **Contact** : « Exclure les déjà contactés » / « Seulement les déjà contactés » ; select « Période » = 30 derniers jours / 90 derniers jours / 6 derniers mois / 12 derniers mois / Depuis toujours ; note « Messages LinkedIn envoyés par l'équipe. »
- **Mots-clés** : lien « Éditer la requête booléenne dans le panneau avancé → »
- **Séniorité / Langue / Taille** : liste `role="checkbox"` avec check accent.
- **Générique (poste/lieu/skills/boîte/secteur/école)** : liste de tokens avec, au survol, 3 boutons — pastille pleine (« Rendre indispensable » / « Repasser en souhaité »), cercle barré (« Exclure cette valeur » / « Ne plus exclure »), `×` (« Retirer {label} », visible si >1 token) ; puis input `h-7` placeholder **« Ajouter — ⏎ »** (ou **« Résolution… »** pendant l'autocomplete LinkedIn, `disabled`).
- **Popover Lieu, extras** : select « Rayon » (`LOCATION_RADIUS_OPTIONS`, LinkedIn uniquement) et select « Mobilité » = « Sur place ou prêts à déménager » / « Sur place uniquement » / « Prêts à déménager uniquement ».

### Boutons de queue de barre
| Label | Style | Comportement |
|---|---|---|
| **+ Filtre** | `border-dashed border-[var(--k-hairline)] px-2.5 py-1 text-xs` | popover 2 étages ; liste : Lieu, Poste, Expérience totale, Ancienneté dans le poste (R/SN), Compétence, Entreprise, Secteur, Taille d'entreprise, École, Séniorité, Langue du profil, Déjà contactés ? (R), « Diplôme, spotlights, groupes… » (hint `panneau avancé`) |
| **Affiner** | dashed + `AiBurst` | déplie la barre NL ; title « Affiner en une phrase — l'IA la traduit en chips visibles » |
| **Avancé · N** | dashed + `+` | ouvre la modale filtres ; N = `advancedCount` (function, degree, groups, network_distance, past_company, past_job_title, spotlight, open_to_work, company_type) |

Barre NL repliable (`order-first basis-full`, `border-[var(--k-hairline-focus)]`) : placeholder **« Affiner en une phrase — ex. « ajoute anglais courant, retire Lyon » (⏎ · esc) »**, spinner `Loader2` pendant l'appel, `×` pour fermer.

### Compteur + relance (à droite, `ml-auto`)
- `{total.toLocaleString('fr-FR')}` en `font-mono text-[15px] [font-feature-settings:'tnum']` + « candidats »
- Bouton d'état : **« Recherche… »** (+`Loader2`) / **« Relancer la recherche »** (`bg-[var(--k-accent)]`) si `dirty` / **« À jour »** (`bg-[var(--k-surface-2)] cursor-default`), `disabled={loading}`

## 7. `SmartOverlays` — surcouches

Ligne `mb-2 flex flex-wrap gap-1.5`, eyebrow `font-mono text-[10px] uppercase` **« Surcouches »**.
Toggles `role="switch"` `rounded-full border px-2.5 py-1 text-xs`, actif = `bg-[var(--k-accent-tint)]` + bordure `color-mix(… 40%)` + check accent.

| Label | Tooltip | Condition |
|---|---|---|
| Prêts à bouger | « À l'écoute (open to work) OU actifs récemment sur LinkedIn — les plus susceptibles de répondre » | Recruiter |
| Mûrs pour bouger | « 3 ans ou plus dans le poste actuel sans évolution — la fenêtre de départ classique » | R/SN |
| Jamais contactés · 12 mois | « Exclut les profils déjà messagés par l'équipe sur le contrat Recruiter ces 12 derniers mois » | Recruiter |
| Déjà croisés | « Candidats déjà apparus dans d'anciennes recherches de l'équipe — le stock dormant à requalifier » | Recruiter |
| Warm intro | « Réseau 1er et 2e degré du compte connecté — une connexion commune peut faire l'intro » | LinkedIn |
| Top écoles | « N grandes écoles FR (HEC, Polytechnique, Centrale…) ajoutées au filtre École — « au moins une » » | — |
| Startup / Scale-up / Grand groupe | « Boîte actuelle de 1 à 200 / 51 à 1000 / 1001+ personnes » | LinkedIn |
| Hors ESN | « Exclut les profils en ESN / cabinet de conseil » | — |
| Ex-ESN | « Est passé par une grande ESN (Capgemini, Alten, Sopra…) mais n'y est plus — profils rompus au delivery, sortis du conseil » | LinkedIn |
| Vivier suggéré | « Entreprises où ce profil se trouve souvent, suggérées par l'IA : … » | si `alt_companies` |

**« A levé »** — bouton + chevron, popover : toggle `France` / `Europe`, 4 stades **Seed / Série A / Série B / Série C** avec compteur `font-mono` (« en résolution… », « top N / M », « N boîtes »), spinner par stade. Note de bas : « Top = les 100 boîtes du stade dont l'effectif croît le plus vite (6 derniers mois) — celles qui recrutent maintenant. Injectées comme boîte actuelle, élagables une à une dans la pilule Boîte. »
Toasts : « Annuaire en cours de résolution pour ce stade — réessaie dans quelques minutes », « Annuaire des levées de fonds indisponible ».

## 8. `AppliedFiltersBar` (hors projet — legacy)

`flex flex-col gap-1.5 mb-2` :
- **FILTRES** (`px-4 py-1.5 rounded-lg border`, `SlidersHorizontal`, `text-xs font-bold uppercase tracking-wider`) + badge compteur `bg-primary text-primary-foreground rounded-full`
- Pilule contexte poste (`bg-muted`, `max-w-[200px] truncate`)
- **Conseil** (`MessageSquare w-3.5`, title « Demander conseil à l'assistant pour affiner la recherche »)
- **Rechercher** (`bg-foreground text-background`, `Search w-3.5`, spinner 3×3 border-2 si loading, `disabled={loading}`)
- Rangée de chips (`bg-muted text-xs border-border/50`, max 6) + lien « +N autres »

---

## 9. `SearchFiltersPanel` (contenu de la modale filtres)

Racine `space-y-2 sm:space-y-2.5 lg:sticky lg:top-24 min-w-0 overflow-hidden`.

### 9.1 Alertes
- « **Reconnexion requise** » — « Le compte **{nom}** est déconnecté. » (`Alert variant=destructive bg-destructive/10 border-destructive/30`)
- « **Aucun compte LinkedIn connecté** » — « Connectez votre compte LinkedIn dans Paramètres pour accéder au sourcing. » (`py-2`, titre `text-xs`, desc `text-2xs`) — masquée en source `database`
- « **Licence non disponible** » — « Votre compte n'a pas de licence Recruiter/Sales Navigator. » (`Lock`)

### 9.2 Sélecteur de source
`grid grid-cols-2 gap-1 p-1 rounded-[10px] border border-[var(--k-hairline)] bg-[var(--k-surface)]` ; onglets **LinkedIn** / **Base Konekt** `text-[13px] py-1.5 rounded-[7px]`, actif = `bg-[var(--k-surface-2)] border shadow-[0_1px_3px_rgba(0,0,0,0.25)]`.
Sous-ligne `text-3xs` : « N recherche(s) incluse(s) restante(s) ce mois » ou « N crédits par page de résultats ».
Base Konekt non activée → ouvre `BaseKonektDialog` (titre « Base Konekt », desc « Une base de profils professionnels que vous consultez sans compte LinkedIn. Elle prend le relais quand la recherche LinkedIn est limitée. », lignes de plan, « Page de 20 profils : N crédits… », « Fiche complète : N crédits, qu'il reste ou non des recherches incluses. », mention « Les profils viennent de sources professionnelles publiques. Le sous-traitant qui les fournit figure sur la page confidentialité. », boutons **Fermer** / **Activer la Base Konekt** / **Voir les plans**).

### 9.3 Compte + mode API
Carte `rounded-[10px] border border-[var(--k-hairline)] bg-[var(--k-surface)] p-2.5` :
- Label `text-[10px] font-semibold uppercase tracking-[0.06em]` « **Compte** » + `QuotaDisplay compact`
- `Select h-8 text-sm` placeholder « Sélectionner », items avec avatar `w-5 h-5 rounded-lg` + badges licence `R` / `SN` (`bg-foreground/10`)
- Segmented mode API `w-7 h-7` : `C` / `R` / `SN`, indisponible → `Lock w-2.5` + `cursor-not-allowed`, actif = `bg-[var(--k-surface-2)] rounded-[6px] border`. Tooltips : « Licence Recruiter/Sales Navigator/LinkedIn Classic requise » ou « Désactivé (licence premium active) » ou le label.

### 9.4 Contexte poste
Hors projet : `JobSelector`. En projet : carte « **Poste actif** » + `{title} · {client}` (icône cible 15px).

### 9.5 `SearchPromptBar` (projet + job)
`rounded-[10px] border bg-[var(--k-surface)] px-3.5 py-3`, textarea autogrow (max 160 px) `text-[15px]`, placeholder **« Décris le profil — ex. Account Manager SaaS B2B en Île-de-France, 8+ ans, a géré des grands comptes, pas de profil ESN »**. Pied : kbd `⏎` + « pour lancer » ; bouton **« Générer les filtres »** (+ `CreditCostBadge actionId="filter_generation"`) → **« Génération… »**. Exemples : « Head of Sales SaaS B2B, Paris, a scalé une équipe commerciale », « Ingénieur DevOps AWS + Terraform, 5 ans+, ouvert au remote ».
Toasts : « N filtre(s) généré(s) », « Décris le candidat idéal pour générer les filtres. », « Connectez votre compte LinkedIn pour lancer une recherche. », « Crédits IA insuffisants », « Service IA temporairement surchargé, réessayez dans 30 secondes », « Trop de requêtes, réessayez dans quelques secondes », « La requête a pris trop de temps. Réessayez. », « Erreur lors de la génération des filtres ».

### 9.6 `FilterFacets` — « Filtres · éditables »
`rounded-xl border border-[var(--k-hairline)] bg-[var(--k-surface-2)] p-3`. En-tête `text-[11px] uppercase tracking-[0.05em]` **« Filtres · éditables »** + lien **« Tout effacer »**.
Lignes `grid grid-cols-[72px_1fr] gap-2.5` : **Poste**, **Lieu**, **Exp.**, **Skills**, **Boîte**, **Niveau** (si séniorité).
Chip : `min-h-6 rounded-full pl-2.5 pr-1.5 py-0.5 text-[13px]`, must → `bg-[var(--k-accent-tint)]` + pastille 5px, exclure → mention `Exclure` en `font-mono text-[9px]`, `×` `opacity-0 group-hover:opacity-100`, title « Clic : obligatoire ↔ souhaité ».
`AddChip` : bouton dashed « **+ Ajouter** » → input `h-6 w-40 rounded-full`, placeholders : « Ex. Account Manager », « Ex. Île-de-France », « Ex. Grands comptes », « Ex. éditeur SaaS ».
Légende : pastille accent « Obligatoire » · cercle vide « Souhaité — clic sur une puce pour basculer ».
Toasts : « Localisation « X » introuvable sur LinkedIn », « Impossible de résoudre la localisation, réessayez. »

### 9.7 `AutoFillFiltersButton` (hors projet uniquement — `hidden` si `activeProject`)
- Bouton œil ghost `h-8 w-8 p-0` (`Eye w-3.5`), tooltip « Voir l'input envoyé à l'IA »
- **Auto-fill** — `variant=default size=sm h-8 gap-2 text-xs`, dégradé **en dur** `bg-gradient-to-r from-violet-500 to-purple-600`, `Wand2 w-3.5` + `CreditCostBadge` ; loading → « Génération... » + `Loader2`. Tooltips : « Sélectionnez un poste pour activer l'auto-remplissage » / « Connectez un compte LinkedIn » / « Remplir automatiquement les filtres depuis le poste sélectionné »
- `ModelPicker actionId="filter_generation" compact`
- Modale debug : titre « Debug Auto-Fill: {titre} », desc « Visualisez les données envoyées à l'IA et les filtres générés » ; blocs « 🔴 Champs critiques manquants (N) », « ℹ️ Champs optionnels non renseignés (N) » + « Ces champs améliorent la qualité des filtres mais ne bloquent pas l'auto-fill. » ; collapsibles « 📥 Input envoyé à l'IA » / « 📤 Filtres générés » (`bg-green-950/30`, `text-green-400` **en dur**) ; « Cliquez sur "Auto-fill" pour voir les filtres générés »
- Toasts : « Veuillez sélectionner un poste », « Complétez au minimum le titre du poste dans le brief avant de générer les filtres. », « Compte LinkedIn non connecté », « N filtres appliqués depuis le poste », + la même famille d'erreurs IA que ci-dessus.

### 9.8 Suggestions IA (chips)
Carte `rounded-[10px] border bg-[var(--k-surface)] p-2.5`, eyebrow « **Suggestions IA** » + glyphe burst.
Chips `rounded-full border text-2xs`, préfixe catégorie `text-3xs` : **Poste**, **Skill**, **Lieu**, **Certif** ; bouton `+` (title « Ajouter », `hover:bg-[var(--k-accent-tint)]`, icône `text-[var(--k-accent)]`) et `×` (title « Ignorer », `hover:bg-destructive/20`). Max 8.

### 9.9 Consignes de scoring IA
Carte `rounded-[10px] border bg-[var(--k-surface)] p-2.5` — label « **Consignes scoring IA** *(optionnel)* », `textarea rows={2}` `bg-[var(--k-surface-2)] rounded-[8px] resize-none`, placeholder **« Ex: Privilégier les profils avec exp. cloud souverain, ignorer la localisation, bonus si exp. scale-up… »**.
Auto-généré depuis `job_details.evaluation_criteria` : « Critères du manager pour le scoring : », « Pondération : X% technique, X% soft skills, X% culture fit, X% motivation, X% expérience. », puis `- {label} (CRITIQUE|important|bonus[, DEAL BREAKER]) — Excellence: "…" — Rédhibitoire: "…" ».

### 9.10 `SearchHistory`
Collapsible : trigger `w-full px-3 py-2 rounded-[10px] border bg-[var(--k-surface)]` avec `History w-4` + « **Historique** » + badge `secondary h-5` = nombre. `ScrollArea max-h-[300px]`.
Entrée : date `dd MMM yyyy · HH:mm` (locale fr), icônes `Play` (title « Réutiliser ces filtres ») et `Trash2` (title « Supprimer »), résumé (`"keywords"`, `Rôle: …`, `📍 …`, `🏢 …`, `Seniorité: …`, sinon « Aucun filtre »), stats `Users N résultats`, `MessageSquare`, `Star`, `Archive`, badge outline « N filtres ».

### 9.11 « Options avancées »
Ligne repliable : chevron rotatif, libellé « **Options avancées** », meta droite `font-mono text-[11px]` « booléen · séniorité · école · spotlights ». Ouvert par défaut hors projet.
- Bloc **Mots-clés** : label + compteur « N car. » ; bouton-preview `min-h-[34px] rounded-[8px] bg-[var(--k-surface-2)]` + crayon au hover ; vide → « Ex: Product Manager, React… »
- Dialog « **Mots-clés de recherche** » : textarea `min-h-[140px] font-mono`, placeholder `Ex: (Terraform OR IaC OR "Infrastructure as Code") AND (AWS OR Azure) NOT (junior OR stagiaire)` ; encadré aide « 💡 Astuces Boolean avancées : » (OR/AND/NOT/Guillemets/Wildcard *) + « ⚠️ Mettre les titres de poste dans le champ Rôle, pas ici. Limite ~200 caractères. » ; **Annuler** / **Appliquer**
- `LinkedInFilters` : conteneur `h-[calc(100vh-220px)] bg-background border border-border overflow-y-auto`, sections accordéon avec badge de compte + preview :
  - « Recherche de base » : Localisation (placeholder « Ville, région, pays... »), École / Formation (« Ou rechercher une école... »), Langue du profil (« Sélectionner les langues... »), Degré de connexion (« Sélectionner les degrés... »), Groupes LinkedIn (« Rechercher un groupe... »)
  - « Poste & Compétences » : Titre du poste, Rôle (mots-clés booléens), Compétences, Niveau de séniorité, Département / Fonction, Niveau d'études (« Rechercher un diplôme (ex: Master, Licence...) »)
  - « Expérience & Ancienneté » : « Expérience calculée (depuis diplôme) », « Années d'expérience (LinkedIn API) », « Ancienneté dans l'entreprise actuelle », « Ancienneté dans le poste actuel » — chaque fois Min (ans)/Max (ans), placeholders `0` / `50`
  - « Entreprise actuelle » : « Filtres intelligents » → toggle « Exclure ESN / Consulting », « Type d'entreprise », « Nom de l'entreprise », « Secteur d'activité », « Taille de l'entreprise », « Siège de l'entreprise »
  - « Expérience passée » : « Ancienne entreprise », « Ancien poste »
  - « Filtres avancés (Recruiter) » : Open to Work, Open to (type), Spotlight (placeholder « Tous les profils »), Hiring Project (ID), Activité - Messages (+ « Période... »), Activité - Notes, Tags
  - « Filtres avancés Base Konekt » : Technologies, Email vérifié, Revenue entreprise, Stade de funding, Domaine entreprise, Postes ouverts chez l'employeur, Nb postes ouverts, Exclure consulting / ESN, Catégorie entreprise, Technologies requises (toutes), Technologies à exclure, Lieux de recrutement, Exclure localisations siège, Funding récent, Funding total levé
  - Toast : « Filtres IA réinitialisés »

### 9.12 Barre d'action collante
`sticky bottom-0 z-10 bg-background pt-2 pb-1 border-t border-[var(--k-hairline)]` :
- **Rechercher** (`flex-1 bg-[var(--k-accent)] text-[var(--k-on-accent)] hover:bg-[var(--k-accent-hover)] border-0`, `Search w-4 mr-2`) → « Recherche... » (`Loader2`) → « Sélectionnez un poste » si pas de job. `disabled = loading || (!selectedAccount && source≠database) || !selectedJob || needsReconnection || !isApiModeAvailable`
- **Effacer** (outline, `disabled={loading}`)

### 9.13 Options de select (source `types.ts`)
- `API_TYPE_OPTIONS` : Recruiter / Sales Navigator / LinkedIn Classic
- `SENIORITY_LEVELS` : Débutant (0-2 ans), Associé, Intermédiaire (3-5 ans), Senior (6-9 ans), Manager, Directeur, VP, C-Level, Partner, Owner
- `NETWORK_DISTANCES` : 1er degré (Connexions), 2ème degré, 3ème degré
- `PRIORITY_OPTIONS` : Obligatoire ✓ / Souhaité ○ / Exclure ✕ — **couleurs en dur `bg-green-100 text-green-700`, `bg-blue-100`, `bg-red-100`**
- `LOCATION_RADIUS_OPTIONS` : Pas de limite, 10 miles (~16 km), 25 (~40), 35 (~56), 50 (~80), 75 (~120), 100 (~160)
- `SPOTLIGHT_OPTIONS` : Tous les profils, Open to Work, Talent actif, Candidats redécouverts, Candidats internes, Intéressé par votre entreprise, Connexions dans l'entreprise
- `PROFILE_LANGUAGES` : Français, Anglais, Espagnol, Allemand, Italien, Portugais, Néerlandais, Chinois, Japonais, Arabe
- `COMPANY_HEADCOUNT_OPTIONS` : Auto-entrepreneur (1), 2-10, 11-50, 51-200, 201-500, 501-1000, 1001-5000, 5001-10000, 10001+
- `DEGREE_OPTIONS` : Baccalauréat / High School, Licence / Bachelor's, Master / Master's, MBA, Doctorat / PhD, Autre
- Catégories IA (chip Taille) : Startup (1-200), Scale-up (51-1000), Grand groupe (1001+), Toutes tailles

---

## 10. `SearchResultsPanel`

Racine : `bg-background border border-border rounded-xl flex flex-col min-h-[420px] lg:min-h-0 lg:h-full overflow-hidden`.

### 10.1 Header (conditionnel)
`px-4 py-2 border-b border-border shrink-0` — « **N** candidat(s) affiché(s) · {total} total ». Toggle pool à droite : **« Vue : Pool »** / **« Vue : Résultats »** (`Database w-3`, `h-7 px-2.5 rounded-full`, variant `secondary`/`ghost`, title « Voir les nouveaux résultats » / « Voir les profils déjà connus »).

### 10.2 Toolbar (job + hasSearched + résultats)
`flex items-center gap-2 px-3 sm:px-4 py-2 border-b overflow-x-auto no-scrollbar`.
- Eyebrow « **Filtrer** » (`text-[10px] uppercase`, `hidden md:inline`)
- Groupe de pills `bg-muted/40 p-0.5 rounded-full border` — actif = `bg-foreground text-background font-semibold` :

| Emoji | Label | Compteur | Tooltip |
|---|---|---|---|
| 👥 | Tous | `mergedResults.length` | Tous les candidats |
| 👁 | Non traités | untreated | Candidats pas encore évalués |
| 🎯 | Scorés | scored | Candidats déjà scorés par l'IA |
| ✉️ | Contactés | messaged | Candidats déjà contactés |
| ⭐ | Shortlist | shortlisted | Candidats ajoutés à la shortlist |
| 📋 | Déjà connus | known | Candidats présents dans ton vivier |
| 📦 | Archivés | dismissed | Candidats archivés / écartés |

(labels `hidden lg:inline` — sous `lg` seuls les emojis restent)
- 🟢 **À l'écoute** (Recruiter uniquement) — actif = `bg-success text-success-foreground` ; tooltips « Relancer la recherche limitée aux profils à l'écoute (Open to Work) » / « Recherche limitée aux profils à l'écoute — cliquer pour désactiver et relancer » ; `disabled={loading}`
- Séparateur `w-px h-5 bg-border`
- **Sélectionner les top profils** / « Top » (ghost `text-emerald-500 hover:bg-emerald-500/10`, `Sparkles`) — title « Sélectionne automatiquement les profils détectés comme à haut potentiel par l'IA pré-scoring (avant LLM) » ; toasts « Aucun profil à haut potentiel non scoré » / « N profils à haut potentiel sélectionnés »
- **Scorer les 20 premiers** / « Scorer les N profils » / mobile « Scorer N » (`Target`, spinner si `scoringInProgress`) — title « Sélectionne les premiers profils non scorés et lance le scoring par lot » ; masqué si `canBatchScore === false`
- Eyebrow « **Affichage** » + toggle **Compact** (`Rows3`, title « Vue compacte (1 ligne par profil) ») / **Détaillé** (`Layers`, title « Vue détaillée (mini-CV complet) ») — `aria-pressed`, persisté `localStorage: konekt_search_view_mode` (défaut `compact`)
- **Trier par score** / « Tri ★ actif » / « ★ » (visible si scores) — actif `bg-foreground text-background`

### 10.3 Barre d'actions de sélection multiple
Apparaît si `selectedProfiles.size > 0`, dans la toolbar : `bg-foreground/[0.04] rounded-lg border px-2 py-1` :
- Badge « **N sélectionné(s)** » (`bg-foreground/10 rounded-md`)
- **Scorer** (`Target w-3.5`, spinner si en cours, title « Scorer les profils sélectionnés »)
- `ModelPicker actionId="scoring" compact` (`hidden lg:inline-flex`)
- `BulkEnrichButton` — icône `Sparkles w-3.5` seule, title « Récupérer email/téléphone des N profil(s) sélectionné(s) » ou « L'enrichissement de contact nécessite un abonnement » (free plan). AlertDialog « Récupérer les contacts de N profils », cases « Email professionnel » (« 1 contact inclus par profil, sinon 1 crédit si trouvé ») et « Téléphone mobile », lignes « Contacts inclus ce mois : », « Profils couverts par le forfait : », « Coût maximum hors forfait : », « Votre solde : ». Toasts `id='bulk-enrich'` : « 0 / N enrichissements de contact en cours… », « En attente du service, reprise dans une minute… », « N enrichissement(s) de contact lancé(s) »
- **Shortlister** (`FolderPlus`, `text-success hover:bg-success/10`, title « Shortlister pour cette mission ») — si projet actif
- `SequenceEnrollButton` → « **Séquence** », title « Inscrire dans une séquence d'outreach »
- **InMail** (`Mail`, title « Envoyer un InMail groupé »)
- **Archiver** (`Archive`, `text-destructive hover:bg-destructive/10`)
Labels `hidden md:inline` → icon-only sous `md`.

### 10.4 Sous-filtres « scorés »
`px-2 sm:px-3 py-1 border-b border-border/50 bg-muted/20` — pills carrées `h-5 px-1.5 text-xs` : **Tous**, **✅ Go**, **🤔 Maybe**, **🔍 À investiguer** (si >0). Select de tri `h-5 min-w-[120px]` : **Score ↓** / **Score ↑** / **Récents** (`ArrowUpDown`/`ArrowDown`/`ArrowUp`/`Clock`).

### 10.5 Zone de scroll résultats
`flex-1 min-h-0 overflow-x-auto overflow-y-auto` (`ref=scrollAreaRef`, position mémorisée dans le cache mission `missionSearchCache`).

**Bannière batch** (hors projet) : `border bg-accent/15 rounded-md`, `NumberTicker` du total en `text-base sm:text-lg font-black tabular-nums` + « PROFILS » + « · N affichés » + pastille verte `CheckCircle2` « traité ». Actions **Élargir** (`Maximize2`) / **Affiner** (`Minimize2`), ghost `h-6 px-2 text-[11px]`. Barre de progression `h-0.5 bg-foreground/5` avec remplissage `bg-foreground/40`.

**CTA Go** : `border-success/30 bg-success/5 rounded-md px-3 py-1.5` — « **N candidat(s) scoré(s) Go** — prêts pour une séquence d'outreach. » + `SequenceEnrollButton`.

**Hints contextuels** (dismiss localStorage `hint:after-first-search`, `hint:after-first-scoring`), `border-accent/30 bg-accent/5 rounded-md px-3 py-1` :
- 🎯 « Sélectionnez les profils intéressants puis **Score** pour les évaluer. »
- 🟢 « Profils scorés. Les **Go** sont les meilleurs matchs — messagez-les ou ajoutez au pipeline. »

**Sélection globale** (vue détaillée) : `Checkbox w-5 h-5 border-2 border-foreground/50` + label « **Tout sélectionner** ».

### 10.6 Pagination / curseur
Bloc `ref=loadMoreTriggerRef py-4`. Pas d'infinite scroll — batch manuel.
- Chargement : `border bg-accent/10 p-4 sm:p-6` + `BrutalLoader variant="search" rows={3}` avec messages custom : « Chargement du lot suivant… », « On recrute les meilleurs profils… », « Encore quelques secondes… », « LinkedIn nous répond… », « Tri des nouveaux candidats… », « Bientôt 25 nouveaux profils… », « Ça arrive, promis… »
- Lot traité : `CheckCircle2` + « **Lot actuel traité !** » (`text-green-600` **en dur**), bouton **Lot suivant** (`bg-foreground text-background`, `ChevronRight`), sous-texte « N chargés sur {total} »
- Sinon : bouton outline sm **« Charger le lot suivant (25 profils) »**
- Fin : encadré `border-dashed` — « **Fin des résultats LinkedIn** » + « N profils chargés sur M disponibles (certains filtrés côté client). » / « Tous les profils ont été parcourus (N). » + « Élargissez vos filtres ou modifiez vos mots-clés pour trouver plus de candidats. » + bouton outline **Relancer la recherche**

### 10.7 États d'écran
| État | Rendu |
|---|---|
| `loading && results.length === 0` | `BrutalLoader variant="search" rows={5}` — messages : « Recherche en cours… », « On fouille LinkedIn… », « Analyse des profils… », « Tri des résultats… », « Scoring des candidats… » |
| `!hasSearched` + mission | `SourcingReadinessPanel` |
| `!hasSearched` + recherche autonome / hors projet | `SearchWelcomeMessage` |
| `displayResults.length === 0` cas 1 | « **Lot actuel traité ✓** » + « Tu as traité les N profils chargés. Il reste **M profils** à découvrir sur LinkedIn. » + bouton **Charger le lot suivant** |
| cas 2 (filtre non vide) | « **Aucun profil dans ce filtre** » + « Tes profils sont peut-être dans une autre catégorie. Affiche tous les profils pour les retrouver. » + **Voir tous les profils** |
| cas 3 | « **Aucun profil trouvé** » + « Essayez d'ajuster vos filtres pour élargir votre recherche » + **Élargir les filtres avec l'IA** (`Maximize2`, `bg-foreground text-background`, `disabled={refineLoading}`) — icône `Search w-10` dans carré `w-20 h-20 bg-muted` (non arrondi) |

**`SourcingReadinessPanel`** : vidéo décorative `/sourcing-empty-motion.mp4` (`w-72 h-72 sm:w-96 sm:h-96 rounded-3xl`, autoplay/loop/muted/playsInline/aria-hidden), titre « Prêt à lancer la recherche » / « Configurez la recherche », sous-titre « Filtres prêts. Lancez la recherche quand vous voulez. » / « Générez les filtres depuis le brief, ou configurez-les manuellement à gauche. », pills « Brief N/M » et « N cr », boutons **Aller au brief** (`ArrowLeft`, `bg-foreground text-background h-11 rounded-xl`) et **Lancer la recherche** (`bg-accent`, `disabled` si pas prêt).

**`SearchWelcomeMessage`** : icône `Search w-8` dans carré `w-16 h-16 bg-foreground text-background` (spring), H3 « Recherche LinkedIn », sous-titre « Tes filtres sont prêts — il ne reste qu'à lancer » (standalone) ou « Trouvez des candidats qualifiés en utilisant les filtres avancés » ; 3–4 étapes numérotées : « Sélectionnez un poste », « Recherchez des profils », « Sélectionnez et scorez », « Ajoutez ou archivez » / « Shortlistez ou archivez ».

---

## 11. Carte de résultat `LinkedInResultCard` (vue « Détaillé »)

Racine : `relative bg-card border-2 transition-all cursor-pointer group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring` — **pas de border-radius**.
- Sélectionnée : `border-primary shadow-lg ring-2 ring-primary/25 bg-primary/[0.04]`
- Repos : `border-border shadow hover:shadow-md hover:border-foreground/50`
- Wrapper motion : `whileHover={{y:-2}}`, `layout="position"`, entrée `opacity/y 12/scale .97`, delay `min(index*0.05, 1.2)`
- `role="button" tabIndex={0}`, aria-label « Candidat {nom}, {headline}, score N sur 100 » ; Enter/Espace ouvrent le détail ; clic ignoré sur `button, a, input, [role=checkbox], [data-no-detail]`

**Anatomie**
1. Barre d'accent gauche `absolute left-0 w-1 bg-accent` si `match_score > 80`
2. Flash overlay 1 s à l'arrivée du score : `hsl(var(--accent))` (go) / `hsl(var(--primary))` (maybe) / `hsl(var(--destructive))` (skip)
3. Overlay scoring batch : `bg-background/70 backdrop-blur-[8px]` + shimmer sweep + 3 points `bg-primary animate-pulse` (délais 0/300/600 ms) + libellé « **Scoring…** »
4. Padding `p-2 sm:p-3`
5. Checkbox `w-5 h-5 border-2 border-foreground/50 bg-background shadow` (desktop colonne gauche `pt-3`) / `w-6 h-6` absolue en haut à droite (mobile). Si `recommendation === 'skip'` → case verrouillée `border-destructive/40 bg-destructive/5` + `X`, tooltip « Profil peu adapté (score < 40%) — sélection désactivée »
6. Avatar `w-14 h-14 border shadow-md` (desktop) / `w-8 h-8` inline (mobile), fallback initiales `bg-gradient-to-br from-primary to-primary/80` ; pastille degré `1°/2°/3°` `w-5 h-5 border-2 border-primary rounded-full`
7. Nom `font-semibold text-sm sm:text-base` (fallback « Profil LinkedIn ») + badge « 🔄 Pool » si `_fromPool` + `CardStatusBadges`
8. Headline `text-xs sm:text-sm text-muted-foreground line-clamp-2`
9. Ligne méta à puces `•` : logo entreprise (`CompanyLogo` / Clearbit) + nom + badge type d'entreprise, ancienneté, ville, `seniority_level`, `department`, `industry`, expérience totale (`text-success tabular-nums`), « N rel. » (k), `LikelyToSwitchBadge`
10. (Détaillé seulement) `ProfileExperienceList defaultLimit={2}`, `ProfileEducationList defaultLimit={1}`, skills : 6 badges `secondary text-3xs h-4` + `+N` (`bg-primary/10 text-primary`)
11. `CandidateHistoryPanel compact` (Airtable / Notion)
12. Actions mobile (`flex sm:hidden overflow-x-auto`)
13. Affordance « **Voir les détails** » (`ExternalLink w-3`, `sm:opacity-0 group-hover:opacity-100`)

### `CardStatusBadges`
| Badge | Style | Contenu |
|---|---|---|
| Séquence | `bg-{success|warning|destructive|info}/10 …/30` + `GitBranch` | « A répondu », « En pause », « Séquence terminée », « Stoppé », « Étape N » ; tooltip = nom de séquence + date |
| Contacté | `bg-info text-info-foreground` + `MessageSquare` | « Contacté » |
| Répondu | `bg-success` + `CheckCircle2` | « Répondu » |
| Shortlist | `bg-warning` + `Star` | « Shortlist » |
| Scoré (sans jobScore) | outline `text-brand-purple bg-brand-purple/10` + `Target` | « N% » |
| Archivé | outline `text-warning` + `Archive` | « Archivé » |
| **Score IA** | outline `font-bold tabular-nums` : ≥70 `success`, ≥40 `warning`, <40 `destructive` + `Target` (+`CheckCircle2` si deep) | « N » ; title « Score IA complet (profil visité) : N/100 — {reco} » ou « Score IA rapide (données de la liste) : N/100 — l'analyse complète se lance à l'ouverture de la fiche » |
| Premium | outline `text-warning` + `Star fill` | « Premium » |
| Open to Work | `bg-success` + `Zap` | « Open to Work » / « OTW » (mobile) |
| Réactif | outline `text-brand-purple` + `Sparkles` | « Réactif » (`hidden sm:flex`) |
| Notion | outline + logo webp | tooltip « Déjà dans Notion » + nom |

Tous : `h-4 sm:h-5 px-1.5 py-0`, libellés `hidden sm:inline`.

### `CardActions` (hiérarchie à 3 niveaux)
1. **SCORE** — bouton custom `h-8 px-3.5 text-xs` (compact `h-7 px-2.5 text-[11px]`), `rounded-md font-bold uppercase tracking-wider text-white`, **dégradé et ombres 100 % en dur** : `linear-gradient(110deg,#4f46e5,#7c3aed,#c026d3)`, `box-shadow 0 4px 14px rgba(124,58,237,.4)`, hover JS `translateY(-1px) scale(1.02)` + shadow `.6`. Loading → shimmer permanent + `Loader2` + « **Analyse…** », `cursor-wait`, `aria-busy`. Title « Scorer pour {job} » / « Analyse IA en cours… »
2. `SequenceEnrollButton` → « Séquence » (si scoré et reco ≠ skip)
3. **Message** (`outline sm h-8`, `bg-muted border-foreground/30 shadow-sm`, `PenLine`, title « Composer un message d'approche »)
4. `AddToProjectButton compact`
5. `EnrichContactButton compact`
6. Overflow `⋯` (`MoreHorizontal`, `h-8 w-8 ghost` + `bg-muted border border-foreground/30`, aria-label « Plus d'actions pour {nom} ») → menu `w-56` : « Ouvrir le profil LinkedIn » (+`ExternalLink`), « Composer un message » (compact), « Envoyer un InMail », séparateur, « **Archiver** » (`text-destructive`)

---

## 12. `CompactResultsTable` (vue « Compact », défaut)

`border border-border bg-background overflow-hidden` (pas arrondi).

**Toolbar** `px-3 py-2 border-b bg-muted/30` : « **N** profil(s) · **X**/**Y** colonnes · **Z** critère(s) du poste » + bouton outline sm **Colonnes** (`Columns3`).
Menu colonnes `w-72 max-h-[70vh]` : label « Colonnes affichées » + « X/Y », sections (`SECTION_LABELS`), `DropdownMenuCheckboxItem` par colonne, puis « **Réinitialiser** » (`Eye`) et « **Tout afficher** » (`EyeOff`).

**Table** `w-full text-xs border-collapse` ; `thead` `sticky top-0 z-20 bg-muted/40 backdrop-blur-sm` ; colonnes `avatar` (sticky left 32) et `name` (sticky left 72) `z-30` ; en-têtes `text-[10px] font-bold uppercase tracking-wider` triables (`ArrowUpDown` opacity-30 → `ArrowDown`/`ArrowUp`) ; séparateur `border-l-2 border-info/30` au début du bloc « critères ».

**Colonnes** (défaut visible = ✔)
- *Profil* : Avatar ✔, Nom ✔, Headline ✔, Score IA ✔, Reco ✔, Lieu ✔, Secteur, Pronom, Langue
- *Signaux* : Open to Work, Premium, Recrute, Influenceur, Créateur, InMail, Open profile, Vérifié, « Recemt embauché » *(typo)* — rendus par `FlagIcon` avec tooltips « Ouvert aux opportunités », « Compte Premium », « En recrutement », « Influenceur LinkedIn », « Créateur de contenu », « InMail accepté », « Profil ouvert (InMail gratuit) », « Profil vérifié », « Récemment embauché »
- *Contact* : Email (`mailto:` `text-info`), Téléphone (`tel:`), LinkedIn URL (« Voir » + `ExternalLink`)
- *Réseau* : Connexions, Followers, Conn. partagées, Distance
- *Expérience* : Années XP ✔, Nb postes, XP 1..5 (1–2 ✔)
- *Formation* : Formation 1 ✔ .. 3
- *Compétences* : Top skills, Nb skills, Langues parlées
- *Statut* : Statut ✔
- *Critères* : dynamiques, dérivés du brief ; tooltip « Source : Compétences du poste / Must-have / Should-have / Nice-to-have / Évaluation IA »
- *Actions* ✔ : menu `⋯` avec « Archiver »

Score : pavé `min-w-[36px] font-bold font-mono tabular-nums` ≥70 success / ≥40 warning / <40 destructive (carré, non arrondi).
Reco : `GO` / `MAYBE` / `SKIP` en `text-[10px] font-bold uppercase tracking-wider` mêmes 3 couleurs.
Valeur absente = `—` en `text-muted-foreground/30`.
Ligne : `hover:bg-muted/40`, sélectionnée `bg-accent/40`.

**Footer** : « Aucun critère défini sur ce poste — ajoutez compétences ou must/should/nice-to-have dans le brief pour voir les colonnes critères. » (`HelpCircle`) ; ou « Lancez le scoring pour évaluer les profils sur les critères du poste. » (`bg-info/10 text-info`, `Sparkles`).

---

## 13. Fiche détail `ProfileDetailSheet`

`SheetContent side="right"` — `!w-full !max-w-[100vw] sm:!w-[95vw] sm:!max-w-[820px] p-0 flex flex-col overflow-hidden rounded-xl border-l border-border bg-muted`. Swipe tactile mobile.

1. **Nav bar** `px-3 sm:px-5 py-2 bg-background border-b` : **Préc.** (`ChevronLeft`) / « N / M » `tabular-nums` / **Suiv.** (`ChevronRight`), ghost `h-7`
2. **Hint swipe** (mobile) : `bg-primary/10 text-primary` — « Swipez pour naviguer »
3. **Header** `SheetHeader px-3 sm:px-5 pt-4 pb-3 bg-background border-b shrink-0` :
   - Avatar `w-12 h-12 sm:w-14 sm:h-14 rounded-xl border shadow-sm`
   - Titre `text-base sm:text-lg font-bold truncate` + lien logo LinkedIn `w-6 h-6 rounded-md`
   - Headline `line-clamp-2`
   - Méta : entreprise (+ logo + ancienneté), `MapPin` lieu, `TrendingUp` expérience totale
   - `CardStatusBadges` + badge score cliquable (pipeline) `rounded-full` ≥70 success / ≥50 warning / <50 destructive, title « Score IA : N/100 — clic pour voir l'évaluation »
   - (pipeline) « Étape » + `select h-7 rounded-full`, tags cliquables `bg-accent/20` (« Cliquer pour supprimer ce tag »), bouton « 🔗 Portail »
   - Contacts : badges email/téléphone copiables → toasts « Email copié » / « Téléphone copié »
   - **Barre d'actions** `border-t overflow-x-auto no-scrollbar` : **Score** / **Relancer le score** (`bg-primary h-7`), `SequenceEnrollButton`, **Message** (outline `PenLine`), `AddToProjectButton`, `EnrichContactButton mode="button-only"`, **Archiver** (`ml-auto`, ghost `hover:text-destructive`)
4. **Contenu** `flex-1 overflow-y-auto` > `p-2.5 sm:p-5 space-y-3 sm:space-y-4`
   - **Scoring** (details open) : titre « Scoring » + badge de profondeur — « **Éval. complète** » (`bg-emerald-500/10 text-emerald-700 dark:text-emerald-400` **en dur**, title « Évalué sur le profil complet (parcours détaillé, À propos…) ») ou « **Éval. rapide** » (`bg-foreground/5`, title « Évalué sur les données de la liste de recherche ») + bouton **« Analyse complète »** (`border-primary/40 text-primary`, title « Ré-évaluer sur le profil complet (parcours détaillé, À propos…) — peut consommer 1 visite de profil LinkedIn », `disabled` pendant enrichissement) ; pendant : `Loader2` + « **Analyse complète en cours…** ». Corps = `JobScoreDisplay compact={false}`
   - `CandidateHistoryPanel`, `AircallHistoryPanel`
   - **À propos** (details replié) : `whitespace-pre-line`
   - Chargement enrichissement : « **Chargement du profil complet…** » (`Loader2`)
   - `CardExpandedContent` → onglets Expériences / Formation / Compétences / Messages / Posts (+ extraTabs pipeline)
5. `OutreachMessageModal` en sortie de « Message »

---

## 14. Scoring IA

### `JobScoreDisplay` — libellés
- Recommandations : **À contacter** (go, `bg-accent/20 border-accent`), **À évaluer** (maybe, `bg-muted`), **Peu adapté** (skip, `bg-muted text-muted-foreground`), **Inconnu**
- Expérience : « XP compatible » / « Trop junior » / « Trop senior » / « XP à vérifier » / « À vérifier »
- Chips compat : « Expérience », « Localisation » (« Compatible » / « À vérifier »), « Rémunération » (« Compatible », « Budget poste sous le marché », « Budget poste confortable », « Non vérifiée »), « Confiance », « Engagement », « Mobilité », « Progression »
- Salaire : « Surqualifié » (« Le salaire proposé semble bas pour ce niveau d'expérience »), « Sous-qualifié », « Salaire OK »
- Score dégradé : « **Éliminé par filtre** », « L'évaluation IA n'a pas abouti pour ce profil. », « Données insuffisantes » / « Score partiel »
- Investigation : « **Profil prometteur mais signal faible** » + « À confirmer en call court (10-15 min). »
- ICP : « Conforme à l'ICP » / « Partiellement conforme » / « Non conforme » (`text-emerald-700 dark:text-emerald-400`, `text-amber-700 dark:text-amber-400`, `text-destructive` — **couleurs Tailwind en dur**), sections « **Match** · … » / « **Manque** · … »
- Bandeau « Match pour **{jobTitle}** », lien « Réduire » / « + N autres »

### `BatchScoringReport` (Dialog)
- Barre d'accent `h-1 konekt-skalr-bg` animée, badge `h-10 w-10 rounded-xl konekt-skalr-bg konekt-shine` + `Sparkles`
- H2 « **Scoring terminé** » + « N profil(s) analysé(s) · ⏱ {durée} »
- 3 `StatCard` : « Scorés IA » (`Brain`), « Score moyen » N/100 (`BarChart3`), « Taux Go » N% (`TrendingUp`, `highlight` si >30 %)
- Ligne escalade : « **N** profil(s) ré-évalué(s) par une IA plus précise » (`Zap text-amber-400`), title « Profils borderline ré-évalués par une IA plus puissante pour plus de précision »
- Barre de ratio Go `h-1.5 rounded-full`, gradient `hsl(var(--status-success)) → hsl(142 71% 55%)` (**valeur en dur**)
- Pills de filtre : **Tous**, **Go**, **Peut-être**, **Skip** (variants success/info/muted)
- Liste `ScrollArea max-h-[340px]` ; vide → « Aucun profil dans cette catégorie »
- Titres de dialogue accessibles : « Rapport de scoring » / « Résultats du scoring IA des profils »

### Toasts scoring (`useLinkedInScoring`)
- « Sélectionnez un poste pour le scoring », « Sélectionnez au moins un profil »
- « **Brief incomplet** » + « Renseigne au moins les compétences must-have ou la description de la mission avant de lancer le scoring — sinon les scores ne seront pas pertinents. » (8 s)
- « Tous les profils sélectionnés sont déjà scorés »
- Progression : « Scoring lots X-Y/N... » (`id: batch-scoring-progress`, 3 s)
- « Lot X/N échoué, passage au suivant... » (warning)
- « Crédits IA épuisés : notation interrompue. » (8 s) ; « Crédits IA épuisés : N profil(s) noté(s) sur M, K à reprendre après rechargement. » (10 s)
- « N profils scorés sur M (rate limit atteint, réessayez le reste) »
- « N profils scorés : X pertinent(s), Y écarté(s) » / « N profils scorés »
- « Profil écarté (score: N%) », « Scoring annulé : vous avez changé de projet. », « Erreur lors du scoring », « Erreur lors du scoring par lot »

---

## 15. Erreurs / quotas / compte déconnecté (`useLinkedInSearchActions`)

| Situation | Message |
|---|---|
| Pas de compte | « Sélectionnez un compte LinkedIn » |
| Pas de poste | « Sélectionnez un poste pour lancer la recherche » |
| Titre manquant | « Renseigne l'intitulé du poste en haut de la page. » (autonome) / « Complétez au minimum le titre du poste dans le brief. » |
| Brief pauvre | « Recherche peu ciblée — décris ta cible via le Prompt IA pour de meilleurs résultats. » / « Brief peu détaillé — les résultats seront génériques. Complétez le brief pour de meilleurs résultats. » (8 s, info) |
| **Quota atteint** | « Quota de recherche journalier atteint. Réessayez demain. » |
| Quota proche | « Attention: vous approchez de la limite quotidienne de résultats de recherche » (warning) |
| Aucun nouveau | « Aucun nouveau profil trouvé. Essayez d'élargir vos filtres ou de modifier vos mots-clés. » (`id: no-new-results`, 5 s) |
| Peu de nouveaux | « Seulement N nouveau(x) profil(s) trouvé(s). Fin des résultats LinkedIn / de la Base Konekt pour ces filtres. » (`id: few-new-results`) |
| Base Konekt off | « La Base Konekt n'est pas activée pour votre espace. Un administrateur peut l'activer depuis le panneau de recherche ou les paramètres. » (8 s) |
| Décompte indispo | « Le décompte de vos recherches incluses est momentanément indisponible. Réessayez dans un instant. » |
| **Conflit de session** | « Conflit de session LinkedIn : votre compte est utilisé ailleurs. Si ça se répète, reconnectez-le avec la méthode cookie (Paramètres > Mon compte)… » / variante mission « Attendez 2-3 minutes… » |
| **Compte indisponible** | « Compte LinkedIn indisponible — {détail} » (15 s, action **Reconnecter** → `/settings?tab=account`). Détails : « Reconnectez votre compte dans Paramètres > Mon compte. », « LinkedIn demande une vérification captcha. Allez sur linkedin.com pour la valider, puis revenez. », « **Trop de requêtes LinkedIn. Patientez 5-10 min avant de relancer.** » (rate limit), « Session LinkedIn expirée. Reconnectez votre compte avec un nouveau cookie li_at. », « Compte LinkedIn introuvable. Reconnectez ou recréez le mapping. » |
| Filtres trop lourds | « LinkedIn n'a pas pu traiter cette recherche — la combinaison de filtres est probablement trop lourde. Retire un critère ou raccourcis les mots-clés, puis relance. » (12 s) |
| Réponse invalide | « Le service LinkedIn a renvoyé une réponse invalide. Réessaie dans quelques instants. » |
| Générique | « Erreur lors de la recherche » |
| Filtres projet chargés | « Filtres du projet "{nom}" chargés » (info) |

**`LinkedInReconnectBanner`** : `mx-2 sm:mx-0 mb-2 px-3 py-2 border border-amber-500/40 bg-amber-500/10 rounded-md text-xs` (**palette Tailwind ambre en dur**) — « **{compte} — session LinkedIn instable.** Plusieurs conflits de session détectés : reconnectez-vous à LinkedIn dans votre navigateur puis ré-importez des cookies frais (li_at + li_a) dans Konekt. » + bouton outline **Reconnecter** + `×` (aria-label « Masquer cette alerte »). Fenêtre d'activité : 1 h ; dismiss persisté `localStorage: li-reconnect-dismissed:{accountId}`.

**`QuotaDisplay`** (compact dans le panneau) : pastille `px-2 py-1 border` — « Quota : N % » ou « En pause » ; seuils warning ≥70 %, critique ≥90 %. Tooltip `w-64 p-3` : « Plafonds LinkedIn du jour » + badge « **Mode protégé** » (`bg-success/10 text-success`, `Shield`) dont le tooltip décrit toute la politique (80 actions/jour, 100 invitations/7 j, 5–15 s entre actions, pause 16 h à 90 %, montée en charge 3 semaines, anti-doublon). 5 barres : « Actions visibles », « Visites de profils », « Recherches », « InMails », « Invitations (7 jours) » — progress `[&>div]:bg-linkedin` puis warning ≥80 %, destructive ≥95 %. Pied : « Pause en cours jusqu'à HH:MM », « {rampStageLabel}. Compteurs du jour remis à zéro à HH:MM. »

## 16. `RefineSearchModal`

`sm:max-w-[600px] max-h-[85vh] flex flex-col`. Titre « **Élargir la recherche** » (`Maximize2`) / « **Affiner la recherche** » (`Minimize2`) ; description « L'IA propose des ajustements pour vos filtres. Choisissez ceux que vous souhaitez appliquer. »
- Loading : `Loader2 w-8` + « Analyse de vos filtres en cours... »
- Vide : « Aucune suggestion disponible. »
- Résumé `rounded-xl border bg-muted/30 p-3` + `Sparkles`, badge d'impact : « ↑↑ Beaucoup plus de résultats », « ↑ Plus de résultats », « ≈ Résultats similaires », « ↓ Moins de résultats », « ↓↓ Beaucoup moins »
- Actions rapides : **Tout accepter** (`Check`) / **Tout refuser** (`X`)
- Carte d'ajustement `rounded-xl border p-3` teintée par la décision : badge de champ (Mots-clés Boolean, Rayon géographique, Titre / Rôle, Expérience min/max (calculée), Expérience (LinkedIn), Niveau d'études, Compétences, Entreprise, Secteur, Séniorité, École, Localisation), raison, aperçu `code` avec `ArrowRight`, 3 boutons **Oui** / **Avec prudence** / **Non** (`ring-1 ring-offset-1` si choisi)
- Pied : **Annuler** / **Appliquer (N)** (`disabled` si 0)

## 17. `FilterWizard`
Modale « **Assistant de filtres** », état « Génération des filtres... », `WizardProgress` + `WizardQuestionStep`. Déclenché par `search.showFilterWizard`.

---

## 18. Tokens `--k-*` — usage réel

Définis dans `/home/user/remix-of-event-template/src/index.css` (l. 92-114 dark, 175-194 light) :
`--k-bg`, `--k-surface`, `--k-surface-2`, `--k-surface-3`, `--k-hairline`, `--k-hairline-hover`, `--k-hairline-focus`, `--k-text`, `--k-text-2`, `--k-text-muted`, `--k-text-placeholder`, `--k-accent`, `--k-accent-hover`, `--k-accent-press`, `--k-accent-ring`, `--k-accent-tint`, `--k-on-accent`, `--k-success`, `--k-warn`.

| Composant | Tokens `--k-*` | Tokens shadcn |
|---|---|---|
| `SourcingFlow` (hero/plan/chips) | **exclusivement** `--k-*` | aucun |
| `SmartOverlays` | **exclusivement** `--k-*` | aucun |
| `SearchPromptBar` | **exclusivement** `--k-*` | aucun |
| `FilterFacets` | **exclusivement** `--k-*` | aucun |
| `SearchFiltersPanel` | conteneurs, onglets source, bouton Rechercher | `Alert destructive`, `Select`, `Button`, `text-muted-foreground`, `bg-muted` — **mélange dans le même fichier** |
| `SearchHistory` | conteneurs `--k-surface` / `--k-hairline` | textes `text-muted-foreground`, `Badge secondary` |
| `SearchResultsPanel` | **aucun** | 100 % shadcn (`border-border`, `bg-card`, `text-muted-foreground`, `bg-foreground/…`) |
| `CompactResultsTable`, `LinkedInResultCard`, `CardActions`, `CardStatusBadges`, `ProfileDetailSheet`, `JobScoreDisplay`, `BatchScoringReport`, `AppliedFiltersBar`, `RefineSearchModal`, `QuotaDisplay`, pages `/sourcing` | **aucun** | 100 % shadcn |

Accent : `--k-accent` = indigo `hsl(250 46% 58%)` (light) / `hsl(250 42% 70%)` (dark) — sans rapport avec `--accent` shadcn ni avec le violet en dur des boutons SCORE / Auto-fill.

---

## ANOMALIES DESIGN

### A. Double (voire triple) système de tokens
1. **Frontière arbitraire** : tout ce qui a été refondu « V3 » (hero, plan, chip bar, overlays, prompt bar, facettes) est en `--k-*` ; tout ce qui est en aval (résultats, cartes, fiche, scoring, table, pages) est en shadcn. Les deux se touchent dans le même écran, à 2 px l'un de l'autre (`FilterChipBar` juste au-dessus de `SearchResultsPanel`).
2. **Mélange intra-fichier** : `SearchFiltersPanel.tsx` utilise `border-[var(--k-hairline)] bg-[var(--k-surface)]` pour ses cartes ET `Alert variant="destructive"`, `text-muted-foreground`, `bg-muted/50`, `border-border` pour ses alertes et son dialog mots-clés. Idem `SearchHistory.tsx`.
3. **Trois accents concurrents** : `--k-accent` (indigo), `--accent`/`--primary` shadcn (utilisés par le flash de carte, les hints, le CTA Go), et le violet en dur `#4f46e5→#c026d3` du bouton SCORE / `from-violet-500 to-purple-600` de l'Auto-fill.
4. **`--k-bad` n'existe pas** : `SourcingFlow.tsx` l. 724, 873, 889 utilise `text-[var(--k-bad,#e06666)]` — le token n'est défini nulle part dans `index.css`, donc **le rouge d'exclusion est toujours le fallback `#e06666` en dur**, en light comme en dark.
5. `--k-accent-press` et `--k-accent-ring` sont définis mais **jamais utilisés** dans la zone recherche.
6. `--k-success` défini mais jamais utilisé ; les états positifs passent par `bg-success` shadcn, `text-emerald-*` ou `text-green-600`.

### B. Valeurs en dur (hors token, hors thème)
- `CardActions.tsx` l. 94-107 : `linear-gradient(110deg,#4f46e5 0%,#7c3aed 50%,#c026d3 100%)`, `rgba(124,58,237,.4/.55/.6)`, hover en JS inline (`e.currentTarget.style.transform`) — non thémable, non dark-aware.
- `AutoFillFiltersButton.tsx` : `from-violet-500 to-purple-600`, panneau debug `bg-green-950/30`, `text-green-400`, `border-green-900` — illisible en thème clair.
- `LinkedInReconnectBanner.tsx` : toute la palette ambre en `amber-500/40`, `amber-700 dark:amber-400`, `amber-900 dark:amber-200`.
- `LinkedInSearch.tsx` bandeau pedigree : `text-amber-700 dark:text-amber-400`.
- `SearchResultsPanel.tsx` : `text-emerald-500` (deux occurrences), `text-green-600` pour « Lot actuel traité ! », `bg-emerald-500/10` ailleurs — trois façons différentes de dire « vert » dans le même fichier, en plus de `text-success`.
- `ProfileDetailSheet.tsx` : `bg-emerald-500/10 text-emerald-700 dark:text-emerald-400` pour « Éval. complète ».
- `JobScoreDisplay.tsx` : `text-emerald-700/amber-700 dark:*` pour les verdicts ICP.
- `BatchScoringReport.tsx` : `linear-gradient(90deg, hsl(var(--status-success)), hsl(142 71% 55%))` — moitié token, moitié HSL brut ; `text-amber-400`.
- `types.ts` `PRIORITY_OPTIONS` : `bg-green-100 text-green-700`, `bg-blue-100 text-blue-700`, `bg-red-100 text-red-700` — palette clair-seulement, cassée en dark.
- `SearchFiltersPanel` : `shadow-[0_1px_3px_rgba(0,0,0,0.25)]` sur les onglets de source ; `SearchPromptBar`/`SearchHero` : `shadow-[0_1px_3px_rgba(0,0,0,0.20/0.2)]` — trois ombres arbitraires légèrement différentes pour le même effet.
- `LinkedInFilters.tsx` : hauteur en dur `h-[calc(100vh-220px)]` imbriquée dans une modale déjà `max-h-[85vh]` → double scroll.
- `LinkedInSearch.tsx` : racine `lg:h-[calc(100dvh-5rem)]` (5rem magique = hauteur du header supposée).
- Largeurs magiques : `max-w-[640px]` (hero), `max-w-[720px]` (plan), `max-w-[820px]` (sheet), `max-w-2xl` (PromptSearchHero), `sm:max-w-3xl` (modale filtres), `sm:max-w-[600px]` (refine), `max-w-[1600px]` (pages) — aucune échelle commune.
- Sticky offsets calculés à la main dans `CompactResultsTable` : `left: 32px` / `72px` codés en dur, désynchronisés si la largeur d'avatar change.

### C. Incohérences avec le reste de l'app
- **Rayons** : `/sourcing` utilise `rounded-xl` ; `--k-*` utilise `rounded-[10px]`, `rounded-[7px]`, `rounded-[8px]`, `rounded-lg`, `rounded-[6px]` ; `LinkedInResultCard` et `CompactResultsTable` n'ont **aucun** rayon (héritage brutaliste) ; `QuotaDisplay` et l'empty state « Aucun profil trouvé » aussi (carré `w-20 h-20 bg-muted`).
- **Bordures** : `border-2` sur la carte de résultat vs `border` partout ailleurs.
- **Typographie** : `font-display` sur les pages `/sourcing` et `BatchScoringReport`, absent de toute la zone V3 qui utilise `font-semibold`/`text-[15px]`/`text-[13.5px]`. Échelle de tailles ad hoc : `text-3xs`, `text-2xs`, `text-[9px]`, `text-[10px]`, `text-[10.5px]`, `text-[11px]`, `text-[11.5px]`, `text-[13px]`, `text-[13.5px]`, `text-[15px]`, `text-[17px]` — 11 tailles non tokenisées.
- **Emojis comme iconographie** : pills de statut (👥 👁 🎯 ✉️ ⭐ 📋 📦 🟢), sous-filtres (✅ 🤔 🔍), hints (🎯 🟢), « 🔄 Pool », « 🔗 Portail », « 💡 Astuces », « ⚠️ », « 🔴 / 🟡 / 🟢 » (auto-fill, brief) — cohabitent avec 3 familles d'icônes : lucide-react, SVG géométriques 1.5px maison (`SourcingFlow`, `FilterFacets`), et logos bitmap (`notion-logo.webp`, `linkedinLogo`).
- **Boutons** : `Button` shadcn dans les résultats, `<button>` nu partout dans le V3, plus le bouton SCORE 100 % custom → trois grammaires de hover/focus/disabled. Aucun `focus-visible` sur les `<button>` nus du V3.
- **Modale filtres** : `SearchFiltersPanel` a une barre d'action `sticky bottom-0` avec **Rechercher/Effacer** en doublon fonctionnel avec le bouton **Relancer la recherche** de `FilterChipBar` et le **Rechercher** de `AppliedFiltersBar` → trois déclencheurs de recherche, trois styles.
- **Pattern de vide** : trois traitements différents (`BrutalLoader`, vidéo `.mp4` du `SourcingReadinessPanel`, carré brutaliste du `SearchWelcomeMessage`).

### D. Densité / spacing spécifiques à la recherche
- Espacements verticaux propres : `space-y-2 sm:space-y-2.5` (panneau filtres) vs `space-y-3/4` ailleurs dans l'app ; `gap-1.5` dominant dans le V3 vs `gap-2/3` ailleurs.
- Contrôles à 6 hauteurs différentes : `h-5` (sous-filtres scorés), `h-6` (pills de statut, chips facettes, toggles vue), `h-7` (popovers, actions de sélection, fiche détail), `h-8` (compte, actions carte), `h-9` (barre de titre `/sourcing/:id`), `h-11` (readiness panel).
- Cellules de table `px-2 py-1.5` + `text-xs` : densité type tableur, très inférieure au reste de l'app.
- Toolbar résultats : `overflow-x-auto no-scrollbar` avec ~8 groupes de contrôles ; sous `lg` les labels disparaissent et il ne reste que des emojis sans texte → cible tactile de 24 px sans libellé.
- Empilement vertical avant les résultats en mission : chip bar + overlays + bannière reconnect + bandeau pedigree + header + toolbar + sous-filtres + bannière batch + CTA Go + 2 hints = jusqu'à **10 bandes** avant la première ligne de profil.

### E. Noms de fournisseurs (charte)
- **Aucune fuite dans du texte visible utilisateur** dans le périmètre audité : `Unipile`, `Apollo`, `Coresignal`, `Better Contact`, `Clearbit`, `PDL` n'apparaissent qu'en commentaires de code, noms de fonctions (`invokeUnipile`, `mergeUnipileFullProfile`) et `console.log`.
- Points de vigilance :
  - `SearchResultsPanel.tsx` l. 320/323 : `console.log('[SearchResults] Enriched Base Konekt profile via Unipile')` — visible en console navigateur, pas dans l'UI.
  - `BulkEnrichButton.tsx` l. 279-281 : formulation correcte et conforme (« Konekt va rechercher les contacts via plusieurs sources. Les sources gratuites (LinkedIn, contacts déjà connus, pipeline) sont tentées en premier. ») — modèle à généraliser.
  - `BaseKonektDialog` : « Le sous-traitant qui les fournit figure sur la page confidentialité » — conforme (renvoi, pas de nom).
  - `logo.clearbit.com` est appelé en dur dans `LinkedInResultCard.tsx` l. 121 : pas un texte, mais une dépendance tierce visible en devtools/CSP.
- En revanche « **LinkedIn** » est omniprésent dans les textes (« On fouille LinkedIn… », « Fin des résultats LinkedIn », « Le service LinkedIn a renvoyé une réponse invalide ») — à trancher si la charte vise aussi les plateformes sources et pas seulement les fournisseurs d'API.

### F. Bugs / dettes visibles
- Typo de libellé de colonne : « **Recemt embauché** » (`CompactResultsTable.tsx` l. 695) — devrait être « Récemment embauché ».
- Mélange tutoiement / vouvoiement dans la même zone : « Tu as traité les N profils chargés » / « Essayez d'ajuster vos filtres », « Vérifie les filtres » / « Choisissez ceux que vous souhaitez appliquer », « Retire un critère » / « Connectez votre compte ».
- Deux orthographes de la même action : « Score » (fiche détail), « SCORE » (carte, uppercase), « Scorer » (toolbar).
- `AppliedFiltersBar` porte un commentaire disant que le toggle de source a été retiré, mais garde les props `searchSource`/`onSearchSourceChange` et l'import `Database` inutilisés.
- `SearchFiltersPanel` reçoit une prop `quota` documentée « obsolète » et non consommée (`QuotaDisplay` lit le serveur).
- `LinkedInSearch.tsx` l. 1185-1187 : commentaire de résolution de merge laissé dans le JSX de production.
