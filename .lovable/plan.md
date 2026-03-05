

## Recherche et Analyse des Best Practices

D'après la recherche, voici ce que les meilleurs ATS et guides de recrutement recommandent et que notre scorecard ne fait **pas encore** :

### Ce qui manque aujourd'hui

| Best Practice (industrie) | Notre scorecard actuelle |
|---|---|
| **Questions d'entretien suggérées** par critère | Juste une description vague |
| **Rubrique de notation** (définition de chaque niveau 1-5) | Étoiles sans explication |
| **Verdict final / Recommandation** (Go/No-Go + justification) | Absent |
| **Signaux d'alerte (red flags)** générés par l'IA | Absent |
| **Questions de suivi** pour le prochain round | Absent |
| **Scorecard par étape** (phone screen vs technique vs final) | Pas de distinction |
| **Résumé IA post-évaluation** basé sur les notes saisies | Absent |

### Plan d'amélioration

#### 1. Enrichir le modèle de critère (Edge Function + types)

L'IA générera pour chaque critère :
- `suggestedQuestions: string[]` — 2-3 questions d'entretien spécifiques à poser
- `ratingRubric: Record<string, string>` — description de ce que signifie chaque note (1="Aucune connaissance", 3="Compétent", 5="Expert")
- `redFlags: string[]` — signaux d'alerte à surveiller

Mise à jour du prompt dans `generate-scorecard/index.ts` pour demander ces champs supplémentaires.

#### 2. Ajouter un type d'étape (interview stage)

Ajouter un champ `stage` à `EvaluationData` permettant de choisir le type d'entretien : "Phone Screen", "Technique", "Culture Fit", "Final". L'IA adaptera les critères en fonction.
- Sélecteur dans l'UI avant la génération
- Passé au prompt pour contextualiser

#### 3. Section verdict final

En bas de la scorecard active, ajouter :
- **Recommandation** : Strong Yes / Yes / Maybe / No / Strong No (boutons radio)
- **Résumé libre** : textarea pour la justification
- **Points de suivi** : textarea pour les questions à creuser au prochain round
- Persistés dans les champs `recommendation`, `summary`, `follow_up_notes` du record

#### 4. Rubrique de notation visible

Quand un critère est expandé, afficher sous la description un mini-tableau des niveaux (1 à 5) avec la définition spécifique générée par l'IA. L'utilisateur sait exactement ce que signifie chaque étoile.

#### 5. Questions d'entretien suggérées

Dans la zone expandée de chaque critère, afficher les 2-3 questions suggérées par l'IA avec un style "prompt card" copiable.

#### 6. Red flags IA

Afficher les signaux d'alerte en badge rouge dans chaque critère concerné.

---

### Modifications techniques

**`supabase/functions/generate-scorecard/index.ts`** :
- Enrichir le prompt pour demander `suggestedQuestions`, `ratingRubric` (objet avec clés "1" à "5"), `redFlags` par critère
- Ajouter un paramètre `interviewStage` au body pour contextualiser

**`src/components/ats/ScorecardTab.tsx`** :
- Étendre `Criterion` avec les nouveaux champs
- Ajouter `EvaluationData.recommendation`, `summary`, `followUpNotes`, `interviewStage`
- Sélecteur d'étape avant génération
- UI expandée enrichie : rubrique, questions, red flags
- Section verdict en bas avec recommandation + résumé + suivi

**Migration SQL** :
- Ajouter colonnes `recommendation text`, `summary text`, `follow_up_notes text`, `interview_stage text` à `candidate_evaluations`

