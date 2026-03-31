

# Plan de Refonte Design — "Brutal Clean"

## Vision

Aligner toute l'app sur un Brutalist epure : haute lisibilite, hierarchie claire, zero glass/glow/neon. Inspiration : Linear, Figma, la rigueur typographique d'un magazine d'architecture.

```text
AVANT                          APRES
┌──────────────────┐           ┌──────────────────┐
│ glass backdrop   │           │ bg-background     │
│ glow-accent neon │    →      │ border-foreground  │
│ text-[9px] UPPER │           │ text-sm normal     │
│ BorderBeam anim  │           │ pas d'animation    │
└──────────────────┘           └──────────────────┘
```

---

## Phase 1 — Fondations Design System

### 1.1 Typographie
- **Tailles minimum** : `text-xs` (12px) partout. Plus jamais de `text-[9px]` ou `text-[10px]`
- **Reduire l'uppercase** : reserver `uppercase tracking-wider` aux labels de section uniquement. Titres et boutons en capitalisation normale
- **Hierarchie** : h1 = `text-2xl font-bold`, h2 = `text-lg font-semibold`, body = `text-sm`, caption = `text-xs text-muted-foreground`

### 1.2 Supprimer le Glass/Neon
- **Fichiers touches** : `src/index.css` (supprimer `.glass`, `.glass-strong`, `.glass-subtle`, `.glow-accent-*`)
- **Navbar** : remplacer `glass` par `bg-background border-b border-foreground`
- **Supprimer** : `BorderBeam` usage, `shimmer-spin`, `glow-accent` classes
- **Garder** : les hover effects de reveal accent (`translate-y` sur boutons), les `border-2 border-foreground`

### 1.3 Palette
- Remplacer les couleurs Tailwind brutes (`bg-green-100 text-green-700`) par des tokens semantiques du design system (`--destructive`, `--accent`, `--muted`)
- Reduire la palette a : foreground, background, muted, accent (brutal-accent), destructive — c'est tout

---

## Phase 2 — Composants UI

### 2.1 Navbar (`Navbar.tsx`)
- Supprimer `glass` des liens
- Augmenter la hauteur des targets tactiles : `h-10` minimum (40px)
- Texte des liens : `text-xs font-medium` au lieu de `text-[11px] uppercase`
- Logo : garder l'animation SVG (c'est fun et distinctif)

### 2.2 Cards / Sections
- `Card` : garder `border border-foreground rounded-none` (c'est le bon call)
- Padding : augmenter a `p-5 sm:p-6` minimum
- Sous-titres : `text-xs text-muted-foreground` au lieu de `text-[9px] font-black uppercase`

### 2.3 Boutons
- Taille minimum : `h-9` (36px) pour touch
- Texte : `text-xs font-semibold` (pas uppercase sauf CTA primaires)
- Garder l'effet hover accent reveal (c'est la signature)

### 2.4 Badges / Status
- Creer un set de variantes unifiees : `default`, `success`, `warning`, `destructive`, `outline`
- Taille : `text-xs px-2 py-0.5` minimum

---

## Phase 3 — Pages principales

### 3.1 Landing page (`SkalrLanding.tsx`)
- Garder la structure hero + features + stats + FAQ
- Simplifier : supprimer le `landing-sky-gradient`, fond blanc pur
- Reduire les animations Framer Motion : uniquement fade-in au scroll, pas de `y: 30` excessifs
- Hero : garder `Instrument Serif` italic, augmenter la taille mobile
- Nav landing : aligner avec la navbar interne (meme structure)

### 3.2 Dashboard (`Dashboard.tsx`)
- Augmenter les tailles de texte dans l'empty state
- Bouton "Actualiser" : `h-9` avec texte visible sur mobile aussi

### 3.3 Missions list (`ProjectsList.tsx`)
- Remplacer `bg-green-100 text-green-700` et similaires par des tokens design system
- Augmenter la taille des cartes mission et leur padding

### 3.4 Mission Workspace (`MissionBentoDashboard.tsx`)
- Labels : `text-xs` au lieu de `text-[10px]`
- Stats : plus grands, plus de respiration entre les lignes
- Actions : garder la structure en liste mais plus de padding

---

## Phase 4 — Nettoyage

- Supprimer les classes CSS mortes dans `index.css` : `.glass`, `.glow-*`, `.glass-shine`, `.spotlight`
- Supprimer `border-beam` keyframes si plus utilise
- Supprimer `shimmer-spin` si inutile
- Audit des imports : verifier que `BorderBeam` n'est plus importe nulle part

---

## Fichiers impactes (estimation)

| Fichier | Type de changement |
|---|---|
| `src/index.css` | Supprimer glass/glow utilities, ajuster tokens |
| `tailwind.config.ts` | Nettoyer keyframes/animations inutiles |
| `src/components/Navbar.tsx` | Supprimer glass, augmenter touch targets |
| `src/components/ui/badge.tsx` | Unifier variantes couleur |
| `src/pages/SkalrLanding.tsx` | Simplifier animations, augmenter lisibilite |
| `src/pages/Dashboard.tsx` | Tailles texte, spacing |
| `src/components/missions/MissionBentoDashboard.tsx` | Tailles, spacing, labels |
| `src/components/outreach/projects/ProjectsList.tsx` | Tokens couleur, tailles |
| `src/components/ats/candidate-detail/shared.tsx` | Tailles boutons/textes |
| ~15 autres composants | Remplacement text-[9px]/[10px] par text-xs |

---

## Ce qu'on ne touche PAS
- La logique metier (hooks, edge functions, contexts)
- La structure des pages et le routing
- Le drag-and-drop kanban
- Les types et interfaces

## Approche d'implementation
Decouper en 4-5 PRs sequentielles pour ne pas tout casser d'un coup :
1. Fondations CSS + Navbar
2. Composants UI (boutons, badges, cards)  
3. Pages internes (Dashboard, Missions, Pipeline)
4. Landing page
5. Nettoyage final

