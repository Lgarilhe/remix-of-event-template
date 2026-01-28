
# Plan d'Optimisation du Système de Séquences

## Contexte et Objectif

L'objectif est d'optimiser le système de séquences d'outreach actuel en exploitant pleinement les capacités de l'API Unipile et en s'inspirant des meilleures pratiques de Lemlist pour créer des workflows conditionnels intelligents.

---

## Analyse de l'Existant

### Ce qui est implémenté actuellement

1. **Structure de données** : Tables `outreach_sequences`, `sequence_steps`, `sequence_enrollments`, `sequence_step_executions`
2. **Types d'actions** : InMail, demande connexion, visite profil, message direct
3. **Conditions basiques** : always, if_connected, if_not_connected, if_no_response
4. **Edge function** : `process-sequences` avec les conditions non implémentées (TODO)

### Lacunes identifiées

1. Les conditions `if_connected`, `if_not_connected`, `if_no_response` retournent toujours `true` (non implémentées)
2. Pas de détection automatique du niveau de connexion (1er, 2ème, 3ème degré)
3. Pas de vérification si une invitation a été acceptée
4. Pas de détection des réponses reçues
5. Pas de webhooks pour les événements en temps réel
6. Interface de création de séquences basique sans visualisation du workflow

---

## Fonctionnalités Unipile Disponibles (à exploiter)

D'après la documentation Unipile, voici les endpoints clés pour les séquences :

| Endpoint | Utilité |
|----------|---------|
| `GET /users/{id}` | Récupère le profil avec `network_distance` (FIRST_DEGREE, SECOND_DEGREE, THIRD_DEGREE) et `is_relationship` |
| `GET /users/invite/sent` | Liste les invitations envoyées en attente |
| `POST /users/invite` | Envoie une demande de connexion |
| `GET /chat_attendees/{id}/chats` | Vérifie si une conversation existe avec un profil |
| `GET /chats/{id}/messages` | Récupère les messages pour détecter les réponses |
| `POST /chats` | Crée une nouvelle conversation (message direct) |
| `POST /chats/{id}/messages` | Envoie un message dans une conversation existante |
| Webhooks | Notifications en temps réel (nouveau message, statut compte) |

---

## Fonctionnalités Lemlist à Répliquer

D'après l'analyse des templates Lemlist, voici les patterns de séquences les plus efficaces :

### Conditions Avancées

1. **Attendre acceptation LinkedIn** : Pause jusqu'à ce que l'invitation soit acceptée
2. **Branchement multicanal** : Si le prospect a un profil LinkedIn, utiliser LinkedIn + email, sinon email seul
3. **Timeout conditionnel** : Si l'invitation n'est pas acceptée sous X jours, passer à une autre branche
4. **Réaction aux interactions** : Envoyer un message si le prospect visite un lien ou ouvre un email
5. **Détection de réponse** : Stopper la séquence dès qu'une réponse est reçue

### Visualisation Workflow

Lemlist propose un éditeur visuel type "arbre de décision" avec des branches conditionnelles.

---

## Plan d'Implémentation

### Phase 1 : Implémenter les Vérifications de Statut Unipile

**Fichiers à modifier/créer :**

1. **`supabase/functions/process-sequences/index.ts`**

   Implémenter les fonctions de vérification réelles :

   ```text
   checkStepCondition():
   - if_connected: GET /users/{profile_id} → vérifier network_distance === "FIRST_DEGREE"
   - if_not_connected: network_distance !== "FIRST_DEGREE"
   - if_no_response: GET /chat_attendees/{profile_id}/chats → vérifier si messages reçus du prospect
   
   checkForReply():
   - GET /chat_attendees/{profile_id}/chats
   - Pour chaque chat: GET /chats/{id}/messages
   - Vérifier si un message du prospect existe après le dernier message envoyé
   ```

2. **Nouvelle fonction `check-invitation-status`**

   Endpoint pour vérifier le statut des invitations en attente :
   - `GET /users/invite/sent` pour lister les invitations envoyées
   - Comparer avec les enrollments actifs pour détecter les acceptations

---

### Phase 2 : Enrichir les Types de Conditions

**Nouvelles conditions à ajouter :**

| Condition | Description | Logique |
|-----------|-------------|---------|
| `wait_until_connected` | Pause la séquence jusqu'à acceptation (max X jours) | Bloquer step jusqu'à network_distance === FIRST_DEGREE |
| `if_invitation_pending` | Si invitation en attente | Vérifier dans /users/invite/sent |
| `if_replied_positive` | Si réponse positive détectée | Analyse IA du contenu de la réponse |
| `if_opened_message` | Si le message a été lu | Vérifier read receipts via API |
| `timeout_branch` | Branchement après X jours sans action | Logique de timeout avec branche alternative |

**Modification schema DB :**

```sql
ALTER TABLE sequence_steps ADD COLUMN timeout_days integer DEFAULT NULL;
ALTER TABLE sequence_steps ADD COLUMN timeout_branch_step_id uuid DEFAULT NULL;
ALTER TABLE sequence_steps ADD COLUMN wait_for_event text DEFAULT NULL;
-- Valeurs possibles: 'connection_accepted', 'message_read', 'reply_received'
```

---

### Phase 3 : Branchement Conditionnel (Workflow Arbre)

**Nouveau concept : Branches de séquence**

Modifier la structure pour supporter des branches :

```sql
CREATE TABLE sequence_branches (
  id uuid PRIMARY KEY,
  sequence_id uuid REFERENCES outreach_sequences(id),
  name text NOT NULL,
  parent_step_id uuid REFERENCES sequence_steps(id), -- Point de branchement
  branch_condition text NOT NULL, -- 'default', 'on_accept', 'on_timeout', 'on_reply'
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sequence_steps ADD COLUMN branch_id uuid REFERENCES sequence_branches(id);
```

**Logique de branchement :**

```text
Étape 1: Demande connexion
  ├── [Si acceptée sous 4 jours] → Branche A: Message direct
  └── [Timeout 4 jours] → Branche B: InMail de relance
```

---

### Phase 4 : Intelligence Automatique

**1. Choix automatique InMail vs Message :**

Avant d'exécuter une étape de type "message", vérifier automatiquement :
- Si `network_distance === "FIRST_DEGREE"` → Envoyer un message direct via `/chats`
- Sinon → Envoyer un InMail

**2. Détection du type de message optimal :**

- Vérifier si le prospect a des crédits InMail disponibles (profil premium)
- Adapter le type de contact en fonction

**3. Scheduling intelligent :**

- Analyser les patterns d'activité du prospect (heures de réponse)
- Ajuster les horaires d'envoi en fonction

---

### Phase 5 : Interface Utilisateur Améliorée

**1. Éditeur Visuel de Séquence (type flowchart)**

```text
Composants à créer :
- SequenceFlowEditor.tsx : Éditeur visuel avec nœuds et connexions
- StepNode.tsx : Composant nœud pour chaque étape
- ConditionNode.tsx : Composant pour les branchements conditionnels
- ConnectionLine.tsx : Lignes de connexion entre nœuds
```

Utiliser une bibliothèque comme `reactflow` ou `elkjs` pour le rendu.

**2. Preview de séquence :**

Afficher une timeline visuelle du parcours prévu pour un candidat :
```text
J+0: Visite profil
J+1: Demande connexion
     └── [Si acceptée] J+2: Message de bienvenue
     └── [Timeout 4j] J+5: InMail de relance
J+7: Follow-up si pas de réponse
```

**3. Dashboard de suivi enrichi :**

- Taux d'acceptation des invitations par séquence
- Temps moyen avant réponse
- Étapes les plus efficaces
- Funnel de conversion visuel

---

### Phase 6 : Webhooks et Temps Réel

**Configuration des webhooks Unipile :**

1. Créer un endpoint `supabase/functions/unipile-webhook/index.ts` pour recevoir :
   - `new_message` : Nouvelle message reçu
   - `account_status` : Changement de statut du compte

2. À la réception d'un webhook :
   - Identifier l'enrollment concerné
   - Mettre à jour le statut (replied, connected, etc.)
   - Déclencher le branchement approprié

---

## Résumé des Modifications

### Fichiers à Modifier

| Fichier | Modifications |
|---------|--------------|
| `supabase/functions/process-sequences/index.ts` | Implémenter checkStepCondition() et checkForReply() avec les vraies API Unipile |
| `src/components/outreach/SequenceBuilder.tsx` | Ajouter nouvelles conditions et UI timeout/branches |
| `src/components/outreach/SequencesList.tsx` | Afficher stats détaillées par séquence |

### Nouveaux Fichiers à Créer

| Fichier | Description |
|---------|-------------|
| `supabase/functions/check-invitation-status/index.ts` | Vérifier statut invitations périodiquement |
| `supabase/functions/unipile-webhook/index.ts` | Recevoir webhooks Unipile |
| `src/components/outreach/SequenceFlowEditor.tsx` | Éditeur visuel de séquence |
| `src/components/outreach/SequenceAnalytics.tsx` | Dashboard analytics détaillé |

### Migration Base de Données

```sql
-- Nouvelles colonnes pour sequence_steps
ALTER TABLE sequence_steps ADD COLUMN timeout_days integer;
ALTER TABLE sequence_steps ADD COLUMN wait_for_event text;

-- Nouvelles colonnes pour sequence_enrollments  
ALTER TABLE sequence_enrollments ADD COLUMN last_check_at timestamptz;
ALTER TABLE sequence_enrollments ADD COLUMN connection_status text DEFAULT 'unknown';
-- Valeurs: 'unknown', 'pending_invite', 'connected', 'not_connected'

-- Table pour les statistiques
CREATE TABLE sequence_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid REFERENCES outreach_sequences(id),
  date date NOT NULL,
  invites_sent integer DEFAULT 0,
  invites_accepted integer DEFAULT 0,
  messages_sent integer DEFAULT 0,
  replies_received integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
```

---

## Ordre de Priorité Recommandé

1. **Priorité Haute** : Implémenter les vérifications Unipile réelles (Phase 1)
2. **Priorité Haute** : Détecter les réponses et stopper les séquences (Phase 1)
3. **Priorité Moyenne** : Ajouter la condition wait_until_connected (Phase 2)
4. **Priorité Moyenne** : Intelligence InMail vs Message auto (Phase 4)
5. **Priorité Basse** : Branchement conditionnel complet (Phase 3)
6. **Priorité Basse** : Éditeur visuel flowchart (Phase 5)
7. **Optionnel** : Webhooks temps réel (Phase 6)

---

## Section Technique

### Endpoints Unipile à Utiliser

```typescript
// Vérifier niveau de connexion
GET /users/{profile_id}?account_id={account_id}
// Réponse inclut: network_distance, is_relationship

// Lister invitations envoyées
GET /users/invite/sent?account_id={account_id}

// Vérifier conversations existantes
GET /chat_attendees/{profile_id}/chats?account_id={account_id}

// Récupérer messages d'un chat
GET /chats/{chat_id}/messages?limit=10

// Envoyer message direct (1er niveau)
POST /chats avec { account_id, attendees: [{ provider_id }], text }

// Envoyer InMail (2ème/3ème niveau)
POST /chats avec { account_id, attendees: [{ provider_id }], text, subject }
// Note: L'API Unipile gère automatiquement le type selon la relation
```

### Logique de Détection de Réponse

```typescript
async function hasProspectReplied(accountId: string, profileId: string, sinceDate: Date): Promise<boolean> {
  // 1. Trouver le chat avec ce profil
  const chats = await fetch(`/chat_attendees/${profileId}/chats?account_id=${accountId}`);
  
  if (!chats.items?.length) return false;
  
  // 2. Vérifier les messages récents
  for (const chat of chats.items) {
    const messages = await fetch(`/chats/${chat.id}/messages?limit=20`);
    
    // 3. Chercher un message du prospect après notre dernier envoi
    const prospectMessages = messages.items.filter(m => 
      m.sender_attendee_id !== 'self' && 
      new Date(m.created_at) > sinceDate
    );
    
    if (prospectMessages.length > 0) return true;
  }
  
  return false;
}
```
