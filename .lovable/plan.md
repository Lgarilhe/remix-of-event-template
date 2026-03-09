

# Bug : Messages de relance envoyés sans premier message

## Diagnostic

J'ai identifié le bug dans le moteur de séquences. Voici ce qui se passe :

### Séquence "Prospection candidat" — structure du graph

```text
Step 0: profile_visit
Step 1: check_connection
  ├─ Connected → Step 2: message (1er msg)
  │                 └→ Step 8: message (relance 1) → Step 9: message (relance 2)
  └─ Not connected → Step 3: connection_request
                       └→ Step 4: wait_connection
                            ├─ Connexion acceptée → Step 6: message (1er msg post-connexion)
                            │                         └→ Step 8: message (relance 1) → Step 9 (relance 2)
                            └─ Timeout → Step 5: inmail (initial)
                                           └→ Step 7: inmail (relance)
                                                └→ ??? (PAS DE next_step_id)
```

### Le bug

Step 7 (InMail relance) a `next_step_id: null`. Quand cette étape est terminée, la fonction `scheduleNextStep` utilise le **fallback `step_order + 1`** (ligne 1030 de `process-sequences`), ce qui programme Step 8 (order 8 = message relance 1).

Mais Step 8 est une relance du premier message direct (Step 2 ou 6), qui n'a **jamais été envoyé** dans le parcours InMail. Résultat : le candidat reçoit une "relance" sans avoir reçu le premier message.

### Cas avéré

**Virgile Boulanger** : a reçu InMail initial (step 5), InMail relance (step 7), puis un message direct "relance" (step 8) alors qu'aucun premier message direct n'avait été envoyé.

### Seul 1 candidat affecté pour l'instant, mais le bug est structurel.

---

## Correctif proposé

### 1. Corriger le graph : terminer la branche InMail

Le step 7 (InMail relance) doit **compléter la séquence** au lieu de tomber dans le fallback. On doit soit :
- Ajouter une vérification dans `scheduleNextStep` pour empêcher le fallback `step_order + 1` quand le step courant est un **branch target** (déjà pointé par un `timeout_branch_step_id`, `if_true_goto_step`, ou `if_false_goto_step`)
- OU corriger la donnée : ne pas utiliser le fallback si le step courant fait partie d'une branche isolée

### 2. Fix dans `scheduleNextStep` (approche structurelle)

Avant de fallback sur `step_order + 1`, vérifier si le step courant est atteint via une branche (referenced by `timeout_branch_step_id`, `if_true/false_goto_step`). Si oui, **ne pas fallback** et compléter la séquence.

Le code existant fait déjà partiellement cette vérification (lignes 1050-1058), mais il ne **bloque pas** le fallback — il se contente de logger.

### 3. Guard supplémentaire : vérifier les précédents avant d'envoyer un message de relance

Dans `handleProcess`, avant d'exécuter un step de type message avec `condition_type: if_connected`, vérifier que le candidat a bien au moins un message `sent` dans la même branche logique. Si non → skip avec raison "no_previous_message".

### Fichiers modifiés

1. **`supabase/functions/process-sequences/index.ts`** :
   - `scheduleNextStep()` : transformer le log des lignes 1050-1058 en **return** effectif pour empêcher le fallback `step_order + 1` quand le step est un branch target
   - `handleProcess()` : ajouter un guard avant les message/inmail pour vérifier qu'un message précédent a bien été envoyé quand le step fait partie d'une chaîne de relances

2. **Migration SQL** (optionnelle) :
   - Annuler le step 8 de Virgile Boulanger si pas encore traité

