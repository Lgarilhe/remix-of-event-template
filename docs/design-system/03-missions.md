# Inventaire exhaustif — ESPACE MISSIONS (Konekt)

> Périmètre : `/missions` (liste), `/missions/:id` (workspace 3 phases), `/mission-invite/:token`.
> Source : `src/pages/{Outreach,MissionWorkspace,AcceptMissionInvite}.tsx`, `src/components/missions/**`,
> `src/components/outreach/projects/ProjectsListV2.tsx`, `src/components/marketplace/PartnerMissionsSection.tsx`,
> `src/hooks/useMissionReadiness.ts`, `src/hooks/useMissionProcess.ts`, `src/lib/missionUtils.ts`.

---

## 0. Cartographie des routes

| Route | Composant page | Guards | Layout |
|---|---|---|---|
| `/missions` | `src/pages/Outreach.tsx` → `ProjectsListV2` | `ProtectedRoute` > `OrganizationGuard` > `AppLayout` | `div.w-full.max-w-full.bg-background` > `.py-6` > `.max-w-[1600px].mx-auto.px-3 sm:px-6 lg:px-8` |
| `/missions/:id` | `src/pages/MissionWorkspace.tsx` → `MissionWorkspaceV2` | idem | plein écran `h-screen` (le wrapper `max-w-[1600px]` n'est utilisé que par les états loading / not-found) |
| `/outreach` | `<Navigate to="/missions" replace>` (redirect legacy, `src/App.tsx:178`) | — | — |
| `/mission-invite/:token` | `src/pages/AcceptMissionInvite.tsx` | aucun (public) | centré `min-h-screen flex items-center justify-center p-6` |

Deep-link workspace : `?tab=<sub>` avec `sub ∈ {overview, brief, process, config, sourcing, outreach, pipeline, insights}`.
Fallback si valeur inconnue/absente → `overview`. Écriture via `setSearchParams(..., { replace: true })`.
Sous-param secondaire : `?outreach=sequences|invitations` (MissionOutreach). Deep-link liste : `?create=brief|import|manual`.

---

## 1. `/missions` — Liste des missions

### 1.1 `Outreach.tsx` (page)
- SEO : title `Missions | Konekt`, description `Gérez vos missions de recrutement et de sourcing`.
- Exporte encore les types `LinkedInAccount` / `LinkedInAccountSubscriptions` (dette : types d'infra dans un fichier de page).
- Commentaire en tête : le feature flag `mission_v2` a été supprimé, `ProjectsListV2` est le seul rendu.

### 1.2 `ProjectsListV2.tsx` — structure
Conteneur : `max-w-[1200px] mx-auto w-full` (≠ `max-w-[1600px]` du wrapper parent → **double contrainte de largeur**).

**Header hero** (`flex items-end justify-between mb-6 flex-wrap gap-4`)
- Eyebrow : `Tableau de bord` — `text-[11px] text-muted-foreground uppercase tracking-wider mb-1`
- H1 : `font-display text-[26px] sm:text-[30px] font-bold leading-tight` → « Tes missions » + `<span class="font-editorial italic font-normal text-muted-foreground">en cours</span>`
- Sous-titre : `{n} mission(s) active(s)` + si bucket attention : `· {n} demande(nt) ton attention` en `style={{color:'hsl(var(--status-warning))'}}`
- **Bouton « Nouvelle mission »** : `h-10 px-5 rounded-full text-[13px] font-semibold text-white konekt-skalr-bg konekt-shine active:scale-[0.97]`, icône `Plus w-4 h-4 strokeWidth 2.5`.
  - Garde quota : si `!canCreateJob` → `toast.error("Quota de missions atteint")` et abandon.
  - Sinon ouvre `CreateMissionV2` avec `initialMode='brief'`.

**KPI strip** : `grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6`, 4 `KpiCard` (`bg-card border border-border rounded-lg px-4 py-3`, label `text-[10px] uppercase tracking-wider`, valeur `font-display text-[22px] font-bold tabular-nums`) :
`Missions actives` · `Sourcés au total` · `À contacter` (highlight `warning` si >0) · `Réponses reçues` (highlight `success` si >0).

**Barre de recherche** : `<Input>` shadcn, `h-9 pl-9 bg-card border-border`, placeholder `Rechercher une mission, un client, un poste…`, icône `Search` absolue. Filtre sur name / clientName / location / skills.

**Sections narratives** (`Section`: emoji + titre `text-[11px] uppercase tracking-wider font-semibold` + sous-titre `text-[10px] text-muted-foreground/70`, contenu `space-y-2`) :
1. ⚡ `Demandent ton attention` — sous-titre `{n} mission(s) avec une action urgente` (bucket `urgency:'high'`)
2. 📍 `En cours` — `{n} mission(s) active(s)`
3. 📦 `Terminées · archivées` — collapsable, bouton pleine largeur `hover:bg-muted/40 px-2 py-1.5 rounded-md`, chevron `ChevronUp`/`ChevronDown` `w-4 h-4`.
4. `PartnerMissionsSection` (cabinets/indépendants uniquement).

**État « aucun résultat après filtre »** : card `bg-card border border-border rounded-xl p-12 text-center`, icône `Search w-8 h-8 text-muted-foreground/40`, titre `Aucune mission trouvée`, texte `Essaye avec d'autres mots-clés ou efface la recherche.`

**Loading** : 3 skeletons `h-24 bg-card border border-border rounded-xl animate-pulse`.

### 1.3 `MissionCard`
Carte : `group bg-card border rounded-xl p-4 hover:border-foreground/30 hover:shadow-md hover:-translate-y-px cursor-pointer`.
Si `isAttention` : `border-warning/40` + **background inline** `linear-gradient(135deg, hsl(var(--card)), hsl(var(--status-warning-muted)/0.4))`.

- Icône `Briefcase w-4 h-4` dans `h-10 w-10 rounded-lg grid place-items-center` (`bg-muted` ou fond `status-warning-muted` inline)
- Titre `h3.font-semibold.text-[14px].truncate`
- **Badge statut** (`STATUS_CONFIG`) : pastille `inline-flex text-[10px] px-1.5 py-0.5 rounded-full`, fond `${color}1a` (concat hex/hsl **bugué** : `hsl(var(--x))1a` n'est pas une couleur valide), dot `h-1 w-1 rounded-full` :
  | value | label | couleur | icône menu |
  |---|---|---|---|
  | `active` | **Actif** | `hsl(var(--status-success))` | `Play` |
  | `paused` | **En pause** | `hsl(var(--status-warning))` | `Pause` |
  | `completed` | **Terminé** | `hsl(var(--status-info))` | `CheckCircle` |
  | `archived` | **Archivé** | `hsl(var(--muted-foreground))` | `Archive` |
- Méta : `Building2` + clientName · `MapPin` + location · `Mise à jour {formatDistanceToNow(locale fr)}`
- KPI inline (`KpiInline`, `font-display font-bold tabular-nums text-[13px]`) : `Sourcés` / `Contactés` / `Réponses` (Réponses en `status-success` si >0)
- **Next-step row** — libellé + bouton `h-7 px-3 rounded-full text-[11px] font-semibold` (`bg-foreground text-background` si attention, sinon `bg-card border border-border hover:bg-accent`), icône dynamique + `ArrowRight w-3 h-3`.

**Table des next-steps (`computeNextStep`)** :
| Condition | label FR | CTA | `?tab=` | urgency | icône |
|---|---|---|---|---|---|
| pas de sourcingProject (mission Notion) | `Démarrer la mission` | `Commencer` | `overview` | medium | `Play` |
| `shortlisted>0 && untreated>=1` | `{n} candidat(s) sourcé(s) non contacté(s)` | `Contacter` | `outreach` | **high** | `MessageSquare` |
| `!job_details.title` | `Brief incomplet` | `Compléter` | `brief` | **high** | `FileText` |
| pas de `filters_snapshot` | `Filtres à générer` | `Analyser le brief` | `brief` | medium | `Sparkles` |
| `stats.total===0` | `Sourcing en attente` | `Lancer le sourcing` | `sourcing` | medium | `Search` |
| `total>0 && messaged===0` | `{n} profil(s) à contacter` | `Outreach` | `outreach` | medium | `Zap` |
| `messaged>0` | `{n} contacté(s) · {n} qualifié(s)` | `Pipeline` | `pipeline` | low | `Briefcase` |

**Menu contextuel** (`DropdownMenu`, trigger `MoreVertical w-3.5 h-3.5` en `h-7 w-7 rounded-md opacity-0 group-hover:opacity-100`, content `align="end" w-48`), items conditionnels :
`Activer` (Play) · `Mettre en pause` (Pause) · `Marquer terminée` (CheckCircle) · `Archiver` (Archive) · séparateur · `Supprimer` (Trash2, `text-destructive focus:text-destructive`, uniquement si `sourcingProject` existe).

**AlertDialog suppression** :
- Titre : `Supprimer cette mission ?`
- Description : `"{nom}" sera supprimée définitivement avec tous ses candidats sourcés et messages. Cette action est irréversible.`
- Boutons : `Annuler` / `Supprimer` (`bg-destructive text-destructive-foreground hover:bg-destructive/90`)
- Toast succès (hook) : `Projet supprimé` — **incohérence de vocabulaire « projet » vs « mission »**.

**Navigation** : `navigateToWorkspace()` — si mission Notion sans sourcing project, crée le project puis navigue ; en cas d'échec `toast.error('Impossible de créer la mission')`.

### 1.4 `PartnerMissionsSection` (`src/components/marketplace/PartnerMissionsSection.tsx`)
Visible seulement si `orgType ∈ {agency, freelance}` et ≥1 mission partenaire.
- Header : `Handshake w-4 h-4` + `Missions partenaires` + `{n} mission(s) confiée(s) par une entreprise`
- Carte : `w-full text-left bg-card border border-border rounded-xl p-4 hover:border-foreground/30 hover:shadow-md hover:-translate-y-px` (mêmes classes que MissionCard → **duplication**)
- Badge : `huntStatusLabel()` en `bg-muted text-muted-foreground rounded-full text-[10px]`
- Méta : `Building2` + client · `{x} % du salaire annuel`
- Erreur : texte `Vos missions partenaires n'ont pas pu être chargées.` + bouton `Réessayer` (`h-7 px-2.5 border border-border text-[11px] uppercase tracking-wider`) — **style brutaliste hors DA v2**.

### 1.5 `EmptyMissionState.tsx` (0 mission) — 578 lignes
Affiché à la place de la liste. Contient `NeuralBackground` (SVG animé framer-motion), `FloatingParticles` (20 particules aléatoires), `OrbitRing`, `AnimatedCounter`, `TypingText`, `LogoCarousel`.
- H2 : `Lancez votre première mission` — `text-2xl sm:text-4xl font-black uppercase tracking-wider`
- Sous-titre : `Une mission = un poste à pourvoir. L'IA vous guide du brief au premier message.`
- StatsBar : `200M+ Profils accessibles` · `45s Brief → Sourcing` · `3x Plus rapide`
- **Carte AI** (bordure carrée `border border-border p-7 sm:p-9`, fond `bg-gradient-to-br from-[hsl(var(--accent))] via-transparent to-[hsl(var(--accent))]`) :
  - Badge `Recommandé` (`bg-foreground text-background text-xs font-bold uppercase`)
  - Titre `Créer avec l'IA`, sous-titre au hover : `Analysons votre brief ensemble...` (effet machine à écrire) / au repos `La méthode la plus rapide`
  - Bullets : `Brief vocal ou écrit → structuré par l'IA` (Sparkles/warning) · `Filtres de recherche générés automatiquement` (Clock/info) · `Messages personnalisés en 1 clic` (MessageSquare/success)
  - CTA `ShimmerButton` : `Commencer le brief IA` (`pointer-events-none`, `tabIndex=-1` — c'est la carte entière qui est le bouton)
- **Carte manuelle** : titre `Créer manuellement`, sous-titre `Pour les recruteurs experts`, bullets `Contrôle total sur chaque paramètre` / `Importez depuis une URL ou un fichier` / `Pour les recruteurs expérimentés`, CTA outline `Création manuelle`.
- Footer : `Ou importez depuis une page carrières` + icône `ExternalLink` **non cliquable** (faux affordance).

---

## 2. `/missions/:id` — Workspace

### 2.1 États page (`MissionWorkspace.tsx`)
| État | Rendu |
|---|---|
| loading | `BrutalLoader variant="default" rows={3}` messages `['Chargement de la mission…','Récupération des données…']`, SEO `Mission | Konekt` |
| introuvable | card `rounded-lg border border-border bg-card p-12 text-center` — emoji 🔍 `text-4xl`, `h2.text-sm.font-semibold` **Mission introuvable**, `p` `Cette mission n'existe pas ou a été supprimée.`, bouton natif `h-9 px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium` → **Retour aux missions** |
| OK | SEO `{project.name} | Konekt` + `<MissionWorkspaceV2 project>` |

### 2.2 `MissionWorkspaceV2` — chrome
Racine : `h-screen w-full max-w-full bg-background relative flex flex-col overflow-hidden`.

**a) Header breadcrumb** — `border-b border-border px-4 sm:px-5 h-11 flex items-center justify-between`
- Bouton texte `Missions` (`text-muted-foreground hover:text-foreground font-medium`) → `/missions`
- `ChevronRight w-3.5 h-3.5 text-muted-foreground/50`
- `h1.font-semibold.text-foreground.truncate` = `project.name`
- `·` + `client_name` (`hidden sm:inline`)
- **Statut global** à droite : dot `w-2 h-2 rounded-full` + label — `STATUS_DOT` : `active → bg-success / Actif`, `paused → bg-warning / En pause`, `completed → bg-info / Terminé`, `archived → bg-muted-foreground / Archivé`.
  ⚠️ tokens **différents** de `ProjectsListV2.STATUS_CONFIG` (`bg-success` vs `hsl(var(--status-success))`) pour la même sémantique.

**b) `PhaseStepper`** (voir §2.3)

**c) Barre de sous-onglets** — `border-b border-border bg-background px-4 sm:px-5 flex items-center gap-1 overflow-x-auto scrollbar-hide`
- Bouton : `px-3 py-1.5 text-[13px] font-medium border-b-2`
  - actif : `border-foreground text-foreground`
  - inactif : `border-transparent text-muted-foreground hover:text-foreground`
  - verrouillé : `opacity-40 cursor-not-allowed` + suffixe **`🔒`** (`ml-1.5 text-[10px]`) et `disabled`
- Contenu par phase :
  - Phase 1 : `Vue d'ensemble` · `Brief` · `Process` · `Configuration`
  - Phase 2 : `Sourcing` · `Outreach`
  - Phase 3 : `Pipeline` · `Insights`

**d) Body** — `flex flex-1 min-h-0` > `flex-1 overflow-y-auto` > wrapper `px-3 sm:px-6 lg:px-8 py-2 sm:py-3` avec largeur conditionnelle :
- `brief|process|config` → `max-w-[1280px] w-full`
- autres NARROW (`overview|outreach|insights`) → `max-w-[960px] w-full`
- `sourcing|pipeline` → pleine largeur
Transition `AnimatePresence mode="wait"` : `enter {opacity:0,y:6}` / `center {opacity:1,y:0}` / `exit {opacity:0,y:-4}`, `duration 0.15 easeOut`.
Chaque vue est enveloppée dans un `SectionErrorBoundary` avec `fallbackTitle` :
`Erreur dans la Vue d'ensemble` · `Erreur dans le Brief` · `Erreur dans le Process` · `Erreur dans la Config` · `Erreur dans le Sourcing` · `Erreur dans l'Outreach` · `Erreur dans le Pipeline` · `Erreur dans les Insights`.

**e) Feature gates** (`hasFeature(orgType, …) && project.organization_id === organizationId`)
- `canEditBrief` = `edit_brief` → `MissionBriefV2 readOnly={!canEditBrief}` et `MissionConfigV2 readOnly={!canEditBrief}`
- `canEditProcess` = `edit_process` → `MissionProcessV2 readOnly={!canEditProcess}`
- `hasFeature` **fail-closed** : `orgType===null` (chargement) ⇒ tout en lecture seule → flash readOnly au premier render.
- Matrice : `edit_brief` / `edit_process` = true pour enterprise, agency, freelance ⇒ readOnly n'arrive en pratique que sur une **mission d'une autre organisation** (recruteur partenaire).

### 2.3 `PhaseStepper` — stepper de phases
Conteneur `border-b border-border bg-background` > `px-4 sm:px-5 py-1.5 flex items-center gap-1 overflow-x-auto scrollbar-hide`.

3 phases (`PHASES`) : `1 Cadrage` (desc `Brief & process`) · `2 Sourcing & Outreach` (desc `Recherche & contact`) · `3 Pipeline` (desc `Entretiens & embauche`).
⚠️ `desc` est défini mais **jamais rendu** ; `rightSlot` est prévu mais non fourni par le workspace (pill « Sourcing actif » retirée).

**États (`getPhaseState`)** — dérivés uniquement de la position vs phase active, **pas** du readiness :
| État | Condition | Pastille numéro (`h-5 w-5 rounded-full text-[10px] font-bold`) | Label `text-[12.5px] font-semibold` | Fond bouton | Connecteur |
|---|---|---|---|---|---|
| `done` | `id < active` | fond `hsl(var(--status-success))`, texte `hsl(var(--background))`, contenu `<Check w-2.5 h-2.5 strokeWidth=3>` | normal | transparent | `h-px w-3 sm:w-4` fond `hsl(var(--status-success))` |
| `active` | `id === active` | fond `hsl(var(--foreground))`, texte `hsl(var(--background))`, `boxShadow 0 0 0 3px hsl(var(--foreground)/0.1)`, contenu = numéro | normal | `hsl(var(--accent))` | `hsl(var(--border))` |
| `todo` | `id > active` | fond `hsl(var(--muted))`, texte `hsl(var(--muted-foreground))`, numéro | `text-muted-foreground` | transparent | `hsl(var(--border))` |
| **`locked`** | `isPhaseLocked(id)` | modificateur : `opacity-50` sur tout le bouton + `disabled` | — | — | — |

Bouton phase : `flex items-center gap-2 px-2.5 py-1 rounded-lg transition-all duration-300`, `hover:bg-accent/50 active:scale-[0.98]` si cliquable, `aria-current="step"` quand actif.
⚠️ Le verrouillage se signale **uniquement par `opacity-50`** — pas de cadenas, contrairement aux sous-onglets qui affichent 🔒.

**Navigation** :
- clic phase → 1er sous-onglet non verrouillé de la phase ; si tous verrouillés → `toast.info('Complétez les étapes précédentes pour débloquer cette phase.')`
- clic sous-onglet verrouillé → `toast.info(step.blockerMessage || 'Complétez les étapes précédentes.')`
- Une phase est « lockée » seulement si **tous** ses sous-onglets le sont.

### 2.4 `useMissionReadiness` — verrouillage (`src/hooks/useMissionReadiness.ts`)
Entrées : `hasBrief = !!(jd.title || project.job_title || project.name)` (fallback legacy), `hasFilters = filters_snapshot non vide`, `hasProcessSteps = jd.process_steps.length>0`, `hasCandidates = stats_total_found>0`, `hasMessaged = stats_messaged>0`.

| step id | isComplete | isReady | **isLocked** | % | **blockerMessage (FR exact)** | nextAction |
|---|---|---|---|---|---|---|
| `brief` | hasBrief | `true` | `false` | `countBriefFields` % | `null` | `Analyser avec l'IA`→brief / `Lancer le sourcing`→sourcing |
| `process` | hasProcessSteps | `true` | `false` | 0 ou 100 | `null` | `Configurer le process`→process |
| `sourcing` | hasCandidates | hasBrief&&hasFilters | **`!hasBrief`** | 0/50/100 | `Complétez le brief avant de lancer le sourcing.` · `Lancez l'analyse IA du brief pour générer les filtres.` | `Contacter les candidats`→outreach |
| `outreach` | hasMessaged | hasCandidates | `false` (volontaire) | 0/30/100 | `null` | `Sourcer des candidats`→sourcing |
| `pipeline` | hasCandidates | hasCandidates | **`!hasCandidates`** | 0/100 | `Ajoutez des candidats au pipeline depuis le sourcing.` | `Aller au sourcing`→sourcing |
| `insights` | hasMessaged | hasCandidates | **`!hasCandidates`** | 0/100 | `Des données de pipeline sont nécessaires pour afficher les insights.` | `Aller au sourcing`→sourcing |

⚠️ Il n'existe **aucune entrée readiness** pour `overview` ni `config` ⇒ `readiness.find(...)` renvoie `undefined`, ces onglets ne sont jamais verrouillés (comportement OK mais implicite).
⚠️ `hasBrief` est quasi toujours vrai (fallback `project.name`) ⇒ le verrou `sourcing` ne se déclenche pratiquement jamais ; en pratique seuls `pipeline` et `insights` se verrouillent. Phase 3 = seule phase réellement lockable.
⚠️ `hasProcessSteps` lit `job_details.process_steps`, alors que le process réel vit dans la table `mission_process_steps` (`useMissionProcess`) ⇒ **incohérence de source de vérité**, `readiness.process` est toujours 0 %.

---

## 3. Phase 1 — Cadrage

### 3.1 `?tab=overview` — `MissionOverviewV2`
Conteneur : `max-w-[920px] pb-8` (3ᵉ contrainte de largeur, après 1600 / 1280).

**Header** (`konekt-fade-up`)
- Pills : `Créée {il y a Xmin|Xh|Xj|X sem|à l'instant}` (`Pill variant="muted"`) ; si `filters_snapshot` : `Pill variant="ai" icon={Sparkles}` → **`Brief structuré par IA`**
- H1 : `font-display text-[28px] sm:text-[32px] font-bold leading-tight mb-1` = `jd.title || project.name`
- Méta `text-[13px] text-muted-foreground` : `CompanyLogo` (logo_url → `https://logo.clearbit.com/{domain}` → fallback `Building2`) + client · `MapPin` + location (+ ` · {remote}` si ≠ Sur site) · `Euro` + salaire formaté (`65K–85K€` / `dès 65K€` / `jusqu'à 85K€`) · contrat.

**Card « Brief en bref »** (`bg-card border border-border rounded-xl p-4`)
- Header : label `Brief en bref` (`text-[10px] uppercase tracking-wider font-semibold`) + bouton texte **`Modifier →`** (`text-[10px]`) → `?tab=brief`
- Lignes `text-[12.5px]` : `Stack` (4 premiers must-have) · `Expérience` (`3–8 ans` / `5+ ans` / `≤ 8 ans`) · `Séniorité` · `Démarrage`
- **Vide** : `Pas encore de détails — complète le brief pour les voir apparaître ici.` (`italic text-[12px]`)

**Card « Process recruteur »**
- Bouton texte **`Configurer →`** → `?tab=process`
- `ProcessSummary` : lit `job_details.process_steps`. Si vide → **process par défaut affiché comme s'il existait** : `Screening / 30 min`, `Entretien tech / 60 min`, `Culture fit / 45 min`, `Offre / sous 48h` + note `Process par défaut — personnalise dans l'onglet Process.`
  ⚠️ Ces libellés ne correspondent à **aucun** `PROCESS_TEMPLATES` réel ⇒ contenu fantôme.
- Puce d'étape : `h-5 w-5 rounded-full bg-muted text-[10px] font-bold`, ligne `hover:bg-muted/40 rounded-md px-2 py-1.5`. Au-delà de 5 : `+{n} autre(s) étape(s)`.

**Card « Funnel »**
- Pill d'état, exclusifs :
  - `total===0` → `Pill muted` **`En attente du sourcing`**
  - `messaged===0` → `Pill info pulse` **`Sourcing terminé · à contacter`**
  - sinon → `Pill success pulse` **`Outreach actif`**
- 5 tuiles `grid grid-cols-2 sm:grid-cols-5 gap-2`, `text-center px-2 py-3 rounded-md border` — `border-dashed border-border bg-background` si 0, sinon `border-border bg-card/50`. Valeur `font-display text-[20px] font-bold` (`text-muted-foreground/40` si 0).
  Labels : `Sourcés` · `Contactés` · `Répondu` · `Entretien` · `Offre`.

**Code mort assumé** : `computeNextStep()` (hero « Étape suivante ») + imports `Sparkles/Search/Zap/ArrowRight/Briefcase` conservés « au cas où » ; `useMissionReadiness(project)` appelé sans utiliser le retour.

### 3.2 `?tab=brief` — `MissionBriefV2` (1107 l.)
Layout : `grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 pb-8`.

**Header colonne gauche**
- Eyebrow `Étape 1 · Cadrage` (`text-[11px] uppercase tracking-wider`)
- H2 `font-display text-[24px] font-bold` : **`Brief de mission`**
- Sous-titre : `Plus le brief est précis, meilleur sera le sourcing et le scoring des candidats.`
- **Boutons (masqués si `readOnly`)** :
  | Bouton | Classes | Icône | Comportement |
  |---|---|---|---|
  | **`Dicter`** | `h-9 px-3 rounded-full text-[12px] font-medium border`, actif `bg-foreground text-background border-foreground` | `Mic w-3.5` | toggle du panneau dictée, `title="Dicter à voix haute"` |
  | **`Analyser avec l'IA`** | `h-9 px-4 rounded-full text-[12px] font-semibold text-white konekt-skalr-bg konekt-shine active:scale-[0.97] disabled:opacity-50` | `Sparkles` / `Loader2 animate-spin` | `disabled = isAnalyzing || completion.percent < 20` ; `title` = `Remplis au moins le titre + description` (si <20 %) sinon `Lance l'analyse IA` |

**Panneau dictée vocale** (`mb-5 bg-card border border-border rounded-xl p-4 konekt-fade-up`)
- Header `Mic` + `Dictée vocale` + bouton fermer `X` (`h-7 w-7 rounded-md hover:bg-accent`)
- `<VoiceDictation>` : bouton **`Dicter le brief`** (`h-9 px-5 text-xs uppercase tracking-wider border bg-foreground text-background`) / état connexion **`Connexion au micro...`** / en cours : bouton **`Arrêter`** (`border-red-600 bg-red-600 text-white` — **rouge en dur, hors tokens**) + dot ping `bg-red-500/bg-red-600` + timer `font-mono`. Zone live : `En écoute — parlez naturellement...` puis texte interim en italique.
- Toasts : `Dictée enregistrée` (succès), `Erreur de connexion Deepgram`, `Accès au microphone refusé. Vérifiez les permissions du navigateur.`, `Aucun microphone détecté.`, `Erreur au démarrage`.
- Transcript rendu dans `mt-3 border border-border rounded-md p-3 max-h-[150px] overflow-y-auto`.

**Auto-save** : debounce **800 ms** sur `updateField`, merge profond `latestRef` + `pendingPatchRef`, garde `editSeqRef` contre les races, flush au démontage / changement de mission. `readOnly` ⇒ `updateField` no-op.

**Composants de champ réutilisés**
- `SectionCard` : `bg-card border border-border rounded-xl overflow-hidden`, header `px-5 py-3 border-b border-border flex items-center gap-3` (emoji `text-base` + `h3.font-display.text-[14px].font-bold` + subtitle `text-[11px]`), corps `p-5 space-y-3`
- `FieldLabel` : `text-[10px] uppercase tracking-wider text-muted-foreground font-semibold`, astérisque `text-destructive ml-0.5` si `required`
- `TextInput` : `w-full h-9 px-3 rounded-md border border-border bg-background text-sm focus:ring-2 focus:ring-ring focus:ring-offset-1`, readOnly → `bg-muted/30 cursor-not-allowed`
- `TextArea` : `px-3 py-2 rounded-md … resize-none`
- `Select` (natif) : `w-full h-9 px-3 rounded-md …`, 1ʳᵉ option `placeholder` par défaut `—`, `disabled` si readOnly
- `TagsInput` : chips `inline-flex px-2 py-0.5 rounded-full text-[11.5px] font-medium`, couleurs inline par variante :
  - `must` → `status-warning-muted` / `status-warning`
  - `should` → `status-info-muted` / `status-info`
  - `nice` → `muted` / `muted-foreground`
  Bouton `X w-2.5` (`aria-label="Retirer {tag}"`). Input d'ajout `h-7 w-44 px-2 text-[12px] border border-dashed`. Raccourcis : `Enter` ajoute, `Backspace` sur input vide retire le dernier, `blur` ajoute. Bouton `Plus w-3.5` (`aria-label="Ajouter"`) affiché quand l'input est non vide. Aucune validation de longueur/doublon hors égalité stricte.

**Sections & champs (ordre de rendu)**

1. **📍 Le poste** — *Identité, contrat, localisation* — grid `sm:grid-cols-3`
   | Label | Type | Placeholder | Options |
   |---|---|---|---|
   | `Titre du poste` * | text (col-span-2) | `Ex: Senior React Engineer` | — |
   | `Référence interne` | text | `Ex: KNK-2026-042` | — |
   | `Type de contrat` | select | `—` | CDI · CDD · Freelance · Alternance · Stage · Intérim |
   | `Urgence` | select | `—` | `🟢 Basse` · `🟡 Moyenne` · `🟠 Haute` · `🔴 Critique` |
   | `Date de démarrage` | text | `ASAP, T3 2026...` | — |
   | `Localisation` | text | `Ex: Paris` | — |
   | `Politique télétravail` | select | `—` | `Sur site` · `Hybride` · `Full remote` |
   | `Jours de remote/sem.` | number | `0-5` | pas de min/max HTML |

2. **📝 Description de la mission** — *Contexte + missions principales*
   - `Contexte du recrutement` textarea rows=2 — `Ex: Création de poste, remplacement, croissance équipe...`
   - `Mission` * textarea rows=6 — `Décris les missions principales, les projets, le quotidien du candidat...`

3. **🏢 Le client** — *L'entreprise qui recrute + hiring manager*
   - `Nom` (`Ex: Doctolib`) · `Secteur` (`Ex: HealthTech`) · `Taille` select (`Startup` · `Scale-up` · `Mid-market` · `Enterprise`)
   - `Site web` col-span-3 (`https://...`)
   - `Notes culture / contexte` textarea rows=2 (`Ce qui caractérise l'entreprise (mission, valeurs, ambiance...)`)
   - Sous-bloc **`Hiring manager`** (`pt-3 border-t`) : `Nom` (`Ex: Sarah Dupont`) · `Poste` (`Ex: VP Engineering`) · `Email` type=email (`sarah@...`) · `LinkedIn` (`https://linkedin.com/in/...`)

4. **👥 L'équipe** — *Hiérarchie et taille (optionnel mais utile pour le pitch)* : `Taille de l'équipe` number (`Ex: 12`) · `Rattachement (à qui ?)` (`Ex: VP Engineering`) · `Personnes managées` number (`0 si IC`)

5. **👤 Le profil recherché** — *Séniorité, expérience, package, langues*
   - `Séniorité` (`Ex: Senior, Lead`) · `Expérience min (ans)` (`3`) · `Expérience max (ans)` (`8`)
   - Bloc **`Rémunération`** : `Salaire min` (`65000`) · `Salaire max` (`85000`) · `Devise` select (`€ EUR` · `$ USD` · `£ GBP` · `CHF`, défaut EUR) · `Type` select (`€/an` · `€/jour` · `€/heure`, défaut annual)
   - `Equity / BSPCE` (`Ex: 0.1-0.5% BSPCE`) · `Avantages` (`Mutuelle, RTT, formation...`)
   - Bloc **`Langues requises`** : bouton texte `+ Ajouter` (`text-[11px]`), vide → `Aucune langue spécifiée` (italic) ; ligne `grid-cols-[1fr_1fr_auto]` : langue (`Ex: Français`) / niveau (`Ex: C1, courant, natif`) / bouton suppr `h-9 w-9 hover:text-destructive hover:bg-destructive/10`
   - `Certifications souhaitées` → `TagsInput variant="nice"`, placeholder `AWS Solutions Architect, CKA...`

6. **⚡ Compétences** — *Ce qui sera utilisé pour scorer les candidats*
   - `Must-have — obligatoires` * → tags `must`, placeholder `React, TypeScript...`
   - `Should-have — souhaitées` → tags `should`, `GraphQL, Tests...`
   - `Nice-to-have — bonus` → tags `nice`, `OSS contributor, blog tech...`
   - `À éviter — red flags / compétences disqualifiantes` → tags **`must`** (même orange que must-have → **collision sémantique**), `ESN/SSII, mobile only...`

7. **🎯 Critères d'évaluation** — *Ce que tu vas évaluer en entretien — utilisé pour la scorecard et l'IA*
   - Vide → `Aucun critère défini. L'IA peut en proposer automatiquement quand tu lances l'analyse.`
   - Ligne : `bg-background border border-border rounded-md p-3`, grid `sm:grid-cols-[1fr_140px_120px_auto]` :
     - label text (`Ex: Architecture frontend, Communication...`)
     - select catégorie : `🔧 Technique` · `🤝 Soft skill` · `🌟 Culture fit` · `🎯 Motivation` · `💼 Expérience`
     - select poids : `Bonus` (1) · `Important` (2) · `Critique` (3)
     - bouton suppr `X` (`aria-label="Supprimer"`)
   - textarea description rows=2 (`Comment évaluer ce critère, ce qu'on cherche concrètement...`)
   - Pills : poids → `Pill warning` (3) / `Pill info` (2) / `Pill muted` (1) ; si deal_breaker → `Pill warning` **`⚡ Deal-breaker`**
   - Bouton texte à droite : **`Marquer deal-breaker`** / **`Retirer deal-breaker`** (`text-[10px]`)
   - Bouton bas : **`Ajouter un critère`** — `w-full h-9 rounded-md border border-dashed text-[12px] hover:bg-accent`, icône `Plus`

**Sidebar (`lg:sticky lg:top-4 space-y-3`)**
- **Indicateur de sauvegarde** (`bg-card border rounded-lg p-3`) — 4 états :
  - `saving` : `CloudUpload text-info animate-pulse` + `Enregistrement…`
  - `saved` : `Check` + `Enregistré` (couleur inline `hsl(var(--status-success))`)
  - `idle` : `Cloud` + `Auto-sauvegarde activée`
  - `error` : `AlertCircle text-destructive` + `Erreur de sauvegarde`
- **Card « État du brief »** : anneau SVG 36×36 (`h-14 w-14 -rotate-90`, stroke `status-success` si ≥60 % sinon `status-info`, `strokeDasharray=100`), `{percent}%` au centre (`font-display text-[13px] font-bold`), `{filled}/{total} champs`, statut `Prêt à analyser` (≥60) / `À compléter`.
  Bloc `Critique` (`text-warning`) listant les champs critiques manquants, puces `h-1 w-1 rounded-full bg-warning` : `Titre`, `Localisation`, `Compétences must-have`, `Description de mission`.
  ⚠️ `computeCompletion` (12 champs, local) ≠ `countBriefFields` (12 champs, `missionUtils`) ≠ `readiness.briefPct` → **3 calculs de complétion différents**.
- **Card « 💡 Conseil »** : `Les compétences must-have et la description de mission sont les fields les plus impactants pour le scoring IA des candidats.` (« fields » — anglicisme en prod).

**Analyse IA (`handleAnalyze`)**
- Garde : si `description < 20 car.` et pas de titre → `toast.error('Renseigne au moins le titre ou la description pour analyser')`
- Appel `invokeWithCredits('generate-search-filters','filter_generation', …)`
- Erreurs → `toast.error(err.message || "Erreur lors de l'analyse")`
- Succès → ouvre `FilterReviewModal`
- Acceptation : persiste `filters_snapshot`, `toast.success('Filtres sauvegardés — direction sourcing')`, redirige `?tab=sourcing` ; échec → `toast.error('Erreur lors de la sauvegarde')`

**`FilterReviewModal`** (`src/components/missions/FilterReviewModal.tsx`, portal `z-[4000]`)
- Panel : `w-full sm:max-w-lg max-h-[85dvh] bg-background border border-border` — **aucun radius** (brutaliste), bottom-sheet sur mobile (spring damping 28 / stiffness 300), backdrop `bg-foreground/60`
- Header : carré `w-8 h-8 bg-foreground` + `SlidersHorizontal`, titre **`Filtres proposés`** (`text-xs font-black uppercase tracking-wider`), sous-titre `{n} catégorie(s) active(s)`, bouton `X` carré `w-8 h-8 border`
- Bandeau **`Stratégie IA`** (`bg-accent/10 border-b-2`) avec `analysis.search_rationale`
- Sections repliables (case à cocher `w-5 h-5 border-2` + `✓`), libellés : `Titres de poste` · `Compétences clés` · `Localisation` (extra `Rayon: {n} km`) · `Expérience` (`{min} – {max} ans` / `{min}+ ans` / `≤ {max} ans`) · `Recherche Boolean` · `Domaines`
- Chips éditables (`EditableChip`) : `border border-border font-display font-bold text-[13px]`, boutons `Pencil w-2.5` (édition inline, Enter=valider, Escape=annuler, blur=valider) et `X w-2.5` (`hover:text-destructive`)
- `ChipInput` : `border border-dashed`, `h-7 w-[120px]`, placeholder `Ajouter...` (ou `Modifier...` pour Boolean)
- Bloc **`Suggestions IA`** (`Sparkle w-2.5`) : chips en pointillés cliquables `+ {suggestion}` (max 8, dédoublonnées)
- Footer `border-t-2 p-4` : bouton **`Regénérer`** (`h-9 px-4 border`) + bouton principal **`Lancer le sourcing`** (`flex-1 h-9 bg-foreground text-background text-xs font-black uppercase`, icône `Play`), désactivé si `enabledCount===0` (→ `bg-muted text-muted-foreground cursor-not-allowed`)

### 3.3 `?tab=process` — `MissionProcessV2`
Layout `grid lg:grid-cols-[1fr_280px] gap-6 pb-8`, même `SectionCard` (redéfini **localement**, sans `space-y-3` dans le corps).

**Header** : eyebrow `Étape 1 · Cadrage`, H2 **`Process d'entretien`**, sous-titre `Définis les étapes d'évaluation. L'IA adaptera le scoring et les scorecards en fonction.`
- Bouton (si `!readOnly && hasSteps`) : **`Réoptimiser avec l'IA`** — `h-9 px-4 rounded-full text-[12px] font-semibold text-white konekt-skalr-bg konekt-shine`, `Sparkles` / `Loader2`, `disabled={suggestingAI}`

**Bandeau readOnly** : `mb-4 px-4 py-3 rounded-lg border border-border bg-muted/30` → `👁️ Lecture seule — le process est défini par le lead recruteur` (emoji inline, ≠ `MissionConfigV2` qui utilise l'icône `Eye`).

**Section 🎯 « Étapes du process »** — sous-titre `{n} étape(s) · glisse pour réordonner` ou `Aucune étape définie`
- Loading : `Loader2 w-5 h-5 animate-spin` centré `py-8`
- **Empty state** (`EmptyProcessState`) : emoji 🏗️ `text-3xl`, titre `Configure ton process` (readOnly : `Aucune étape définie`), texte `Choisis un template adapté ou laisse l'IA proposer un process basé sur le brief.` (readOnly : `Aucune étape définie pour cette mission.`)
  - Bouton **`Suggestion IA basée sur le brief`** — `w-full h-10 rounded-full konekt-skalr-bg konekt-shine text-[13px] font-semibold text-white`, état chargement : `Analyse du brief…`
  - Label `Ou choisis un template`
  - Grille `grid-cols-2 gap-2` de 4 templates (`bg-background border border-border rounded-lg p-3 hover:border-foreground/30`), affichant label + description + `{n} étapes` :
    | key | label | description | étapes |
    |---|---|---|---|
    | `standard` | `Standard (3 étapes)` | `Screening → Technique → Client` | 30+60+45 min |
    | `senior` | `Senior (5 étapes)` | `Screening → Tech → Cas pratique → Culture → Direction` | 30+90+120+45+30 |
    | `fast` | `Rapide (2 étapes)` | `Screening → Entretien unique` | 20+60 |
    | `executive` | `Executive (4 étapes)` | `Screening → Stratégie → Panel → Board` | 45+90+60+30 |
    ⚠️ Le commentaire d'en-tête annonce « 5 templates » mais il y en a **4**. L'ordre d'affichage suit `Object.entries` (standard, senior, fast, executive) → pas l'ordre logique de durée.
- **Timeline** (steps présents) : ligne verticale `absolute left-[30px] top-7 bottom-7 w-px bg-border` (**offset magique en dur**)
  - Bullet début : cercle `w-7 h-7 rounded-full bg-muted border` avec `→` + label `Candidat soumis`
  - `StepCard` draggables (voir §3.4)
  - Bullet fin : cercle vert (`status-success-muted` / `status-success` / `border 1px hsl(var(--status-success)/0.4)`) avec `✓` + label **`Embauché`**
- **Ajout d'étape** (masqué si readOnly) :
  - Repos : bouton `w-full h-9 rounded-md border border-dashed text-[12px] hover:bg-accent` → **`Ajouter une étape`** (`Plus w-3.5`)
  - Ouvert : input `flex-1 h-9 px-3 text-sm rounded-md`, placeholder `Nom de l'étape...`, `autoFocus`, Enter=valider / Escape=annuler ; bouton **`Ajouter`** (`h-9 px-4 rounded-md bg-foreground text-background text-[12px] font-semibold`, `disabled` si vide) ; bouton **`Annuler`** (`h-9 px-3 border border-border text-muted-foreground`)

**Section 👥 « Équipe mission »** — *Recruteurs internes + invitations externes* → `MissionTeamSection` (voir §3.5)

**Sidebar**
- Card **`État du process`** — 4 `KpiRow` (`font-display font-bold tabular-nums text-[15px]`) : `Étapes` (Target) · `Durée totale` + suffixe `min` (Clock) · `Éliminatoires` (Zap, coloré `status-warning` si >0) · `Membres équipe` (Users)
- Card `Pill success pulse` **`Process configuré`** (si `hasSteps`)
- Card **`💡 Conseil`**, 3 variantes :
  - sans étapes : `Choisis un template adapté ou laisse l'IA proposer un process basé sur la séniorité du poste.`
  - 0 éliminatoire : `Marquer une étape comme éliminatoire permet de filtrer les candidats automatiquement avant l'étape suivante.`
  - sinon : `Le format visio (Teams/Zoom/Meet) génère automatiquement un lien meeting dans l'invitation calendar du candidat.`

**AlertDialog de remplacement de process** (déclenché par `Réoptimiser avec l'IA` quand des étapes existent)
- Titre : `Remplacer les {n} étapes actuelles ?` ou `Remplacer l'étape actuelle ?`
- Description : `Le process « {label} » remplacera les étapes existantes. ` + `{n} candidat(s) positionné(s) sur une étape actuelle sera/seront repositionné(s) sur l'étape de même nom, ou sur la première étape. ` (ou `Aucun candidat n'est positionné sur une étape actuelle. `) + `Cette action est irréversible.`
- Boutons : `Annuler` / **`Remplacer`** (`bg-destructive hover:bg-destructive/90`)
- Toast (hook) : `Process « {label} » appliqué · {n} candidat(s) repositionné(s)` (ou `Process créé`)

**Choix du template par l'IA (`handleAISuggestion`, règles sur `jd.seniority` / `jd.manages`)** : junior/stage/alternance → `fast` ; lead/senior/principal → `senior` ; director/vp/c-level/head ou `manages>5` → `executive` ; défaut → `standard`.
⚠️ La branche `executive` est **inatteignable** : elle suit un `else if` sur `senior|lead|head` — « Head of X » tombe dans `senior` avant d'atteindre le test executive.

### 3.4 `StepCard` (`src/components/missions/process/shared.tsx`)
Carte `rounded-lg border border-border bg-card transition-all` ; `isDragging` → `opacity-50 scale-[0.98]` ; `isDragTarget` → `border-primary/40 shadow-sm`.
Drag & drop **HTML5 natif** (`draggable`, `onDragStart/Over/End`) — ≠ `@dnd-kit` utilisé par le pipeline.

**Header replié** (`flex items-center gap-3 px-4 py-3`)
- Poignée `GripVertical w-4 h-4` (`cursor-grab active:cursor-grabbing`) — pas de zone de saisie dédiée, toute la carte est draggable
- Numéro : `w-7 h-7 rounded-full bg-foreground text-background text-xs font-bold font-display`
- Input nom inline : `text-[14px] font-semibold bg-transparent border-none focus:bg-muted/30 rounded px-1 -mx-1 max-w-[60%] sm:max-w-none`, commit au blur (ignore si vide)
- Pill format : `text-[11px] px-1.5 py-0.5 rounded-full bg-muted` affichant **uniquement l'emoji** (`🎥` / `📞` / `🤝`), `title="Format"`
- Badge **`Éliminatoire`** (`hidden sm:inline-flex`, `Zap w-2.5`, fond `status-warning-muted` / texte `status-warning`)
- `Clock w-3` + `{duration}min` · `User w-3` + `{interviewer_name || Interne|Client|Panel}` (`hidden sm:inline-flex`)
- Bouton `ChevronDown w-4` (`aria-label` `Développer`/`Réduire`, `rotate-180` si ouvert)
- Bouton `Trash2 w-3.5` (`aria-label="Supprimer"`, `hover:text-destructive hover:bg-destructive/10`) — **suppression sans confirmation**

**Contenu déplié** (`px-4 pb-4 pt-3 border-t border-border/50 space-y-4 bg-muted/20`)
- `Description` : input `h-9 px-3 rounded-lg` (radius `lg` alors que les autres champs sont en `md` → incohérence), placeholder `Description de l'étape...`
- Grid `grid-cols-2 sm:grid-cols-4 gap-3` :
  - `Durée (min)` : number, fallback `30` si invalide
  - `Réalisé par` : select `Interne` / `Client` / `Panel`
  - `Interviewer` : text, placeholder `Nom...`
  - `Éliminatoire` : bouton bascule `w-full h-9 rounded-md border` — `Zap + Oui` (fond `status-warning-muted`) / `Non`
- **`Format de l'entretien`** : 3 boutons `grid-cols-3` `flex flex-col items-start px-3 py-2.5 rounded-md border`, actif `border-foreground/40 bg-background` :
  | value | emoji | label | desc |
  |---|---|---|---|
  | `video` (défaut) | 🎥 | `Visioconférence` | `Teams, Zoom, Meet…` |
  | `phone` | 📞 | `Téléphonique` | `Appel classique` |
  | `onsite` | 🤝 | `Présentiel` | `Sur place / bureaux` |
  - **si `video`** : sous-bloc `Outil de visio` — 4 boutons (`grid-cols-2 sm:grid-cols-4`, `text-[11.5px]`) avec **logos SVG inline maison** : `Microsoft Teams` · `Zoom` · `Google Meet` · `Lien personnalisé`.
    - `other` → input `https://… (lien meeting personnalisé)`
    - autre provider → note `Sparkles` + `Le lien {Provider} sera généré automatiquement à chaque entretien planifié.`
  - **si `onsite`** : label `Adresse (optionnel)`, input `Ex: 12 rue de Paris, 75002 — bureaux client`, note `L'adresse sera incluse dans l'invitation calendar du candidat.`
  - **si `phone`** : note `Le numéro de téléphone du candidat sera utilisé. L'interviewer recevra le numéro dans son invitation calendar.`
- **`Objectifs`** : chips `px-2.5 py-1 rounded-md bg-accent/50 border border-border text-xs` préfixés `☑ ` avec bouton `×` texte ; input d'ajout `h-8 w-40 px-2 text-xs border border-dashed` placeholder `Ajouter un objectif...` (Enter / blur) + bouton `Plus w-3.5`.
  ⚠️ Ces chips (`rounded-md`, `bg-accent/50`, `☑` unicode) n'ont **rien à voir** avec les chips du brief (`rounded-full`, tokens status, `X` lucide).

### 3.5 `MissionTeamSection` (`process/shared.tsx`)
Bloc `mt-6 pt-6 border-t border-border` (⚠️ imbriqué dans un `SectionCard` qui a déjà son propre header → **double séparateur**).
- Titre : `Users w-4` + `Équipe mission ({n})` (`text-[10px] uppercase tracking-wider font-bold`)
- Bouton **`Assigner`** (`Plus w-3`, `h-8 px-3 rounded-full text-[11.5px] border border-border bg-background hover:bg-accent`) — visible si `!readOnly && availableMembers.length>0 && !showAssign`
- **Formulaire d'assignation** : select membres (`Sélectionner un membre...`), select rôle (`Lead` · `Sourcer` · `Account Manager` · `Reviewer` ; défaut `sourcer`), bouton **`OK`** (`h-9 px-4 rounded-full bg-foreground text-background text-[12px] font-bold`, disabled si aucun membre), bouton **`×`** d'annulation
- Loading équipe : spinner `w-4 h-4 rounded-full border-2 border-t-foreground animate-spin`
- Vide : `Aucun membre assigné à cette mission.`
- Ligne membre : `flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-card`, avatar `w-8 h-8 rounded-full bg-muted` + `User`, badge rôle `px-2 py-0.5 text-xs rounded-md border bg-muted/50` (`ROLE_LABELS` : `Lead` / `Sourcer` / `Account Manager` / `Reviewer` / **`Recruteur partenaire`**), bouton `Trash2` masqué pour les membres externes
- **AlertDialog retrait** : titre `Retirer ce membre ?`, description `Retirer {nom} de cette mission ?`, boutons `Annuler` / **`Retirer`** (`bg-destructive hover:bg-destructive/90`). Toasts : `Membre assigné à la mission`, `Ce membre est déjà assigné à cette mission`, `Membre retiré de la mission`
- **Invitations externes** (`mt-4 pt-4 border-t`) :
  - Titre `Invitations externes ({n} en attente)`
  - Bouton **`Inviter par email`** (`Mail w-3`, mêmes classes que `Assigner`)
  - Formulaire : input `type=email` placeholder `email@freelance.com` (Enter valide), bouton **`Inviter`** / **`Envoi...`** (disabled si vide ou `isSending`), bouton `X`
  - Ligne invitation : `Mail w-3.5` + email + badge statut :
    | statut | libellé | classes |
    |---|---|---|
    | `pending` | `En attente` | `border-warning/30 text-warning bg-warning/10` |
    | `accepted` | `Acceptée` | `border-success/30 text-success bg-success/10` |
    | `rejected` | `Refusée` | `border-border text-muted-foreground` |
    | (autre) | `Expirée` | `border-border text-muted-foreground` |
  - Si `pending` : bouton `Link2` (`title="Copier le lien d'invitation"` → `{origin}/mission-invite/{token}`, toast `Lien d'invitation copié` / fallback `toast.error('Lien : ' + url)`) et bouton `Trash2` (`title="Annuler l'invitation"`, **sans confirmation**)
  - Toasts hook : `Invitation envoyée par email`, `Invitation annulée`, `Invitation acceptée — vous avez accès à la mission`
  - Rôle d'invitation figé à `freelance` (pas de select).

### 3.6 `?tab=config` — `MissionConfigV2`
Layout `grid lg:grid-cols-[1fr_280px] gap-6 pb-8`, `SectionCard` **re-redéfini localement** (3ᵉ copie).

**Header** : eyebrow `Étape 1 · Cadrage`, H2 **`Configuration`**, sous-titre `Paramètres généraux de la mission, hunt mode et portail client.`
**Bandeau readOnly** : icône `Eye w-3.5` + `Lecture seule — la configuration est gérée par le lead recruteur`

**Section ⚙️ « Infos mission »** — *Identité et statut*
- `Nom de la mission` * — `DebouncedInput` (commit au **blur**, pas de debounce réel malgré le nom), placeholder `Ex: Lead Engineer @ Doctolib`
- `Client` (uniquement si `isAgency`) — `Ex: Doctolib`
- `Statut` — select natif : `🟢 Actif` · `🟡 En pause` · `🔵 Terminé` · `⚪ Archivé`
- `Lien Calendly` type=url — placeholder `https://calendly.com/...`, hint `Le lien sera utilisé pour le bouton 'Programmer un RDV' sur les conversations candidat`
- `Notes internes` — textarea rows=4, placeholder `Contexte, alertes, décisions clés...`, hint `Notes privées sur cette mission (visibles uniquement par ton équipe)`

**Section 💬 « Configuration outreach »** (masquée si readOnly) — *Influence la rédaction IA des messages de cette mission*
- `Pour qui recrutes-tu ?` — 2 boutons `grid-cols-2 px-3 py-2 rounded-lg border`, actif `border-foreground bg-foreground/5 font-medium` :
  - `Notre société (interne)` → `L'IA parle en "on / nous / chez nous"`
  - `Un client externe` → `L'IA mentionne "ton client" / cabinet externe` (défaut `client`)
- `Qui incarne l'IA ?` — select `h-9 rounded-lg` : `Talent Acquisition` · `Recruteur externe / Cabinet` (défaut) · `CTO / Directeur tech` · `Talent Lead / Head of Talent` · `Founder / CEO` · `Manager direct` · `DRH / People` · `Membre de l'équipe (peer)`
  - hint : `Adapte le ton, le wording et la posture des messages générés. Ex : un CTO parle tech, un Talent parle people, un Founder parle vision.`
- `Anonymiser le client dans les messages` — **toggle switch custom** (`relative h-6 w-11 rounded-full`, `role="switch"`, knob `h-4 w-4 translate-x-1/translate-x-6`, `bg-foreground`/`bg-muted`), désactivé si pas de client
  - hint dynamique : `Cache le nom "{client}" et le remplace par un alias générique` / `Renseigne d'abord le client dans le brief pour activer cette option` (italique)
  - si activé : champ `Alias (utilisé à la place du nom)`, placeholder `Ex: une scale-up tech française, un acteur du paiement, etc.`, hint `Si vide, l'IA utilisera "une entreprise tech française" par défaut.`
- Avertissement si `!config.recruitment_mode` : `p-3 rounded-lg bg-warning/5 border border-warning/30` → **`⚠ Pas encore configuré`** : `par défaut, l'IA considère que c'est un recrutement pour un client externe. Configure ci-dessus pour adapter le ton.`
  ⚠️ Ce toggle est **le seul switch custom** de l'espace missions ; le reste de l'app utilise `ui/switch`.

**Puis** `MissionHuntMode` et `MissionClientPortal` (masqués si readOnly).

**Sidebar** : indicateur de sauvegarde (4 états, **copie exacte** de MissionBriefV2) ; card **`Statut actuel`** (dot + `font-display text-[16px] font-bold` + description : `Sourcing, outreach et pipeline disponibles.` / `Aucune nouvelle action — la mission peut être réactivée.` / `Mission terminée — consultez le pipeline pour le bilan.` / `Mission archivée — accès en lecture seule.`) ; card **`Raccourcis`** (`Ouvrir Calendly` ou `Configure ton Calendly pour activer le bouton RDV dans l'inbox`) ; card **`💡 Conseil`** (`Le portail client permet à ton client de voir uniquement les candidats que tu as présentés, sans accès au reste de Konekt.`).
⚠️ Le `Statut actuel` réutilise les labels **avec emoji** (`🟢 Actif`) du select → emoji dupliqué à côté du dot coloré.

### 3.7 `MissionHuntMode` (dans Config)
Card `rounded-xl border border-border p-5 space-y-5 bg-card`.

**Gate org** : si `!hasFeature(orgType,'marketplace_publish')` → card `rounded-lg border p-6 text-center` + `Lock w-6 h-6` + `Le mode chasse est réservé aux entreprises.`

**Bloc activation** : icône `Target` dans `h-9 w-9 rounded-lg bg-muted`, titre `Mode chasse` (`font-display text-[14px] font-bold`), desc `Proposez cette mission aux recruteurs partenaires du cercle Konekt. Ils postulent, vous acceptez, ils sourcent avec vous.`
- Admin → bouton bascule `h-9 px-4 rounded-full text-[12px] font-semibold border` : **`Activé`** (`bg-foreground text-background`) / **`Désactivé`** (`bg-background border-border`), `Loader2` si busy
- Non-admin → texte `Mode chasse activé` / `Mode chasse désactivé`

**Badges de statut hunt** (`HUNT_STATUS_LABELS` + `HUNT_STATUS_COLORS`) :
| status | label | bg | color |
|---|---|---|---|
| `draft` | `Brouillon` | `hsl(var(--muted))` | `muted-foreground` |
| `published` | `Publiée` | `hsl(var(--accent))` | `accent-foreground` |
| `in_progress` | `En cours` | `status-info-muted` | `status-info` |
| `filled` | `Pourvue` | `status-success-muted` | `status-success` |
| `cancelled` | `Annulée` | `hsl(var(--destructive)/0.15)` | `destructive` |
+ compteur `Users w-3` `{accepted}/{max} recruteurs` (masqué en draft).

**Bandeau plan** (si `!canPublishPlan`) : `Sparkles` + `Cette mission reste publiée avec votre plan actuel.` / `La publication sur la marketplace est disponible avec le plan Entreprise.` + `Une fois retirée, vous ne pourrez la republier qu'avec le plan Entreprise.` / `Vous pouvez préparer les réglages dès maintenant.` + lien `Voir les plans` → `/pricing`.
**Bandeau deadline** : `rounded-lg border border-warning/40 bg-warning/10 p-3` → `Date limite dépassée : la mission n'est plus proposée aux recruteurs partenaires. Repoussez la date puis enregistrez pour la remettre en avant.`

**Réglages** (`grid sm:grid-cols-3`, `disabled` si `isClosed || !isAdmin`) :
- `Percent` `Rémunération (% du salaire annuel)` — number `min=5 max=30`, défaut 15
- `Users` `Recruteurs maximum` — number `min=1 max=10`, défaut 3
- `Calendar` `Date limite` — type=date
- Note : `Le recruteur facture ce pourcentage directement à votre entreprise à l'embauche. Konekt ne prend pas de commission pendant la bêta.`
- Validations (toasts) : `La rémunération doit être comprise entre 5 % et 30 % du salaire annuel` · `Le nombre de recruteurs doit être compris entre 1 et 10` · `La date limite ne peut pas être dans le passé`

**Actions de statut** (admin) :
- draft → **`Publier sur la marketplace`** (`Globe`, `bg-foreground text-background rounded-full h-9 px-4`, `disabled` si `!canPublishPlan`)
- open → **`Enregistrer les réglages`** (primaire) · **`Mission pourvue`** (outline) · **`Remettre en brouillon`** (outline) · **`Annuler la publication`** (outline `text-destructive hover:bg-destructive/10`)
- closed → **`Remettre en brouillon`**
- non-admin → `Seul un administrateur peut modifier ces réglages.`

**AlertDialogs de statut (`STATUS_ACTION_TEXT`)** :
| action | titre | description | bouton |
|---|---|---|---|
| `filled` | `Marquer la mission comme pourvue ?` | `La mission ne sera plus proposée aux recruteurs partenaires. Les recruteurs acceptés gardent leur accès et les candidatures en attente sont closes, avec une notification à leurs auteurs.` | `Mission pourvue` |
| `cancelled` | `Annuler la publication ?` | `La mission ne sera plus proposée aux recruteurs partenaires. Les candidatures en attente sont closes, avec une notification à leurs auteurs.` | `Annuler la publication` (destructive) |
| `draft` | `Remettre la mission en brouillon ?` | `La mission sort de la marketplace. Les candidatures en attente sont closes… Vous pourrez modifier les réglages puis publier de nouveau.` | `Remettre en brouillon` |
| `disabled` | `Désactiver le mode chasse ?` | `La mission sort de la marketplace. Les recruteurs déjà acceptés gardent leur accès, les candidatures en attente sont closes…` | `Désactiver` |

**Candidatures reçues** : titre `Candidatures ({n} en attente)` ; loading `Loader2 w-4` ; erreur → `ErrorBox` (`Impossible de charger les candidatures.` + `Réessayer`) ; vide → `Publiez la mission pour recevoir des candidatures de recruteurs partenaires.` (draft) / `Aucune candidature pour le moment.`
`ApplicantCard` : avatar, nom (`Recruteur partenaire` par défaut), organisation + `orgTypeLabel`, headline, `{n} an(s) d'expérience`, `{n} placement(s)`, lien `Profil LinkedIn` + `ExternalLink` (rendu **seulement si URL https linkedin.com** — garde XSS), `Candidature du {date}`, chips spécialisations (`px-1.5 py-0.5 text-[10px] rounded-full border bg-muted/50`), bio, message cité (`border-l-2 pl-3`).
Actions : **`Accepter`** (`h-8 px-3 rounded-full bg-foreground text-background text-[11.5px] font-semibold`, `disabled` si `isResponding || acceptedCount>=maxCount || !isOpen`, `title` = `La mission n'est plus ouverte aux candidatures` / `Nombre maximal de recruteurs atteint`) · **`Refuser`** (outline). Non-admin : `Seul un administrateur peut répondre.` Sinon badge `applicationStatusLabel` (`En attente` / `Acceptée` / `Non retenue` / `Retirée` / `Terminée`).

**AlertDialogs candidature** : `Accepter ce recruteur ?` / `Refuser cette candidature ?` / `Mettre fin à la collaboration ?` avec descriptions personnalisées ; boutons `Accepter` / `Refuser` / `Mettre fin` (`bg-destructive` sauf accept).

**Recruteurs partenaires** : titre `Recruteurs partenaires ({n}/{max})`, vide → `Aucun recruteur partenaire accepté sur cette mission.` ; ligne + bouton **`Mettre fin`** (outline destructive).

### 3.8 `MissionClientPortal` (dans Config)
Card `rounded-xl border border-border p-5 space-y-4 bg-card`.
- **Gate** : `!hasFeature(orgType,'client_portal')` → `Lock` + `Le portail client est réservé aux cabinets et freelances.`
- Header : `Link2` dans `h-9 w-9 rounded-lg bg-muted`, titre `Portail client` + compteur `({n})` en `tabular-nums`, desc `Lien public pour partager les candidats avec le hiring manager.`
- Bouton **`Créer un accès`** (`Plus w-3`, `h-9 px-3 rounded-full border border-border hover:bg-accent text-[12px] font-medium`)
- **Formulaire** (`rounded-lg border p-4 bg-background konekt-fade-up`) : `Nom du client *` (`Ex: Thomas Dupont`, autoFocus) · `Email (optionnel)` (`thomas@client.com`) ; boutons **`Générer le lien`** / **`Création…`** (`bg-foreground text-background rounded-full`, disabled si nom vide) et **`Annuler`**
- Validation : `toast.error('Entrez le nom du client')`
- Liste tokens : ligne `px-3 py-2 rounded-md border hover:border-foreground/30` — nom `text-[13px] font-medium`, email `text-[11px]`, `Vu {distance fr}` (`hidden sm:block`), boutons carrés `h-7 w-7 rounded-md` : `Copy`→`Check` vert 2 s (`title="Copier le lien"`), `ExternalLink` (`title="Ouvrir le portail"`, `/client/{token}`), `Trash2` (`title="Révoquer l'accès"`)
- Toasts : `Lien copié !` / `Impossible de copier — copiez manuellement : {url}`
- Vide : `Aucun accès client créé. Génère un lien pour donner accès au hiring manager.` (italique)
- **AlertDialog** : `Révoquer l'accès ?` / `Révoquer l'accès pour "{nom}" ? Le lien partagé deviendra inaccessible. Cette action est irréversible.` / `Annuler` · **`Révoquer`** (`bg-destructive`)
- ⚠️ Tutoiement (`Génère un lien`) vs vouvoiement (`Révoquer l'accès pour…`) dans le **même composant**.

---

## 4. Phase 2 — Sourcing & Outreach

### 4.1 `?tab=sourcing` — `MissionSourcing`
Pleine largeur (pas de `max-w`).
- **Loading comptes** : `bg-background border border-border p-6` + `BrutalLoader rows={2}` messages `['Chargement des comptes…']` — **card sans radius**, hors DA v2
- **Aucun compte LinkedIn** : `EmptyLinkedInAccountState` avec message `Pour lancer le sourcing, connectez d'abord un compte LinkedIn.`
- **Bandeau brief→filtres** (si `filled>=3 && jd.title && !filters_snapshot`) : `border border-border bg-accent/10 px-3 py-2 mb-2 rounded-lg` →
  `Brief rempli ({filled}/{total} champs).` (semibold) + `Générez les filtres depuis le brief pour valider chaque suggestion.`
  Bouton **`Aller au brief`** (`ArrowLeft w-3`, `h-7 px-3 text-xs font-bold uppercase tracking-wider rounded-md border bg-foreground text-background`) → `?tab=brief`
- Contenu : `<OutreachSearchProvider><LinkedInSearch …/></OutreachSearchProvider>` (délégué au module outreach, hors périmètre)
- `handleOpenSearchAgent` : construit un brief texte complet (`=== BRIEF ===` / `=== ACCÈS ===`) puis `openContextualAgent({mode:'sourcing', …})`

**`EmptyLinkedInAccountState`** (partagé Sourcing/Outreach) : `bg-background border border-border p-6 sm:p-8`, carré `w-12 h-12 border` + `Users`, `h2.text-sm.font-bold.uppercase.tracking-wider` **`Connectez votre compte LinkedIn`**, message paramétrable, bouton **`Aller dans les paramètres`** (`Settings w-3.5`, `h-9 px-6 bg-background border border-border text-xs font-medium uppercase tracking-wider`, **pas de radius**) → `/settings?tab=account`.

**`SourcingReadinessPanel`** (rendu **depuis `outreach/search/SearchResultsPanel`**, pas depuis missions/)
- `max-w-lg mx-auto space-y-5 py-4`, entrée `motion` opacity/y 8
- **Vidéo décorative** `/sourcing-empty-motion.mp4` `w-72 h-72 sm:w-96 sm:h-96 object-cover rounded-3xl` (autoplay/loop/muted/playsInline/aria-hidden)
- Titre : `Prêt à lancer la recherche` / `Configurez la recherche` (`text-lg font-semibold`)
- Sous-titre : `Filtres prêts. Lancez la recherche quand vous voulez.` / `Générez les filtres depuis le brief, ou configurez-les manuellement à gauche.`
- Pastilles : `Brief {filled}/{total}` — `accent` si ≥8, `primary` si ≥4, sinon `destructive` ; `{n} cr` (crédits) — `accent` si OK, `destructive` sinon, `...` si loading
- Boutons `h-11 w-full rounded-xl` : **`Aller au brief`** (`ArrowLeft`, `bg-foreground text-background`) si pas de filtres ; **`Lancer la recherche`** (`Search`, `bg-accent text-accent-foreground shadow-md` si actif, sinon `bg-muted/30 text-muted-foreground cursor-not-allowed`)
- Props `onAutoFill` / `autoFillLoading` marquées `@deprecated`.

### 4.2 `?tab=outreach` — `MissionOutreach`
Largeur `max-w-[960px]`. Conteneur `border border-border bg-background` (**sans radius**).
- Loading comptes / absence de compte : mêmes états, message `Pour gérer vos séquences d'outreach, connectez d'abord un compte LinkedIn.`
- Loading stats : `Loader2 h-6 w-6 animate-spin` centré `py-12`
- **Bandeau « Go »** (si `goCount>0 && enrollments===0`) : `border-b bg-success/5 p-4`, rond `w-8 h-8 rounded-full bg-success/10` + `CheckCircle2 text-success`, texte `{n} candidat(s) Go prêt(s) à être contacté(s)` + `Créez une séquence pour les inscrire automatiquement.`, bouton **`Créer une séquence`** (`h-9 px-4 text-xs font-semibold bg-foreground text-background rounded-lg` + `ArrowRight`)
- **Sélecteur de compte** (si >1) : `Compte :` + select `h-8 px-2 text-xs rounded-md`
- **Stats d'enrôlement** : `{n} inscrits` · `{n} en cours` · `{n} répondu` · `{x}% taux de réponse` (`text-success` si >0)
- **Sous-onglets** (`?outreach=`) : boutons `h-8 px-3 text-xs font-medium rounded-md border`, actif `bg-foreground text-background border-foreground` :
  - `⚡ Séquences` (défaut, param supprimé de l'URL)
  - `📨 Invitations`
  ⚠️ Style **pill bordé** ≠ style **underline** des sous-onglets du workspace → 2 grammaires d'onglets superposées à l'écran.
- Contenus rendus en permanence avec `hidden` (pas de démontage) : `<SequencesList projectId>` / `<InvitationsPanel organizationId>`

---

## 5. Phase 3 — Pipeline & Insights

### 5.1 `?tab=pipeline` — `MissionPipeline` (674 l.)
Pleine largeur. `space-y-3`.

**Loading** : `BrutalLoader rows={3}` messages `['Chargement du pipeline…']`

**Command bar** (si `totalCandidates>0`) — `bg-card border border-border rounded-xl overflow-hidden konekt-fade-up`
- *Rangée 1 — funnel cliquable* : par colonne, bouton `min-w-[84px] rounded-lg px-3 py-1.5 hover:bg-muted/40` avec valeur `font-display text-[20px] font-bold tabular-nums` (`text-muted-foreground/40` si 0) + dot coloré + label `text-3xs uppercase tracking-wider`. Entre 2 colonnes : `ChevronRight w-3` + taux de passage `{x}%` (`text-warning` si <10 %, `—` si indéfini), `title="Taux de passage vers « {label} »"`. Bloc séparé à droite pour **`Écarté`**.
- *Rangée 2 — méta* (`h-10 border-t px-4`) : `{n} candidat(s)` + `· {n} étapes` ; pastille staleness `{n} sans mouvement +7j` (`bg-warning/10 text-warning rounded-full h-6 px-2` + `Clock`) ; **toggle de vue** (`bg-muted/40 p-0.5 rounded-full border`, boutons `h-6 px-2 text-2xs rounded-full`, `aria-pressed`) : **`Table`** (`List w-3`) / **`Kanban`** (`LayoutGrid w-3`) ; `TutorialVideoDialog` titre `Le pipeline en 30 secondes`, desc `Funnel, kanban et fiches candidat : l'essentiel en vidéo.`, points : `Cliquez sur une étape du funnel pour ouvrir le board à cet endroit` / `Glissez une carte pour faire avancer un candidat dans le process` / `Cliquez sur une carte pour ouvrir la fiche complète` / `Vos étapes se personnalisent dans Cadrage → Process`

**Nudge « board générique »** (si `steps.length===0 && total>0`) : `bg-card border rounded-xl px-4 py-2.5`, carré `h-7 w-7 rounded-lg bg-brand-purple/15 text-brand-purple` + `ListChecks`, texte `Board générique.` + `Définissez vos étapes d'entretien pour piloter les candidats colonne par colonne.`, bouton **`Configurer le process`** (`h-7 px-3 rounded-full bg-foreground text-background text-2xs font-semibold` + `ArrowRight`) → `?tab=process`

**Empty pipeline** (`total===0`) : `bg-card border rounded-xl py-16 text-center`, rond `h-10 w-10 rounded-full bg-info/10 text-info` + `Users`, `h3.font-display.text-[14px].font-bold` **`Votre pipeline attend ses premiers candidats`**, texte `Lancez une recherche dans l'onglet Sourcing pour ajouter des candidats à cette mission.`

**Colonnes** — thème *sémantique* :
| clé | label | dot | ring |
|---|---|---|---|
| `untreated`/`sourced` | `Sourcé` | `bg-muted-foreground/50` | `ring-foreground/25` |
| `messaged` | `Contacté` | `bg-info` | `ring-info/40` |
| `shortlisted` (statique) | `Shortlisté` | `bg-success` | `ring-success/40` |
| étapes process (dynamiques) | `{step.name}` | rotation `bg-brand-cyan` → `bg-teal-400` → `bg-indigo-400` → `bg-brand-purple` | idem /40 |
| `hired` | `Embauché` | `bg-success` | `ring-success/40` |
| `dismissed` | `Écarté` | `bg-destructive/60` | `ring-destructive/40` |

Colonne : `flex flex-col rounded-xl bg-muted/20`, largeur `flex-1 min-w-[248px] max-w-[340px]` (Écarté : `flex-none w-[216px]`), `isOver` → `bg-muted/40 ring-1 ring-inset {theme.ring}`.
Header colonne `px-3 h-9` : dot `w-1.5 h-1.5` + `h3.text-3xs.uppercase.tracking-wider.font-semibold` (`text-destructive` pour Écarté) + compteur + badge staleness `Clock w-2.5 {n}`.
Board : `flex gap-2 overflow-x-auto thin-scrollbar pb-2 h-[calc(100dvh-340px)] min-h-[480px]` — **hauteur calculée en dur (340 px)**.

**Empty par colonne (`EMPTY_COPY`)** : `Aucun candidat sourcé` (sourced/untreated) · `Personne n'a encore été contacté` (messaged) · `Ça se joue à gauche` (hired) · `Rien à écarter, bon signe` (dismissed) · défaut `Aucun candidat` · pendant le survol de drop : `Déposer ici`.
Dans `messaged` vide : bouton **`Contacter les candidats`** (`Send w-3`, `h-7 px-3 rounded-full bg-foreground text-background text-2xs font-semibold`) → `?tab=outreach`.

**`KanbanCard`** : `bg-card border border-border rounded-lg p-2.5 cursor-grab active:cursor-grabbing interactive-card` ; overlay drag → `shadow-xl ring-1 ring-foreground/20 rotate-1 scale-[1.02]`.
- Avatar `w-7 h-7 rounded-full font-display text-3xs font-bold`, thème pseudo-aléatoire (hash du nom) parmi `brand-purple/blue/cyan/pink`, `emerald-400/15`, `amber-400/15`
- Nom `text-xs font-semibold truncate`, headline `text-2xs` (`—` si vide)
- **Badge score** : `h-[18px] px-1.5 rounded-full text-2xs font-bold tabular-nums ring-1 ring-inset` — ≥70 `bg-success/10 text-success` · ≥40 `bg-warning/10 text-warning` · <40 `bg-destructive/10 text-destructive`, `title = recommendation`
- Icône `MessageSquare text-success` si `status==='replied'` (`title="A répondu"`)
- Ancienneté `Clock` + `auj.` / `{n}j` / `{n}sem` / `{n}mois` — `text-warning font-semibold` si stale (≥7 j hors états exemptés), `title="Sans mouvement depuis {n}j"`
- Lien LinkedIn `w-5 h-5 rounded-md opacity-0 group-hover:opacity-100 hover:text-linkedin`

**Drag & drop** : `@dnd-kit` (`PointerSensor` distance 5, `rectIntersection`), garde `dragHappenedRef` contre le click fantôme.
Toasts : `{Nom} embauché !` (colonne `hired`) / `{Nom} déplacé vers « {label} »` / erreur `Erreur lors de la mise à jour`.
Mapping stage→status : `sourced|untreated→untreated`, `messaged→messaged`, `dismissed→dismissed`, `hired→shortlisted`, défaut `shortlisted`.

**Vue table** : `ProjectCandidatesTableEnhanced` (composant outreach/projects).
**Fiche candidat** : `CandidateDetailModal` (module ATS) alimenté par un objet `ATSCandidate` construit à la volée, `stageOptions` = colonnes + `Écarté`.

### 5.2 `?tab=insights` — `MissionInsights`
Conteneur `bg-background border border-border p-4 sm:p-6 space-y-6` — **aucun radius, DA v0 brutaliste**, en rupture totale avec les autres onglets.

**Vide** (`stats.total===0`) : `py-16 text-center`, emoji 💡 `text-3xl`, `h3.text-sm.font-bold.uppercase.tracking-wider` **`Pas encore de données`**, texte `Lancez une recherche dans l'onglet Sourcing pour commencer à voir les insights de cette mission.`

**Section 1 — `📊 Funnel de conversion`** : `border border-border p-4 sm:p-6`, titre `text-[10px] uppercase tracking-wider font-bold`, contenu `<ProjectFunnel>`
**Section 2 — 4 `MetricCard`** (`border border-border p-4 text-center`, valeur `text-2xl font-bold`) :
| label | valeur | sous-label | couleur |
|---|---|---|---|
| `Taux de réponse` | `{n}%` | `{r}/{t} inscrits` | success ≥20, warning ≥10, sinon destructive |
| `Temps moyen de réponse` | `{n}j` ou `—` | `délai moyen` | `text-foreground` |
| `Taux de contact` | `{n}%` | `{m}/{t} sourcés` | `text-foreground` |
| `Conversion globale` | `{n}%` | `{n} shortlistés` | success si ≥5 |

**Section 3 — `🤖 Recommandations`** : cartes `border-l-4 p-3` — high `border-destructive/40 bg-destructive/10`, medium `border-warning/40 bg-warning/10`, low `border-success/40 bg-success/10`. Bouton d'action `text-xs font-medium uppercase tracking-wider underline underline-offset-2` → `{label} →`.
| icône | titre | description | action → tab | prio |
|---|---|---|---|---|
| ⏸️ | `Mission sans activité` | `Aucune recherche lancée depuis la création il y a {n} jours. Lancez votre première recherche pour trouver des candidats.` | `Lancer le sourcing`→sourcing | high |
| ⏸️ | `Inactive depuis {n} jours` | `Relancez une recherche pour enrichir votre pipeline avec de nouveaux profils.` | `Relancer le sourcing`→sourcing | high |
| 💡 | `{n} profils non contactés` | `Vous avez {n} profils sourcés qui n'ont pas encore été contactés. Créez une séquence pour les approcher.` | `Créer une séquence`→outreach | high si >10 sinon medium |
| ⚡ | `Peu de profils sourcés` | `Seulement {n} profils trouvés. Essayez d'élargir vos filtres dans le Brief (expérience, localisation, titres).` | `Modifier le brief`→brief | medium |
| 🔥 | `Excellent taux de réponse ({n}%)` | `Votre approche fonctionne bien. Continuez à enrichir le pipeline avec de nouveaux profils.` | `Sourcer plus`→sourcing | low |
| ⚠️ | `Taux de réponse bas ({n}%)` | `Essayez de personnaliser davantage vos messages, de varier les canaux (InMail vs invitation), ou de cibler des profils avec un meilleur score.` | — | high |
| 📊 | `{n}% de profils écartés` | `Plus de la moitié des profils sont écartés. Affinez vos critères de recherche dans le Brief pour améliorer la pertinence.` | `Affiner le brief`→brief | medium |
| 📋 | `Aucun candidat shortlisté` | `{n} candidats contactés mais aucun shortlisté. Revoyez les réponses reçues dans le pipeline.` | `Voir le pipeline`→pipeline | medium |

**Section 4 — `🕐 Activité récente`** (15 derniers) : dot `w-2 h-2 rounded-full` (`bg-brand-purple` shortlisted / `bg-info` messaged / `bg-destructive/40` dismissed / `bg-muted-foreground/30`), nom, statut FR (`sourcé` / `contacté` / `shortlisté` / `écarté`), score `{n}%` coloré (≥70 success, ≥40 warning, sinon destructive), date relative fr.
⚠️ Ici le score s'affiche **avec `%`** alors que le Kanban l'affiche **sans** — même donnée, 2 unités.

---

## 6. Création de mission — `CreateMissionV2` (1136 l.)

`Dialog` shadcn, `DialogContent` : `max-w-[920px] p-0 gap-0 overflow-hidden bg-background border border-border rounded-xl max-h-[90vh] flex flex-col`. `DialogHeader` en `sr-only` (titre `Créer une nouvelle mission`, desc `Choisis comment tu veux décrire la mission : coller une fiche de poste ou remplir manuellement.`) — le header visible est custom.
Barre d'accent haut : `h-1 konekt-skalr-bg`.

**Header custom** : bouton `ArrowLeft` (`aria-label="Retour"`) si `mode!=='choose'`, sinon carré `h-8 w-8 rounded-lg konekt-skalr-bg konekt-shine` + `Sparkles` blanc. Titre/sous-titre selon le mode :
- `choose` → `Nouvelle mission` / `Comment veux-tu décrire la mission ?`
- `brief` → `Brief IA` / `Colle ta fiche de poste, l'IA extrait l'essentiel`
- `manual` → `Création manuelle` / `Remplis les champs un par un`
Bouton `X` (`aria-label="Fermer"`).

**Brouillon** : `saveEditorDraft('create-mission', …)` à la fermeture (200 ms de délai), restauration à la réouverture avec `toast.info('Brouillon repris', { description: 'Votre saisie du {date} à {heure} a été conservée.' })` (fallback `Votre saisie précédente a été conservée.`). Effacé si la création a réussi.

### 6.1 Mode `choose`
- Badge : `konekt-skalr-bg-soft` + `border: 1px solid hsl(271 81% 56% / 0.25)` inline + `Sparkles` `hsl(330 81% 70%)` → texte `konekt-skalr-text` **`Brief en 60 secondes`**
- H2 `font-display text-[28px] sm:text-[32px] font-bold` : `Décris la mission,` + `<span class="font-editorial italic font-normal">l'IA fait le reste.</span>`
- Sous-titre : `Colle une fiche de poste ou remplis les champs manuellement. À toi de choisir.`
- 2 cards `rounded-xl border px-5 py-5` :
  | value | label | desc | badge |
  |---|---|---|---|
  | `brief` (recommandé) | `Coller une fiche de poste` | `L'IA extrait le titre, les compétences, l'expérience et la localisation en quelques secondes.` | **`60 secondes`** (`konekt-skalr-bg` blanc) |
  | `manual` | `Saisir manuellement` | `Pour les briefs complexes ou multi-rôles. Tu rempliras les champs un par un.` | `5-10 min` (`bg-muted`) |
  ⚠️ Ces 2 cards **doublonnent** les 2 cards de `EmptyMissionState` (labels différents : `Créer avec l'IA` vs `Coller une fiche de poste`) pour la même action.

### 6.2 Mode `brief` — grid `lg:grid-cols-2 min-h-[440px]`
**Colonne gauche (`p-6 space-y-3 lg:border-r`)**
- `Nom (optionnel)` — `Ex: Senior React @ Doctolib` · `Client (optionnel)` — `Ex: Doctolib`
- Barre **`Importer depuis`** : bouton **`Un fichier`** (`Paperclip`, `h-7 px-2.5 rounded-full border text-[11px]`, `Loader2` si upload) — `accept=".txt,.md,text/plain,text/markdown"` ; bouton **`Une URL`** (`Link2`, toggle actif `bg-foreground text-background`) ; hint aligné à droite `TXT · MD · WTTJ · LinkedIn Jobs · careers`
- **Input URL** (dépliable) : `Globe` + input `https://www.welcometothejungle.com/fr/companies/…` + bouton **`Scanner`** (`h-7 px-3 rounded-md bg-foreground text-background`, disabled si URL invalide)
- **Bandeau détection URL** (URL collée dans le textarea) : fond inline `linear-gradient(135deg, hsl(271 81% 56% / 0.10), hsl(217 91% 60% / 0.10))` + `border 1px solid hsl(271 81% 56% / 0.3)` — `{emoji} {source} détecté — pré-remplir titre + entreprise ?` + bouton **`Pré-remplir →`** (`konekt-skalr-bg konekt-shine rounded-full h-7 px-3`)
  Sources reconnues (`detectUrlSource`) : 🌴 `Welcome to the Jungle` · 💼 `LinkedIn Jobs` / `LinkedIn` · ⚙️ `Lever` / `Workable` / `Teamtailor` · 🌱 `Greenhouse` · 🎓 `JobTeaser` · 🇫🇷 `APEC` · 🌐 `Page carrière`
- **Zone brief + drag&drop fichier** : textarea rows=10 `text-[13px] leading-relaxed rounded-md resize-none` ; placeholder multi-lignes `Colle ta fiche de poste ici, glisse-dépose un fichier, ou tape ton brief...` + exemple Doctolib. Overlay drag : `border-2 border-dashed border-foreground/40` + `Upload w-6` + `Lâche pour importer` / `TXT · MD`. Compteur : `{n} caractères · minimum 20` ou `prêt pour analyse`.
- Toasts import : `✨ {source} reconnu` (desc `Titre, entreprise et lieu pré-remplis…`, 6 s) · `Page entreprise détectée` (7 s) · `URL non reconnue` (warning, 5 s) · `📎 Fichier "{nom}" importé` · `Format {EXT} non pris en charge — utilise un fichier TXT ou MD, ou colle le contenu dans la zone brief` · `Erreur lors du scan` / `Erreur lors de la lecture du fichier`

**Colonne droite — Copilot (`p-6 bg-card/30`)**
- Header : carré `h-6 w-6 rounded-md konekt-skalr-bg` + `Sparkles`, label `Copilot prêt` / **`Copilot analyse…`** / **`Copilot a détecté`**, egaliseur 3 barres animées `hsl(330 81% 70%)` pendant l'analyse
- Repos : `Colle ton brief à gauche et clique sur **Analyser avec l'IA**.` + `En quelques secondes, l'IA détecte le titre, les compétences clés, l'expérience, la localisation et génère les filtres de recherche.`
- Analyse : 6 skeletons `h-9 rounded-md bg-muted/40 animate-pulse` avec opacité dégressive
- Résultat : lignes `px-2.5 py-2 rounded-md bg-card border` + `Check` vert — champs `Titre` (FileText) · `Rôles` (Briefcase, 3 max) · `Compétences` (Layers, 5 max) · `Expérience` (Star) · `Localisation` (MapPin) · `Catégorie` (Building2)

**Footer brief** (`border-t bg-card/50 px-6 py-3`) : statut `Clock` + `Colle ou tape ton brief (min. 20 caractères)` / `Prêt pour analyse` / `Brouillon prêt · {n} infos extraites`
- Bouton **`Analyser avec l'IA`** (`h-9 px-5 rounded-full konekt-skalr-bg konekt-shine`, disabled `<20 car.`) → puis remplacé par **`Créer la mission`** (`Check` + `ArrowRight`)
- Toasts : `Le brief est trop court (minimum 20 caractères)` · `Analyse terminée — vérifie et crée la mission` · `Erreur lors de l'analyse`
- Redirection après création : `?tab=sourcing` si analyse effectuée, sinon `?tab=brief`

### 6.3 Mode `manual` (`px-8 py-8 max-w-xl mx-auto space-y-4`)
- `Titre de la mission *` — `Ex: Senior React Engineer`, `h-10`, autoFocus
- `Client / Entreprise (optionnel)` — `Ex: Doctolib`, `h-10`
- `Description (optionnel)` — textarea rows=6, `Quelques lignes pour décrire la mission, le contexte, les enjeux…`
- Note : `Tu pourras compléter le brief, ajouter des compétences et lancer l'analyse IA après création.`
- Footer : **`Annuler`** (`h-9 px-4 rounded-full border`) / **`Créer la mission`** (`konekt-skalr-bg`, disabled si titre vide) ; validation `toast.error('Le titre est requis')` ; redirection `?tab=brief`
- ⚠️ Les inputs manuels sont en `h-10` alors que tout le reste de l'espace missions est en `h-9`.

---

## 7. `/mission-invite/:token` — `AcceptMissionInvite`
`min-h-screen bg-background flex items-center justify-center p-6`, contenu `text-center max-w-md space-y-4`.
| État | Rendu |
|---|---|
| `loading` | `Loader2 w-8 h-8 animate-spin text-foreground` + `Acceptation de l'invitation...` (`text-sm text-muted-foreground`) |
| `success` | `CheckCircle2 w-8 h-8` + `h1.text-sm.font-bold.uppercase.tracking-wider` **`Invitation acceptée`** + `Vous avez été ajouté à la mission. Vous pouvez maintenant sourcer et proposer des candidats.` + bouton **`Voir la mission`** (`h-9 px-6 bg-foreground text-background border border-border text-xs font-medium uppercase tracking-wider`, **sans radius**) |
| `error` | emoji 🔒 `text-4xl` + **`Invitation invalide`** + `Ce lien d'invitation n'est plus valide ou a expiré. Contactez le recruteur qui vous a invité.` + lien texte **`Retour aux missions`** (`text-sm underline hover:opacity-70`) |

---

## 8. Récapitulatif transverse

### 8.1 Tous les boutons primaires « gradient Skalr »
`konekt-skalr-bg konekt-shine` : `Nouvelle mission` (liste) · `Analyser avec l'IA` (brief, footer create) · `Créer la mission` (×2) · `Réoptimiser avec l'IA` (process) · `Suggestion IA basée sur le brief` (process empty) · `Pré-remplir →` (create) · badge `60 secondes` · barre d'accent du dialog · icônes carrées d'en-tête.
Tailles : `h-10 px-5` (liste), `h-9 px-4` (brief/process), `h-9 px-5` (footer create), `h-10` (process empty), `h-7 px-3` (pré-remplir) → **5 tailles pour le même bouton primaire**.

### 8.2 Toasts (texte exact, tous fichiers du périmètre)
`Quota de missions atteint` · `Impossible de créer la mission` · `Projet supprimé` · `Projet créé avec succès` / `Recherche créée` · `Erreur: {message}` ·
`Complétez les étapes précédentes.` · `Complétez les étapes précédentes pour débloquer cette phase.` · `{blockerMessage}` (voir §2.4) ·
`Renseigne au moins le titre ou la description pour analyser` · `Erreur lors de l'analyse` · `Filtres sauvegardés — direction sourcing` · `Erreur lors de la sauvegarde` · `Dictée enregistrée` ·
`Erreur de connexion Deepgram` · `Accès au microphone refusé. Vérifiez les permissions du navigateur.` · `Aucun microphone détecté.` · `Erreur au démarrage` ·
`Process « {label} » appliqué · {n} candidat(s) repositionné(s)` / `Process créé` · `Membre assigné à la mission` · `Ce membre est déjà assigné à cette mission` · `Membre retiré de la mission` ·
`Invitation envoyée par email` · `Invitation annulée` · `Invitation acceptée — vous avez accès à la mission` · `Lien d'invitation copié` · `Lien : {url}` ·
`Lien copié !` · `Impossible de copier — copiez manuellement : {url}` · `Entrez le nom du client` ·
`La rémunération doit être comprise entre 5 % et 30 % du salaire annuel` · `Le nombre de recruteurs doit être compris entre 1 et 10` · `La date limite ne peut pas être dans le passé` ·
`{Nom} embauché !` · `{Nom} déplacé vers « {label} »` · `Erreur lors de la mise à jour` ·
`Le brief est trop court (minimum 20 caractères)` · `Analyse terminée — vérifie et crée la mission` · `Le titre est requis` · `Brouillon repris` · `✨ {source} reconnu` · `Page entreprise détectée` · `URL non reconnue` · `📎 Fichier "{nom}" importé` · `Format {EXT} non pris en charge…` · `Erreur lors du scan` · `Erreur lors de la lecture du fichier`.

### 8.3 Tous les dialogs de l'espace missions
| # | Composant | Type | Titre |
|---|---|---|---|
| 1 | ProjectsListV2 | AlertDialog | `Supprimer cette mission ?` |
| 2 | CreateMissionV2 | Dialog (920 px) | `Créer une nouvelle mission` (sr-only) |
| 3 | MissionBriefV2 | Portal custom `z-[4000]` | `Filtres proposés` |
| 4 | MissionProcessV2 | AlertDialog | `Remplacer les {n} étapes actuelles ?` |
| 5 | MissionTeamSection | AlertDialog | `Retirer ce membre ?` |
| 6 | MissionHuntMode | AlertDialog | 4 variantes de statut |
| 7 | MissionHuntMode | AlertDialog | 3 variantes de candidature |
| 8 | MissionClientPortal | AlertDialog | `Révoquer l'accès ?` |
| 9 | MissionPipeline | `CandidateDetailModal` (ATS) | fiche candidat |
| 10 | MissionPipeline | `TutorialVideoDialog` | `Le pipeline en 30 secondes` |

---

## 9. ANOMALIES DESIGN

### 9.1 Valeurs en dur — typographie arbitraire
Aucune échelle typo n'est respectée. Recensement des `text-[Npx]` uniques dans le périmètre :
`text-[10px]` · `text-[10.5px]` · `text-[11px]` · `text-[11.5px]` · `text-[12px]` · `text-[12.5px]` · `text-[13px]` · `text-[14px]` · `text-[15px]` · `text-[16px]` · `text-[20px]` · `text-[22px]` · `text-[24px]` · `text-[26px]` · `text-[28px]` · `text-[30px]` · `text-[32px]`
→ **17 tailles arbitraires** cohabitant avec les tokens Tailwind `text-3xs` (10px), `text-2xs` (11px), `text-xs`, `text-sm`, `text-lg`, `text-2xl`, `text-4xl`. Les mêmes 10 px sont écrits `text-[10px]` (brief/process/config) **et** `text-3xs` (pipeline) selon le fichier.
Cas absurdes : `text-[10.5px]`, `text-[11.5px]`, `text-[12.5px]` (`MissionOverviewV2`, `PhaseStepper` `text-[12.5px]`).

### 9.2 Couleurs hors tokens
- `VoiceDictation.tsx` : `border-red-600 bg-red-600 text-white`, `bg-red-500`, `bg-red-600` — **rouges Tailwind bruts**, aucun token
- `MissionPipeline.tsx` : `bg-teal-400`, `bg-indigo-400`, `bg-emerald-400/15`, `bg-amber-400/15`, `text-amber-300`, `text-emerald-400` — palette Tailwind brute pour les thèmes de colonnes et d'avatars
- `Pill.tsx` variant `ai` : `linear-gradient(135deg, hsl(271 81% 56% / 0.18), hsl(330 81% 60% / 0.18))`, `color: hsl(330 81% 75%)`, `border 1px solid hsl(271 81% 56% / 0.3)` — **HSL littéral, non tokenisé, non theme-aware** (illisible en light mode)
- `CreateMissionV2.tsx` : `hsl(330 81% 70%)` (×2), `hsl(271 81% 56% / 0.25)`, gradient `hsl(271 81% 56% / 0.10)` → `hsl(217 91% 60% / 0.10)`, `border 1px solid hsl(271 81% 56% / 0.3)` — mêmes valeurs recopiées, aucune variable
- `index.css` `.konekt-skalr-*` : gradient `hsl(271 81% 56%) → hsl(330 81% 60%) → hsl(217 91% 60%)` en dur dans le CSS, dupliqué ensuite en inline dans 4 composants TSX
- `ProjectsListV2.MissionCard` : `background: ${statusCfg.color}1a` où `color = 'hsl(var(--status-success))'` → produit `hsl(var(--status-success))1a`, **CSS invalide** ⇒ le fond du badge de statut est en réalité transparent
- Deux systèmes de statut parallèles : classes utilitaires (`bg-success`, `text-warning`, `border-success/30`) vs variables inline (`hsl(var(--status-success))`) — souvent dans le même écran (`shared.tsx` mélange les deux dans un même badge : `border-warning/40` + `style={{background:'hsl(var(--status-warning-muted))'}}`)

### 9.3 Gradients `konekt-*` — inventaire des usages
| Classe | Usages dans le périmètre |
|---|---|
| `konekt-skalr-bg` | 10 (boutons IA, barre dialog, badges, carrés d'icônes) |
| `konekt-skalr-bg-soft` | 1 (badge `Brief en 60 secondes`) |
| `konekt-skalr-text` | 2 (`Brief en 60 secondes`, label de source URL) |
| `konekt-shine` | 8 (systématiquement couplé à `konekt-skalr-bg`) — **animation infinie non désactivable, ignore `prefers-reduced-motion`** |
| `konekt-fade-up` | 12 (overview ×3, brief ×2, process ×3, pipeline ×4, create ×5, portal ×1) avec des `animationDelay` inline en dur (`120ms`, `180ms`, `{i*50}ms`, `{i*80}ms`) |
| `konektPulseDot` | animation inline dans `Pill` (`animation: 'konektPulseDot 1.6s …'` en JS, pas en classe) |
`konekt-glow` et `konekt-shimmer-text` sont définis dans `index.css` mais **jamais utilisés** dans l'espace missions.

### 9.4 Incohérences de radius
| Contexte | Radius |
|---|---|
| Cards de section (brief/process/config/overview/pipeline command bar) | `rounded-xl` |
| Cards sidebar (save indicator, KPI, conseil) | `rounded-lg` |
| Inputs, selects, textareas | `rounded-md` |
| Input « Description » de `StepCard` | `rounded-lg` ← seul input en `lg` |
| Selects de `MissionTeamSection` | `rounded-lg` ← idem |
| Boutons primaires IA / pills | `rounded-full` |
| Boutons secondaires (Ajouter, Annuler…) | `rounded-md` |
| Vidéo `SourcingReadinessPanel` | `rounded-3xl` ← unique dans l'app |
| `MissionInsights`, `MissionOutreach`, `EmptyLinkedInAccountState`, `FilterReviewModal`, `AcceptMissionInvite`, `EmptyMissionState`, `PartnerMissionsSection` (bouton) | **aucun radius** (héritage brutaliste v0) |

### 9.5 Incohérences de spacing
- 4 largeurs max empilées sur la même page : `1600px` (wrapper page) → `1200px` (ProjectsListV2) / `1280px` (brief/process/config) / `960px` (overview/outreach/insights) / `920px` (contenu interne de `MissionOverviewV2` **et** dialog create) / `max-w-lg` (SourcingReadinessPanel)
- Padding horizontal du workspace : header `px-4 sm:px-5`, stepper `px-4 sm:px-5`, body `px-3 sm:px-6 lg:px-8` → **désalignement visible** entre le chrome et le contenu
- Padding vertical du body : `py-2 sm:py-3` (très serré) alors que chaque vue ajoute son propre `pb-8`
- Sidebars : toujours `280px` en dur (`lg:grid-cols-[1fr_280px]`) répété 3×
- Hauteurs magiques : `h-[calc(100dvh-340px)] min-h-[480px]` (kanban), `left-[30px]` (ligne de timeline process), `max-h-[150px]` (transcript), `min-w-[248px] max-w-[340px]` / `w-[216px]` (colonnes), `min-w-[84px]` / `min-w-[72px]` (funnel), `h-[18px]` (badge score), `w-[120px]` / `w-[140px]` / `w-[200px]` (chips modal)
- Hauteurs de contrôles : `h-6` (toggle vue), `h-7` (boutons compacts), `h-8` (sous-onglets outreach), `h-9` (standard), `h-10` (bouton Nouvelle mission, inputs du mode manuel), `h-11` (SourcingReadinessPanel), `h-12` (CTA EmptyMissionState) → **7 hauteurs de bouton**

### 9.6 Duplications de composants
| Élément dupliqué | Emplacements |
|---|---|
| `SectionCard` (emoji + titre + sous-titre) | **3 copies quasi identiques** : `MissionBriefV2:370`, `MissionProcessV2:410`, `MissionConfigV2:270` (seule différence : `space-y-3` dans le corps) |
| Indicateur d'auto-save 4 états | **2 copies identiques** : `MissionBriefV2:261-288`, `MissionConfigV2:180-207` |
| `DebouncedInput` / `TextInput` | 2 implémentations divergentes (controlled+debounce 800 ms vs uncontrolled+blur) pour le même rendu visuel |
| Card « 💡 Conseil » | 3 copies (brief, process, config) |
| Card de mission | `ProjectsListV2.MissionCard` vs `PartnerMissionsSection` (mêmes classes, code séparé) |
| Chips/tags | 4 grammaires : `TagsInput` (rounded-full, tokens status), `EditableChip` du FilterReviewModal (carré, `font-display font-bold`), objectifs de `StepCard` (`rounded-md bg-accent/50` + `☑`/`×` textuels), spécialisations de `ApplicantCard` (`rounded-full border bg-muted/50`) |
| Barre de sous-onglets | underline (`MissionWorkspaceV2`) vs pills bordées (`MissionOutreach`) — **affichées simultanément** |
| Empty state de création | `EmptyMissionState` (2 cards animées) vs `CreateMissionV2.ChooseMode` (2 cards) — même choix, 2 designs |
| Templates de process | `PROCESS_TEMPLATES` (`process/shared.tsx`) vs `DEFAULT_STEPS` (`useMissionProcess.ts`) — le `standard` est recopié à l'identique |
| Labels de statut hunt/contrat/remote | `types/jobDetails.ts` (`REMOTE_LABELS`: `Full remote`) vs `marketplace/huntLabels.ts` (`REMOTE_LABELS`: `Télétravail à 100 %`) — **même nom d'export, valeurs différentes** |
| Drag & drop | HTML5 natif (`StepCard`) vs `@dnd-kit` (`MissionPipeline`) |

### 9.7 Code mort / fichiers orphelins dans `src/components/missions/`
- **`FilterWizard.tsx` (762 lignes) — 0 importeur.** Doublon de `src/components/outreach/filter-wizard/FilterWizard.tsx` (seul réellement utilisé, exporté via `index.ts`).
- **`PedigreePresetSelector.tsx` (332 lignes) — 0 importeur** (seulement cité dans un commentaire de `pedigree/PedigreeRequirementsEditor.tsx`). C'est **le seul composant du dossier à utiliser les primitives shadcn** (`Button`, `Badge`, `Select`, `Dialog`) — l'unique morceau conforme au design system est inutilisé.
- `SourcingReadinessPanel.tsx` vit dans `missions/` mais n'est consommé que par `outreach/search/SearchResultsPanel.tsx` (props `onAutoFill`/`autoFillLoading` `@deprecated`).
- `MissionOverviewV2` : `computeNextStep()` + 5 imports d'icônes conservés « au cas où la décision serait revertée » ; `useMissionReadiness(project)` appelé pour rien.
- `MissionWorkspaceV2` : `NARROW_SUBS` contient `brief|process|config` puis les exclut par 3 conditions `&&` — logique inversée illisible.
- `PhaseStepper` : `Phase.desc` jamais rendu, `rightSlot` jamais fourni.

### 9.8 Autres anomalies de conception
- **Ton** : tutoiement (`Tes missions`, `Colle ta fiche`, `Choisis un template`, `Génère un lien`) et vouvoiement (`Lancez votre première mission`, `Connectez votre compte`, `Vous avez {n} profils`, `Révoquer l'accès pour…`) coexistent, parfois dans le même fichier (`MissionClientPortal`, `MissionInsights` vs `MissionBriefV2`).
- **Emojis en UI de production** : `🔒` (onglet verrouillé), `👁️` (readOnly process), `💡`, `⚡`, `📍`, `📦`, `🏗️`, `🎯`, `👥`, `📝`, `🏢`, `👤`, `⚙️`, `💬`, `🟢🟡🔵⚪` (options de statut), `🟢🟡🟠🔴` (urgence), `🔧🤝🌟🎯💼` (catégories de critères), `🎥📞🤝` (formats), `→` et `✓` (bullets de timeline), `☑` et `×` (chips d'objectifs), `⚠` (avertissement config), `⏸️🔥📊📋` (insights), `✨📎` (toasts). **Aucune iconographie unifiée** : lucide, emojis et SVG maison (logos Teams/Zoom/Meet, LinkedIn/Gmail/Slack/HubSpot/Salesforce) cohabitent.
- **Accessibilité** : boutons `disabled` signalés uniquement par `opacity-40`/`opacity-50` ; verrouillage de phase sans libellé textuel ni `aria-disabled` explicite ; `EmptyMissionState` = boutons imbriqués (`ShimmerButton` dans `motion.button`, neutralisé par `pointer-events-none`) ; toggle d'anonymisation custom sans `aria-label`.
- **Sémantique score** : `{n}` (kanban), `{n}%` (insights), seuils 70/40 recopiés dans 3 fichiers.
- **`h-screen` + `overflow-hidden`** sur le workspace ⇒ le contenu est scrollé dans un conteneur interne ; combiné à `h-[calc(100dvh-340px)]` du kanban, la hauteur est calculée deux fois de manière indépendante.
