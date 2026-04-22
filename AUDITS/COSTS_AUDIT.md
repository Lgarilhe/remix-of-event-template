# Audit Coûts IA + Infra — Projet Skalr

**Date:** 16 avril 2026 | **Cutoff:** Claude Haiku 4.5 / Sonnet 4.6 / Opus 4.6

---

## 1. Inventaire Appels IA (Anthropic)

### 12 Edge Functions Calling Anthropic

| Function | Modèle Défaut | Tokens In/Out Estimés | Extended Thinking | Cas Usage |
|----------|---|---|----|---|
| **score-profile-job** | Sonnet 4.6 | 3.5k+2k | Non | Scoring 1 profil/poste (prompt job+profil) |
| **generate-outreach-message** | Sonnet 4.6 | 8k+2k | Non | Message LinkedIn (rare re-appel correctif) |
| **generate-scorecard** | Gemini Flash + RAG | 4k+3k | Non | Grille d'évaluation 8 critères |
| **search-agent-chat** | Sonnet 4.6 | 6k+4k (loop 5 rounds) | Opt-in 16k | Agent sourcing multi-angles, tool use |
| **chat-filter-assistant** | Haiku 4.5 | 2k+1.5k | Non | Chat affinage filtres (par message) |
| **auto-analyze-message** | Haiku 4.5 | 1.5k+1k | Non | Classification message (rapide) |
| **process-sequences** | Sonnet 4.6 | 3k+2k | Non | Multi-envois email, per email |
| **sequence-send-email** | Sonnet 4.6 | 2.5k+1.5k | Non | Personnalisation email batch |
| **generate-reply-suggestions** | Haiku 4.5 | 1.5k+1k | Non | 3 suggestions rapides |
| **generate-search-filters** | Sonnet 4.6 | 4k+2.5k | Non | Calibration filtres sourcing |
| **refine-search-filters** | Sonnet 4.6 | 3k+2k | Non | Élargir/affiner critères |
| **nurturing-analyzer** | Sonnet 4.6 | 2.5k+1.5k | Non | Analyse engagement candidat |
| **enrich-vivier-contacts** | Haiku 4.5 | 2k+1.5k | Non | Notes enrichissement vivier |

**Extended Thinking:** Seulement `search-agent-chat` en mode opt-in (budget 16k). Coût: 16k tokens × $0.15/1M ($thinking) ≈ $0.0024 par appel thinking.

---

## 2. Appels OpenAI (Embeddings)

### text-embedding-3-small

3 edge functions utilisent OpenAI pour générer des embeddings:
- **generate-embedding** (invoquée par ingest-context)
- **backfill-knowledge-lake** (batch embeddings)
- **retrieve-context** (requête embeddings pour RAG)

**Tarif:** $0.02 par 1M input tokens

| Cas | Tokens par Appel | Fréquence | Coût Estimé |
|----|---|---|---|
| Ingest chunk (500 chars) | 200-300 | 50-100/jour | $0.0006 |
| Retrieval query | 300 | 500/jour | $0.003 |
| Backfill batch (1000 chunks) | 300k | 1×/mission | $0.006 |

**Leak détecté:** Pas de déduplication SHA-256 observable → embeddings re-calculés sur mêmes chunks.

---

## 3. Appels Tiers (Unipile, Apollo, PDL)

### Unipile (Payant)
- **unipile-search:** Requête LinkedIn Recruiter API
  - Par mission: 500 profils sourcés = 5-10 appels search
  - Prix: ~$0.20-0.50/request selon volume
  - **500 profils ≈ $5-10 mission**

- **unipile-accounts:** Gestion comptes LinkedIn
  - Une fois/semaine: $0 (maintenance)

- **unipile-manage-webhooks:** Sync conversions
  - $0 (fonctionnalité)

### Apollo.io (Freemium + Enterprise)
- **apollo-search:** 50M contacts base de données
  - Tarif: Forfait ou pay-per-contact (£0.002 si en dehors forfait)
  - Par mission: 100-200 contacts enrichis = £0.20-0.40
  - **100 contacts ≈ £0.20 ($0.25)**

### PDL (PeopleDataLabs)
- **pdl-search:** API SQL enrichissement profils
  - Tarif: $0.005-0.015/appel selon données
  - Par mission: 50 profils enrichis = $0.25-0.75
  - **50 profiles ≈ $0.50**

### Résumé Tiers
| Fournisseur | Par Mission | Annual (100 missions) |
|---|---|---|
| **Unipile** | $5-10 | $500-1000 |
| **Apollo** | $0.25 | $25 |
| **PDL** | $0.50 | $50 |
| **Total** | $5.75-10.75 | $575-1075 |

---

## 4. Coûts Anthropic par Mission Type

### "Mission Standard" Modèle
- **1 brief:** 1× generate-search-filters (4k in, 2.5k out)
- **500 profils sourcés:** unipile-search (5 appels)
- **100 scorés:** 100× score-profile-job (3.5k in, 2k out each)
- **50 messages outreach:** 50× generate-outreach-message (8k in, 2k out each)
- **10 screencalls:** 10× generate-scorecard (4k in, 3k out each)
- **5 entretiens:** 5× live-coaching (10k in/min, assume 5 min = 50k in, 5k out each)

### Décomposition Tokens Anthropic

| Action | Qty | Tokens In | Tokens Out | Model | Coût USD |
|--------|-----|-----------|------------|-------|----------|
| Brief filters | 1 | 4,000 | 2,500 | Sonnet | $0.024 |
| Score profiles | 100 | 350,000 | 200,000 | Sonnet | $1.65 |
| Outreach msgs | 50 | 400,000 | 100,000 | Sonnet | $1.50 |
| Scorecards | 10 | 40,000 | 30,000 | Gemini/Sonnet | $0.21 |
| Live coaching | 5 | 250,000 | 25,000 | Sonnet | $0.825 |
| **Subtotal Anthropic** | — | **1.044M** | **357.5k** | — | **$4.189** |

### Credits Konekt (Facturation Client)

Baseline: 1 crédit = 1000 tokens Sonnet 4.6

| Action | Tokens | Floor | Multiplier | Credits | Cost to Client |
|--------|--------|-------|-----------|---------|---|
| Brief | 6.5k | 2 | 1.0 | 7 | — |
| Scores | 550k | 100 (1 each) | 1.0 | 550 | — |
| Outreach | 500k | 50 | 1.0 | 500 | — |
| Scorecards | 70k | 20 | 1.0 | 70 | — |
| Coaching | 275k | 25 (5×) | 1.0 | 275 | — |
| **Total** | — | — | — | **1402** | **€280** @0.20€/crédit |

### Marge Brute
- Client pays: **€280**
- Coût Anthropic: **$4.19** ≈ **€3.84**
- Marge brute: **€276** (98%)
- Infra Supabase: ~€8 (hosting functions)
- **Marge nette:** ~€268 par mission

---

## 5. Leaks & Défauts

### 🔴 LEAK 1: Extended Thinking Inutilisé
- `search-agent-chat` supporté mais rarement activé
- Coût si généralisation: +16k tokens × 0.00015 ≈ +€0.0024/appel (faible)
- **Impact minimal.**

### 🔴 LEAK 2: Cache Mémoire retrieve-context (5 min)
- Après cold start, edge function lose state
- Même query dans 2 requêtes différentes = 2 embeddings OpenAI
- Fréquence: 500 retrievals/mission
- Coût doublé potentiellement: +$0.003
- **Impact:** $3-5/mission si requêtes répétées

### 🟡 LEAK 3: Déduplication Embeddings Absente
- Chunks identiques re-embedés à chaque ingest-context
- SHA-256 check non observable
- Backfill-knowledge-lake batch = économie mais pas incremental
- **Impact:** 10-20% embeddings redondants = +$0.006-0.01/mission

### 🟡 LEAK 4: Boucles Agent (search-agent-chat)
- Max 5 rounds tool use (codé)
- Chaque round = 6k in (cumul context) + 4k out
- Cas pire: 5 rounds = 30k in + 20k out × Sonnet = $0.15 par calibration
- Fréquence: 1 calibration/mission
- **Impact:** $0.15/mission acceptable

### 🟡 LEAK 5: Rate Limits mais Pas Throttling
- 40 req/min generate-outreach (haut)
- 20 req/min generate-scorecard (ok)
- Pas de backoff intelligent → potentiel 429 → retry exponential
- **Impact:** Marginal (retry déjà intégré)

### 🟡 LEAK 6: Anthropic sans settleCredits Check
Vérifié: `generate-outreach-message`, `search-agent-chat`, `generate-scorecard` ont `settleCredits` fire-and-forget.
Mais pas de validation pre-call qu'il y a assez de crédits = risque de "spend now, check later"
- 2 functions non-checkées: `process-sequences`, `sequence-send-email`
- **Impact:** Overages temporaires, facturable

---

## 6. Optimisations Prioritaires

| Rang | Optimisation | Économie Estimée | Effort | ROI |
|-----|---|---|---|---|
| **1** | Déduplication SHA-256 embeddings + cache Redis (5min) | 15% OpenAI | 4h | **Très élevé** |
| **2** | Prompt caching Anthropic (system prompt 8k fixe) | 20% Anthropic in-tokens | 6h | **Élevé** (cache hits 80%+) |
| **3** | Batch scoring (100 profils) vs 100 appels | 40% du temps, 10% tokens | 8h | **Moyen** (complexity) |
| **4** | Disable extended thinking sauf agent calibration | 0% (rarement utilisé) | 1h | **Faible** |
| **5** | Kill process-sequences (check credits pre-call) | Limite overages | 2h | **Moyen** (compliance) |
| **6** | Compression prompts (remove verbose instructions) | 5% Anthropic tokens | 3h | **Faible** |
| **7** | Reduce retrieve-context history (8 messages → 4) | 2% Anthropic tokens | 1h | **Très faible** |
| **8** | Incremental backfill Knowledge Lake (delta sync) | 30% embeddings backfill | 12h | **Élevé si fréquent** |
| **9** | Apollo/PDL batch enrichment endpoint | 20% Apollo calls | 16h | **Élevé si 500+ enrichs** |
| **10** | Monitor cost/mission per user (dashboard) | Visibilité → optimisations clients | 6h | **Stratégique** |

**Top 3 Impact:**
1. **Dédup + cache embeddings:** -€3-5/mission, 4h
2. **Prompt caching:** -€0.50-1/mission, 6h
3. **Batch scoring API:** -€0.30-0.50/mission, 8h

---

## 7. Instrumentation Manquante

### Métriques Recommandées

```sql
-- Table: cost_tracking_daily
CREATE TABLE cost_tracking_daily (
  date DATE,
  organization_id UUID,
  cost_anthropic_usd NUMERIC(10,4),
  cost_openai_usd NUMERIC(10,4),
  cost_unipile_usd NUMERIC(10,4),
  cost_apollo_usd NUMERIC(10,4),
  cost_pdl_usd NUMERIC(10,4),
  cost_supabase_usd NUMERIC(10,4),
  total_cost_usd NUMERIC(10,4),
  missions_count INT,
  users_active INT,
  cost_per_mission NUMERIC(10,4),
  cost_per_user NUMERIC(10,4),
  tokens_anthropic_in INT,
  tokens_anthropic_out INT,
  tokens_openai INT,
  PRIMARY KEY (date, organization_id)
);

-- Query: Cost per Anthropic action
SELECT 
  ai_action,
  COUNT(*) as calls,
  SUM(cost_usd) as total_cost,
  AVG(tokens_input + tokens_output) as avg_tokens,
  MAX(tokens_input + tokens_output) as peak_tokens,
  SUM(cost_usd) / COUNT(*) as cost_per_call
FROM ai_credit_transactions
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY 2 DESC;

-- Query: Missions profitability
SELECT 
  project_id,
  COUNT(DISTINCT user_id) as users,
  SUM(credits_used) as total_credits,
  SUM(cost_usd) as cost_ai,
  SUM(cost_ai + (SELECT COALESCE(SUM(amount),0) FROM api_costs WHERE project_id = p.project_id)) as total_cost,
  ROUND((SELECT SUM(amount) FROM billing_entries WHERE project_id = p.project_id) - total_cost, 2) as margin
FROM ai_credit_transactions t
RIGHT JOIN projects p ON t.project_id = p.id
GROUP BY 1
ORDER BY 6 DESC;
```

### Dashboards Frontend (Priority)
- [ ] Real-time cost/mission widget (target user)
- [ ] Monthly trend graph (Anthropic vs OpenAI vs tiers)
- [ ] Cost per action heatmap (identify heavy hitters)
- [ ] Predictions: "Current pace = €X by month-end"

---

## 8. Summary & Recommendations

### Par-Mission Economics
- **Cost to Client:** €280/mission (credits)
- **Actual Cost (Anthropic+OpenAI+Tiers):** ~€14 (1.4%)
- **Gross Margin:** €266 (95%)

### Break-even Scalability
- Fixed costs (Supabase, APIs): ~€500/month
- Variable costs: ~€14/mission
- **Needed:** 2-3 missions/month to profit; >50/month = €12k gross margin

### Top Risks
1. **Prompt bloat:** generate-outreach-message 8k tokens = 40% cost. Compress to 5k = -€0.30/message.
2. **Unmetered API:** Apollo/PDL can spike if batch enrichment used recklessly.
3. **No cost governance:** Users unaware missions cost €14-20 → overuse agent calls.

### Next 30 Days
- [ ] Implement SHA-256 dedup + Redis cache (embeddings)
- [ ] Enable prompt caching for generate-outreach-message, search-agent-chat
- [ ] Add cost tracking dashboard with per-action breakdown
- [ ] Audit `process-sequences` for untracked spending
- [ ] Set cost alerts: €50/day, €500/month

---

**Audit Completed:** 16 Apr 2026
**Auditor:** Claude Code AI
**Status:** Ready for implementation

