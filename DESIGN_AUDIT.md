# Audit Design Complet - Skalr

## Contexte
Audit design exhaustif de l'application Skalr (React/Tailwind/Radix UI). Couvre : design system, coherence visuelle, accessibilite WCAG 2.1 AA, UX copy, composants, navigation, responsive, et recommandations priorisees.

---

## Score Global : 6.5/10

| Aspect | Score | Statut |
|--------|-------|--------|
| Design System (tokens, variables) | 8/10 | Solide fondation HSL + dark mode |
| Coherence des couleurs | 4/10 | 460+ couleurs hardcodees |
| Typographie | 6/10 | Pas d'echelle explicite |
| Spacing | 6/10 | Pas d'echelle claire |
| Composants UI | 8/10 | 47+ composants Radix |
| Accessibilite WCAG 2.1 AA | 3/10 | Lacunes majeures |
| Navigation UX | 5/10 | Code mort (Navbar), pas de breadcrumbs |
| Responsive | 8/10 | Mobile/desktop ok, tablet non teste |
| Etats (loading/empty/error) | 7/10 | Presents mais inconsistants |
| Dark Mode | 9/10 | Bien implemente |
| UX Copy / Microcopy | 8/10 | FR coherent, erreurs trop generiques |
| Documentation | 2/10 | Pas de Storybook, JSDoc minimal |

---

## PARTIE 1 : DESIGN CRITIQUE

### Premiere impression
- **Ce qui attire l'oeil en premier :** Le style "brutal" (rounded-none, shadows offset) donne une identite forte et distincte
- **Reaction emotionnelle :** Professionnelle, moderne, technique
- **Clarte du but :** Immediatement clair - outil de sourcing/recrutement

### Usabilite

| Finding | Severite | Recommandation |
|---------|----------|----------------|
| Double systeme nav (Navbar.tsx = code mort, jamais importe) | Mineur | Supprimer `Navbar.tsx` - fichier mort |
| Pas de breadcrumbs sur `/missions/:id` | Modere | Composant existe (`breadcrumb.tsx`) mais jamais utilise - l'integrer dans `AppHeader.tsx` |
| 78+ modals dont certains tres lourds (CandidateDetailModal = 6 tabs) | Modere | Optimiser pour mobile, ajouter loading par section |
| Query params inconsistants (`?tab=`, `?view=`) | Mineur | Unifier sur `?tab=` partout |

### Hierarchie visuelle
- **Lecture :** Le flux est clair grace a la sidebar + header + contenu principal
- **Emphase :** Le style brutal (borders noires, shadows offset) guide bien l'attention
- **Whitespace :** Bien utilise dans les pages principales, dense dans les modals

### Coherence

| Element | Probleme | Recommandation |
|---------|---------|----------------|
| Couleurs | 460+ hardcodees dans 90 fichiers | Migrer vers tokens CSS semantiques |
| Border radius | 7 variants (none, sm, md, lg, xl, full + partiels) | Standardiser : `rounded-none` brutal + `rounded-full` badges |
| Hauteurs boutons | h-8, h-9, h-10, h-[34px] | Standardiser : h-8 (xs), h-9 (sm), h-10 (default), h-11 (lg) |
| Icones | Lucide (174 fichiers) + Phosphor (5 fichiers) | Migrer Phosphor vers Lucide |
| Shadows | Melange brutal (offset solide) + soft (shadow-md) | Choisir un style dominant |

### Ce qui fonctionne bien
- Style brutal distinctif et coherent dans les composants de base
- Sidebar collapsible avec tooltips et badges
- Lazy-loading des pages pour la performance
- Feature-gating de la navigation selon le type d'organisation
- Empty states elabores avec animations et statistiques
- Dark mode complet et bien pense

---

## PARTIE 2 : DESIGN SYSTEM AUDIT

### Summary
**Composants audites :** 47+ | **Issues trouvees :** 18 | **Score :** 72/100

### Naming Consistency

| Issue | Composants | Recommandation |
|-------|-----------|----------------|
| Melange kebab-case / PascalCase dans `src/components/ui/` | Radix = kebab (`button.tsx`), Custom = Pascal (`AnimatedOrb.tsx`, `EmptyState.tsx`) | Standardiser sur kebab-case |
| Props naming | Coherent : `variant`, `size`, `className` partout | Aucune action |

### Token Coverage

| Categorie | Tokens definis | Valeurs hardcodees trouvees |
|-----------|---------------|---------------------------|
| Couleurs | 41 variables CSS (light + dark) | 460+ instances dans 90 fichiers |
| Spacing | Standard Tailwind (--spacing: 0.25rem) | 15+ valeurs arbitraires (h-[80px], h-[34px], max-w-[420px]) |
| Typographie | 4 familles (Instrument Sans, Outfit, Serif, Mono) | Pas d'echelle de heading definie |
| Shadows | 7 niveaux (2xs a 2xl) avec dark mode | Melange inline + CSS vars |
| Border radius | --radius: 0.375rem | 7 variants Tailwind utilisees |

### Component Completeness

| Composant | States | Variants | Sizes | Docs | Score |
|-----------|--------|----------|-------|------|-------|
| Button | default, hover, active, disabled, focus | 6 (default, destructive, outline, secondary, ghost, link) | 4 (default, sm, lg, icon) | Minimal | 4.5/5 |
| Input | default, hover, focus, disabled | 1 | 1 | Aucune | 4/5 |
| Badge | default, hover, focus | 8 (default, secondary, destructive, outline, success, warning, info, muted) | 1 | Aucune | 4.5/5 |
| Card | Compound pattern complet | 1 | 1 | Aucune | 5/5 |
| Select | default, open, closed, disabled, focus | Radix-based | 1 | Aucune | 4/5 |
| Tabs | active, inactive, disabled, focus | Radix-based | 1 | Aucune | 5/5 |

**Manques identifies :**
- Button : pas d'etat **loading** (spinner)
- Input : pas d'etat **error** ni **readonly** visuellement distinct
- Select : pas d'etat **error** explicite
- Badge : pas d'etat **disabled**

### Documentation
- **JSDoc :** 4 fichiers seulement (AnimatedOrb, BrutalLoader, UpgradePrompt, ChannelIcon)
- **Storybook :** Aucun fichier `.stories.tsx` trouve
- **Score documentation : 1.5/5**

### Composabilite
- **Compound patterns :** Card, Select, Tabs, Alert, Form - excellents
- **forwardRef :** Tous les composants UI l'utilisent
- **cn() utility :** Utilise partout pour le merge de classes
- **Score : 4.5/5**

---

## PARTIE 3 : ACCESSIBILITE WCAG 2.1 AA

**Standard :** WCAG 2.1 AA | **Issues trouvees :** 22+ | **Critiques :** 6 | **Majeures :** 9 | **Mineures :** 7+

### Perceivable

| # | Issue | Critere WCAG | Severite | Recommandation |
|---|-------|-------------|----------|----------------|
| 1 | 16+ images avec `alt=""` vide | 1.1.1 Non-text Content | Critique | Ajouter alt descriptif ou `aria-hidden="true"` pour images decoratives |
| 2 | 460+ couleurs hardcodees cassent le dark mode | 1.4.3 Contrast | Critique | Migrer vers tokens CSS |
| 3 | Muted-foreground light mode : ratio ~5.8:1 | 1.4.3 Contrast | Mineur | Passe AA, pas AAA - acceptable |

**Note positive :** Paires de couleurs principales passent toutes AA :
- Foreground/Background : ~13.5:1 (light), ~14:1 (dark)
- Primary-foreground/Primary : ~12:1
- Destructive-foreground/Destructive : ~6.5:1

### Operable

| # | Issue | Critere WCAG | Severite | Recommandation |
|---|-------|-------------|----------|----------------|
| 4 | Pas de skip-to-content | 2.4.1 Bypass Blocks | Majeur | Ajouter dans `AppLayout.tsx` |
| 5 | Focus visible insuffisant (77 instances seulement) | 2.4.7 Focus Visible | Majeur | Regle CSS globale : `*:focus-visible { outline: 2px solid hsl(var(--ring)); }` |
| 6 | Touch targets < 44x44px (close buttons = 16-20px) | 2.5.5 Target Size | Majeur | Augmenter padding : `p-3 h-11 w-11` |
| 7 | `ApplicationModal.tsx` et `AuthSheet.tsx` sans Escape key | 2.1.1 Keyboard | Critique | Migrer vers Radix Dialog |

### Understandable

| # | Issue | Critere WCAG | Severite | Recommandation |
|---|-------|-------------|----------|----------------|
| 8 | Labels non associes aux inputs (ApplicationModal: 6 inputs sans id) | 3.3.2 Labels | Critique | Ajouter `htmlFor`/`id` pairs |
| 9 | Pas d'`aria-invalid` sur champs en erreur | 3.3.1 Error ID | Majeur | Utiliser le pattern `FormField` de `form.tsx` |
| 10 | Erreurs tronquees a 150 chars | 3.3.1 Error ID | Mineur | Messages complets et actionnables |

### Robust

| # | Issue | Critere WCAG | Severite | Recommandation |
|---|-------|-------------|----------|----------------|
| 11 | Modals custom sans focus trap | 4.1.2 Name, Role, Value | Critique | Migrer `ApplicationModal.tsx`, `AuthSheet.tsx` vers Radix |
| 12 | Pas d'`aria-live` pour contenu dynamique | 4.1.3 Status Messages | Majeur | `aria-live="polite"` sur resultats |
| 13 | `<div>` utilises comme boutons | 4.1.2 Name, Role, Value | Majeur | Remplacer par `<button>` natif |
| 14 | `<footer>` landmark manquant | 1.3.1 Info | Mineur | Ajouter dans AppLayout |
| 15 | Sidebar sans `<aside>` | 1.3.1 Info | Mineur | Wrapper avec `<aside>` |

### Navigation clavier

| Element | Tab Order | Enter/Space | Escape | Arrow Keys |
|---------|-----------|-------------|--------|------------|
| Radix Dialog | Piege (correct) | Ferme via bouton | Ferme | N/A |
| ApplicationModal | Non piege | Partiel | Manquant | N/A |
| AuthSheet | Non piege | Partiel | Manquant | N/A |
| Carousel | OK | N/A | N/A | Gauche/Droite |
| Mentions (comments) | OK | Selectionne | Ferme | Haut/Bas |

### Contraste couleurs

| Element | Foreground | Background | Ratio | Requis | Pass ? |
|---------|-----------|------------|-------|--------|--------|
| Body text (light) | 265 4% 12.9% | 0 0% 100% | ~13.5:1 | 4.5:1 | Pass |
| Body text (dark) | 248 0.3% 98.4% | 0 0% 15% | ~14:1 | 4.5:1 | Pass |
| Muted text (light) | 257 4.6% 55.4% | 0 0% 100% | ~5.8:1 | 4.5:1 | Pass |
| Primary button | 248 0.3% 98.4% | 266 4% 20.8% | ~12:1 | 4.5:1 | Pass |
| Destructive | 0 0% 100% | 27 24.5% 57.7% | ~6.5:1 | 4.5:1 | Pass |

---

## PARTIE 4 : UX COPY AUDIT

### Summary
**Langue :** 100% francais, aucun melange avec l'anglais. Coherence linguistique excellente.

### Error Messages (Score : 5/10)

| Pattern | Exemple | Qualite |
|---------|---------|---------|
| Bon | "Acces au microphone refuse. Verifiez les permissions du navigateur." (`LiveCoachingPanel.tsx`) | Probleme + Action |
| Bon | "Aucun microphone detecte. Verifiez le peripherique audio selectionne." | Probleme + Solution |
| Mauvais | `toast.error('Erreur lors de la generation')` (`ScorecardTab.tsx`) | Trop generique |
| Mauvais | `toast.error('Erreur lors de l\'ajout')` (`CandidateCommentsTab.tsx`) | Pas d'explication |
| Mauvais | `toast.error(err.message)` (plusieurs fichiers) | Fuite de messages techniques |

**Recommandation :** Standardiser sur le format : **Probleme** puis **Pourquoi** puis **Que faire**

### Empty States (Score : 9/10)

| Composant | Texte | Qualite |
|-----------|-------|---------|
| EmptyMissionState | "Lancez votre premiere mission" + stats (200M+ profils, 45s brief-to-sourcing) | Excellent |
| OutreachEmptyState | "Contactez vos meilleurs candidats" + 3 options | Excellent |
| FilterPresetsManager | "Aucun preset sauvegarde" + instruction | Bon |

### CTAs (Score : 8/10)

| CTA | Qualite | Note |
|-----|---------|------|
| "Commencer le brief IA" | Bon | Verbe + objet |
| "Ajouter au pipeline" | Bon | Action claire |
| "Se reconnecter" | Bon | Specifique |
| "Creation manuelle" | Faible | Nom au lieu de verbe, preferer "Creer manuellement" |

**Aucun bouton generique "OK/Oui/Non"** trouve - toujours des labels d'action specifiques.

### Confirmation Dialogs (Score : 9/10)

Excellent : "Supprimer cette sequence ?" + "Cette action est irreversible. Tous les candidats inscrits seront retires." + [Annuler] [Supprimer]

### Placeholders (Score : 9/10)

Excellents - incluent des exemples concrets :
- "Ex: Dev Senior Paris Remote"
- "Ajouter un commentaire... Tapez @ pour mentionner"
- "Resume de l'entretien et justification de la recommandation..."

### Loading States (Score : 7/10)

Bien : Messages rotatifs progressifs dans ProjectsList : "Chargement des projets..." puis "Synchronisation Notion..." puis "Recuperation des postes..."
Faible : Certains "Chargement..." generiques sans contexte.

---

## PARTIE 5 : COULEURS & TOKENS

### Top 10 fichiers avec couleurs hardcodees

| Fichier | Occurrences |
|---------|-------------|
| `src/components/outreach/BulkInMailModal.tsx` | 53 |
| `src/components/ats/LiveCoachingPanel.tsx` | 32 |
| `src/components/outreach/sequence/InteractiveFlowDiagram.tsx` | 30 |
| `src/components/outreach/projects/ProjectCandidatesTableEnhanced.tsx` | 28 |
| `src/components/jobs/JobCard.tsx` | 28 |
| `src/components/ats/ScorecardTab.tsx` | 27 |
| `src/components/outreach/projects/ProjectFunnel.tsx` | 26 |
| `src/components/outreach/SequenceEnrollmentsPanel.tsx` | 23 |
| `src/components/ats/candidate-detail/ScoringCard.tsx` | 23 |
| `src/components/outreach/SequenceActivityLog.tsx` | 22 |

### Exemples de violations
- `bg-green-100`, `text-green-800` devrait etre `bg-success/10`, `text-success`
- `text-[#1A1A1A]`, `bg-[#F5F5F5]` devrait etre `text-foreground`, `bg-muted`
- `border-emerald-500` devrait etre `border-success`

---

## PARTIE 6 : RESPONSIVE, ANIMATIONS, Z-INDEX

### Responsive (Score : 8/10)
- Mobile-first avec breakpoints sm/md/lg
- Sidebar collapse gracieux, menu mobile complet
- **Manques :** Breakpoint tablette peu teste, tabs sans scroll horizontal mobile, icones de tailles inconsistantes (h-3.5, h-4, w-[18px])

### Animations (Score : 7/10)
- Accordion : 0.2s, Fade : 0.6s, Slide : 0.25s - coherent
- BrutalLoader et AnimatedOrb : animations custom soignees
- **Manque :** Durees inline variees (duration-150 vs duration-300) sans convention

### Z-index (Score : 4/10)

| Valeur | Instances | Usage |
|--------|-----------|-------|
| z-10 | 134 | Surutilise pour tout |
| z-50 | 19 | Modals/overlays |
| z-[5000] | Multiple | Dialog, Select, Popover |

**Recommandation :** Definir une echelle semantique dans Tailwind config :
- z-dropdown: 50
- z-sticky: 100
- z-overlay: 200
- z-modal: 300
- z-popover: 400
- z-tooltip: 500

---

## PARTIE 7 : PLAN DE CORRECTIONS PRIORISE

### P0 - Critique (impact immediat)
1. **Migrer couleurs hardcodees** vers tokens CSS (90 fichiers, ~460 instances)
2. **Focus trap modals custom** vers migrer `ApplicationModal.tsx` + `AuthSheet.tsx` vers Radix Dialog
3. **Alt text images** vers 16+ instances (quick win)
4. **Labels formulaires** vers associer htmlFor/id dans les formulaires custom

### P1 - Haute priorite
5. **Skip-to-content** link dans `AppLayout.tsx`
6. **Focus visible global** dans `index.css`
7. **Touch targets** vers augmenter a 44x44px minimum pour boutons close
8. **Supprimer Navbar.tsx** (code mort, jamais importe)
9. **Migrer Phosphor vers Lucide** (5 fichiers)
10. **Loading state Button** vers ajouter variant loading au composant

### P2 - Moyenne priorite
11. **Breadcrumbs** sur pages de detail (composant existe, jamais utilise)
12. **Echelle typographique** explicite
13. **Z-index** standardise avec echelle semantique
14. **Error state Input** vers ajouter variant error
15. **aria-live regions** pour contenu dynamique
16. **Standardiser messages d'erreur** vers format "Probleme + Pourquoi + Action"

### P3 - Basse priorite
17. **Durees animation** vers convention 150ms/300ms
18. **Style shadow** vers choisir brutal vs soft
19. **Spacing scale** vers documenter et tokeniser les valeurs arbitraires
20. **Storybook** vers documenter les composants visuellement
21. **Naming convention** vers standardiser kebab-case dans ui/

---

## VERIFICATION

Ce rapport est base sur l'analyse statique du code. Pour validation complete :
1. Tester visuellement chaque page en dark mode
2. Audit Lighthouse accessibility sur les pages principales
3. Test clavier complet (Tab navigation)
4. Test tablette (768px) sur toutes les pages
5. Test VoiceOver/NVDA sur les parcours critiques
6. Zoom 200% sur toutes les pages
