

# Plan : Rendre l'évaluation et la scorecard responsive mobile

## Problèmes identifiés

### 1. CandidateDetailModal (`CandidateDetailModal.tsx`)
- **Dialog** : en mode split (onglet Évaluation), forcé à `95vw/95vh` avec un panneau droit fixe de `w-[400px]` -- inutilisable sur mobile
- **Header** : boutons d'action (`LinkedIn`, `Email`, `Portail`) en `flex ml-auto` débordent sur petit écran
- **Stage + actions** (l.294) : `flex items-center gap-4` non wrappé
- **Tabs** : `overflow-x-auto` OK mais les tabs sont petits et serrés

### 2. ScorecardTab (`ScorecardTab.tsx`)
- **Header bar** (l.391-438) : `flex items-center justify-between` avec 3 boutons (`Coaching Live`, `Régénérer`, `Sauvegarder`) côte à côte -- déborde sur mobile
- **Critères** : les étoiles (5 boutons) + chevron + badges tiennent difficilement sur petit écran
- **Verdict section** : `flex flex-wrap gap-1.5` pour les 5 recommandations -- OK mais les boutons sont larges

### 3. Qualification page (`Qualification.tsx`)
- **Header** (l.152-173) : `flex items-center justify-between` avec titre long + bouton Sauvegarder
- **Grid** (l.175) : `grid-cols-1 lg:grid-cols-3` -- déjà responsive, OK
- **Verdict buttons** (l.327) : `grid grid-cols-2 sm:grid-cols-4` -- OK

## Changements prévus

### CandidateDetailModal
- Mode split sur mobile : **empiler verticalement** au lieu de `flex` horizontal. Le panneau droit passe en dessous ou est masqué derrière un bouton toggle
- Remplacer `w-[400px] shrink-0` par `w-full lg:w-[400px]` et `flex` par `flex flex-col lg:flex-row`
- Header actions : wrapper avec `flex-wrap` et cacher les labels sur mobile (icônes seules)
- Stage row : `flex flex-wrap gap-2` au lieu de `gap-4`

### ScorecardTab
- Header buttons : stack vertical sur mobile (`flex flex-col sm:flex-row`)
- Boutons d'action : texte caché sur mobile, icônes seules via `hidden sm:inline`
- Étoiles : réduire taille sur mobile (`w-4 h-4` au lieu de `w-5 h-5` sur `< sm`)

### Qualification page
- Header : `flex flex-col sm:flex-row` pour empiler titre et bouton sur mobile
- Padding : réduire `px-6` à `px-4` sur mobile

## Fichiers modifiés
1. `src/components/ats/CandidateDetailModal.tsx` -- layout split, header, tabs, actions
2. `src/components/ats/ScorecardTab.tsx` -- header buttons, criteria rows, verdict
3. `src/pages/Qualification.tsx` -- header responsive, padding

