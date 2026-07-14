# Audit Assistant IA (Copilot) — Konekt

Date : 2026-07-14
Branche : `claude/ai-chat-audit-x62ewv`
Objectif : état des lieux complet du chat/assistant IA, et gap analysis vers la cible produit :
**un agent omniscient (voit tout le workspace) avec pleins pouvoirs d'action (peut tout faire)**.

Précédent audit : `RAG_AGENT_AUDIT.md` (2026-04-16, verdict 5.5/10).

## Verdict : 7.5 / 10 — l'infrastructure d'agent est là, le produit ne l'exploite qu'à moitié

Depuis avril, les Sprints 1, 2 et 3 du plan précédent ont été livrés : **34 tools** (15 lectures +
19 mutations) avec human-in-the-loop complet, **re-ranking Claude Haiku** dans le RAG, **mémoire
cross-session** (`user_insights`), et même des briques non prévues (actions programmées via cron,
audit trail dans Settings, routeur d'intention hybride).

Ce qui bloque aujourd'hui n'est plus l'infrastructure, c'est le **câblage** :
- L'agent n'est réellement contextuel que sur 1 mode sur 4 (sourcing) — les modes brief/process/outreach existent côté prompts mais ne sont jamais déclenchés.
- L'omniscience est « lazy » (tout passe par des tool calls) et plusieurs pans du workspace sont invisibles (inbox, emails, config, fichiers uploadés, web).
- Les pouvoirs d'action couvrent ~60 % des opérations du produit, avec des trous majeurs (planifier un entretien, envoyer un email, créer une séquence, lancer une vraie recherche depuis le chat).
- Aucune notion de **niveau d'autonomie** : 100 % des mutations exigent une approbation manuelle, ce qui est le bon défaut mais interdit le mode "collègue autonome".

---

## 1. Cartographie de l'existant

### 1.1 Les 5 surfaces IA côté frontend

| Surface | Edge function | Streaming | Historique | Nature |
|---|---|---|---|---|
| **Copilot** (`AgentDrawer`/`AgentChatPanel`) | `search-agent-chat` + `agent-tool-action` | SSE + thinking | `agent_conversations`/`agent_messages` | Vrai agent conversationnel avec tools |
| `AiTextarea` (commandes `/ai`) | `ai-chat-completion` | Non | Aucun | Génération one-shot (8 commandes) |
| `InlineAIPanel` (inbox) | `analyze-response` | Non | Cache 24h (`message_analysis_cache`) | Suggestions de réponse |
| `LiveCoachingPanel` | `live-coach`, `generate-call-report` | WebSocket audio (Deepgram) | `call_coaching_sessions` | Coach entretien temps réel |
| `MissionCopilot` / `CopilotRail` | — aucune | — | localStorage | **Pas d'IA** : règles JS statiques |

Le Copilot est monté globalement (`src/App.tsx:196`), ouvrable par FAB, **Cmd+K**, palette Cmd+J,
sidebar, fiches candidat/poste, et en mode contextuel depuis le sourcing
(`src/pages/SourcingSearch.tsx:108`, `src/components/missions/MissionSourcing.tsx:77`).

### 1.2 Le cœur : `search-agent-chat` (1 536 lignes)

- **Modèle** : Claude Sonnet 4.6 par défaut, extended thinking (budget 16k) en streaming pur, max 32k tokens.
- **5 system prompts** selon `context_mode` : sourcing (méthodologie 8 étapes, très riche), brief, process, outreach, libre.
- **Routeur d'intention hybride** (mode libre) : classifieur Haiku (DATA / ACTION / CHAT, timeout 5s, fallback regex) → boucle d'outils ou streaming pur (`search-agent-chat/index.ts:720`).
- **Boucle agentique** : max **5 rounds**, 120s/round, 16k tokens/round.
- **Contexte injecté** : 24 derniers messages, `aiContext` (Settings → Contexte IA, niveaux user+org), `app_context` (page/mission/candidat courant), mémoire `user_insights` (top 8), `brief_context` en mode sourcing. Le reste est chargé **à la demande via les read tools** (lazy).
- **Persistance** : `agent_conversations` + `agent_messages` ; extraction d'insights tous les 6 messages (Haiku).

### 1.3 Le registre de tools (`_shared/agent-tools*.ts`)

**15 lectures** (exécution directe) : `get_my_missions`, `get_mission_overview`, `get_mission_candidates`,
`get_mission_process`, `get_mission_brief`, `get_sequences_status`, `get_candidate_detail`,
`get_upcoming_interviews`, `get_candidate_outreach`, `get_linkedin_thread`, `search_knowledge` (RAG),
`get_vivier_overview`, `get_org_analytics`, `get_team_overview`, `get_recent_agent_actions`.

**19 mutations** (toutes `requiresApproval: true`) : cycle `proposed → dry-run → bandeau
d'approbation UI (realtime) → approved → executed/failed`, avec édition des paramètres avant
exécution, double confirmation sur les actions sensibles (`SENSITIVE_TOOLS`), file d'attente
hors plage horaire (`scheduled_for` + cron `process-scheduled-actions` toutes les 2 min), et
traçabilité complète (`agent_tool_executions` + audit dans Settings → Actions de l'agent).

Mutations couvertes : stage candidat, shortlist, création mission, enrollment séquence, draft
outreach, enrichissement contact, note, dismiss, assignation, statut/brief mission, filtres de
recherche (régénérer/appliquer), **envoi de message LinkedIn** (via Unipile), pause/resume séquence,
invitation équipe, quotas membres.

### 1.4 RAG / Knowledge Lake — mature

- Embeddings OpenAI `text-embedding-3-small` (1536d), `knowledge_chunks` org-scopé, 12 chunk types, dédup SHA-256.
- **Re-ranking Claude Haiku livré** (Sprint 2) : fetch top-30 cosine → rescore 0-10 → top-N (`retrieve-context/index.ts:320`).
- Ingestion auto par trigger DB (`auto-ingest-context`) : profils LinkedIn, notes, commentaires, coaching, évaluations, séquences, briefs. Backfill batch (`backfill-knowledge-lake`, 12 sources dont Airtable et Aircall).
- 3 modes de retrieval : org-wide, multi-entity (candidat + jobs liés), single entity.

### 1.5 Mémoire cross-session — livrée (Sprint 3)

`_shared/user-memory.ts` : extraction de 0-3 insights durables par conversation (Haiku),
dédup + renforcement de confiance, injection top-8 dans le system prompt, bump d'usage.
Table `user_insights` (migration `20260422120000`).

---

## 2. Gap analysis n°1 — Omniscience

Ce que l'agent **ne voit pas** aujourd'hui, classé par impact :

| # | Angle mort | Détail | Impact |
|---|---|---|---|
| O1 | **Modes contextuels non branchés** | `brief`/`process`/`outreach` ont leurs prompts et écrans d'accueil (`thread.tsx:52-74`) mais aucun appelant `openContextualAgent` — seul `sourcing` est câblé | L'agent perd son intelligence contextuelle sur 3 onglets sur 4 |
| O2 | **Fichiers uploadés perdus** | Le composer accepte 5 fichiers (`thread.tsx:761`) mais `chat-adapter.ts` ne les transmet pas ; aucun parseur PDF/DOCX backend | CV, fiches de poste, notes : invisibles (Sprint 4 jamais livré) |
| O3 | **Web search : stub** | `web_search` désactivé (`search-agent-chat/index.ts:267,332`) | Pas de veille entreprise/marché (Sprint 5 jamais livré) |
| O4 | **Inbox invisible globalement** | `get_linkedin_thread` lit UN fil ; pas de tool "vue d'ensemble inbox / messages non lus / réponses en attente" ; les messages inbox ne sont pas dans le knowledge lake | L'agent ne peut pas dire « qui m'a répondu ? » |
| O5 | **Contexte de page mince** | `app_context.missionTitle` toujours `null` (`useAppContext.ts:56`) ; rien sur ce que l'utilisateur a sous les yeux (candidats affichés, filtres actifs, résultats de recherche) | L'agent doit re-demander ce que l'user regarde |
| O6 | **Surfaces IA cloisonnées** | `ai-chat-completion` (AiTextarea) et `chat-filter-assistant` n'ont ni RAG, ni mémoire, ni tools ; `analyze-response` et `live-coach` ne partagent rien avec le Copilot | Les insights appris dans le chat n'améliorent pas les autres assistants |
| O7 | **Pas de recherche live depuis le chat** | `search_candidates` est un leurre de calibration (`search-agent-chat/index.ts:281`) ; la vraie recherche vit dans `run-agent-search`, déclenchée hors chat | « Trouve-moi 10 profils » ne trouve rien en direct |
| O8 | **Trous du knowledge lake** | Non ingérés : messages inbox, emails, config mission, résultats de recherche passés, insights extraits, docs légaux/portail client | Le RAG ne couvre qu'une partie de la donnée métier |

## 3. Gap analysis n°2 — Pouvoirs d'action

| # | Manque | Détail | Impact |
|---|---|---|---|
| A1 | **`schedule_interview` absent** | Le label existe côté UI (`AgentToolApprovalCard.tsx:128-153`) mais le tool n'est pas dans le registre backend — Calendly/Graph pourtant intégrés ailleurs | Promesse UI non tenue, action clé du recruteur |
| A2 | **Pas d'envoi d'email** | `send-transactional-email` / queue Resend existent mais pas exposés en tool | L'agent ne peut relancer que par LinkedIn |
| A3 | **Pas de création/édition de séquence** | Il peut enroll/pause/resume mais pas créer une séquence ni en éditer les steps | Workflow outreach incomplet |
| A4 | **Pas de lancement de recherche réelle** | Aucun pont chat → `run-agent-search` (le plan est validé hors boucle d'outils via `[AGENT_ACTION]`) | Rupture du flux agentique |
| A5 | **Pas d'actions bulk** | Tous les tools sont mono-candidat (sauf enroll) — pas de « déplace ces 12 candidats », « dismiss tous les < 40 » | Force le clic manuel en masse |
| A6 | **Zéro autonomie configurable** | 100 % des mutations `requiresApproval: true`, aucun réglage par tool/org/user ; pas d'auto-exécution même pour les actions bénignes (note, tag) | Interdit le mode « collègue autonome » |
| A7 | **Pas d'agent proactif** | Aucun cron qui fait travailler l'agent seul (surveiller les réponses, détecter les missions au ralenti, préparer un digest matinal, proposer des actions) | L'agent ne travaille que quand on lui parle |
| A8 | **Actions post-entretien factices** | LiveCoachingPanel : « Avancer dans le pipeline » / « Planifier » = `toast.success` sans mutation (`LiveCoachingPanel.tsx:836-870`) | Faux pouvoir d'action visible utilisateur |

## 4. Dettes techniques et anomalies relevées

1. **`messageId: null`** systématique dans le ToolContext (`search-agent-chat/index.ts:1185`) → exécutions non liées au message d'origine.
2. **`_ai_action` figé** à `agent_search_calibration` quel que soit le mode (`chat-adapter.ts:54`) → le gating crédits/modèle ne distingue rien.
3. **`ai_chat` et `rag_rerank` absents de `ACTION_COSTS`** → floor à 1 crédit par défaut, pricing non maîtrisé.
4. **Création de conversation côté client obligatoire** (« le backend 400 sans conversation_id », `AgentChatPanel.tsx:104`) — le backend devrait avoir un create-path.
5. **Page `/agents` = lanceur, pas reprise** : clic sur une carte → `openAgent(jobId)` sans recharger la conversation (`Agents.tsx:140`).
6. **Budget temps risqué** : boucle 5 rounds × 120s vs hard-limit edge ~150s → coupures possibles en multi-rounds lents.
7. **Auth ré-implémentée à la main** dans `search-agent-chat` / `run-agent-search` (au lieu de `requireOrgAccess`) — correcte aujourd'hui, fragile à la maintenance ; `retrieve-context` en mode service_role ne re-vérifie pas l'org du body (confiance à l'appelant, documenté).
8. **Crédits post-hoc non bloquants** : l'appel LLM part même à solde insuffisant (log warn) — pas de pré-autorisation.
9. **Clients Konekt hardcodés dans le prompt sourcing** (`search-agent-chat/index.ts:166` : liste d'entreprises à ne pas chasser) → à déplacer en DB (org settings), sinon obsolescence et fuite multi-tenant conceptuelle.

## 5. Roadmap vers l'agent omniscient à pleins pouvoirs

### P0 — Câblage & correctifs (≈ 1 semaine) — ROI immédiat, zéro nouvelle infra
1. **Brancher les modes** brief/process/outreach : `openContextualAgent({mode})` depuis les onglets mission + `_ai_action` par mode (corrige O1, dette 2).
2. **Contexte de page riche** : peupler `app_context` (titre mission, onglet, candidats visibles, filtres actifs) et l'injecter dans le system prompt (corrige O5).
3. **`schedule_interview` + pont `launch_search`** : combler la promesse UI (A1) et relier le chat à `run-agent-search` (A4, O7).
4. **Hygiène** : entrées `ACTION_COSTS` manquantes, `messageId` réel, create-path conversation backend, reprise de conversation depuis `/agents`.

### P1 — Omniscience (≈ 2 semaines)
1. **Web search réel** : utiliser le server tool `web_search` natif de l'API Claude (pas besoin de Perplexity/Tavily — moins d'intégration, résultats cités) (O3).
2. **Upload de fichiers bout-en-bout** : transmettre les fichiers du composer, endpoint `ingest-user-file` (PDF/DOCX/TXT, max 10 Mo), chunk → `knowledge_chunks` `chunk_type='user_upload'` (O2).
3. **Read tools inbox & couverture lake** : `get_inbox_overview` (non lus, réponses en attente, par compte), ingestion des messages inbox + emails dans le lake (O4, O8).
4. **Décloisonner** : faire passer `analyze-response` et `AiTextarea` par le même `aiContext` + `user_insights` que le Copilot (O6).

### P2 — Pleins pouvoirs avec autonomie graduée (≈ 2-3 semaines)
1. **Nouvelles mutations** : `send_email`, `create_sequence` / `update_sequence_steps`, actions **bulk** (`bulk_update_stage`, `bulk_dismiss` avec dry-run listant chaque candidat), `export_data` (A2, A3, A5).
2. **Niveaux d'autonomie** (le vrai « tous les pouvoirs », sans le danger) : table `agent_tool_policies (org_id, tool_name, policy: auto | approve | off)` + UI Settings.
   - Défaut proposé : `auto` pour les lectures et mutations bénignes (note, tag, draft), `approve` pour le reste, `approve` **non désactivable** pour `mutation_external` (LinkedIn/email sortants) et destructif.
   - Le cycle `agent_tool_executions` reste inchangé : `auto` = passage direct à `auto_executed`, l'audit trail Settings devient le filet de sécurité (A6).
3. **Agent proactif** : cron quotidien/horaire qui exécute l'agent en tâche de fond par org (digest matinal, réponses reçues non traitées, missions au ralenti, relances dues) et **propose** des actions dans le bandeau — exécution selon policy (A7).
4. **Boucle agentique renforcée** : rounds dynamiques avec continuation (une action programmée peut ré-invoquer l'agent), gestion du budget 150s par découpage.

### P3 — Durcissement (continu)
- Pré-autorisation crédits (refus 402 avant l'appel LLM) ; factoriser l'auth sur `requireOrgAccess` ; re-vérification org dans `retrieve-context` mode interne ; sortir la liste clients du prompt vers la DB ; brancher les vraies mutations post-entretien du LiveCoachingPanel (A8) ; QA skill (4 personas) sur chaque nouveau tool.

### Ce qu'on recommande de NE PAS faire
- **Supprimer l'approbation sur les actions sortantes** (messages LinkedIn/emails) même en mode « pleins pouvoirs » : un envoi raté est irréversible et engage la marque du client. L'autonomie graduée (P2.2) donne le même ressenti produit sans le risque.
- Pré-charger tout le workspace dans le prompt : le pattern lazy (tools) est le bon, il faut l'enrichir (contexte de page + inbox), pas le remplacer.

---

## 6. Synthèse chiffrée

| Dimension | Avril 2026 | Aujourd'hui | Cible |
|---|---|---|---|
| Tools lecture | 2 | 15 | ~20 (inbox, recherche live, web) |
| Tools mutation | 0 | 19 | ~26 (email, séquences, bulk, interview) |
| Human-in-the-loop | ❌ | ✅ complet (dry-run, édition, audit, scheduling) | ✅ + policies d'autonomie |
| Re-ranking RAG | ❌ | ✅ Haiku | ✅ |
| Mémoire cross-session | ❌ | ✅ `user_insights` | ✅ + mémoire org curée |
| Upload fichiers | ❌ | 🟠 UI seule (payload jamais envoyé) | ✅ ingest → RAG |
| Web search | ❌ stub | ❌ stub | ✅ server tool Claude |
| Modes contextuels | 1/4 | 1/4 branché | 4/4 |
| Agent proactif | ❌ | ❌ | ✅ cron + digest |
| **Note globale** | **5.5/10** | **7.5/10** | **9+/10** |

Effort total estimé : **5-6 semaines** de dev pour la cible complète, sans refonte architecturale —
le registre de tools, le cycle d'approbation et le RAG absorbent tout.

---

## 7. Post-scriptum — exécution (même jour, cette branche)

L'intégralité des plans P0, P1 et P2 a été livrée sur `claude/ai-chat-audit-x62ewv`
(commits `2a64e7c` → `301ee4b`) :

- **P0** : modes brief/process/outreach outillés (classifieur étendu) et dérivés de
  l'onglet actif ; `missionTitle` dans le contexte de page ; tools `schedule_interview`
  et `launch_search` (le [SEARCH_PLAN] validé était un cul-de-sac — rien n'appelait
  `run-agent-search`) ; `ACTION_COSTS` complétés, `message_id` réel, create-path
  conversation backend, reprise depuis `/agents`.
- **P1** : web search natif (server tool API, pause_turn, chips) ; upload de fichiers
  bout-en-bout (`ingest-user-file` : PDF + images via IA, TXT/MD/CSV, → knowledge lake
  `document`/`user_upload`, champ `documents` dans `search_knowledge`) ;
  `get_inbox_overview` ; mémoire `user_insights` injectée dans `ai-chat-completion`
  et `text-action`.
- **P2** : politiques d'autonomie `agent_tool_policies` (auto/approve/off par org et
  par tool, clamp serveur pour mutation_external + destructifs, UI Réglages) ;
  `bulk_update_stage` / `bulk_dismiss` ; agent proactif `agent-daily-digest`
  (cron 6h UTC lun-ven, opt-in, déterministe) ; `send_email` (boîte connectée,
  suppression list, approbation obligatoire) ; `create_sequence` ; boucle agentique
  dynamique (8 rounds bornés à ~140s mural).

Total : **26 mutations + 16 lectures + web search**. Reste en backlog : ingestion
Word (.docx), refacturation crédits du web search, pré-autorisation crédits (P3),
factorisation auth sur `requireOrgAccess`, sortie de la liste clients du prompt
sourcing vers la DB.
