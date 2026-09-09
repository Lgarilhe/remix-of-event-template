# 09 — CALENDRIER / TÂCHES / SURFACE IA — Inventaire exhaustif

## 1. CALENDRIER — `/home/user/remix-of-event-template/src/pages/Calendar.tsx` (924 l.)

### 1.1 Structure
- `PageLayout maxWidth="2xl"`, `SEOHead` titre `"Calendrier | Konekt"`, description `"Vue calendrier des entretiens, InMails et étapes de séquence à venir"`.
- Header `motion.header` (`initial opacity 0/y 8`, `duration .4`), `flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6`.
  - Icon-tile : `h-10 w-10 rounded-lg bg-emerald-500/15 text-foreground` + `CalendarIcon w-5 h-5`.
  - H1 `font-display font-bold text-2xl sm:text-3xl tracking-tight` → **« Calendrier »**.
  - Sous-titre = `rangeLabel` + ` · {n} événement(s)` + ` · {n} entretien(s)` + ` · ✨{n} via Calendly`.
  - `rangeLabel` : vue jour → `"Lundi 9 septembre 2026"` (1re lettre capitalisée) ; vue semaine → `"9 sept – 15 sept 2026"`.
- **3 vues** : `week` | `day` | `list`, persistées dans `localStorage['calendar-view-mode']`.

### 1.2 Boutons du header (tous `<button>` natifs, aucun `Button` shadcn)
| Élément | Label FR | Classes clés | Action |
|---|---|---|---|
| Segmented vue | **Semaine / Jour / Liste** (labels cachés `<md`) | conteneur `inline-flex bg-muted/40 p-0.5 rounded-full border border-border`, item `h-8 px-2.5 rounded-full text-2xs font-medium`, actif `bg-foreground text-background shadow-sm` | `setView` + localStorage ; `title="{label} (raccourci {1|2|3})"` |
| Refresh | **Actualiser** (`sm:inline`) | `h-8 px-3 rounded-full border border-border bg-background hover:bg-accent text-2xs`, `disabled:opacity-50` | `refetch()`, `disabled={isFetching}`, icône `RefreshCw` + `animate-spin` si fetching, aria-label `"Rafraîchir le calendrier"` |
| Précédent | icône `ChevronLeft` | `h-8 w-8 rounded-full` dans groupe `bg-muted/40 rounded-full border` | `-1 j` (vue jour) / `-7 j` ; aria `"Jour précédent"`/`"Semaine précédente"`, `title="Précédent (J)"` |
| Aujourd'hui | **Aujourd'hui** | `h-8 px-3 rounded-full text-2xs` | `startOfDay(new Date())`, `title="Aujourd'hui (T)"` |
| Suivant | `ChevronRight` | idem | `+1 j` / `+7 j`, `title="Suivant (K)"` |
| Créer | **Programmer** (`sm:inline`) + `Plus` | `h-8 px-3 rounded-full bg-foreground text-background text-2xs hover:opacity-90` | `openCreate()`, `title="Programmer un entretien (N)"` |

### 1.3 Raccourcis clavier (bloqués si focus input/textarea/contenteditable)
`K`/`→` suivant · `J`/`←` précédent · `T` aujourd'hui · `N` nouvel entretien · `1/2/3` semaine/jour/liste. Bandeau d'aide en bas : `text-3xs text-muted-foreground/60` avec `<kbd className="font-mono px-1 py-0.5 rounded border border-border bg-muted/40">` — libellés : `Raccourcis :` `J précédent` `K suivant` `T aujourd'hui` `N nouvel entretien` `1/2/3 semaine/jour/liste`.

### 1.4 Vue Semaine
- Wrapper `rounded-xl bg-card border border-border overflow-hidden`, grille `grid-cols-1 sm:grid-cols-2 lg:grid-cols-7`.
- Colonne jour : `min-h-[260px] lg:min-h-[440px]`, borders conditionnelles (`lg:border-l`, `sm:border-l`, `max-sm:border-t`), week-end → `bg-muted/10`.
- En-tête de colonne : `px-3 py-2.5 border-b`, aujourd'hui → `bg-emerald-500/15`, jour surchargé → `bg-warning/[0.06]` ; libellé jour `text-3xs uppercase tracking-wider font-semibold` + date `font-display text-base font-bold tabular-nums`; badge compte `min-w-[20px] h-5 rounded-full text-2xs font-bold` (`bg-foreground text-background` si today sinon `bg-foreground/10`) ; `AlertTriangle w-3 h-3 text-warning` si surchargé (aria `"Journée surchargée"`).
- **Ligne « maintenant »** : uniquement pour today, entre 7h et 21h, positionnée en `%` — puce `h-1.5 w-1.5 rounded-full bg-destructive shadow-[0_0_0_3px_rgba(239,68,68,0.15)]` (RGBA en dur) + trait `h-px bg-destructive`.
- Loading : 2 skeletons `h-24 rounded-xl bg-muted/40 animate-pulse`.
- Vide (jour) : bouton pleine hauteur `opacity-20 hover:opacity-60` avec `Plus`, `title="Programmer un entretien ce jour"` → ouvre la modale à 10h00.

### 1.5 Vue Jour — `components/calendar/CalendarDayView.tsx`
- Timeline `HOUR_HEIGHT = 56px`, `START_HOUR = 7`, `END_HOUR = 21` (14 h visibles), conteneur `max-h-[640px] overflow-y-auto`.
- Auto-scroll au montage vers l'heure courante (ou 9h) `- 40px`.
- En-tête : jour `text-[10px] uppercase tracking-wider` + date `font-display text-xl font-bold` (`d MMMM yyyy`), badge compte `min-w-[24px] h-6 rounded-full`. Today → `bg-emerald-500/15`.
- Chaque tranche horaire est un `<button>` `h-[56px] hover:bg-muted/20` avec label `07:00` (`text-[10px] tabular-nums w-10`), aria `"Programmer un événement à {h}h"` → `onSlotClick`.
- Indicateur d'heure : puce `h-2 w-2 bg-destructive shadow-[0_0_0_4px_rgba(239,68,68,0.15)]` + trait + heure `text-[10px] font-bold text-destructive tabular-nums`.
- Positionnement events : `top = (minutes-420)/60*56`, `height = max(durée/60*56, 32)`, défaut 30 min. Events en `absolute left-[60px] right-3 z-20`. `compact = height < 70` (prop passée mais **non utilisée** par EventCard).
- **Pas de gestion de chevauchement en colonnes** : deux events simultanés se superposent exactement.

### 1.6 Vue Liste (agenda) — `CalendarListView.tsx`
- `rounded-xl bg-card border divide-y`. En-tête jour **sticky** `top-0 z-10 px-5 py-2.5 backdrop-blur-sm` : `bg-emerald-500/15` si today sinon `bg-muted/40` ; titre `EEEE d MMMM` capitalisé, badge `Aujourd'hui` (`text-[10px] uppercase tracking-wider font-bold`), compteur `text-[10.5px]`.
- Vide : `"Pas d'événement"` en `text-xs text-muted-foreground/60 italic`.
- ⚠ Chaque event est enveloppé dans une `<div onClick>` contenant le `<button>` d'EventCard → double déclencheur potentiel (le commentaire de DayView dit explicitement d'éviter ce pattern).

### 1.7 Anatomie d'un événement (`EventCard`, memo)
- Types & couleurs (`TYPE_STYLES`) :
  - `qualification` → **Entretien**, `Briefcase`, `bg-violet-500/[0.08] hover:bg-violet-500/[0.14]`, `border-violet-500/30`, `iconBg bg-violet-500/15`, `text-violet-600 dark:text-violet-400`
  - `inmail` → **InMail**, `Mail`, tokens `info` (`bg-info/[0.08]`, `border-info/30`, `text-info`)
  - `sequence_step` → **Séquence**, `Zap`, `cyan-500` (hors palette tokens)
  - `reminder` → **Rappel**, `Clock`, `warning` — **exclu de la légende** (`filter(t => t !== 'reminder')`)
- Card : `rounded-xl border p-2.5 transition-colors`, passé → `opacity-50`, conflit → `ring-2 ring-destructive/60 border-destructive/40`, buffer → `ring-1 ring-warning/50`.
- `title` (tooltip natif) : `⚠ Conflit d'horaire — {titre}` / `⚠ Moins de 10 min depuis l'event précédent — {titre}` / `{titre}`. `aria-label` : `"{Entretien} à {HH:mm}: {titre} (conflit)"`.
- Ligne 1 : heure `font-display text-[12px] font-bold tabular-nums` + `· {n}min` (`text-3xs`) + badge round + badge Calendly (`Sparkles w-2.5`, `title="Via Calendly"`) + tuile d'icône type `h-5 w-5 rounded-md`.
- Badge round : **Final** (`bg-warning/15 text-warning ring-1 ring-warning/30`), **1er** (`bg-foreground/[0.08]`), **2e** (`bg-info/10 text-info`), 3e+ (`bg-cyan-500/15 text-cyan-700 dark:text-cyan-400`).
- Bloc candidat (qualif) : `CandidateAvatar size=32` + `MissionCompanyLogo size=16` en overlay `-bottom-0.5 -right-0.5 ring-2 ring-card` ; nom `text-xs font-display font-semibold`, sous-ligne `text-3xs` `{client} · {poste}`.
- Non-qualif : logo société + `{client} · {poste}` puis `event.subtitle` en `text-xs font-medium`.
- Pied : initiales manager dans pastille `h-4 w-4 rounded-full bg-emerald-500/15` + prénom (`title="Animé par {nom}"`), et icône lieu `Video` si visio (URL http(s) ou littéral `"visio"`) sinon `MapPin`, `title={location}`. Séparateur `border-t border-border/40`.

### 1.8 Conflits / surcharge — `useCalendarConflicts.ts`
- Seuils : `OVERLOAD_THRESHOLD = 5` events/jour, `BUFFER_MIN_MINUTES = 10`, durée par défaut 30 min. Conflits calculés uniquement entre events du même manager (ou deux sans manager). O(n²).
- Bandeaux (au-dessus de la grille) : pill `bg-destructive/10 border-destructive/30 text-destructive` → **« {n} conflit(s) d'horaire détecté(s) »** (n = `conflictIds.size / 2`, approximatif) ; pill `bg-warning/10 border-warning/30 text-warning` → **« {mardi 10} : {n} events, journée chargée »**.

### 1.9 Barre de filtres — `CalendarFiltersBar.tsx`
- Toggle **Mes RDV** (`UserIcon`) — actif : `bg-foreground text-background border-foreground`.
- `FilterPill` (Popover, `PopoverContent w-56 p-3 rounded-xl`), badge compte `min-w-[18px] h-[18px] text-[10px] font-bold` :
  - **Type** (`Filter`) : `Entretiens` / `InMails` / `Séquences`
  - **Format** (`Video`) : `Visio` (Video) / `Présentiel` (Building2) / `Téléphone` (**icône Briefcase — incohérente**)
  - **Étape** (`CheckCircle2`) : `1er entretien` / `2e entretien` / `3e entretien` / `Final`
  - **Manager** (`UserIcon`, affiché si >1 manager) : liste `max-h-64 overflow-y-auto`
  - **Mission** (`Briefcase`, si ≥1 projet) : nom + client en `text-[10px]`
- **Vues** (presets, `Bookmark` + `ChevronDown`, `title="Filtres sauvegardés"`, `PopoverContent w-72`) :
  - Label `Sauvegarder cette vue`, input `placeholder="Ex: Mes entretiens semaine"` (`h-8 rounded-lg text-xs`, Enter = save), bouton `BookmarkPlus` `h-8 w-8 rounded-lg bg-foreground` désactivé si nom vide ou 0 filtre (`title="Active des filtres pour sauver"`), hint `Active au moins 1 filtre pour pouvoir le sauvegarder.`
  - Liste `Vues sauvegardées` : nom cliquable + `Trash2` `opacity-0 group-hover:opacity-100`, `title="Supprimer"`.
- **Effacer ({n})** : `border-destructive/40 bg-destructive/5 text-destructive`.

### 1.10 Modale de création — `CreateEventModal.tsx`
- `DialogContent sm:max-w-[520px] rounded-xl max-h-[calc(100vh-2rem)] p-0 gap-0`, header tuile `bg-emerald-500/15`.
- Titre **« Programmer un entretien »**, description **« Crée un événement dans ton calendrier — il apparaîtra immédiatement. »**
- Champs : **Étape** (Select ; options `Qualif initiale` / `1er entretien` / `2e tour client` / `3e tour` / `Final round` — **libellés différents de ceux du filtre Étape**) · **Mission** (Select, placeholder `Sélectionner une mission…`, vide → `Aucune mission active`) · **Candidat** (`CandidateAutocomplete`, hint `Cherche dans tes candidats existants ou crée-en un nouveau au passage.`) · **Manager** (`· qui anime l'entretien`, placeholder `Sélectionner un manager…`, vide → `Aucun membre dans l'équipe`, suffixes `(moi)` et `· {role}`) · **Date** (`type=date`) / **Heure** (`type=time`, défaut `10:00`) / **Durée** (`15 min`/`30 min`/`45 min`/`1 h`/`1h30`, défaut 30) · **Format** pills `Visio`/`Bureau`/`Téléphone`/`Autre` (3 des 4 utilisent l'icône `MapPin`) + input dont le placeholder varie : `Lien de visio (optionnel)` / `Adresse précise (optionnel)` / `+33 6 …` / `Lieu / lien…` · **Notes (optionnel)** textarea `placeholder="Points à creuser, contexte du RDV…"` `min-h-[60px] text-xs resize-none` rows=3.
- Footer : **Annuler** (`rounded-full border`) + **Programmer** (`rounded-full bg-foreground`, `Loader2 animate-spin` si submitting, `disabled` si pas de candidat).
- Toasts : `Pas authentifié` · `Sélectionne ou crée un candidat` · `Entretien programmé` · `Entretien programmé · {nom} ajouté au pipeline` · `Erreur lors de la création`.

### 1.11 Sheet de détail — `EventDetailSheet.tsx`
- `SheetContent w-full sm:max-w-md p-0 overflow-y-auto`; header teinté par `TYPE_TONES` (mêmes couleurs que TYPE_STYLES mais **dupliquées avec des opacités différentes** : `/10` au lieu de `/[0.08]`).
- Header : tuile type, label type `text-[10px] uppercase tracking-wider font-bold`, mention `Via Calendly`, badge round (`meta.round.label`), titre `font-display text-xl`, ligne date `Lundi 9 septembre · 10:00 – 10:30 · 30 min`.
- Sections (`Section` : icône + titre `text-[10px] uppercase tracking-wider`) : **Candidat** (card cliquable → `/pipeline?candidate=`, `ArrowRight` en hover) · **Mission** (→ `/missions/{id}`) · **Animé par** (avatar ou initiales `bg-emerald-500/15`, sous-libellé `Manager`) · **Lieu** (détection : `Visio`, `Google Meet`, `Zoom`, `Microsoft Teams`, `Lien visio`, `Lieu non précisé` ; boutons `ExternalLink` `title="Ouvrir le lien"` et `Copy` `title="Copier"`) · **Notes**.
- Footer sticky : **Tâche prép.** / **Tâche débrief** (qualifs, `CheckSquare`, `h-9 rounded-full border`) ; **Préparer l'entretien (scorecard IA)** (`h-10 rounded-full border-success/30 bg-success/10`, `Sparkles`) → `/pipeline?candidate=…&tab=evaluation&prepareInterview=1` ; **Rejoindre la réunion** (`bg-foreground`, `Video`) sinon **OK** (`border`, `CheckCircle2`).
- Toasts : `Lien copié` / `Impossible de copier`.
- Pré-remplissage `CreateTaskModal` : titres `Préparer l'entretien {nom}` / `Débrief de l'entretien {nom}`, échéance `-1 h` (prep) / `+2 h` (débrief), catégories `interview_prep` / `debrief`.

### 1.12 États du calendrier
- **Loading** : skeletons par colonne.
- **Vide global** (`rawEvents = 0`) : tuile `bg-emerald-500/15`, **« Pas d'événement cette semaine »** + « Les entretiens, InMails programmés et étapes de séquence à venir s'afficheront ici. Les RDV pris via Calendly remontent automatiquement. »
- **Vide filtré** : tuile `bg-warning/10`, **« Aucun événement ne correspond à vos filtres »** + « {n} événement(s) cette semaine, mais tous filtré(s). Essayez de relâcher un filtre. » + CTA **Effacer les filtres** (`h-9 rounded-full bg-foreground text-[12px]`).
- **Aucun état « calendrier non connecté »** : pas d'écran d'onboarding/connexion Google/Outlook — les données viennent uniquement de `qualification_sessions`, `inmail_queue`, `sequence_step_executions`. Pas d'état d'erreur non plus (`isError` non exploité).
- **Vouvoiement** dans les empty states du Calendrier vs **tutoiement** dans ceux de Tâches.

---

## 2. TÂCHES — `src/pages/Tasks.tsx` (741 l.)

### 2.1 Structure
- `PageLayout maxWidth="lg"`, SEO `"Tâches | Konekt"` / `"Vos rappels et tâches en cours"`.
- Header identique au Calendrier (tuile `bg-emerald-500/15` + `CheckSquare`), H1 **« Tâches »**, sous-titre `{n} en cours · {n} terminée(s)` ou **« Aucune tâche en cours »**.
- **Pas de colonnes / kanban** : sections empilées par bucket d'urgence.

### 2.2 Boutons du header
- Segmented : **Actives ({n})** / **Toutes** — `h-8 px-3 rounded-full text-[11.5px]` (Calendrier utilise `text-2xs` = 11px → **incohérence typo**).
- **Actualiser** (`RefreshCw`, aria `"Actualiser les tâches"`, **pas de spinner ni de disabled** contrairement au Calendrier).
- **Nouvelle tâche** (`Plus`, `bg-foreground text-background rounded-full`, label toujours visible).

### 2.3 Buckets (`BUCKET_META`) — libellés + couleurs
| clé | label | icône | couleur | hint |
|---|---|---|---|---|
| `overdue` | **En retard** | AlertCircle | `text-destructive` / `bg-destructive/10` | `À traiter en priorité` |
| `today` | **Aujourd'hui** | Clock | `text-warning` / `bg-warning/10` | `À traiter aujourd'hui` |
| `week` | **Cette semaine** | CalendarDays | `text-info` / `bg-info/10` | `Dans les 7 jours` |
| `later` | **Plus tard** | Bell | `text-foreground` / `bg-emerald-500/15` | `Au-delà de cette semaine` |
| `done` | **Terminées** | CheckCircle2 | `text-success` / `bg-success/10` | `Tâches archivées` |

### 2.4 KPI strip
5 `KPICard` (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3`), `rounded-xl border p-4`, alerte overdue → `bg-destructive/[0.04] border-destructive/20` ; tuile `h-9 w-9 rounded-lg` (grisée `bg-emerald-500/15` si count 0), label `text-[10px] uppercase tracking-wider`, valeur `font-display text-2xl font-bold tabular-nums` animée par `useCountUp(count, {duration: 700})`, hint `text-xs`. Anim `delay: index * 0.05`.

### 2.5 Suggestions automatiques (bandeau vert)
- `rounded-xl bg-emerald-500/[0.06] border-emerald-500/30`, header `bg-emerald-500/[0.04]` + tuile `bg-emerald-500/20 text-emerald-700 dark:text-emerald-400` + `Sparkles`.
- Titre **« {n} suggestion(s) de tâches automatiques »**, sous-titre **« Détectées d'après ton activité — clique pour créer ou rejeter »**.
- Item : titre, description `line-clamp-2`, motif `text-[10px] uppercase tracking-wider text-emerald-700` (ex. `Entretien terminé il y a {n}h sans débrief enregistré`, `RDV dans {n}h sans tâche de prep enregistrée`, `Stagnant depuis {n}j en "{stage}"`).
- Boutons : **Créer** (`h-8 px-3 rounded-full bg-emerald-600 text-white hover:bg-emerald-700` — **seule couleur brand en dur non tokenisée de la page**, `title="Créer cette tâche"`) et `X` (`h-8 w-8 rounded-lg`, `title="Ignorer"`). Le rejet est local (Set en mémoire, non persisté).

### 2.6 Anatomie d'une ligne de tâche (`TaskRow`, memo)
- `<motion.li>` `flex items-start gap-3 px-5 py-3.5 hover:bg-muted/30`, terminée → `opacity-60`, sortie animée `opacity 0 / height 0` en 0.2 s.
- **Checkbox** shadcn `mt-1 shrink-0`, aria `"Marquer comme terminée"` / `"Marquer comme non terminée"`, `disabled` pendant l'action — **mais aucun feedback visuel de loading sur le toggle** (l'état `loading==='toggle'` n'est jamais rendu).
- **Avatar** candidat `CandidateAvatar size=36` + `MissionCompanyLogo size=16` en overlay → ⚠ le logo société est dérivé de `reminder.job_title` (intitulé de poste), pas d'un nom de client.
- **Titre** `text-sm font-display font-semibold tracking-tight`, terminé → `line-through text-muted-foreground`.
- **Badge mission** : `text-[10px] px-2 py-0.5 rounded-full border bg-foreground/[0.04] uppercase tracking-wider font-semibold` — cliquable (→ `/missions/{job_id}`) ou statique.
- **Description** `text-xs line-clamp-2`.
- **Échéance** : `Clock w-3 h-3` + libellé `Aujourd'hui · 14:30` / `Demain · 09:00` / `12 sept à 09:00` ; couleur `text-destructive` (en retard) / `text-warning` (aujourd'hui) / `text-muted-foreground`.
- **Lien candidat** : `ExternalLink w-3 h-3` + nom → `/pipeline?candidate={id}`.
- **Action au hover** : ⚠ aucune — le bouton supprimer (`h-8 w-8 rounded-lg hover:text-destructive hover:bg-destructive/[0.06]`, `Trash2`, `Loader2 animate-spin` en cours, aria `"Supprimer la tâche"`) est **toujours visible**.
- AlertDialog : titre **« Supprimer la tâche ? »**, corps **« "{titre}" sera définitivement supprimée. Cette action est irréversible. »**, boutons **Annuler** / **Supprimer** (`bg-destructive text-destructive-foreground`).
- **PAS DE PRIORITÉ** : le modèle `Reminder` n'a ni champ priorité ni assigné. L'urgence est dérivée de `due_at` (buckets) et la seule taxonomie est `category`.

### 2.7 En-tête de section (`BucketSection`)
`rounded-xl bg-card border overflow-hidden` ; barre `px-5 py-3.5 border-b bg-muted/20` : tuile `h-8 w-8 rounded-lg`, `h2 font-display font-bold text-[14px]`, compteur `min-w-[22px] h-5 rounded-full text-[11px] bg-foreground/10 font-bold tabular-nums`. Liste `divide-y divide-border` + `AnimatePresence`. Stagger parent : `staggerChildren 0.05, delayChildren 0.1`.

### 2.8 Filtres — `TasksFiltersBar.tsx`
- **Catégorie** (`Filter`) avec emoji : `📌 Général`, `🔁 Relance`, `🎯 Prép. entretien`, `📝 Débrief`, `📂 Admin`, `🤝 Client`, `🔍 Sourcing`.
- **Mission** (`Briefcase`) : job_titles distincts.
- **Toggle 3 états** : `Source` (neutre) → **Auto seulement** (`Sparkles`) → **Manuel seulement** (`CheckCircle2`) → neutre.
- **Effacer ({n})** identique au calendrier.
- ⚠ `FilterPill` est **dupliqué à l'identique** entre `TasksFiltersBar` et `CalendarFiltersBar` (seul écart : `whitespace-nowrap` présent dans la version calendrier).

### 2.9 Modale de tâche — `CreateTaskModal.tsx`
- Titre **« Nouvelle tâche »**, description **« Crée un rappel — peut être lié à un candidat, une mission, ou standalone. »**
- Champs : **Titre \*** (`placeholder="Ex : Relancer Sophie après silence radio"`, autoFocus) · **Catégorie** (mêmes emojis mais **libellés longs différents des filtres** : `Général`, `Relance candidat`, `Préparation entretien`, `Débrief post-RDV`, `Administratif`, `Suivi client`, `Sourcing`) · **Échéance** + **Heure** (défaut = maintenant +1 h arrondi) · **Description (optionnel)** (`placeholder="Détails utiles, contexte, points à adresser…"`) · **Candidat lié · optionnel** · **Mission liée · optionnel** (placeholder `Aucune mission`, item sentinelle `__none__` → **bug potentiel : la valeur `__none__` est stockée telle quelle dans `projectId`**).
- Footer **Annuler** / **Créer**. Toasts : `Pas authentifié`, `Saisis un titre`, `Tâche créée`, `Erreur lors de la création`.
- Toasts hook : `Tâche terminée` / `Tâche réactivée` / `Erreur lors de la mise à jour`.
- **Raccourci global** `GlobalTaskShortcut` : `Cmd+T` / `Ctrl+T` (utilise `navigator.platform`, déprécié) → ouvre `CreateTaskModal`.

### 2.10 États
- Loading : 3 skeletons `h-24 rounded-xl bg-muted/40 animate-pulse`.
- Vide : tuile `bg-success/10 text-success` (ou `bg-warning/10` si filtré) — **« Zéro tâche en cours »** + « Les rappels apparaîtront ici. Crée-en une depuis cette page, le modal d'un candidat ou un événement. » + CTA **Nouvelle tâche** ; version filtrée **« Aucune tâche ne correspond à tes filtres »** + « {n} tâche(s) active(s) mais toutes filtrées. Relâche un filtre pour les voir. » + **Effacer les filtres**.
- **Pas d'état d'erreur** : `fetchAllReminders` avale l'erreur et renvoie `[]` → une panne réseau s'affiche comme « Zéro tâche en cours ».

### 2.11 Autocomplete partagé — `CandidateAutocomplete.tsx`
Input `placeholder="Tape un nom — chercher ou créer…"` + `Search` à gauche + `Loader2` à droite ; dropdown `rounded-xl border bg-popover shadow-lg` avec en-tête `Candidats existants` (`text-3xs uppercase`), option de création **« Créer "{query}" comme nouveau candidat »** + sous-titre `Ajouté au pipeline en "Pressenti" sur la mission sélectionnée` (tuile `bg-emerald-500/15 text-emerald-700`) ; chip sélectionné avec badge **Nouveau** (`bg-emerald-500/15 ring-1 ring-emerald-500/30`) et lien **Changer** (souligné). Enter = 1er résultat sinon création, Escape ferme.

---

## 3. SURFACE IA / AGENT

### 3.1 `AgentContext.tsx` — états du drawer
`isOpen`, `conversationId`, `openRequestNonce` (force re-seed), `initialJobId`, `initialMessage`, `unreadCount`, `contextMode: 'brief' | 'process' | 'sourcing' | 'outreach' | null`, `briefContext`, `autoJob`, `projectId`, `accountId`, `appContext` (page/path/missionId/missionTitle/missionTab/candidateId).
API : `openAgent(jobId?)`, `openAgentWithMessage(msg)`, `openConversation(id)`, `openContextualAgent({mode, briefContext, initialMessage, job, projectId, accountId})`, `closeAgent`, `toggleAgent`.
⚠ `closeAgent` remet tout à null **sauf `accountId`** (fuite d'état) ; `toggleAgent` idem.

### 3.2 `AgentDrawer.tsx`
- **FAB** : `fixed bottom-6 right-6 z-[1900]`, `AnimatedOrb size=52 speed=6` + halo `bg-accent/20 blur-sm`, pastille non-lu `h-2.5 w-2.5 bg-accent ring-2 ring-background animate-pulse`, anim `animate-[scale-in_0.35s_cubic-bezier(0.34,1.56,0.64,1)]`, aria `"Ouvrir l'agent IA"`. Tooltip clavier au hover : `⌘K` / `Ctrl+K` (badge **carré, sans `rounded`** — incohérent avec le reste).
- Masqué si non connecté, si le drawer est ouvert, ou sur `/auth`, `/onboarding`, `/portal*`.
- **Sheet** `side="right"`, `w-full sm:w-[420px] p-0 border-l`, hauteur pilotée par `visualViewport` (fallback `100dvh`), bouton de fermeture natif masqué (`[&>button]:hidden`). Titre a11y masqué **« Assistant IA »**, description **« Conversation contextuelle avec l'assistant recrutement. »**
- Raccourci global `Cmd/Ctrl+K` (toggle).

### 3.3 `AgentChatPanel.tsx` — chrome du panneau
- **Vue chat** (`animate-slide-in-right`) : header `px-4 py-3 border-b border-border/60 bg-background/80 backdrop-blur-sm` avec bouton `History` (`title="Historique des conversations"`), `AnimatedOrb size=24 speed=4` contenant `Bot`, titre selon le mode :
  - `sourcing` → **Sourcing Assistant** · `brief` → **Brief Assistant** · `process` → **Process Assistant** · `outreach` → **Outreach Assistant** · sinon **Copilot IA**
  - sous-titre **« Mode contextuel »** / **« Conversation libre »** (⚠ titres en anglais dans une UI FR).
  - bouton `SquarePen` `title="Nouvelle conversation"`.
- Mode dérivé automatiquement de l'onglet mission actif (`brief`/`process`/`outreach`) si aucun `contextMode` explicite.
- **Vue historique** (`animate-slide-in-left`) : `ArrowLeft` (`title="Retour au chat"`), orbe, titre **« Conversations »** / **« Historique du Copilot »**, `X` (`title="Fermer"`), carte **« Nouvelle conversation »** (`rounded-2xl border bg-card/40 px-4 py-3`, tuile `rounded-xl bg-primary/10 text-primary` + `SquarePen`).
- Seeding : orbe centrée `AnimatedOrb size=32 speed=3` pendant la réhydratation.
- Connecteurs : préférences persistées `localStorage['konekt:assistant:disabled-connectors:v2']`, scope `{userId}:{orgId}`.

### 3.4 `AgentConversationsList.tsx`
- Statuts : `Calibration` (muted) · `Plan proposé` (foreground) · `En cours` (`text-primary` + pulse) · `Terminé` (`text-emerald-600` en dur) · `En pause` · `Erreur` (destructive).
- Ligne : titre, puce de statut (ping animé si running), `{n} Go` avec `Target`, `il y a {distance}` (locale fr), `ChevronRight`. Bordure gauche `border-l-2 border-l-primary` (running) / `border-l-emerald-500/50` (completed).
- Loading : skeletons **brutalistes** carrés (`bg-muted`, pas de `rounded`) avec shimmer `animate-[shimmer_1.8s_infinite]` et delays inline.
- Vide : carré `h-10 w-10 border` + `Bot`, **« Aucune conversation »** / **« Lance une nouvelle conversation pour commencer »**.
- ⚠ Style « ancien design system » (carrés, `border-border/8`) au milieu du panneau arrondi.

### 3.5 `thread.tsx` (assistant-ui) — conversation
- **Écrans d'accueil `WELCOME`** par mode :
  - `free` — « Comment puis-je t'aider ? » / « Sourcing, messages d'approche, analyse de profils, prochaines actions. » ; suggestions : *Sourcer des candidats*, *Rédiger un message d'approche*, *Analyser mes priorités*, *Que peux-tu faire ?*
  - `sourcing` — « Calibrons ta recherche » / « Décris le poste, je structure les critères puis l'agent lance la recherche. » ; *Lancer le sourcing sur ce poste*, *Affiner les critères*
  - `brief` — « Construisons le brief » / « Je t'aide à cadrer le besoin, poste par poste. » ; *Compléter le brief*, *Questions à poser au client*
  - `process` — « Définissons le process » / « Étapes d'évaluation, critères, deal-breakers. » ; *Proposer un process d'évaluation*
  - `outreach` — « Travaillons l'approche » / « Messages, séquences de relance, ton adapté au profil. » ; *Rédiger une séquence d'approche*, *Améliorer un message*
  - Rendu : orbe 48, titre `text-xl font-display font-bold`, sous-titre `text-[13px]`, cartes `rounded-2xl border-border/70 bg-card/40 px-3.5 py-3 hover:border-primary/40 hover:bg-accent active:scale-[0.99]` + tuile `rounded-xl bg-muted group-hover:bg-primary/10`.
- **Message utilisateur** : bulle droite `max-w-[80%] rounded-3xl rounded-br-md bg-muted px-4 py-2.5 text-[14px]`.
- **Message assistant** : pleine largeur, orbe `h-7 w-7 rounded-full bg-muted/60` (`speed` 6 si running, 2 sinon), curseur de frappe `w-1.5 h-4 bg-foreground/40 animate-pulse`.
- **Indicateur de réflexion** : `ShimmerThinking` = orbe 20 + `<span class="konekt-shimmer-text text-[13px] font-medium">Réflexion en cours…</span>` ; affiché seulement si aucun texte/reasoning/tool-call.
- **ReasoningBlock** : toggle `ChevronRight` (rotate-90) + `Sparkles` + libellé **« Réflexion en cours »** (shimmer) / **« Réflexion »**, contenu en grid `grid-rows-[1fr]/[0fr]`, bordure gauche `border-l border-border/60 pl-3`.
- **Blocs système parsés** dans le texte assistant : `[OPTIONS]`, `[PROFILE]`, `[SCORING_TEST]`, `[SEARCH_PLAN]`, `[AGENT_ACTION]` (strippé) ; gestion du streaming partiel.
  - `OptionsChips` : `ThreadPrimitive.Suggestion send` ; pill si ≤28 car. et ≤4 options, sinon lignes pleine largeur avec chevron.
  - `SearchPlanCard` — **« Plan de recherche »**, badge `cible : {n} profils`, lignes `Résumé / Mots-clés / Localisation / Titres / Entreprises / Compétences / Expérience ({min}–{max} ans)`.
  - `ScoringTestCard` — **« Test de scoring »** ; recommandations : **À contacter** (success) / **À évaluer** (warning) / **Peu adapté** (muted) ; verdicts `pass` (CheckCircle2/success) / `partial` (AlertTriangle/warning) / `fail` (XCircle/destructive) ; seuils de score **75 / 50** → success/warning/destructive.
  - `SampleProfilesCards` — initiales, score (mêmes seuils **dupliqués**), `Briefcase`/`MapPin`, `{n} ans XP`, tags `bg-primary/10 text-primary`, section **« Parcours »** (flèches `→`), forces/réserves.
- **Markdown** : styles inline très longs (`[&_p]:my-2` …), tables scrollables avec `aria-label="Tableau de résultats — faire défiler horizontalement si nécessaire"`, liens internes interceptés via regex `APP_ROUTE` (inclut `calendar`, `tasks`, `agents`) → `closeAgent()` + `navigate()`.
- **Composeur** : `rounded-[1.75rem] border bg-background p-2 shadow-sm focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-primary/5`.
  - Placeholders : `sourcing` → **« Décris le profil recherché… »** ; `brief` → **« Pose une question sur le brief… »** ; sinon **« Écris un message à Konekt IA… »** (⚠ pas de placeholder dédié process/outreach).
  - Chips fichiers : `FileText` + nom tronqué `max-w-[140px]` + `X` (aria `"Retirer le fichier"`), **max 5**, accept `.pdf,.docx,.txt,.md,.csv,image/png,image/jpeg,image/webp,image/gif`.
  - Toolbar : `toolsSlot` (ConnectorMenu) sinon trombone `title="Joindre un fichier"` ; `modelSlot` (ModelPicker compact) ; envoi `ml-auto h-8 w-8 rounded-full bg-primary` + `ArrowUp` (`disabled:opacity-30`).
  - Overlay drag & drop : **« Dépose tes fichiers ici »** / **« Images, PDF, Word, texte — 5 max »**, `border-2 border-dashed border-primary/50`.
  - Disclaimer : **« Konekt IA peut faire des erreurs — vérifie les infos importantes. »** (`text-[10.5px] text-muted-foreground/50`).
  - Safe-area : `paddingBottom: max(0.75rem, env(safe-area-inset-bottom))`.

### 3.6 Appels d'outils — `tool-uis.tsx`
- `TOOL_CHIP_LABELS` : ~45 libellés FR (`Lecture des missions`, `Recherche sémantique`, `Note candidat`, `Planification d'entretien`, `Envoi d'email`, `Message LinkedIn`, `Enrichissement contact`…).
- `ToolFallbackChip` : chip `rounded-lg border-border/60 bg-muted/20 px-2.5 py-1 text-xs` avec suffixes **`en cours…`** / **`interrompu`** / **`⏳ en attente d'approbation`** (`text-amber-600 dark:text-amber-400` — couleur en dur) / **`refusé`** / **`échec`** / **`✓`** (`text-accent`).
- Chips connecteurs (Notion / Gmail / Outlook / e-mail) : encart `rounded-xl border-border/60 bg-muted/25` + logo sur `bg-white` (fond blanc forcé, même en dark), pastille `animate-pulse` si running ; libellés **Recherche dans Notion**, **Lecture dans Notion**, **Recherche dans Gmail**, **Lecture d'un échange e-mail**, sous-libellés **En cours…**, **Recherche interrompue**, **La recherche a échoué**, **Accès refusé**. Masquées une fois réussies.
- Tool UIs dédiées (emoji, style différent) : **🔍 Recherche de candidats**, **🏢 Enrichissement entreprise**, **🌐 Recherche web** avec `en cours…` / `✓ terminée`.

### 3.7 Approbation d'outil — `AgentToolApprovalCard.tsx`
- Bandeau `px-4 py-3 border-b bg-muted/30`, carte **brutaliste** : `border border-border bg-background p-3` + `boxShadow: '3px 3px 0px 0px hsl(var(--primary))'` inline — **seule ombre offset de toute la surface IA**.
- Libellés : `Action proposée` + nom technique en `font-mono`, résumé du dry-run, warning `text-warning` + `AlertTriangle`.
- `TOOL_LABEL` : 27 libellés FR (`Modifier le stade candidat`, `Écarter un candidat`, `Lancer la recherche autonome`, `Modifier les quotas d'un membre`…).
- Boutons (shadcn `Button size="sm"` `h-7 px-2.5 text-xs`) : **Rejeter** (outline, `X`/`Loader2`) · **Modifier** (outline, `Pencil`) · **Approuver** (`bg-foreground text-background`, `Check`) ; en édition : **Annuler** / **Approuver avec modifs**.
- Actions sensibles (`send_linkedin_message`, `send_email`, `dismiss_candidate`, `bulk_dismiss`, `invite_team_member`, `update_member_quota`, `update_mission_status` si archived/completed) : encart `border-warning/40 bg-warning/5` + `ShieldAlert` — **« Action sensible — une fenêtre de confirmation s'ouvrira au clic sur Approuver pour vérifier la cible ({cible}). »** ; AlertDialog **« Confirmer cette action sensible »** / « Tu vas effectuer cette action sur **{cible}**. » / boutons **Annuler** / **Oui, j'approuve**.
- Édition des params : champs typés (readonly `(lecture seule)`, boolean → Switch, number, textarea `font-mono`, JSON), titre **« Modifier les paramètres avant d'exécuter »**.
- Toasts : `Action rejetée`, `Action exécutée ✓`, `Action exécutée avec tes modifs ✓`, `Action programmée pour {date}` (durée 6000), `Sauvegarde échouée : …`, `Approbation après édition a échoué`, `Action {approve|reject} a échoué`.
- Realtime Supabase + filtre 24 h sur les propositions.

### 3.8 Tâches de fond — `AgentBackgroundTasksBar.tsx`
`border-b border-border/60 bg-muted/30 px-4 py-2` ; par tâche : `Loader2` (queued) ou `Sparkles text-primary`, libellé **« Scoring — {titre} »**, compteur `{done}/{total}` ou **`en file…`** ou `…`, `<Progress className="h-1.5" />`.

### 3.9 Connecteurs — `connector-menu.tsx`
- Trigger `Plus` `h-8 w-8 rounded-full`, pastille `bg-success ring-2 ring-background` si ≥1 actif ; aria `"Ajouter un fichier ou gérer les connecteurs — {n} actif(s)"` / `"… — aucun actif"`.
- Popover `w-72 p-2` : **Joindre un fichier** (`Paperclip`), séparateur, en-tête **Connecteurs** / **« Appliqué aux prochains messages »** + `Loader2` (aria `Chargement`).
- Ligne connecteur : logo sur `bg-white`, label, description (adresse e-mail), statut **Vérification…** / **Statut indisponible** / **Non connecté** / **Actif dans le chat** / **En pause** ; `Switch` (aria `"Utiliser {label} dans le chat"`) ou bouton **Connecter** (e-mail non connecté) ; pied **Gérer les connecteurs** (`Settings2`) → `/settings?tab=agent-actions` (ou `?tab=account` pour l'e-mail).
- `connector-logos.tsx` : SVG Gmail/Outlook/E-mail avec **hex en dur** (`#4285F4`, `#34A853`, `#EA4335`, `#FBBC04`, `#C5221F`, `#0078D4`, `#28A8EA`, `#50D9FF`, `#0364B8`, `#64748B`) — légitimes (logos de marque) mais non tokenisés.

### 3.10 Crédits IA
- `LowCreditBanner` : seuil <20 % (revient sous 10 %), `bg-warning/10 text-warning` ou `bg-destructive/10 text-destructive` si critique ; textes **« Plus de crédits IA disponibles : les fonctionnalités IA sont désactivées. »** / **« Il vous reste {n} crédits IA ({p}% du forfait du mois). »** ; CTA **« Acheter des crédits »** + `ArrowUpRight` → `/settings?tab=credits` ; `X` aria `"Fermer"` (re-affichage après 30 min si critique). ⚠ **vouvoiement** alors que le chat tutoie.
- `CreditCostBadge` : `~{n} cr`, `rounded-sm bg-muted/80 border-border/50`, tooltip « Estimation : ~{n} crédit(s) avec le modèle {nom} » + « Coût réel basé sur les tokens consommés. »
- `ModelPicker` : trigger `rounded-sm border px-2 py-1 text-xs` + `ModelLogo` + `~{n} cr` + tag `auto` ; menu `w-72`, label **Modèle**, option **✨ Automatique**, modèles `claude-haiku-4-5`, `claude-sonnet-4-5`, `claude-sonnet-4-6`, `claude-opus-4-6` avec nom + description + `~{n} cr`. `actionId` = `agent_search_calibration` (sourcing) ou `agent_chat`.
- `ModelLogo` : volontairement neutre (`Sparkles text-primary`, aria `"IA Konekt"`), `ProviderLabel` → **« IA Konekt »**.
- **Crédits épuisés (chat)** : pré-autorisation avant envoi → message assistant **« Crédits IA insuffisants ({n} restants, {n} requis). Rechargez-les depuis Paramètres, onglet Crédits IA, puis renvoyez votre message. »**, sinon `CREDITS_EXHAUSTED_TEXT`. Erreurs HTTP rendues comme texte assistant : 401 **« Ta session a expiré. Reconnecte-toi puis renvoie ton message. »** · 403 **« Cette action n'est pas autorisée pour ton compte dans cette organisation. »** · 429 **« Trop de demandes en même temps. Attends quelques secondes puis réessaie. »** · autre **« Le copilote est momentanément indisponible. Réessaie dans un instant. »** ⚠ mélange tutoiement (erreurs) / vouvoiement (crédits).

### 3.11 `AiTextarea.tsx` (surface IA « inline », hors drawer)
Bouton flottant `Sparkles` `absolute top-1.5 right-1.5 h-7 w-7` (`title="Commandes IA (/ai)"`), slash `/ai` ouvre la popover `w-72`. Commandes : `✍️ Rédige` (Génère depuis zéro), `✨ Améliore`, `✂️ Raccourcis`, `📝 Allonge`, `🇬🇧 Traduis EN`, `🔍 Corrige`, `👋 Tu`, `🎩 Vous`. En-tête `Instruction détectée` / `(commande vide)`. Loader **« Génération… »**. Barre de preview **« Preview {commande} »** avec ✕/✓. ⚠ Utilise **`brand-purple`** (`border-brand-purple`, `bg-brand-purple/5`, `text-white`) — palette locale absente de tout le reste, et **carrés sans radius**.

### 3.12 `Agents.tsx` (bref)
Page liste des conversations d'agent : `BrutalLoader`, header `uppercase tracking-tight` **« Agents IA »** / « Vos agents de sourcing autonomes », bouton **Nouvel agent** (carré, `border`, → `/missions`), sections **Agents actifs ({n})** / **Historique ({n})**, `AgentCard` (`rounded-lg`, badge de statut `STATUS_CONFIG` — **3e mapping de statuts, encore différent** de `AgentConversationsList` et de la DB), stats `{n} shortlistés` / `{n} scannés`, empty **« Aucun agent »** + « Créez un agent depuis une mission… » + **Aller aux missions** (vouvoiement).

---

## 4. ANOMALIES DESIGN

**Couleurs**
1. `emerald-500/15` utilisé comme « tuile d'accent » partout (Calendrier, Tâches, EventDetailSheet, CandidateAutocomplete, modales) — **couleur Tailwind brute non tokenisée**, tandis que le reste utilise `primary/accent/success`.
2. `violet-500` et `cyan-500` pour les types d'événements (avec variantes `dark:` manuelles) au milieu de tokens sémantiques (`info`, `warning`) → **système hybride token/Tailwind**.
3. `bg-emerald-600 hover:bg-emerald-700 text-white` (bouton « Créer » des suggestions) et `text-emerald-600` (statut « Terminé » des conversations) — valeurs en dur.
4. `text-amber-600 dark:text-amber-400` pour « en attente d'approbation » alors que `warning` existe.
5. `rgba(239,68,68,0.15)` en dur dans deux `shadow-[…]` (ligne d'heure courante) au lieu de `hsl(var(--destructive))`.
6. `bg-white` forcé sous les logos de connecteurs (illisible/incohérent en dark).
7. Palette locale **`brand-purple`** exclusive à `AiTextarea`.
8. `TYPE_STYLES` (Calendar.tsx) et `TYPE_TONES` (EventDetailSheet) : **deux tables de couleurs par type dupliquées**, avec des opacités divergentes (`/[0.08]` vs `/10`).
9. Trois mappings de statuts de conversation : `AgentConversationsList.statusMap`, `Agents.tsx STATUS_CONFIG`, `agent_conversations.status` — couleurs et icônes différentes pour les mêmes états.

**Typo / spacing / radius**
10. Échelle de taille incohérente pour le même composant : Calendrier `text-2xs` (11 px via tailwind.config) vs Tâches `text-[11.5px]` arbitraire ; ailleurs `text-[10px]`, `text-3xs`, `text-[10.5px]`, `text-[11px]`, `text-[12.5px]`, `text-[13px]`, `text-[14px]` — **au moins 9 tailles ad hoc en dur** en plus des tokens `2xs`/`3xs`.
11. Radius : `rounded-full` (pills/boutons), `rounded-xl` (cards), `rounded-lg` (inputs/tuiles), `rounded-2xl` (cartes de suggestion), `rounded-3xl rounded-br-md` (bulle user), `rounded-[1.75rem]` (composeur), `rounded-sm` (ModelPicker/CreditCostBadge), **aucun radius** (AgentConversationsList, AgentToolApprovalCard, AiTextarea, Agents.tsx, badge ⌘K).
12. Hauteurs de contrôle : `h-7` (approbation), `h-8` (filtres/header), `h-9` (CTA modales/inputs), `h-10` (CTA sheet) — sans échelle nommée.
13. Boutons : **quasiment aucun `<Button>` shadcn** dans Calendar/Tasks (tout est `<button>` + classes recopiées) ; `AgentToolApprovalCard` et `AiTextarea` sont les seuls à l'utiliser → **variant/size inexistants sur 90 % de la surface**.

**Animations custom**
14. `konekt-shimmer-text` (gradient + `konektShimmerText 2.4s linear`) coexiste avec `animate-[shimmer_1.8s_infinite]` (AgentConversationsList) et `animate-pulse` — **trois vocabulaires d'attente**.
15. Animations locales : `animate-slide-in-right` / `animate-slide-in-left` (panneau), `animate-[scale-in_0.35s_cubic-bezier(...)]` (FAB), `animate-fade-in`, `stagger-in`, plus framer-motion (`initial/animate` recopié à l'identique dans 8 endroits avec `duration: 0.4` + delays 0.05/0.1). `konekt-shine`, `konekt-glow`, `konekt-fade-up`, `konektBgPan` définis dans `index.css` mais inutilisés ici.

**Duplications structurelles**
16. `FilterPill` dupliqué (calendar/tasks), `getInitials` dupliqué (Calendar.tsx + EventDetailSheet.tsx), seuils de score 75/50 dupliqués (ScoringTestCard + SampleProfilesCards), `emailConnectorLabel`/`emailProviderLabel` dupliqués (AgentChatPanel + tool-uis).
17. `agent/` (chrome + approbation), `assistant-ui/` (thread + tools + connecteurs), `ai/` (modèle + crédits), `prompt-kit/` (upload) : **4 dossiers, 4 styles visuels** (arrondi soft / brutaliste offset-shadow / `rounded-sm` / portal). `AiTextarea` et le composeur du thread font tous deux « écrire avec l'IA » sans partager un pixel.
18. Trois surfaces d'états d'outil : `ToolFallbackChip` (chip), tool UIs emoji (`🔍/🏢/🌐`), `AgentToolApprovalCard` (bandeau) — sans langage visuel commun.

**Contenu / a11y**
19. **Tutoiement vs vouvoiement** mélangés : Tâches et chat tutoient, Calendrier (empty states), `LowCreditBanner`, crédits IA et `Agents.tsx` vouvoient.
20. Titres d'assistant en **anglais** (`Sourcing/Brief/Process/Outreach Assistant`) dans une UI FR.
21. Libellés de round incohérents entre filtre (`1er entretien`…`Final`), modale (`Qualif initiale`…`Final round`) et badge de card (`1er`/`2e`/`Final`).
22. Catégories de tâches : libellés courts (filtres) ≠ libellés longs (modale) pour les mêmes valeurs.
23. **Aucune notion de priorité ni d'assigné** sur les tâches (contrairement à l'attendu) ; **aucun état « calendrier externe non connecté »** ni état d'erreur sur les deux pages (erreurs avalées → rendues comme « vide »).
24. `CalendarListView` imbrique un `<button>` dans une `<div onClick>` (double trigger) ; `compact` calculé par `CalendarDayView` n'est jamais utilisé ; `SelectItem value="__none__"` de `CreateTaskModal` est stocké tel quel.
