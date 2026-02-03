
# Séquence conditionnelle avec branchement intelligent

## Objectif

Créer des séquences de prospection avancées avec logique conditionnelle basée sur le statut de connexion LinkedIn :

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  1. Visite de profil                                                        │
│         │                                                                   │
│         ▼                                                                   │
│  2. Attendre 2 minutes                                                      │
│         │                                                                   │
│         ▼                                                                   │
│  3. Vérifier connexion                                                      │
│         │                                                                   │
│    ┌────┴────┐                                                              │
│    ▼         ▼                                                              │
│  1er degré   2e/3e degré                                                    │
│    │            │                                                           │
│    ▼            ▼                                                           │
│ Message     Invitation                                                      │
│ direct      (<50 car.)                                                      │
│    │            │                                                           │
│    ▼            ▼                                                           │
│  [FIN]     Attendre 2 jours                                                 │
│               │                                                             │
│          ┌────┴────┐                                                        │
│          ▼         ▼                                                        │
│       Accepté   Non accepté                                                 │
│          │         │                                                        │
│          ▼         ▼                                                        │
│       Message   InMail                                                      │
│       direct    payant                                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Ce qui existe déjà

| Élément | État actuel |
|---------|-------------|
| Types d'actions | `profile_visit`, `connection_request`, `message`, `inmail`, `smart_message` |
| Triggers | `wait_connection`, `wait_reply`, `wait_profile_visit`, `condition_branch` |
| Conditions | `always`, `if_connected`, `if_not_connected`, `if_no_response` |
| Délais | Jours et heures uniquement |
| Timeout | `timeout_days` + `timeout_branch_step_id` pour branchement alternatif |

## Nouvelles fonctionnalités

### 1. Support des délais en minutes
Pour les cas comme "attendre 2 minutes après la visite de profil".

### 2. Nouveau trigger : Vérifier connexion (`check_connection`)
Un step qui vérifie le degré de connexion et route vers deux branches :
- **Si connecté (1er degré)** → branche A
- **Si non connecté** → branche B

### 3. Sélecteurs de branchement
Pouvoir sélectionner "vers quelle étape aller" selon le résultat de la condition.

### 4. Limite de caractères pour les invitations
Compteur visuel avec limite à 50 caractères pour les notes d'invitation LinkedIn.

---

## Détails techniques

### Migration base de données

Ajout de 3 colonnes à la table `sequence_steps` :

```sql
ALTER TABLE sequence_steps
ADD COLUMN delay_minutes integer DEFAULT 0,
ADD COLUMN if_true_goto_step uuid REFERENCES sequence_steps(id) ON DELETE SET NULL,
ADD COLUMN if_false_goto_step uuid REFERENCES sequence_steps(id) ON DELETE SET NULL;
```

### Modifications Frontend

**Fichier : `src/components/outreach/SequenceBuilder.tsx`**

1. **Type `SequenceStep`** - Ajouter :
   - `delayMinutes: number`
   - `ifTrueGotoStep?: string`
   - `ifFalseGotoStep?: string`

2. **Nouveau trigger `check_connection`** dans la liste TRIGGERS :
   ```typescript
   { 
     value: 'check_connection', 
     label: 'Vérifier connexion', 
     icon: GitBranch, 
     color: 'bg-indigo-100 text-indigo-600', 
     description: 'Route selon le degré', 
     requiresPrevious: [], 
     excludeIfPrevious: [] 
   }
   ```

3. **Input minutes** dans la section délais (à côté de jours/heures)

4. **Configuration branchement** pour `check_connection` :
   - Dropdown "Si connecté → aller à l'étape X"
   - Dropdown "Si non connecté → aller à l'étape Y"

5. **Compteur de caractères** pour `connection_request` :
   - Afficher "X/50" sous le champ message
   - Rouge si > 50 caractères

### Modifications Backend

**Fichier : `supabase/functions/process-sequences/index.ts`**

1. **Support `delay_minutes`** dans `scheduleNextStep()` :
   ```typescript
   scheduledAt.setMinutes(scheduledAt.getMinutes() + (nextStep.delay_minutes || 0));
   ```

2. **Handler `check_connection`** dans `executeStepAction()` :
   ```typescript
   case 'check_connection': {
     const profile = await getProfileInfo(accountId, profileId);
     const isConnected = profile?.network_distance === 'FIRST_DEGREE';
     
     const nextStepId = isConnected 
       ? step.if_true_goto_step 
       : step.if_false_goto_step;
     
     if (nextStepId) {
       await scheduleNextStep(supabase, enrollment, step.step_order, nextStepId);
     }
     
     return { success: true };
   }
   ```

### Fichier : `src/components/outreach/SequencesList.tsx`

Mapper les nouveaux champs lors de la sauvegarde :
- `delay_minutes` ← `step.delayMinutes`
- `if_true_goto_step` ← `step.ifTrueGotoStep`
- `if_false_goto_step` ← `step.ifFalseGotoStep`

---

## Exemple de séquence créée

| Ordre | Type | Condition | Délai | Action |
|-------|------|-----------|-------|--------|
| 1 | profile_visit | always | 0 | Visite du profil |
| 2 | check_connection | - | 2 min | Vérifie si connecté → 3 / sinon → 4 |
| 3 | message | if_connected | 0 | Message direct (FIN) |
| 4 | connection_request | if_not_connected | 0 | Invitation (<50 car.) |
| 5 | wait_connection | - | timeout: 2j | Attendre acceptation → 6 / sinon → 7 |
| 6 | message | if_connected | 0 | Message si accepté |
| 7 | inmail | if_not_connected | 0 | InMail si non accepté |

---

## Fichiers à modifier

| Fichier | Type de modification |
|---------|---------------------|
| Migration SQL | Nouvelle migration : `delay_minutes`, `if_true_goto_step`, `if_false_goto_step` |
| `src/components/outreach/SequenceBuilder.tsx` | Ajouter trigger, input minutes, compteur caractères, UI branchement |
| `src/components/outreach/SequencesList.tsx` | Mapper les nouveaux champs à la sauvegarde |
| `supabase/functions/process-sequences/index.ts` | Handler `check_connection`, support `delay_minutes` |

