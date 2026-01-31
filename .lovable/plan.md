

# Plan : Copilot MCP-Powered avec RAG

## Vision

Créer un **assistant IA contextuel unifié** (Copilot) qui :
1. **Se connecte aux outils externes via MCP** (Notion déjà connecté, extensible à d'autres)
2. **Fonctionne en mode RAG** (Retrieval Augmented Generation) pour une compréhension profonde
3. **Agit sur l'ensemble du système** avec une intelligence contextuelle

Ce Copilot remplacera les 6+ features IA éparpillées actuelles par un point d'entrée unique, accessible partout.

---

## État Actuel - Inventaire IA à Unifier

### Edge Functions IA Existantes

| Fonction | Rôle | Contexte utilisé |
|----------|------|------------------|
| `chat-filter-assistant` | Génère les filtres LinkedIn | Job sélectionné, filtres actuels |
| `generate-outreach-message` | Rédige les messages d'approche | Profil candidat, job, ton |
| `analyze-response` | Analyse l'intent des réponses | Conversation, profil, jobs dispo |
| `score-profile-job` | Score compatibilité profil/poste | Profil complet, critères job |
| `generate-reply-suggestions` | Suggestions de réponses | Conversation en cours |
| `analyze-linkedin-profile` | Analyse un profil LinkedIn | Données profil brutes |

### Composants UI IA Actuels

| Composant | Localisation | Actions |
|-----------|--------------|---------|
| `FilterAssistantModal` | Outreach | Chat filtres LinkedIn |
| `OutreachMessageModal` | Outreach | Génère messages |
| `NurturingPanel` | Messages | Analyse intent + suggestions |
| `JobScoreDisplay` | Résultats | Affiche score IA |

### Sources de Données MCP Disponibles

| Source | Statut | Données |
|--------|--------|---------|
| **Notion** | Connecté | Jobs, Candidats, Shortlist, Critères Transverses |
| (Autres) | Extensible | Slack, Google Drive, Linear... |

---

## Architecture du Copilot MCP

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                          FRONTEND                                        │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                     CopilotProvider (Context)                      │  │
│  │  • currentPage: 'outreach' | 'ats' | 'candidates' | 'messages'     │  │
│  │  • selectedItems: candidat(s), job(s), conversation                │  │
│  │  • conversationHistory: messages du Copilot                        │  │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                    CopilotPanel (UI)                               │  │
│  │  • Panneau latéral flottant (toggle Cmd+K)                         │  │
│  │  • Chat conversationnel streaming                                  │  │
│  │  • Actions contextuelles automatiques                              │  │
│  │  • Suggestions proactives                                          │  │
│  └─────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────│────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    EDGE FUNCTION: copilot                                │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                    Context Builder (RAG)                           │  │
│  │  • Récupère les données pertinentes via MCP                        │  │
│  │  • Enrichit le prompt avec le contexte métier                      │  │
│  │  • Vectorise et cherche les infos similaires                       │  │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                    Action Router                                   │  │
│  │  • Détecte l'intention utilisateur                                 │  │
│  │  • Route vers le bon "skill" (filtres, message, scoring...)        │  │
│  │  • Exécute les actions (update Notion, envoi message...)           │  │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                    MCP Connectors Layer                            │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │  │
│  │  │     Notion       │  │   Unipile        │  │   (Extensible)   │  │  │
│  │  │  Jobs, Candidats │  │  LinkedIn API    │  │   Slack, etc.    │  │  │
│  │  │  Shortlist       │  │  Messages        │  │                  │  │  │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Fonctionnalités du Copilot

### 1. Mode Conversationnel Unifié

L'utilisateur parle naturellement, le Copilot comprend et agit :

| Demande Utilisateur | Réponse du Copilot |
|---------------------|---------------------|
| "Configure les filtres pour le poste Numspot" | Analyse le job Notion, propose filtres LinkedIn |
| "Rédige un message pour ce candidat" | Récupère profil + job actif, génère message personnalisé |
| "Évalue ces 3 profils pour le poste X" | Score batch avec critères Must/Should/Nice |
| "Résume les réponses de la journée" | Agrège les messages, détecte les intents |
| "Mets Jean dans le pipeline Numspot" | Crée l'entrée Shortlist dans Notion |
| "Quels candidats ont répondu positivement ?" | Filtre les conversations avec intent 'interested' |

### 2. Conscience Contextuelle (RAG)

Le Copilot sait automatiquement :
- **Page active** : Outreach, ATS, Candidates, Messages
- **Éléments sélectionnés** : Profil(s), Job, Conversation
- **Historique récent** : Dernières actions, derniers messages
- **Données Notion** : Jobs actifs, critères de scoring, pipeline

### 3. Actions Automatiques

Le Copilot peut **exécuter** des actions, pas seulement suggérer :
- Appliquer des filtres LinkedIn
- Envoyer un InMail (avec confirmation)
- Créer/Mettre à jour des entrées Notion
- Changer le stage d'un candidat
- Planifier un rappel

### 4. Suggestions Proactives

Le Copilot apparait avec des suggestions contextuelles :
- **Page Outreach vide** : "Veux-tu que je configure les filtres pour [Job actif] ?"
- **Nouveau message reçu** : Badge avec intent détecté + actions suggérées
- **Profil consulté** : "Score: 85% pour [Job]. Tu veux rédiger un message ?"

---

## Implémentation Technique

### Phase 1 : Infrastructure Frontend

**Fichiers à créer :**

```text
src/contexts/CopilotContext.tsx
  - État global du Copilot (page, sélection, conversation)
  - Hook useRegisterCopilotContext() pour injection depuis les pages

src/components/copilot/CopilotPanel.tsx
  - Panneau latéral avec chat streaming
  - Rendu markdown des réponses
  - Actions rapides contextuelles

src/components/copilot/CopilotTrigger.tsx
  - Bouton flottant (icône IA)
  - Raccourci clavier Cmd+K
  - Badge de notification

src/components/copilot/CopilotMessage.tsx
  - Affichage des messages (user/assistant)
  - Rendu des actions suggérées
  - Boutons d'action inline

src/hooks/useCopilot.ts
  - useAskCopilot() : envoyer une question
  - useCopilotActions() : exécuter une action
  - useCopilotContext() : lire le contexte
```

### Phase 2 : Edge Function Unifiée

**Fichier à créer :**

```text
supabase/functions/copilot/index.ts
```

Structure de la fonction :

```typescript
// Schéma de requête
interface CopilotRequest {
  // Message utilisateur
  message: string;
  
  // Contexte frontend
  context: {
    page: 'outreach' | 'ats' | 'candidates' | 'messages';
    selectedJobId?: string;
    selectedProfiles?: ProfileData[];
    activeConversation?: Message[];
    currentFilters?: LinkedInFiltersState;
  };
  
  // Historique conversation Copilot
  history: { role: 'user' | 'assistant'; content: string }[];
  
  // Options
  action?: 'chat' | 'execute'; // chat = répondre, execute = agir
}

// Schéma de réponse
interface CopilotResponse {
  message: string; // Réponse texte
  actions?: CopilotAction[]; // Actions suggérées
  data?: any; // Données structurées (filtres, message généré, etc.)
  executed?: { // Si action exécutée
    type: string;
    result: any;
  };
}
```

### Phase 3 : Intégration MCP pour RAG

Le Copilot utilisera les outils Notion MCP déjà connectés :

```text
Capacités MCP Notion disponibles :
- notion-search : Recherche sémantique dans les bases
- notion-fetch : Récupère les détails d'une page/DB
- notion-create-pages : Crée des entrées (Shortlist, etc.)
- notion-update-page : Met à jour un candidat/job
```

**Logique RAG dans l'edge function :**

1. **Détection d'intention** : L'IA analyse la demande utilisateur
2. **Récupération contexte** : 
   - Si job mentionné → fetch depuis Notion via API
   - Si candidat mentionné → récupère profil + historique
   - Si critères → enrichit avec transversal criteria
3. **Génération réponse** : Prompt enrichi avec tout le contexte
4. **Exécution optionnelle** : Si action confirmée, appelle l'API appropriée

### Phase 4 : Migration Progressive

1. **Ajouter CopilotProvider** dans `App.tsx`
2. **Injecter contexte** depuis chaque page via `useRegisterCopilotContext`
3. **Remplacer progressivement** les anciens boutons par des raccourcis Copilot
4. **Garder les anciennes modales** comme fallback pendant la transition

### Phase 5 : Suppression du Legacy

Une fois le Copilot stable :
- Supprimer `FilterAssistantModal.tsx`
- Supprimer `OutreachMessageModal.tsx`  
- Simplifier `NurturingPanel.tsx` (affichage seul, pas de génération)
- Retirer les boutons IA éparpillés

---

## Interface Utilisateur

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  Outreach > Recherche LinkedIn          [Filtres] [Job: Numspot ▼] 🤖  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                      ┌─────────────────┐│
│  Résultats de recherche...                           │     Copilot     ││
│                                                      │                 ││
│  ┌─────────────────────┐                             │ "Tu es sur la   ││
│  │ Profil 1 ☑          │                             │ page Outreach   ││
│  └─────────────────────┘                             │ avec 3 profils  ││
│  ┌─────────────────────┐                             │ sélectionnés"   ││
│  │ Profil 2 ☑          │                             │                 ││
│  └─────────────────────┘                             │ ┌─────────────┐ ││
│  ┌─────────────────────┐                             │ │📝 Rédiger   │ ││
│  │ Profil 3 ☑          │                             │ │   message   │ ││
│  └─────────────────────┘                             │ └─────────────┘ ││
│                                                      │ ┌─────────────┐ ││
│                                                      │ │📊 Évaluer   │ ││
│                                                      │ │   profils   │ ││
│                                                      │ └─────────────┘ ││
│                                                      │                 ││
│                                                      │ ┌─────────────┐ ││
│                                                      │ │ Demande...  │ ││
│                                                      │ └─────────────┘ ││
│                                                      │ [    Envoyer  ] ││
│                                                      └─────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Extensibilité MCP

Le Copilot est conçu pour être **extensible** à d'autres outils MCP :

| Outil | Cas d'usage |
|-------|-------------|
| **Slack** | "Préviens l'équipe qu'on a trouvé un candidat chaud" |
| **Google Calendar** | "Planifie un call avec Jean jeudi à 14h" |
| **Linear** | "Crée une tâche de suivi pour ce candidat" |
| **Airtable** | Alternative/complément à Notion |

L'architecture MCP permet d'ajouter des connecteurs sans modifier le code du Copilot.

---

## Estimation

| Phase | Description | Complexité | Messages estimés |
|-------|-------------|------------|------------------|
| 1 | Infrastructure frontend (Context, Panel, Trigger) | Moyenne | 2-3 |
| 2 | Edge function unifiée + routing | Moyenne-Haute | 2-3 |
| 3 | Intégration RAG avec Notion MCP | Moyenne | 2 |
| 4 | Migration progressive des pages | Facile | 2-3 |
| 5 | Nettoyage legacy | Facile | 1 |

**Total estimé : 9-12 messages**

---

## Avantages de cette Approche

1. **UX unifiée** — Un seul point d'entrée IA, accessible partout (Cmd+K)
2. **Contexte partagé** — Le Copilot sait toujours où tu es et ce que tu fais
3. **RAG natif** — Enrichissement automatique avec les données Notion
4. **Actions directes** — Pas seulement des suggestions, mais des exécutions
5. **Extensible MCP** — Ajout de nouveaux outils sans refonte
6. **Maintenance simplifiée** — Une seule edge function au lieu de 6+

