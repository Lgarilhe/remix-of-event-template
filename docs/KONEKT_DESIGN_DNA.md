# Konekt — Visual DNA

Doc réutilisable dans Claude Design (ou tout LLM visuel). Extrait de `src/index.css`, `tailwind.config.ts`, `src/components/ui/*`, `src/components/layout/*`, `src/pages/Dashboard.tsx`, `src/components/missions/MissionBentoDashboard.tsx`, `src/components/missions/BriefWizard.tsx`.

## 1. Identité visuelle

Konekt combine **deux grammaires cohabitantes** :

- **Dashboard / app courante** — style *Qonto dark-first* : cards `rounded-lg/xl`, bordures subtiles (`border-white/10`), fonds `bg-card` layered, boutons `rounded-full`, shadows très légères.
- **Brief / flux data-entry** — style *brutal éditorial* : `border-2`, coins droits (pas de radius), labels `uppercase tracking-wider font-bold`, inversions `bg-foreground text-background`.

Les deux coexistent : le **brutal** marque les moments « saisie / décision critique » (BriefWizard, FilterReview), le **Qonto** porte la navigation fluide (Dashboard, bento, stats).

Défaut **dark**. Classe `.light` active le thème clair. Toutes les couleurs sont des variables CSS HSL — **jamais de hex hardcodé**.

## 2. Design tokens (CSS variables)

### Neutrals dark (default)
```
--background          40 3% 11%   /* fond app */
--foreground          0  0% 98%   /* texte principal */
--card                40 3% 14%   /* cards */
--popover             40 3% 16%
--muted               40 3% 18%   /* fonds tags, progress-bg */
--muted-foreground    40 2% 56%   /* texte secondaire */
--accent              40 3% 20%   /* hover ghost */
--border              0 0% 100% / 10%  /* toutes bordures */
--input               0 0% 100% / 12%
--ring                0 0% 100% / 25%  /* focus */
--sidebar-background  40 3% 8%    /* + foncé que bg */
```

### Neutrals light
```
--background 0 0% 98%  · --foreground 40 3% 11%
--card       0 0% 100% · --muted      40 3% 95%
--border     40 3% 90%
```

### Brand — Skalr / Konekt (gradients & accents)
```
--skalr-purple   271 81% 56%   /* hero primary */
--skalr-pink     330 81% 60%
--skalr-blue     217 91% 60%
--skalr-cyan     187 85% 53%
--skalr-green    142 71% 45%
```
Exposé sous `colors.brand.{purple,pink,blue,cyan,green}` dans Tailwind.

### Semantic status (muted = fond tinté)
```
--status-success 142 71% 45%  / success-muted 142 40% 18% (dark) | 71% 95% (light)
--status-warning  45 93% 47%  / warning-muted
--status-info    217 91% 60%  / info-muted
--destructive      0 72% 51%
```
Tailwind : `bg-success`, `text-warning`, `bg-info/5`, etc.

### Brand 3rd-party
```
--brand-linkedin  201 100% 35%  (hover 29%)
--brand-whatsapp  142 70% 49%
```

### Charts (data-viz — 5 hues)
```
--chart-1 271 60% 55%   purple
--chart-2 187 60% 50%   cyan
--chart-3 142 50% 45%   green
--chart-4 330 60% 55%   pink
--chart-5  45 80% 55%   yellow
```

### Rayon, ombres, espacement
```
--radius   0.75rem              /* base = lg */
xl  = radius + 4px  (1rem)
lg  = radius
md  = radius - 2px
sm  = radius - 4px

--spacing  0.25rem              /* 4px unit */

shadow-2xs → 2xl : tous en hsl(0 0% 0% / α) — α = 0.15→0.4 dark, 0.04→0.15 light
```

## 3. Typographie

| Rôle | Stack | Quand l'utiliser |
|------|-------|------------------|
| **sans** (défaut) | `Instrument Sans` → system | Corps, UI, inputs |
| **display** (h1–h3 via `--font-*`) | `Outfit` 700 | Titres de page, hero |
| **serif** (`font-editorial`) | `Instrument Serif` | Moments éditoriaux, hero marketing |
| **mono** | `Space Mono` | Meta, compteurs, KPI `tabular-nums` |

**Échelle typographique effective** (extraite des composants, pas déclarée explicitement) :
```
page title       text-xl sm:text-2xl font-bold tracking-tight        (PageHeader h1)
card title       text-base/lg font-semibold                           (CardTitle h3)
section title    text-xs uppercase tracking-wider font-bold           (Section header)
body             text-sm                                              (défaut UI)
secondary        text-xs text-muted-foreground
micro meta       text-[11px] text-muted-foreground/60
brutal label     text-xs font-bold uppercase tracking-wider           (BriefWizard fields)
kpi value        text-xl/2xl font-bold font-mono tabular-nums         (StatTile)
```

Règle : `tracking-tight` pour titres h1/h2, `tracking-wider` pour labels uppercase.

## 4. Layout system

### `<PageLayout>` — wrapper de page
```tsx
<PageLayout maxWidth="2xl"> ... </PageLayout>
```
- `min-h-screen bg-background`
- `py-6 pb-8`, container `mx-auto px-3 sm:px-6 lg:px-8`
- max-width presets : `sm 3xl · md 5xl · lg 1200 · xl 1400 · 2xl 1600 · full`
- Fade-in par défaut : `animate-in fade-in-0 slide-in-from-bottom-1 duration-300`

### `<PageHeader>`
- `flex items-start justify-between gap-3 mb-4 flex-wrap`
- Icon 20px + h1 `text-xl sm:text-2xl font-bold tracking-tight`
- Meta à droite du titre : `text-xs font-mono uppercase tracking-wider text-muted-foreground`
- Actions alignées à droite

### `<Section>` — bloc applicatif
- `border border-border bg-background`
- Header : `px-4 py-2.5 border-b border-border`, titre `text-xs uppercase tracking-wider font-bold`, sous-titre avec tiret `— subtitle`
- Body : `p-4` si `padded`, sinon raw

### `<StatTile>` + `<StatGrid>` — KPI bandeaux
- Style *brutal* : `border border-border p-3 sm:p-4`, value `text-xl sm:text-2xl font-bold font-mono tracking-tight tabular-nums`
- Label : `text-xs uppercase tracking-wider text-muted-foreground font-medium`
- Variants : `default | primary | success | warning | destructive | info` — accent = fond tinté à 5–10%
- StatGrid utilise `gap-0` + négative margins `-mx-px [&>*]:-ml-px -mt-px` pour fusionner les bordures

## 5. Composants UI — conventions

Lib = **shadcn/ui** (Radix + Tailwind) avec `cva` pour les variants.

### Button (`src/components/ui/button.tsx`)
- **Shape : `rounded-full`** (signature Konekt)
- Tailles : `xs 8h · sm 9h · default 10h · lg 11h · icon 10×10`
- Variants : `default` (outline transparent) · `primary` (solid foreground) · `destructive` · `outline` · `secondary` · `ghost` · `link`
- Transition : `transition-all duration-200`
- Loading state intégré : `loading` prop → spinner Loader2 auto
- Focus : `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`

### Card (`src/components/ui/card.tsx`)
- `rounded-xl border border-border bg-card text-card-foreground shadow-sm`
- Padding standard : `p-6`, header avec `space-y-1.5`
- Title en `h3 text-2xl font-semibold leading-none tracking-tight`

### Badge
- `rounded-full border px-2.5 py-0.5 text-xs font-semibold`
- Variants : `default · secondary · destructive · outline · success · warning · info · muted`
- Uppercase pas par défaut (≠ brutal)

### Input
- `h-10 rounded-lg border border-input bg-background px-3 py-2`
- Error state : `aria-invalid` + `error` prop → `border-destructive focus-visible:ring-destructive`
- Text `text-base md:text-sm` (iOS anti-zoom)

### Dialog / AlertDialog
- Overlay : `bg-black/80` + `fade-in-0`
- Content : `rounded-xl border bg-card p-6 shadow-lg`, centré, `max-w-lg`
- Animations : `zoom-in-95 slide-in-from-top-[48%]`
- Close button `absolute right-2 top-2`, label FR `Fermer`
- **Règle projet** : jamais `window.confirm()` — toujours AlertDialog en français.

### Tabs
- List : `rounded-full bg-muted p-1` (pilule)
- Trigger actif : `bg-background text-foreground shadow-sm`
- Tout `rounded-full` + `transition-all`

### Dropdown, Popover, Select, Sheet, Drawer, Sidebar, Sonner (toast), Skeleton, Tooltip
- Tous suivent la convention shadcn : bordures `border-border`, fonds `bg-popover/card`, radius `var(--radius)`, animations `data-[state=open]:animate-in`
- Skeleton : `animate-pulse rounded-md bg-muted`

### Custom UI non-shadcn (à connaître)
- `AnimatedOrb` · `AnimatedCompass` · `AnimatedFunnel` · `AnimatedChatBubble` — illustrations motrices (lucide en 3D subtil)
- `ChannelIcon` — mapping LinkedIn / WhatsApp / Email / Phone
- `EmptyState` — card centered, icon circle `bg-accent`, CTA pill
- `brutal-loader` — loader style brutal
- `background-paths` — fond animé SVG
- `text-rotate` — texte en rotation

### Magic UI (décoratif — usage parcimonieux)
- `NumberTicker` — compteurs animés (utilisé partout pour KPI, briefPct)
- `ShimmerButton` — bouton hero avec shimmer (ex. "Lancer le sourcing")

## 6. Patterns récurrents

### Card cliquable (pattern Konekt le + utilisé)
```tsx
<button className={cn(
  "w-full rounded-lg border border-border bg-card p-4 sm:p-5",
  "flex items-center gap-3 text-left transition-all group",
  "hover:border-primary/20 hover:shadow-sm"
)}>
  <div className="w-9 h-9 rounded-lg bg-muted group-hover:bg-primary/10 
                  flex items-center justify-center shrink-0 transition-colors">
    <Icon className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
  </div>
  <div className="flex-1 min-w-0">
    <h3 className="text-sm font-medium text-foreground">{title}</h3>
    <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
  </div>
  <ArrowRight className="w-4 h-4 text-muted-foreground/50 
                         group-hover:text-primary group-hover:translate-x-0.5 
                         transition-all shrink-0" />
</button>
```
Signature Konekt : **icon chip 36×36 à gauche + double ligne title/desc + chevron qui glisse**.
Ajouter `style={{ WebkitTapHighlightColor: 'transparent' }}` pour iOS.

### CTA hero (action principale)
```tsx
<button className="w-full rounded-lg p-5 flex items-center gap-4 text-left
                   bg-primary text-primary-foreground hover:bg-primary/90 transition-colors group">
  <div className="w-9 h-9 rounded-lg bg-primary-foreground/20 ...">
    <Rocket className="w-4 h-4" />
  </div>
  <div className="flex-1"><h3>Titre</h3><p className="opacity-80">Desc</p></div>
  <ArrowRight className="opacity-70 group-hover:translate-x-0.5" />
</button>
```

### Progress bar
```tsx
<div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
  <motion.div
    className={cn('h-full rounded-full',
      pct >= 70 ? 'bg-primary' : pct >= 30 ? 'bg-warning' : 'bg-destructive')}
    initial={{ width: 0 }} animate={{ width: `${pct}%` }}
    transition={{ duration: 1, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
  />
</div>
```
Seuils couleur : **< 30 destructive, 30–69 warning, ≥ 70 primary**.

### Stepper / timeline horizontal
```
[●] ────── [●] ────── [○] ────── [🔒]
 Brief     Process   Sourcing   Outreach
```
- Cercle 24×24 `rounded-full border`, check si complete, Lock si locked
- Séparateurs `h-px bg-primary` (done) ou `bg-border`
- Label `text-xs font-medium hidden sm:inline`

### Brief brutal style (BriefWizard)
- Border **épaisse** `border-2`
- Coins droits : la plupart des champs sont sans radius sur le `<Field>`
- Focus = pas d'outline, juste `border-border` → *intentional* (le projet a sa propre focus-ring-brutal)
- Number badge `w-10 h-10 border-2 bg-foreground text-background` ou inverse selon état
- Step dialog plein écran en portal : `fixed inset-0 z-[4000] h-[100dvh]` + `pt-[env(safe-area-inset-top)]`
- Fullscreen progress `h-1 bg-foreground/10` avec fill `bg-foreground`

### Tag / chip
- Soft (Qonto) : `px-2 py-0.5 text-xs font-medium rounded-md bg-muted text-muted-foreground`
- Brutal (BriefWizard TagInput) : `px-2.5 py-1 border-2 uppercase tracking-wider font-bold`
  - must-have : `bg-destructive text-destructive-foreground border-destructive`
  - should-have : `bg-accent/30 text-foreground border-accent`
  - nice-to-have : `bg-foreground text-background border-border`
  - to-avoid : `bg-foreground/10 line-through`

### Empty state
Card centrée, icon chip 40/56px `rounded-xl bg-accent`, title `text-base sm:text-lg font-semibold`, desc `max-w-md` puis CTA pill `h-9 rounded-full border`.

## 7. Micro-interactions (layer `utilities` dans `index.css`)

### `.interactive-card` — hover lift
```
transition-all duration-150 ease-out
:hover  → -translate-y-px, bg-muted/40, border-foreground/30,
          shadow 0 2px 6px / 1px 3px
:active → translate-y-0
```

### `.interactive-row` — hover row (listes denses)
```
transition-colors duration-100
:hover → bg-muted/40
```

### `.stagger-in > *` — cascade d'entrée
- `animate-in fade-in-0 slide-in-from-bottom-2 duration-300`
- Délais progressifs 0 · 40 · 80 · 120 · 160 · 200 · 240 · 280ms (plafonné à 280ms à partir du 8e)

### Animations tailwind définies
| Nom | Durée | Usage |
|-----|-------|-------|
| `fade-in` | 600ms | apparition douce |
| `fade-zoom-in` | 1s | hero |
| `slide-in-right/left` | 250ms | panels |
| `scroll-left` | 40s infinite | marquee |
| `scroll-left-fast` | 110s infinite | marquee |
| `shimmer` | — | skeletons, hero button |
| `scan` | — | orb scan |
| `accordion-up/down` | 200ms | accordion |
| `zoom-in` | — | modals |

### Easings
- Micro-interactions : `ease-out` (150–200ms)
- Transitions route : 300ms
- Progress fill : `cubic-bezier(0.16, 1, 0.3, 1)` (expo.out)

### `prefers-reduced-motion`
Override global dans `index.css` : disable `interactive-card`, `interactive-row`, `stagger-in`. **Toujours respecter**.

## 8. Utilitaires maison

```
.skalr-gradient-text   → bg-clip-text purple→pink→blue 135°
.skalr-gradient-bg     → linear purple→pink 135°
.skalr-gradient-border → linear purple→pink→blue 135° (à utiliser sur padding pour effet border)
.font-editorial        → Instrument Serif
.no-scrollbar / .scrollbar-hide  → masque la scrollbar
.perspective-1000 / .perspective-800 → 3D hover
.focus-ring-brutal     → ring visible sur dark et light
.skip-to-content       → a11y skip link (sr-only → focus visible top-left)
```

## 9. Règles & interdits

### À faire
- Toujours utiliser les tokens HSL via `hsl(var(--xxx))` (jamais `#hex` direct)
- Boutons : **`rounded-full`** systématiquement (shape signature)
- Cards : **`rounded-xl`** ou `rounded-lg` selon densité
- Transitions : préfixer `transition-all duration-150-200 ease-out`
- Icônes : lucide-react, taille standard `w-4 h-4` (dans boutons), `w-3.5 h-3.5` (dense), `w-5 h-5` (titres)
- Focus : laisser `:focus-visible` global (2px outline ring, offset 2)
- Copy : **français**, labels courts, descriptions en phrase complète
- Destructive actions : AlertDialog ― jamais `window.confirm`
- Tables/listes denses : `font-mono tabular-nums` pour chiffres alignés

### À éviter
- Hex / rgb hardcodés → utiliser les CSS vars (audit DESIGN_AUDIT.md : 460+ occurrences à nettoyer)
- Rectangles à coins durs dans le dashboard (réservé au mode brutal brief)
- Ombres marquées dark : préférer `shadow-sm`, contraste via border
- `box-shadow` custom → préférer `shadow-{sm,md,lg}` mappés sur tokens
- Emojis dans l'UI (hors empty-state / marketing)

## 10. Axes d'évolution connus (DESIGN_AUDIT.md)

- Unifier les 2 grammaires (brutal ↔ Qonto) via une règle claire — probablement garder brutal seulement pour **saisie critique** et data-entry volumineuse.
- Nettoyer les 460+ couleurs hardcodées → forcer via lint / CI.
- Poser une échelle typographique explicite dans `tailwind.config.ts` (text-xs→3xl déclarés, pas juste laissés à Tailwind défaut).
- Poser une échelle d'espacement nommée (currently ad-hoc `gap-3/gap-4/space-y-3/4/6`).
- Ajouter Storybook (doc manquante).
- a11y : skip-link présent, mais ARIA et focus-traps à auditer sur les 78+ modals.

---

## TL;DR pour Claude Design

> Konekt = **dark-first Qonto** + **brutal éditorial** qui cohabitent. Palette neutre warm-gray (H=40, S=2-3%), accents violet→rose→bleu (gradient Skalr). Boutons `rounded-full`, cards `rounded-xl`, bordures `white/10`, ombres discrètes. Typographie : Instrument Sans corps, Outfit titres, Instrument Serif éditorial, Space Mono KPI. Pattern signature : card cliquable avec *icon-chip 36 + double-ligne + chevron glissant*. Micro-interactions : lift -1px + shadow, stagger 40ms, `ease-out 150ms`. Destructive = AlertDialog FR. KPI = `font-mono tabular-nums`. Tout en CSS vars HSL, jamais d'hex. Respect `prefers-reduced-motion` par défaut.
