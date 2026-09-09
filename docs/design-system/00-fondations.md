# 00 — Fondations & audit quantitatif transverse

Relevé du 2026-09-09 sur la branche `claude/app-details-exhaustifs-s6nf9t`.
532 fichiers `.ts/.tsx` sous `src/`, dont 105 616 lignes de `.tsx`.

## 1. Tokens actuels (`src/index.css`)

Thème **dark par défaut** sur `:root`, thème clair sous la classe `.light` posée sur `<html>`
(bascule dans `AppSidebar.tsx:83-91` et `layout/NavigationPalette.tsx:65-68`, persistée dans
`localStorage['konekt-theme']`, réappliquée au boot dans `main.tsx:108`).

### 1.1 Rampe shadcn (HSL, sans `hsl()`)

| Token | Dark | Light |
|---|---|---|
| `--background` | `40 3% 11%` | `0 0% 98%` |
| `--foreground` | `0 0% 98%` | `40 3% 11%` |
| `--card` | `40 3% 14%` | `0 0% 100%` |
| `--popover` | `40 3% 16%` | `0 0% 100%` |
| `--primary` | `0 0% 98%` | `40 3% 11%` |
| `--secondary` / `--muted` | `40 3% 18%` | `40 3% 95%` |
| `--accent` | `40 3% 20%` | `40 3% 93%` |
| `--muted-foreground` | `40 2% 56%` | `40 3% 46%` |
| `--destructive` | `0 72% 51%` | identique |
| `--border` | `0 0% 100% / 10%` | `40 3% 90%` |
| `--input` | `0 0% 100% / 12%` | `40 3% 90%` |
| `--ring` | `0 0% 100% / 25%` | `40 3% 60%` |
| `--radius` | `0.75rem` | idem |

Teinte de base commune : **40° (beige/warm grey)**, saturation 2–3 %. Le dark n'est pas neutre,
il est légèrement chaud — c'est le seul marqueur chromatique de la marque dans l'app authentifiée.

Le dark utilise des **bordures en alpha** (`0 0% 100% / 10%`) alors que le light utilise une
**couleur opaque** (`40 3% 90%`). Deux modèles de bordure différents selon le thème.

### 1.2 Sidebar (8 tokens dédiés)
`--sidebar-background` `40 3% 8%` (dark) / `40 3% 96%` (light), + foreground, primary,
primary-foreground, accent, accent-foreground, border, ring.

### 1.3 Statuts sémantiques
`--status-success` `142 71% 45%`, `--status-warning` `45 93% 47%`, `--status-info` `217 91% 60%`,
chacun avec `-foreground` et `-muted`. Exposés en Tailwind sous `success` / `warning` / `info`.
**Il n'existe pas de `--status-danger`** : l'erreur passe par `--destructive`, qui sert aussi aux
actions destructives. Deux sens portés par un seul token.

### 1.4 Marque
`--skalr-purple` `271 81% 56%`, `--skalr-pink` `330 81% 60%`, `--skalr-blue` `217 91% 60%`,
`--skalr-cyan` `187 85% 53%`, `--skalr-green` `142 71% 45%`. Exposés sous `brand.purple`, etc.
Le préfixe `skalr` est l'ancien nom du produit ; le produit s'appelle Konekt.
`--skalr-blue` et `--status-info` ont **la même valeur** ; `--skalr-green` et `--status-success` aussi.

### 1.5 Marques tierces
`--brand-linkedin` `201 100% 35%` + hover, `--brand-whatsapp` `142 70% 49%`.

### 1.6 Surfaces landing
`--landing-sky-start` `200 80% 95%`, `--landing-sky-end` `220 70% 92%`, `--landing-accent-yellow`
`50 100% 60%`. Utilisées uniquement par la landing et l'onboarding, en clair, y compris quand
l'app est en dark.

### 1.7 Charts
`--chart-1..5` (violet, cyan, vert, rose, jaune). **Valeurs identiques en dark et en light** —
non compensées pour le contraste sur fond sombre.

### 1.8 Le second système : tokens `--k-*`

Introduit pour la refonte de la recherche, en registre « Linear/Qonto ». 26 variables,
déclarées en **valeurs complètes** (`hsl(...)` / `rgba(...)`) et non en triplets, donc
consommées via `bg-[var(--k-surface)]` et non via des classes Tailwind sémantiques.

Échelle de surfaces : `--k-bg` `hsl(40 4% 8.5%)` → `--k-surface` 11% → `--k-surface-2` 14%
→ `--k-surface-3` 16.5%. Trois niveaux de hairline (`--k-hairline` .06, `-hover` .10, `-focus` .14).
Quatre niveaux de texte (`--k-text`, `-2`, `-muted`, `-placeholder`). Un accent indigo unique
`--k-accent` `hsl(250 42% 70%)` avec hover / press / ring / tint / on-accent.

**C'est un design system parallèle et plus complet que le système shadcn officiel** (échelle de
surfaces explicite, échelle de texte explicite, états d'accent explicites). Il ne couvre qu'une
zone de l'app.

### 1.9 Ombres
9 niveaux (`--shadow-2xs` → `--shadow-2xl`), redéfinis en light avec des alphas plus faibles.
Seuls `shadow-sm` (86), `shadow-md` (39), `shadow-lg` (39) et `shadow` (36) sont réellement
employés ; `shadow-2xs`, `shadow-xs` ne sont jamais appelés depuis le JSX.

### 1.10 Variables orphelines
`--tracking-normal: 0em` et `--spacing: 0.25rem` sont déclarées et jamais lues.

## 2. Typographie

### 2.1 Familles déclarées (`tailwind.config.ts`)
| Classe | Pile |
|---|---|
| `font-sans` (défaut body) | Instrument Sans |
| `font-display` | Outfit |
| `font-brand` | Bricolage Grotesque → Outfit |
| `font-serif` / `.font-editorial` | Instrument Serif |
| `font-mono` | Space Mono |

`h1, h2, h3` sont forcés en **Outfit 700** par une règle globale dans `@layer base`, ce qui rend
`font-display` redondant sur les titres et rend impossible un titre en poids 500 sans surcharge.

Usage réel : `font-display` 168, `font-mono` 108, `font-editorial` 19, `font-brand` 3, `font-sans` 2.
**Bricolage Grotesque est déclaré mais quasi inutilisé.**

`body` est en `font-medium` global : le poids « normal » du produit est 500, donc `font-medium`
appliqué localement (843 occurrences) est le plus souvent un no-op.

### 2.2 Échelle réellement utilisée

Classes Tailwind :

| Classe | Occurrences |
|---|---|
| `text-xs` | 1 839 |
| `text-sm` | 676 |
| `text-3xs` (10px, ajout maison) | 181 |
| `text-2xs` (11px, ajout maison) | 155 |
| `text-lg` | 80 |
| `text-base` | 63 |
| `text-xl` | 52 |
| `text-2xl` | 50 |
| `text-4xl` | 25 |
| `text-5xl` / `text-3xl` | 16 chacun |
| `text-6xl` | 5 |
| `text-7xl` | 1 |

Valeurs arbitraires en parallèle — **1 122 occurrences de tailles en pixels en dur** :

| Classe | Occurrences |
|---|---|
| `text-[10px]` | 380 |
| `text-[11px]` | 255 |
| `text-[12px]` | 119 |
| `text-[13px]` | 108 |
| `text-[11.5px]` | 64 |
| `text-[10.5px]` | 38 |
| `text-[14px]` | 33 |
| `text-[15px]` | 27 |
| `text-[12.5px]` | 24 |
| `text-[16px]`, `text-[13.5px]` | 6 chacun |
| `text-[20px]`, `text-[9px]`, `text-[24px]`, `text-[28px]` | 4–6 chacun |

Le commentaire de `tailwind.config.ts` annonce que `text-3xs`/`text-2xs` existent précisément pour
« bannir l'usage de `text-[Npx]` arbitraires (8px / 9.5px / 10.5px / 11.5px) ». Les paliers ont été
ajoutés, la migration n'a pas eu lieu : `text-[10px]` (380) est plus fréquent que `text-3xs` (181)
qui vaut exactement la même chose.

**Le corps de texte réel de l'app tourne autour de 10–13 px.** L'échelle nominale (`text-xs` = 12px)
et l'échelle en dur se recouvrent sans se remplacer : 10 / 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 13.5 /
14 / 15 px coexistent, soit **10 paliers dans une plage de 5 px**.

### 2.3 Graisses
`font-medium` 843, `font-bold` 727, `font-semibold` 438, `font-normal` 53, `font-black` 29,
`font-extrabold` 2. Six graisses en circulation ; `font-bold` sur du texte de 10–11 px est un
motif fréquent.

## 3. Espacement, rayons, ombres

### 3.1 Gouttières
`gap-2` 750, `gap-1.5` 553, `gap-1` 493, `gap-3` 336, `gap-4` 80, `gap-2.5` 76, `gap-0.5` 68,
`gap-6` 16, `gap-5` 6, `gap-8` 4, `gap-3.5` 4.
L'app vit entre 4 et 12 px. Les demi-pas (`1.5`, `2.5`, `3.5`) représentent 633 usages.

### 3.2 Paddings
`px-3` 338, `px-2` 318, `p-3` 232, `py-0.5` 214, `px-4` 193, `px-1.5` 173, `p-4` 171,
`py-2` 147, `py-1.5` 140, `px-1` 107, `p-2` 101, `px-2.5` 100, `py-3` 94, `py-1` 93,
`px-6` 91, `px-5` 70, `py-4` 65, `py-2.5` 61, `p-6` 58.
Aucune règle « padding de carte » ni « padding de page » n'émerge : `p-3`, `p-4` et `p-6`
cohabitent sur des conteneurs de même niveau.

### 3.3 Rayons
`rounded-full` 566, `rounded-lg` 464 (= `--radius` 12px), `rounded-md` 309 (10px),
`rounded-xl` 203 (16px), `rounded` 151 (**4px, hors échelle du design system**),
`rounded-sm` 40 (8px), `rounded-2xl` 21 (24px), `rounded-none` 2, `rounded-3xl` 2.
Sept rayons plus les rayons partiels. `rounded` (151 usages) ne dérive pas de `--radius` :
c'est le défaut Tailwind à 0.25rem, il ne suit donc pas un changement de `--radius`.

### 3.4 Hauteurs de contrôle
`h-8` 296, `h-7` 283, `h-9` 269, `h-10` 100, `h-12` 50, `h-11` 19.
(`h-4` 688, `h-5` 176, `h-6` 131 sont majoritairement des icônes.)
Quatre hauteurs de contrôle principales — 28, 32, 36, 40 px — sans correspondance claire avec les
`size` du bouton shadcn.

### 3.5 Largeurs de conteneur
`max-w-md` 53, `max-w-full` 37, `max-w-2xl` 33, `max-w-xs` 22, `max-w-lg` 17, `max-w-3xl` 13,
`max-w-sm` 11, `max-w-6xl` 7, `max-w-5xl` 6, `max-w-xl` 5, plus des valeurs en dur :
`max-w-[1600px]` 9, `max-w-[1200px]` 5, `max-w-[1280px]` 4, `max-w-[640px]` 3, `max-w-[600px]` 3,
`max-w-[520px]` 3, et une douzaine de largeurs de troncature (`max-w-[200px]`, `[180px]`, `[160px]`,
`[150px]`, `[140px]`, `[120px]`…).
**Trois largeurs de page différentes** (1200, 1280, 1600) selon l'écran.

### 3.6 Z-index
`z-10` 72, `z-50` 22, `z-20` 13, `z-40` 6, `z-30` 5, puis en dur :
`z-[9999]` 12, `z-[9998]` 4, `z-[6000]` 1, `z-[4000]` 4, `z-[2100]` 2, `z-[200]` 1, `z-[100]` 2,
`z-[70]` 1, `z-[60]` 1, `z-[1]` 1.
Aucune échelle de calques nommée. Les overlays Radix sont à `z-50` et sont donc franchis par tout
`z-[9999]` maison.

## 4. Couleurs hors tokens

### 4.1 Hex en dur : 34 occurrences, 8 fichiers
`AnimatedOrb.tsx`, `assistant-ui/connector-logos.tsx` (logos Google/Microsoft — légitime),
`ui/chart.tsx` (mort), `outreach/search/SourcingFlow.tsx`, `outreach/result-card/CardActions.tsx`,
`settings/MyLinkedInAccount.tsx`, `settings/LinkedInSafetySettings.tsx`, `pages/Auth.tsx`.
Valeurs notables : `#e06666` ×4 (utilisé via `text-[var(--k-bad,#e06666)]` — un token `--k-bad`
qui **n'existe pas** dans `index.css`, donc c'est toujours le fallback qui s'applique),
`#260513` ×4, `#c026d3`, `#7c3aed`, `#4f46e5`, `#50D9FF`, `#64748B`.

### 4.2 Palette Tailwind brute : 394 occurrences
`bg-emerald-500` 79, `bg-amber-500` 15, `border-emerald-500` 15, `text-emerald-400` 14,
`text-amber-400` 14, `border-amber-500` 14, `text-emerald-700` 12, `text-emerald-600` 11,
`text-amber-700` 11, `text-amber-600` 11, `bg-cyan-500` 9, `bg-violet-500` 7, `text-emerald-500` 7,
`text-amber-500` 7, `bg-purple-500` 4, `text-green-500` 4, `bg-indigo-500` 3, `bg-green-950` 3…

`emerald` et `amber` doublonnent `success` et `warning`, qui existent en token et sont
utilisés en parallèle (`bg-success` 199, `text-success` 173, `text-warning` 169, `bg-warning` 164).
**Le même statut est donc peint de deux façons selon le fichier**, avec des valeurs différentes
(`--status-success` = `142 71% 45%` ≠ `emerald-500` = `160 84% 39%`).

`violet` / `purple` / `indigo` doublonnent `--skalr-purple`.

### 4.3 Usage des tokens sémantiques (pour comparaison)
`text-muted-foreground` 2 388, `border-border` 1 505, `text-foreground` 1 439, `bg-muted` 697,
`bg-background` 450, `bg-foreground` 416, `text-destructive` 318, `bg-destructive` 278,
`text-background` 238, `bg-accent` 237, `bg-success` 199, `bg-card` 177.

`bg-foreground` (416) + `text-background` (238) est le motif du bouton primaire inversé, utilisé
à la main plutôt que par `variant="default"` du Button (15 occurrences seulement).

## 5. Iconographie

**1 876 imports lucide-react, 217 icônes distinctes, dans 264 fichiers.** Aucune autre librairie
d'icônes (Phosphor a disparu depuis l'audit d'avril).

Top : `Loader2` 105, `Sparkles` 68, `X` 63, `Clock` 54, `Briefcase` 52, `Check` 50, `Plus` 48,
`Users` 44, `CheckCircle2` 44, `Mail` 42, `AlertTriangle` 41, `ChevronDown` 41, `ArrowRight` 40,
`MessageSquare` 36, `Building2` 36, `Search` 35, `Target` 34, `ExternalLink` 33, `Trash2` 31.

**60 icônes ne sont utilisées qu'une seule fois.**

Doublons sémantiques : `CheckCircle2` (44) vs `CheckCircle` (10) ; `AlertTriangle` (41) vs
`AlertCircle` (21) ; `MessageSquare` (36) vs `MessageCircle` (11).

Tailles : `h-4 w-4` domine (688 `h-4`), puis `h-5` 176, `h-6` 131. Pas de token de taille d'icône.

## 6. Composants : ce qui est utilisé, ce qui est mort

### 6.1 Fréquence d'usage des primitives (occurrences de balise)
`Badge` 127, `Select` 92, `Skeleton` 55, `AlertDialog` 43, `Tooltip` 43, `Dialog` 37,
`Checkbox` 34, `Switch` 23, `ScrollArea` 21, `Popover` 20, `DropdownMenu` 17, `Collapsible` 15,
`Avatar` 11, `Sheet` 10, `Progress` 8, `Tabs` 7, `Table` 4, `HoverCard` 2, `Separator` 2,
`Command` 1, `RadioGroup` 1.

`AlertDialog` (43) dépasse `Dialog` (37) : la confirmation destructive est bien systématisée.
Une seule occurrence de `window.confirm` subsiste.

### 6.2 Composants `ui/` jamais importés — 15 fichiers morts
`accordion`, `aspect-ratio`, `background-paths`, `breadcrumb`, `calendar`, `carousel`, `chart`,
`drawer`, `form`, `slider`, `text-rotate`, `toggle-group`, `use-toast`, `AnimatedChatBubble`,
`AnimatedCompass`.

Conséquences :
- `form.tsx` mort ⇒ **`react-hook-form` n'est utilisé nulle part** et **`zod` n'est importé dans aucun fichier**. Toute la validation de formulaire est écrite à la main.
- `calendar.tsx` mort ⇒ la page `/calendar` (924 lignes) réimplémente sa propre grille.
- `chart.tsx` mort ⇒ `recharts` n'est importé que par `outreach/SequenceAnalytics.tsx`. Les autres vues d'analytics dessinent leurs graphiques à la main.
- `use-toast.ts` mort ⇒ un seul système de toast en service (**sonner**, 93 fichiers), mais `toast.tsx` + `toaster.tsx` + `use-toast.ts` restent en dépôt.
- `breadcrumb.tsx` mort ⇒ aucun fil d'Ariane dans une app à 3 niveaux de profondeur (`/missions/:id?tab=sourcing`).

### 6.3 Presque morts
`UpgradePrompt`, `command` (uniquement `NavigationPalette`), `hover-card` (2), `toggle` (1),
`AnimatedFunnel` (1).

## 7. États d'écran

### 7.1 États vides
`EmptyState` (composant maison) est importé dans **6 fichiers**.
Les chaînes « Aucun… / Aucune… » apparaissent **189 fois dans 116 fichiers**.
Soit environ 95 % des états vides écrits à la main, la plupart sans illustration ni action.

Extraits relevés : « Aucune conversation », « Aucun poste trouvé », « Aucune recherche lancée »,
« Aucune mission publiée », « Aucune donnée pour le moment », « Aucune suggestion disponible. »
(avec et sans point final selon les fichiers), « Aucune activité à afficher ».

### 7.2 États de chargement — trois systèmes en parallèle
| Système | Portée |
|---|---|
| `Skeleton` shadcn | 12 fichiers |
| `Loader2` + `animate-spin` | 105 fichiers, 248 occurrences |
| `brutal-loader` | 20 fichiers |
| `animate-pulse` à la main | 40 occurrences |

### 7.3 Densité par route (source : `docs/audit-ux/inventory.json`, généré ce jour)

| Route | Fichiers | Dialogs | Inputs | Écritures | Toast OK | Toast KO |
|---|---:|---:|---:|---:|---:|---:|
| `/missions/:id` | 229 | 38 | 112 | 132 | 133 | 235 |
| `/sourcing/:id` | 175 | 19 | 97 | 53 | 60 | 131 |
| `/dashboard` | 141 | 12 | 21 | 73 | 61 | 90 |
| `/pipeline` | 138 | 9 | 26 | 70 | 56 | 80 |
| `/inbox` | 117 | 14 | 25 | 49 | 56 | 98 |
| `/pipeline/scorecard/:candidateId` | 108 | 9 | 14 | 64 | 53 | 77 |
| `/settings` | 90 | 20 | 68 | 59 | 73 | 106 |
| `/calendar` | 36 | 4 | 21 | 17 | 13 | 17 |
| `/onboarding` | 35 | 1 | 5 | 13 | 7 | 13 |
| `/missions` | 31 | 2 | 1 | 12 | 20 | 25 |
| `/tasks` | 31 | 2 | 10 | 15 | 11 | 13 |
| `/marketplace` | 26 | 3 | 5 | 8 | 14 | 16 |
| `/auth` | 20 | 1 | 3 | 9 | 6 | 6 |
| `/` (landing) | 15 | 0 | 4 | 2 | 0 | 0 |
| `/sourcing` | 15 | 1 | 0 | 11 | 8 | 8 |
| `/pricing` | 15 | 0 | 0 | 8 | 6 | 9 |
| `/agents` | 13 | 0 | 0 | 8 | 6 | 5 |
| `/mission-invite/:token` | 10 | 0 | 0 | 10 | 9 | 8 |
| `/qualification/:id` | 10 | 0 | 2 | 2 | 1 | 2 |
| `/portal/:token` | 5 | 0 | 0 | 0 | 0 | 0 |
| `/client/:token` | 5 | 0 | 0 | 0 | 1 | 2 |
| `/r/:slug` | 5 | 0 | 0 | 0 | 0 | 0 |

`/missions/:id` concentre 229 fichiers et 38 dialogues : c'est l'écran qui décide de la
faisabilité de toute refonte.

## 8. Mouvement

Durées : `duration-200` 39, `duration-150` 25, `duration-300` 21, `duration-500` 12, `duration-700` 3.
Courbes : `ease-out` 10, `ease-linear` 4, `ease-in` 4 — le reste hérite du défaut Tailwind.

Keyframes maison dans `index.css` : `accordion-down/up`, `zoom-in`, `fade-zoom-in`, `fade-in`,
`slide-in-right`, `konektPulseDot`, `konektBgPan`, `konektGlow`, `konektShine`, `konektFadeUp`,
`konektShimmerText`.

Utilitaires maison : `.interactive-card` (lift de 1 px + ombre), `.interactive-row` (fond au survol),
`.focus-ring-brutal`, `.stagger-in` (délais 0→280 ms sur 8 enfants), `.konekt-skalr-bg`,
`.konekt-skalr-bg-soft`, `.konekt-skalr-text`, `.konekt-glow`, `.konekt-shine`, `.konekt-fade-up`,
`.konekt-shimmer-text`, `.thin-scrollbar`, `.no-scrollbar`, `.scrollbar-hide` (doublon de
`.no-scrollbar`), `.perspective-1000`, `.perspective-800`, `.skalr-gradient-text`,
`.skalr-gradient-bg`, `.skalr-gradient-border`, `.landing-sky-gradient`, `.font-editorial`.

`prefers-reduced-motion` est honoré, mais **uniquement** pour `.interactive-card`,
`.interactive-row` et `.stagger-in`. Les 248 `animate-spin`, les `konekt-*` et les canvas animés
ne sont pas neutralisés.

## 9. Accessibilité

`aria-label` 147, `role="…"` 50, `sr-only` 21, `alt=` 96, `aria-describedby` **1**.
39 boutons `size="icon"` — la couverture `aria-label` n'est pas garantie sur tous.
Un lien « skip to content » est stylé dans `index.css` (`.skip-to-content`).
Le focus visible global est posé (`:focus-visible { outline: 2px solid hsl(var(--ring)) }`),
mais `--ring` en dark vaut `0 0% 100% / 25%` : **un contour blanc à 25 % d'opacité**, très en
dessous du ratio 3:1 exigé par WCAG 2.1 pour un indicateur de focus.

Aucune bibliothèque de formulaire ⇒ pas d'association automatique label/champ/erreur,
d'où l'unique `aria-describedby` de tout le dépôt.

## 10. Responsive

Points de rupture employés : `sm:` 622, `lg:` 112, `md:` 78, `xl:` 11, `2xl:` 0.
`useIsMobile` n'est appelé que dans 3 fichiers. 117 bascules d'affichage responsive,
69 éléments `sticky` ou `fixed`.
L'app est conçue pour deux tailles (mobile / desktop) ; la tranche tablette (`md:`) est peu traitée.

## 11. Dates et nombres

Deux systèmes coexistent : `date-fns` (62 fichiers) et `toLocaleDateString` (26 occurrences).
La locale `fr` de `date-fns` n'est importée que dans 4 fichiers (`CandidateCommentsTab`,
`candidate-detail/ProfileTab`, `ActivityTab`, `NotesTab`) : **partout ailleurs, `format()` rend les
mois et les jours en anglais dans une interface française**.

Vingt formats de date distincts sont en circulation : `'d MMM yyyy'`, `'dd MMM yyyy'`,
`'d MMMM yyyy'`, `'dd MMMM yyyy'`, `'dd/MM/yyyy'`, `'dd/MM/yy'`, `'dd/MM'`, `'d MMM'`, `'dd MMM'`,
`'HH:mm'`, `'dd/MM HH:mm'`, `'dd/MM à HH:mm'`, `'d MMM yyyy à HH:mm'`, `'dd MMM yyyy · HH:mm'`,
`'dd MMM yyyy HH:mm'`, `'d MMM HH:mm'`, `'EEEE d MMMM'`, `'EEEE'`, `'yyyy-MM-dd'`, `'h'`.
Trois séparateurs différents entre date et heure : `à`, `·`, espace.

## 12. Documents d'audit préexistants

- `DESIGN_AUDIT.md` (dernier commit 2026-07-16) décrit un style « brutal » : `rounded-none`,
  ombres en décalage plein, bordures noires. **Ce document est périmé** : `index.css` a été
  réécrit le 2026-09-06 en thème Qonto avec `--radius: 0.75rem` et des ombres douces.
  Il mentionne aussi Phosphor Icons et un `Navbar.tsx` mort, tous deux disparus.
- `UX_AUDIT.md` (2026-04-16) décrit 8 onglets de mission ; il y en a 3 phases aujourd'hui.
- `docs/audit-ux/` (généré le 2026-09-09) fournit `inventory.json` et `coverage.json` — la
  source de la section 7.3.
