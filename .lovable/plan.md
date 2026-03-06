

# Plan : Refonte du coaching live -- mode "checklist + signaux"

## Concept

Remplacer le feed chronologique (liste d'alertes qui s'empilent) par deux sections stables :

1. **Checklist des critères** : la liste complète des critères de la scorecard, chacun avec un statut (pas encore abordé / couvert / signal positif/négatif). L'IA coche automatiquement quand le sujet est traité. Le recruteur voit d'un coup d'oeil ce qu'il reste à couvrir.

2. **Signaux à creuser** : uniquement les points que l'IA détecte comme méritant d'être approfondis (hésitation, contradiction, red flag, opportunité). Maximum 2-3 items visibles, remplacés à chaque cycle (pas d'accumulation). Si rien d'intéressant, la section reste vide -- pas de bruit.

```text
┌─────────────────────────────────────────┐
│ ✅ Leadership          ⬜ Salaire       │
│ ✅ Expérience tech     ⬜ Disponibilité │
│ ⚠️ Motivation (négatif) ⬜ Culture fit  │
├─────────────────────────────────────────┤
│ 🔍 CREUSER                              │
│ "Il hésite sur sa date de dispo"        │
│  → Demander : quand exactement ?        │
│                                         │
│ "Mentionne une contre-offre"            │
│  → Creuser le montant et la timeline    │
└─────────────────────────────────────────┘
```

## Changements

### 1. Prompt backend (`supabase/functions/live-coach/index.ts`)

Modifier le prompt système pour demander un output différent :
- **`criteria_updates`** : inchangé (l'IA marque les critères couverts)
- **`dig_deeper`** : remplace `alerts` + `suggestions`. Liste de 0 à 3 items avec `{ signal: string, question: string }`. L'IA ne retourne des items que quand il y a quelque chose de pertinent à creuser
- Supprimer le champ `alerts` du JSON de sortie
- Augmenter la consigne : "Si rien de nouveau ou intéressant à signaler, retourne dig_deeper vide. Ne génère PAS d'items juste pour en générer."

### 2. Frontend (`src/components/ats/LiveCoachingPanel.tsx`)

**State** :
- Remplacer `coachFeed: CoachAlert[]` par `digDeeper: { signal: string; question: string }[]`
- Conserver `criteriaStatus` inchangé
- Conserver `alertsLogRef` pour le rapport final (stocker tous les dig_deeper historiques)

**Intervalle** :
- Passer `COACH_INTERVAL_MS` de 15s à 30s
- Ne plus déclencher sur `speech_final`, uniquement sur `UtteranceEnd` + timer (réduire les appels)

**UI** :
- **Section haute** : grille de tous les critères (compacte, 2 colonnes). Chaque critère = badge avec icone (⬜ pas couvert, ✅ couvert positif, ⚠️ couvert négatif). Clickable pour voir le verbatim
- **Section basse** : "À creuser" -- les 2-3 derniers `dig_deeper` items. Remplacés à chaque cycle, pas accumulés. Animation `animate-in` quand ça change. Si vide, afficher "RAS -- continuez l'entretien"
- Supprimer le `ScrollArea` du coach feed (plus besoin de scroller, tout tient dans l'espace fixe)

### 3. Réponse du coach (`analyzeWithCoach`)

Adapter le parsing :
- `data.dig_deeper` remplace `data.alerts` + `data.suggestions`
- Setter `setDigDeeper(data.dig_deeper || [])` (remplacement, pas accumulation)
- Pousser dans `alertsLogRef` pour historique

## Fichiers modifiés
1. `supabase/functions/live-coach/index.ts` -- nouveau prompt + nouveau format JSON
2. `src/components/ats/LiveCoachingPanel.tsx` -- nouveau state, nouvelle UI, intervalle 30s

