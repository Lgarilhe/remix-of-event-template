# Audit RAG + Chat IA — Skalr

Date : 2026-04-16
Branche : `claude/app-audit-jHxht`
Objectif : savoir où on en est pour en faire un agent type **Notion AI / Linear Agent** (comprend le contexte + agit + se souvient).

## Verdict : 5.5 / 10

Infrastructure RAG solide, chat IA en partie agentique, mais **read-only**. On est à ~60 % du chemin vers un "vrai agent". Les mutations + le re-ranking + la mémoire cross-session débloquent l'essentiel.

---

## 1. Infrastructure RAG — ✅ Mature

- **Embeddings** : OpenAI `text-embedding-3-small` (1536d) — `supabase/functions/generate-embedding/index.ts:85`
- **Tables vectorielles** :
  - `knowledge_chunks` (centrale, org-scoped, TTL) — `migrations/20260324000705_c3cb8227.sql`
  - `candidate_profiles.embedding`, `job_profiles.embedding`
  - Index IVFFlat (lists=100), composites sur `entity_type/chunk_type`
- **RPC de retrieval** :
  - `retrieve_context()` — single entity cosine
  - `retrieve_context_multi()` — candidat + jobs liés
  - Cache mémoire 5 min sur embeddings de requête
- **12 chunk types indexés** : profile, experience, about, post, conversation, call_transcript, note, evaluation, job_context, company, sequence_history, scoring_result
- **Ingestion auto** : LinkedIn, notes, commentaires, coaching transcripts, évaluations, historique séquences, Aircall, Airtable
- **Dédup** : SHA-256 sur content, contrainte unique `(org, entity, chunk_type, content_hash)`
- **RLS** : activée sur toutes les tables RAG, multi-tenant propre

**Ce qui manque côté RAG** :
- ❌ **Re-ranking** (cross-encoder ou "Claude as reranker") — on reste sur cosine seule ⇒ faux positifs
- ❌ **Hybrid search** (BM25 + vector) pour requêtes très spécifiques (noms, numéros)
- ❌ **Ingestion de documents utilisateur** (PDF, DOCX, CV, fiches de poste uploadées par l'user)

---

## 2. Chat IA actuel — 🟠 Partiel

- **Modèle** : Claude Sonnet 4.6 avec **extended thinking** (budget 16k tokens) — `search-agent-chat/index.ts:425`
- **Streaming** : ✅ SSE format Anthropic natif
- **Tool use Anthropic** : ✅ activé, mais **3 tools seulement** (read-only) :
  1. `search_candidates` → `database-search`
  2. `enrich_company` → base entreprise
  3. `web_search` → **STUB** qui renvoie "not available" (`search-agent-chat/index.ts:370-371`)
- **Loop agentique** : 5 rounds max
- **Contexte injecté** : mission active, RAG multi-entity, 24 derniers messages, system prompt par mode (brief/process/sourcing/outreach)
- **Persistance** : tables `agent_conversations` + `agent_messages`, soft-delete à 60 j

**Ce qui manque côté chat** :
- ❌ **Mutations** (voir section 3) — l'agent lit, il n'agit pas
- ❌ **Mémoire cross-session** : chaque conv repart à zéro, pas de `user_insights` / `workspace_memory`
- ❌ **Web search** fonctionnel (stub)
- ❌ **Upload de fichier** dans le chat (pas de drag-drop CV/JD/note)
- ❌ **Système de tools modulaire** : tout est hardcodé dans `search-agent-chat` (442 lignes)

---

## 3. Capacités d'action — 🔴 Faible (le vrai blocage)

**Ce que l'agent peut faire** : rechercher, lire, scorer, suggérer.
**Ce qu'il ne peut PAS faire** :
- ❌ Créer une mission
- ❌ Mettre à jour un stage candidat (la edge function `update-candidate-stage` existe mais n'est pas exposée en tool)
- ❌ Ajouter à une shortlist (`add-to-shortlist` existe, idem)
- ❌ Envoyer un message outreach
- ❌ Déclencher une séquence
- ❌ Modifier le brief
- ❌ Planifier un entretien

⇒ C'est un **"super RAG"**, pas un agent.

---

## 4. Contexte utilisateur & mémoire — 🟠 Partiel

- ✅ L'agent sait quelle mission est active (`agent_conversations.job_id` / `project_id`)
- ✅ L'agent a les 24 derniers messages de la conversation en cours
- ✅ Statut de conversation (`calibrating`, `plan_proposed`, `running`, `completed`)
- ❌ Pas de mémoire **entre** conversations
- ❌ Pas de `user_preferences` / `user_insights` (ex : "Paul préfère les candidats Seniors", "ce cabinet cible les startups Series A")
- ❌ Pas de "workspace knowledge" à la Notion AI (facts curated + cités dans toutes les réponses)

---

## 5. Ingestion de fichiers — ❌ Absente côté user

- ✅ Backfill automatique depuis les intégrations (LinkedIn, Airtable, Aircall)
- ❌ Pas d'upload ad-hoc dans le chat (CV PDF, note MD, fiche de poste Word)
- ❌ Pas de parser PDF/DOCX côté edge function

---

## 6. Live coaching (entretien) — 🔴 Stub

- `live-coach/index.ts` : mode `generate_intro` uniquement (3 bullet points via Gemini 3 Flash)
- ❌ Pas de Deepgram branché (la clé existe via `deepgram-temp-key` mais le flux complet n'est pas câblé)
- ❌ Pas de streaming entretien, pas de suggestions en live, pas de red flags temps réel
- ❌ Pas de scorecard pré-remplie post-entretien

---

## 7. Comparaison avec les références

| Dimension | Skalr | Notion AI | Linear Agent |
|---|---|---|---|
| Pgvector / RAG | ✅ | ✅ | ✅ |
| Tool use Claude | ✅ (3 tools) | ❌ (actions natives) | ✅ (10+) |
| Re-ranking | ❌ | ✅ | ✅ |
| Mutations | ❌ | ✅ | ✅ |
| Extended thinking | ✅ | ✅ | ✅ |
| Mémoire cross-session | ❌ | ✅ | ✅ |
| Upload document | ❌ | ✅ | 🟡 |
| Multi-entity context | ✅ | ❌ | ✅ |
| Execution autonome | 🟡 (search only) | ❌ | ✅ |

---

## 8. Plan pour passer à un vrai agent Notion-like

### 🥇 Sprint 1 — Mutations (2 semaines) — **LE DÉVERROU PRINCIPAL**
Ajouter un **tools registry** partagé dans `_shared/agent-tools.ts` et exposer :
- `update_candidate_stage(candidate_id, job_id, stage, reason)`
- `add_to_shortlist(candidate_id, list_id)`
- `send_outreach_message(candidate_id, template_id | custom_body)` — avec **human-in-the-loop** (mode `draft` par défaut, confirme avant envoi)
- `create_mission(title, brief)` — idem, draft
- `enroll_in_sequence(candidate_ids[], sequence_id)`
- `schedule_interview(candidate_id, duration, step_id)` — une fois Google/Outlook Calendar branchés

**Pattern clé** : chaque tool a un mode `dry_run` + approbation user (`needs_review` → `approved` → `execute`). C'est ce qui distingue un agent utile d'un agent dangereux.

### 🥈 Sprint 2 — Re-ranking Claude-as-reranker (1 semaine)
`retrieve-context` v2 :
1. Fetch top-30 vectoriel (cosine)
2. Appel Claude Haiku pour rescorer + critique
3. Renvoyer top-8 re-rankés + citations

Gain attendu : +30-40 % de pertinence sur les questions candidat.

### 🥉 Sprint 3 — Mémoire cross-session (2 semaines)
- Table `user_insights` : `(user_id, org_id, insight_type, content, embedding, last_used_at)`
- Types : préférence recruteur ("vise senior+"), pattern mission ("Paul ferme en 25j en moyenne"), style message ("ton direct, tutoiement").
- Extraction automatique : hook post-conversation qui demande à Claude "extrais 0-3 insights durables de cet échange".
- Injection : 3-5 insights pertinents dans le system prompt de chaque nouvelle conversation.

### Sprint 4 — Upload fichier (2 semaines)
- Endpoint `ingest-user-file` : accepte PDF, DOCX, TXT (max 10 MB).
- Parsing : `pdf-parse` + `mammoth` dans edge function.
- Chunk + embed + stocke dans `knowledge_chunks` avec `chunk_type='user_upload'` et `expires_at=+90j`.
- UI : drag-drop dans `AgentDrawer`.

### Sprint 5 — Web search réel + live coach (1 semaine)
- Remplacer le stub `web_search` par Perplexity `sonar` ou Tavily (cache 24h).
- Brancher Deepgram dans `live-coach` : streaming audio → transcript → suggestions Claude live → scorecard auto-pré-remplie.

---

## 9. Gains business escomptés

- **Avant** : "chat qui aide à rechercher" — temps gagné 10-15 %
- **Après Sprint 1+2** : "assistant qui fait" — temps gagné 40-50 %
- **Après Sprint 3+4+5** : "collègue autonome qui bosse la nuit" — différenciant marché

Côté tech, **tout est déjà en place** : pgvector, chunk types, Claude Sonnet 4.6 avec extended thinking, tool use, streaming, RLS. Les 3 briques manquantes sont :
1. **Tools mutantes avec human-in-the-loop**
2. **Re-ranker**
3. **Mémoire long-terme (user_insights)**

Pas de refonte architecturale nécessaire. 6-8 semaines de dev ⇒ niveau Notion AI / Linear Agent.

---

## Fichiers à regarder en premier

- `supabase/functions/search-agent-chat/index.ts` — 442 l, **à découper en `_shared/agent-tools.ts` + modes** (brief/process/sourcing/outreach).
- `supabase/functions/retrieve-context/index.ts` — ajouter le re-ranker ici.
- `supabase/functions/ingest-context/index.ts` — étendre pour accepter user uploads.
- `supabase/functions/_shared/rag-adapters.ts` — ajouter adapters PDF/DOCX.
- `supabase/migrations/` — nouvelle migration `user_insights` + `agent_tool_executions` (traçabilité des mutations).
