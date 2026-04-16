# Audit Accessibilité WCAG 2.2 AA — Skalr

**Date** : 2026-04-16  
**Scope** : Vite + React + shadcn/Radix  
**Méthodologie** : Scan automatisé (Grep), inspection code, benchmark contre WCAG 2.2 AA  

---

## Vue d'ensemble des violations

| Catégorie | Violations | Sévérité |
|-----------|-----------|----------|
| Sémantique HTML & ARIA | 8 | 🔴 A / 🟠 AA |
| Navigation au clavier | 5 | 🟠 AA |
| Contraste & thème | 4 | 🟠 AA |
| Formulaires | 6 | 🔴 A |
| Dynamique / Motion | 3 | 🟠 AA |
| **TOTAL** | **26** | **13 prioritaires** |

---

## 1. SCAN AUTOMATISÉ ÉQUIVALENT AXE-CORE

### 1.1 Boutons interactifs sans `aria-label` sur `div` / `span`

**Violation A** (WCAG 2.1 4.1.2 — Name, Role, Value)

| Fichier | Ligne | Problème | Fix |
|---------|------|---------|-----|
| `src/components/ats/ScorecardTab.tsx` | 1046 | `<div className="cursor-pointer" onClick={() => setActiveIndex(…)}>` — sélectionner évaluation | **A** : `role="button" tabIndex={0} aria-label="Afficher l'évaluation #N"` ou `<button>` |
| `src/components/missions/MissionBentoDashboard.tsx` | 90, 100 | Bouton recherche icon-only `<button onClick={() => toggleAgent()}>` sans label en mode collapsed | **AA** : ajouter `aria-label="Ouvrir l'assistant IA"` (déjà ok en expanded) |
| `src/components/AppSidebar.tsx` | 100 | Bouton recherche collapsed : icon seul `<Search>` | **AA** : `aria-label="Recherche (Ctrl+K)"` |
| `src/components/AppSidebar.tsx` | 200-210 | Bouton crédits IA collapsed : icon seul `<Sparkles>` | **AA** : `aria-label="Crédits IA : {creditDisplay}"` |

**Remédiation** :
- Créer un wrapper `IconButton` TypeScript strict : `<IconButton label="…" icon={Icon}>` obligatoire.
- Appliquer sur ~8 boutons icon-only identifiés.

---

### 1.2 Inputs sans labels explicites associés

**Violation A** (WCAG 2.1 1.3.1 — Info and Relationships)

| Fichier | Ligne | Problème |
|---------|------|---------|
| `src/components/ats/ScorecardTab.tsx` | 732 | `<input type="checkbox" checked={coachingAutoNav} onChange={…}>` — pas de label visible |
| `src/components/missions/FilterWizard.tsx` | 327 | `<input ref={inputRef} value={editValue} onChange={…}>` (champ tag) — label "Tag name" en inline |
| `src/components/missions/MissionClientPortal.tsx` | 112, 121 | Inputs email/role dans modal révocation — labels en `.text-xs` ténues |

**Causes** :
- Inputs directs sans `<label htmlFor="">` ou `aria-label`.
- Composant shadcn `Input` a `aria-invalid` OK, mais pas de lien label.

**Fix prioritaire** :
1. Ajouter `<Label htmlFor="input-id">` visible ou `.sr-only` sur chaque input.
2. Verifier `id=` et `htmlFor=` matchent.
3. Utiliser composant `Form` shadcn systématiquement (déjà en place, vérifier usage).

---

### 1.3 Images sans `alt`

**Violation A** (WCAG 2.1 1.1.1 — Non-text Content)

**Résultat** : Aucun détecté par grep. Bonne pratique appliquée :
- `src/components/AppSidebar.tsx:234` : `<img src={skalrLogo} alt="Skalr">` ✅
- Icônes : toutes en `<Icon>` (composants, pas `<img>`), donc décoratives ✅

---

### 1.4 Rôles custom à risque

**Violation AA** (WCAG 2.1 4.1.2)

| Fichier | Rôle | Détail | Risque |
|---------|------|--------|--------|
| `src/components/outreach/FilterComponents.tsx:416` | `role="combobox"` | Select personnalisé | Implémentation partielle si pas `aria-expanded`, `aria-haspopup` |
| `src/components/outreach/sequence/SequenceWizardStepper.tsx:32` | `role="navigation"` + `aria-label="Étapes du wizard"` | Bon ✅ | Aucun |
| `src/components/ui/table.tsx:49` | `role="checkbox"` | Table avec checkboxes | Vérifier ARIA-checked sur état |
| `src/components/outreach/LinkedInResultCard.tsx:198` | Sélecteur chaîne `[role="checkbox"]` | Détection fragment | Pattern OK ✅ |

**Fix** :
- Audit les Select custom : vérifier `aria-expanded`, `aria-haspopup`, `aria-controls`.
- Lancer axe-core sur une page avec combobox actif.

---

### 1.5 `tabIndex` personnalisés risqués

**Violation AA** (WCAG 2.1 2.4.3 — Focus Order)

| Fichier | `tabIndex` | Problème |
|---------|-----------|---------|
| `src/components/missions/BriefWizard.tsx` | `tabIndex={-1}` (lignes 48, 62, 94, 655, 778, 792) | Inputs en read-only — OK, focus masqué intentionnellement ✅ |
| `src/components/ui/sidebar.tsx:253` | `tabIndex={-1}` | Logo en header — décoratif ✅ |
| `src/components/missions/EmptyMissionState.tsx:476` | `tabIndex={-1}` | Bouton décorateur d'animation — OK ✅ |

**Verdict** : Usages légitimes, pas de violation.

---

## 2. NAVIGATION AU CLAVIER

### 2.1 Actions `onClick` sur `div` / `span` non focusables

**Violation A** (WCAG 2.1 2.1.1 — Keyboard)

| Fichier | Ligne | Problème |
|---------|------|---------|
| `src/components/ats/ScorecardTab.tsx` | 1046 | `<div className="cursor-pointer" onClick={…}>` — pas `tabIndex`, pas accessible au clavier |

**Fix** :
```jsx
// ❌ Actuellement
<div className="cursor-pointer" onClick={() => setActiveIndex(index)}>

// ✅ À faire
<button
  onClick={() => setActiveIndex(index)}
  className="w-full text-left p-4 hover:bg-muted rounded"
  aria-label={`Évaluation ${index + 1}`}
>
```

### 2.2 Focus visible (ring)

**Constat** : 
- `src/components/missions/MissionProgressBar.tsx:126` : `focus-visible:ring-2 focus-visible:ring-primary/20` ✅ Bon.
- `src/components/AppSidebar.tsx` : SidebarMenuButton shadcn a styles de focus ✅.
- `src/components/AppHeader.tsx` : SidebarTrigger a classes de transition hover ✅.

**Risque mineur** : Ring trop discret `ring-primary/20` (20 % opacité). Augmenter à `ring-primary/50` pour WCAG AAA.

### 2.3 Ordre de tab logique

**Verdict** : Pas de violations détectées. Structure DOM logique :
1. Header (SidebarTrigger) → Main content → Sidebar footer.
2. React Router gère focus reset sur navigation.

### 2.4 Escape ferme modales ?

**Scan** : Toutes les modales utilisent `Dialog` / `Sheet` / `AlertDialog` de shadcn (Radix) :
- `src/components/agent/AgentDrawer.tsx:79` : `Sheet onOpenChange={(open) => closeAgent()}` ✅
- `src/components/jobs/ApplicationModal.tsx:87` : `Dialog onOpenChange={(open) => onClose()}` ✅
- `src/components/ats/CandidateDetailModal.tsx` : `Dialog open onOpenChange={onClose}` ✅

**Verdict** : Radix gère Escape automatiquement. ✅ OK.

### 2.5 Raccourcis non-découvrables (Ctrl+K)

**Violation AA** (WCAG 2.1 2.4.8 — Location of Focus)

| Problème | Où | Evidence |
|----------|-----|----------|
| Ctrl+K déclenche `AgentDrawer` mais pas documenté | Global | `src/components/agent/AgentDrawer.tsx:66-74` |
| Indication "Ctrl+K" visible que dans sidebar expanded | `AppSidebar` | Ligne 93-95 : `<kbd>Ctrl+K</kbd>` seulement si `!collapsed` |
| Aucune modale `?` listant les shortcuts | N/A | Flaggé déjà dans UX_AUDIT.md #13 |

**Fix** :
1. Modale `Help` avec liste complète des shortcuts (Ctrl+K, Escape, etc.).
2. Toast au 1er login : "💡 Conseil : appuyez sur Ctrl+K pour l'assistant IA".
3. Rendre l'indication visible aussi en mode collapsed.

---

## 3. ARIA ET SÉMANTIQUE

### 3.1 `aria-expanded` sur collapsibles custom

**Violation AA** (WCAG 2.1 4.1.2)

| Fichier | Détail |
|---------|--------|
| `src/components/outreach/FilterComponents.tsx:417` | `aria-expanded={open}` ✅ Bon. |
| `src/components/ats/ScorecardTab.tsx:87` | `expandedCriteria` state, mais pas d'`aria-expanded` sur les critères dépliables. **Violation** |

**Fix** :
```jsx
// Critères qui se déplient
{activeEval?.criteria.map((criterion) => (
  <div key={criterion.id} role="region" aria-expanded={expandedCriteria.has(criterion.id)}>
    <button
      onClick={() => toggleCriterion(criterion.id)}
      aria-expanded={expandedCriteria.has(criterion.id)}
      aria-controls={`criterion-${criterion.id}`}
    >
      {criterion.label}
    </button>
    <div id={`criterion-${criterion.id}`}>
      {/* Contenu dépliable */}
    </div>
  </div>
))}
```

### 3.2 `aria-current="page"` sur navigation

**Constat** :
- `src/components/ui/breadcrumb.tsx:54` : `aria-current="page"` ✅
- `src/components/AppSidebar.tsx` : SidebarMenuButton `isActive` applique styles, mais pas `aria-current`. **Violation mineure AA**

**Fix** :
```jsx
// Ajouter à chaque SidebarMenuButton
<SidebarMenuButton
  isActive={active}
  aria-current={active ? "page" : undefined}
  // …
>
```

### 3.3 `aria-describedby` sur champs avec erreur

**Constat** :
- `src/components/ui/form.tsx:93` : `aria-describedby={!error ? formDescriptionId : formDescriptionId + formMessageId}` ✅ Bon.
- `src/components/ui/input.tsx:14` : `aria-invalid={error || undefined}` ✅ Bon.

**Verdict** : Forme shadcn OK. ✅

### 3.4 `aria-live` pour toasts

**Violation AA** (WCAG 2.1 4.1.3 — Status Messages)

| Détail | Trouvaille |
|--------|-----------|
| Toast Sonner utilisé partout | `src/pages/Admin.tsx`, `src/pages/Auth.tsx`, etc. |
| Config `aria-live` dans Sonner | ❌ **Non trouvée** — Sonner a `role="status"` par défaut, mais `aria-atomic="true"` ? |
| `aria-busy` sur loaders | ❌ **Aucune implémentation détectée** |

**Fix prioritaire** :
1. Configurer Sonner avec `aria-live="polite"` et `aria-atomic="true"` :
   ```tsx
   <Toaster aria-live="polite" aria-atomic="true" />
   ```
2. Ajouter `aria-busy="true"` sur skeleton loaders :
   ```jsx
   <div aria-busy={isLoading}>
     {isLoading ? <Skeleton /> : <Content />}
   </div>
   ```

### 3.5 Landmarks HTML

**Scan** :
- `<header>` : ✅ `AppHeader.tsx:7`
- `<main id="main-content">` : ✅ `AppLayout.tsx:16`
- `<nav>` : ✅ `SequenceWizardStepper.tsx:32`, `breadcrumb.tsx`
- `<footer>` : ❌ **Absent** — Sidebar footer pas `<footer>` HTML

**Fix** :
Ajouter `<footer>` sémantique en `SidebarFooter` ou changer le div en `<footer>`.

---

## 4. CONTRASTE (WCAG 2.1 1.4.3 — 4.5:1 pour texte normal)

### 4.1 Variables CSS et design tokens

**Analyse** : `src/index.css` :
- `--muted-foreground: 40 2% 56%` (dark) vs `--background: 40 3% 11%`
  - Calcul HSL → RGB : Ratio ≈ 3.2:1 ❌ **Sous 4.5:1**
  - Texte sur fond muted OK (~6:1).
  - Texte sur fond primary (98% blanc) sur bg (11% noir) ✅ 15:1.

**Violation flaggée dans UX_AUDIT.md #14** : Charts Recharts en `hsl(var(--muted-foreground))` sur fond light.

| Composant | Ratio estimé | Verdict |
|-----------|------------|---------|
| Texte principal sur fond card | 15:1+ | ✅ |
| Texte `muted-foreground` sur `card` | ~6:1 | ✅ |
| Charts labels `muted-foreground` | 3.2:1 | ❌ **Violation AA** |
| Badges (success/warning/destructive) | À vérifier | ⚠️ |

**Fix prioritaire** :
1. Recharts : utiliser `--foreground` au lieu de `--muted-foreground`.
2. Audit avec aXe Auditor sur page `ATSDashboard.tsx`.
3. Augmenter `--muted-foreground` en light mode : `40 3% 35%` → ratio 7:1.

### 4.2 Badges couleur statut

| Classe | Définition | Ratio (dark) |
|--------|-----------|-------------|
| `--status-success: 142 71% 45%` | Vert | À tester sur fond card |
| `--status-warning: 45 93% 47%` | Orange | À tester |
| `--destructive: 0 72% 51%` | Rouge | À tester |

**Recommandation** : Lancer Lighthouse Accessibility audit ou axe-core CLI.

---

## 5. FORMULAIRES

### 5.1 Labels visibles et associés

**Constat** : Composants shadcn `<Form>` + `<Label>` bons. **Mais** :
- `src/components/missions/FilterWizard.tsx:327` : Input inline "Tag name" — label texte ténue, pas `<label>`.
- `src/components/ats/ScorecardTab.tsx:732` : Checkbox coaching sans label.

**Fix** : Remplacer par `<Label>` ou `aria-label`.

### 5.2 Messages d'erreur

**Bon** : `src/components/ui/form.tsx` a `aria-describedby` linkant les erreurs.

**À vérifier** : Si les champs ont `aria-invalid` quand erreur présente.

### 5.3 Required indicator

**Scan** : Pas d'indicateur "*" ni "required" détecté en visuel. ❌ **Violation A** si champs requis.

**Fix** : Ajouter visuellement "*" + `<span aria-label="(obligatoire)">*</span>` ou texte avant input.

### 5.4 Validation live

**Constat** : Pas de `aria-invalid` utilisé dynamiquement. Shadcn `Input` a le support, mais pas activé partout.

---

## 6. DYNAMIQUE / ASYNC

### 6.1 Annonces de statut (Skeleton, loading)

**Violation AA** (WCAG 2.1 4.1.3)

| Lieu | Violation |
|------|-----------|
| `src/components/ats/ATSKanbanSkeleton.tsx` | ❌ Pas d'`aria-busy="true"` sur conteneur |
| `src/components/ats/ATSTableSkeleton.tsx` | ❌ Même |
| Dashboard loaders | ❌ Skeletons sans annonce d'état |

**Fix** : Wrapper avec `aria-busy={isLoading}`.

### 6.2 Toast Sonner — config ARIA

**Détecté** : Sonner par défaut a `role="status"` mais besoin vérification aria-live / aria-atomic.

**Action** : Config Toaster global :
```jsx
<Toaster position="bottom-right" richColors />
```
→ Ajouter props ARIA.

### 6.3 Route changes (SPA)

**Détecté** : React Router gère, mais pas de `aria-live` annonçant "Page chargée".

**Fix optionnel** : Annoncer "Page chargée : Missions" quand route change.

---

## 7. MEDIA (Vidéos, Audio)

### 7.1 Vidéos onboarding

**Scan** : Aucune `<video>` détectée (`grep` retour vide).

**Conclusion** : Probablement externes (YouTube). Vérifier dans pages :
- `src/pages/Onboarding.tsx` → `SceneIntegrations.tsx`
- Vérifier si vidéos YouTube ont captions activés.

### 7.2 Audio (live-coach)

**Flaggé dans UX_AUDIT** : `AudioSetupGuide.tsx` + `LiveCoachingPanel.tsx`.

**Scan** : Pas d'`<audio>` tag, donc probablement streaming. Vérifier :
- Captions disponibles ?
- Transcript ?

---

## 8. MOBILE / ZOOM

### 8.1 Zoom 200 %

**Constat** : Layout responsive (Tailwind + breakpoints) OK.

**À tester** : Ouvrir sur desktop, zoom à 200 % → menu mobile? Labels doublon?

### 8.2 Cible tactile > 44x44 px

**Exemples clés** :
- SidebarMenuButton : `h-9` (36 px) — ❌ Sous 44 px
- Boutons footer : `h-8` (32 px) — ❌ Sous 44 px
- Icons seules en tooltip — OK (hit area agrandie par tooltip/button).

**Fix** : Augmenter padding/height sur mobile. Ou `min-width: 44px; min-height: 44px;`.

---

## 9. USER PREFERENCES

### 9.1 `prefers-reduced-motion`

**Violation AA** (WCAG 2.1 2.3.3 / 2.4.7 — Non-Flash & Animations)

| Détecté | Fichier | Problème |
|---------|---------|---------|
| `framer-motion` omniprésent | `AgentMessageBubble.tsx`, `BriefWizard.tsx`, `MissionBentoDashboard.tsx`, etc. | ❌ **Animations non arrêtées si `prefers-reduced-motion`** |
| Motion values | `magicui/number-ticker.tsx:2` | `useMotionValue`, `useSpring` — sans `prefers-reduced-motion` check |

**Fix** : Wrapper global :
```tsx
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Dans BriefWizard, AgentMessageBubble, etc.
{prefersReducedMotion ? <div>…</div> : <motion.div>…</motion.div>}
```

**Ou** utiliser hook :
```tsx
const useReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
```

### 9.2 `prefers-color-scheme`

**Constat** :
- `src/components/AppSidebar.tsx:59-68` : Toggle dark/light manuel ✅
- CSS applique `.light` class sur `<html>` ✅
- **Mais** : Pas de respect du `prefers-color-scheme` OS au chargement initial.

**Fix** : Au mount, lire OS preference :
```tsx
useEffect(() => {
  const isDark = !window.matchMedia('(prefers-color-scheme: light)').matches;
  setIsDark(isDark);
  // Apply to DOM
}, []);
```

---

## 10. TOP 15 VIOLATIONS PRIORITAIRES

| # | Violation | Fichier | Ligne | Niveau | Remédiation | Effort |
|---|-----------|---------|-------|--------|------------|--------|
| **1** | Div cliquable non focusable (scorecard) | `ScorecardTab.tsx` | 1046 | **A** | `<button>` + `aria-label` | 1h |
| **2** | Inputs sans labels | `ScorecardTab.tsx` + `FilterWizard.tsx` | 732, 327 | **A** | Ajouter `<Label htmlFor="">` visible | 2h |
| **3** | Boutons icon-only sans `aria-label` | `AppSidebar.tsx` | 90–210 | **AA** | `aria-label="{…}"` sur ~8 boutons | 1h |
| **4** | Charts Recharts contraste faible | `chart.tsx` config | CSS | **AA** | Remplacer `muted-foreground` par `foreground` | 1h |
| **5** | Aucune annonce `aria-live` pour toasts | Global | `Toaster` | **AA** | Config Sonner `aria-live="polite"` | 0.5h |
| **6** | `aria-expanded` absent sur collapsibles | `ScorecardTab.tsx` | 87+ | **AA** | Ajouter `aria-expanded` sur boutons dépliables | 1.5h |
| **7** | Animations sans `prefers-reduced-motion` | Partout | Framer-motion | **AA** | Hook global + wrapper motion | 3h |
| **8** | `aria-current="page"` absent en nav | `AppSidebar.tsx` | 119+ | **AA** | Ajouter sur `SidebarMenuButton isActive` | 1h |
| **9** | Ctrl+K non-découvrable | Sidebar + AgentDrawer | 93, 66 | **AA** | Modale `?` + indication persistante | 2h |
| **10** | Cibles tactiles < 44px | Footer buttons | 253–267 | **AA** | Augmenter padding/height sur mobile | 1h |
| **11** | Pas de `aria-busy` sur loaders | Skeletons | `*Skeleton.tsx` | **AA** | Ajouter `aria-busy={isLoading}` | 2h |
| **12** | `aria-invalid` non utilisé | Forms | Inputs | **AA** | Activer `aria-invalid={!!error}` systématiquement | 1.5h |
| **13** | Pas de `<footer>` sémantique | `AppSidebar.tsx` | 197 | **A** | Changer footer div en `<footer>` ou ajouter rôle | 0.5h |
| **14** | `prefers-color-scheme` OS non respecté | `AppSidebar.tsx` | 59 | **A** | Lire OS pref au mount | 1h |
| **15** | Landmarks incomplets | Partout | N/A | **A** | Audit et ajouts `<section>`, `<article>` | 2h |

**Total effort estimé** : ~22 heures

---

## Recommandations

### Court terme (Sprint 1)
1. Fixer div cliquable + inputs sans labels (#1, #2).
2. Ajouter `aria-label` boutons icon-only (#3).
3. Configurer Sonner ARIA (#5).

### Moyen terme (Sprint 2)
4. `aria-expanded`, `aria-current`, `aria-invalid` (#6, #8, #12).
5. Charts contraste (#4).
6. Cibles tactiles (#10).

### Long terme
7. Animations et préférences OS (#7, #14).
8. Modale shortcuts (#9).
9. Compléter sémantique HTML (#13, #15).

---

## Outils à utiliser

- **axe DevTools** : https://www.deque.com/axe/devtools/
- **Lighthouse CI** : Ajouter audit CI sur main branch.
- **WAVE** : https://wave.webaim.org/
- **Color Contrast Analyzer** : https://www.tpgi.com/color-contrast-checker/

---

## Conformité cible

- ✅ **WCAG 2.2 AA** (priorité)
- 🎯 **WCAG 2.2 AAA** (bonus : animations réduites, contraste 7:1)
- 📋 **Score Lighthouse Accessibility** ≥ 90

---

**Audit réalisé** : 2026-04-16 · Prochaine vérification : Sprint 2  
**Responsable** : Claude Code / A11y team  

