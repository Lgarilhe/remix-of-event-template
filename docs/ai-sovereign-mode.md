# Mode IA Souverain — spécification d'implémentation

> Spec du 2026-07-08. Objectif : permettre à chaque organisation de choisir entre
> **Mode Souverain** (modèles open source hébergés en UE — contrôle total de la donnée)
> et **Mode Performance** (frontier : Claude / GPT / Gemini — précision maximale).
> Différenciateur marché : aucun concurrent sourcing (Kalent, Juicebox, HireEZ) ne propose ça.

---

## 1. Concept produit

### Deux modes, par organisation (Settings → IA)

| | 🛡️ **Souverain** | ⚡ **Performance** (défaut) |
|---|---|---|
| Modèles | Open source hébergés UE (Scaleway 🇫🇷, fallback OVHcloud 🇫🇷) | Claude (défaut), extensible GPT / Gemini |
| Garanties affichées | Données traitées en France/UE, poids ouverts, zéro entraînement sur vos données, hors CLOUD Act, DPA Scaleway | DPA + zéro rétention (processeurs US) |
| Qualité | Très bonne, un cran sous le frontier (affiché honnêtement) | Meilleure IA du marché |
| Coût compute | 10-30× moins cher | référence |
| Positionnement | Secteur public, banque, santé, défense, grands comptes | Défaut général |

Argument systémique : la chaîne Konekt est déjà quasi-EU (Supabase Irlande, Unipile 🇫🇷,
Coresignal 🇪🇺, Scaleway 🇫🇷). Le mode souverain complète le tableau côté IA.

### Modèles souverains retenus (catalogue Scaleway, juillet 2026)

| Rôle | Modèle | Pourquoi |
|---|---|---|
| Tier `fast` (classifs, analyses) | **Gemma-4-26b-a4b** ou Qwen3.6-35b-a3b | centimes, latence minimale |
| Tier `default` + scoring | **Qwen3.6-35b-a3b** (MoE 3B actifs) | JSON fiable, agentic, 200+ langues, coût plancher |
| Rédaction FR (outreach, replies) | **Mistral Medium 3.5** 🇫🇷 | meilleure qualité FR du lot + « modèle français » |
| Tier `thinking` / agent | **GLM-5.2** | top open-weight agentic/tool-use (contexte 1M) |

Option « 100 % modèle français » : Mistral seul sur tous les tiers (pour les clients
qui exigent modèle ET hébergeur français). Qualité moindre sur le raisonnement — assumé.

---

## 2. État des lieux — pourquoi c'est un chantier contenu

L'infra existante converge déjà :

- **`_shared/call-claude.ts`** : passerelle IA unique (~30 fonctions). Accepte le
  **format OpenAI Chat Completions en entrée** (messages, tools, tool_choice,
  response_format) et le convertit vers Anthropic. → Pour un provider
  OpenAI-compatible (Scaleway, OVH, OpenAI, Mistral), c'est un **passthrough sans
  conversion** : le gros du travail est déjà fait.
- **`_shared/ai-config.ts`** : `MODEL_CATALOG` avec champ `provider`, tiers,
  multiplicateurs de crédits, prix/MTok ; `ACTION_COSTS` avec `routingTier`,
  `autoDefault`, et déjà une restriction `providers: ["anthropic"]` sur les actions
  agent ; chaîne de résolution `userOverride > orgDefault > autoDefault > ROUTING_DEFAULTS`.
- **`organizations.ai_model_default`** + `useModelPreference` + `ModelPicker` : la
  préférence de modèle par org existe déjà côté UI et DB.
- **`_shared/settle-credits.ts`** : crédits token-based avec multiplicateur par modèle —
  il suffit de donner des multiplicateurs aux modèles souverains.

## 3. Changements backend

### 3.1 `call-claude.ts` → passerelle multi-provider

- Ajouter un chemin `callOpenAICompat(baseUrl, apiKey, opts)` à côté du chemin Anthropic :
  payload transmis quasi tel quel (messages/tools déjà au format OpenAI),
  parsing de la réponse Chat Completions → même `ClaudeCompatResult` (content, toolCall,
  usage, model, stop_reason). Retries 429/5xx identiques.
- `mapModel()` devient `resolveModelAndProvider(modelId)` : lit le `MODEL_CATALOG`,
  retourne `{provider, apiModelId, baseUrl, apiKeyEnv}`.
- Providers initiaux : `anthropic` (existant), `scaleway`
  (`https://api.scaleway.ai/v1/chat/completions`, clé `SCALEWAY_AI_API_KEY`),
  `ovh` en fallback (`OVH_AI_API_KEY`). Clés = secrets Supabase, propriété Konekt
  (pas de BYO-key au départ).
- Conserver l'injection anti-AI-style, aiContext, et la consigne JSON — communes aux
  deux chemins. ⚠️ Le header prompt-caching est Anthropic-only → conditionnel.

### 3.2 `ai-config.ts`

- Étendre `ModelProvider` : `"anthropic" | "google" | "openai" | "scaleway" | "ovh"`.
- Ajouter au `MODEL_CATALOG` les modèles souverains avec `sovereign: true`,
  prix Scaleway réels, et multiplicateurs crédits bas (ordre de grandeur 0.05-0.15 —
  à figer avec les prix relevés sur la console Scaleway ; décision business : répercuter
  la baisse ou garder les floors actuels en marge).
- Nouveau : `ROUTING_DEFAULTS_SOVEREIGN` (fast → gemma-4/qwen3.6, default → qwen3.6,
  thinking → glm-5.2, rédaction → mistral-medium-3.5 via `autoDefault` par action).
- `getModel(action, opts)` prend `aiMode` : en mode souverain, la résolution est
  **clampée** au catalogue souverain (un `orgDefault`/`userOverride` non-souverain est
  ignoré avec fallback sur l'équivalent souverain du tier). En mode performance,
  comportement inchangé.
- Actions `providers: ["anthropic"]` (agent search) : en souverain → GLM-5.2 (tool-use)
  marqué **bêta**, avec fallback propre « action optimisée pour le mode Performance »
  si l'A/B révèle un taux d'échec tool-call trop élevé.

### 3.3 Résolution du mode par requête

- Helper partagé `getOrgAiMode(admin, organizationId)` avec cache in-memory par instance
  (pattern `resolve-org-credentials`). Les ~30 fonctions appelantes passent déjà
  l'`organization_id` pour les crédits → **sweep mécanique** : passer `aiMode` à
  `getModel()`/`callLLM()` (1-2 lignes par fonction).

### 3.4 `settle-credits.ts`

- Aucun changement structurel : le multiplicateur par modèle porte déjà le pricing.
  Ajouter les entrées des nouveaux modèles. Le ledger stocke déjà le `modelId` → la
  répartition souverain/performance est traçable pour la facturation et le reporting.

### 3.5 Embeddings (fuite de souveraineté n°1)

- `generate-embedding` + knowledge lake utilisent OpenAI (1536 dims). En souverain →
  modèle d'embedding hébergé Scaleway (BGE-multilingual-class, 1024 dims).
- ⚠️ **Les espaces vectoriels ne sont pas interchangeables** : ajouter
  `knowledge_chunks.embedding_model` + filtrer les recherches par modèle. Les orgs qui
  basculent en souverain démarrent un espace vide (ou backfill payé). À traiter en
  phase C — le mode souverain phase A/B couvre les LLM et l'affiche clairement
  (« embeddings : bascule en cours »).

### 3.6 Dictée vocale (fuite n°2)

- Deepgram = US. En souverain : Gladia 🇫🇷 (API STT compatible temps réel) ou
  désactivation propre de la dictée avec message explicite. Phase C.
- Restent US hors périmètre IA : Resend (email transactionnel), Stripe — à documenter
  dans la page transparence, roadmap séparée.

## 4. Changements base de données

```sql
-- Migration unique, idempotente
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS ai_mode text NOT NULL DEFAULT 'performance'
  CHECK (ai_mode IN ('performance', 'sovereign', 'sovereign_fr'));
-- sovereign_fr = variante « 100 % modèle français » (Mistral only)

-- Phase C (embeddings)
ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS embedding_model text NOT NULL DEFAULT 'openai-1536';
```

`organizations.ai_model_default` existe déjà (inchangé — il devient le choix DANS le mode).

## 5. Changements frontend

| Composant | Changement |
|---|---|
| **`AISettings`** (Settings → IA, à côté d'AICreditsSettings) | **CRÉER** : 2 cards de mode avec liste de garanties, badge 🇪🇺/🇫🇷, toggle variante « 100 % français », mention honnête de l'écart de qualité. Réservé admin/owner |
| `useAiMode` (hook) | **CRÉER** sur le pattern exact de `useModelPreference` (localStorage + DB) |
| `ModelPicker` | **MODIFIER** : catalogue filtré par mode, badge « Souverain » sur les modèles EU |
| Badge global discret | **CRÉER** : indicateur « IA souveraine » (footer AgentDrawer + sorties de génération) quand le mode est actif — preuve visible pour l'utilisateur ET ses clients |
| Bannière scoring | **CRÉER** : si le mode a changé depuis le dernier scoring d'une mission, bannière « les scores existants ont été calculés en mode X » + CTA re-scorer. Pas de blocage dur |

## 6. Règle branding — exception à acter

La règle CLAUDE.md (« vendor names never user-facing ») reçoit UNE exception délibérée :
la page **Settings → IA** et la page marketing du mode souverain peuvent nommer
« Mistral », « hébergé chez Scaleway en France » — les noms SONT l'argument de vente.
Partout ailleurs, « IA Konekt » reste la règle. `/privacy` liste les sous-traitants
(exception légale déjà prévue).

## 7. Validation qualité (avant GA du mode souverain)

1. **A/B scoring** via `BatchScoringReport` : Sonnet 4.6 (actuel) vs Qwen3.6 vs
   Mistral Medium sur ≥50 candidats réels de ≥3 missions — écart de score moyen,
   taux de JSON invalide, désaccords sur les deal-breakers.
2. **Tool-calling** : batterie sur les 19 outils de mutation de l'agent avec GLM-5.2
   (taux de succès des tool-calls, hallucination d'arguments).
3. **Rédaction FR** : revue humaine de 20 messages d'outreach Mistral vs Claude
   (+ passage des règles anti-AI-style).
4. Skill QA (4 personas) sur les flows IA dans les deux modes.

## 8. Phasage

| Phase | Contenu | Estimation |
|---|---|---|
| **A — Cœur** | Passerelle multi-provider + catalogue souverain + clamp `getModel` + migration `ai_mode` + sweep des ~30 fonctions + Settings UI | **2-3 j** |
| **B — Validation** | A/B scoring + tool-use GLM (agent bêta ou fallback) + pricing crédits final + bannière scoring | **1-2 j** |
| **C — Étanchéité** | Embeddings EU (+ `embedding_model`), STT Gladia, badge global, page transparence | **1-2 j** |

Total ≈ **1 semaine** + QA. Rollout : flag org interne → beta 2-3 clients demandeurs → GA.

## 9. Risques & parades

| Risque | Parade |
|---|---|
| JSON invalide plus fréquent sur modèles ouverts | `response_format` JSON supporté par Scaleway sur les modèles récents + consigne system existante + retry parse ; mesuré en phase B |
| Tool-calling agent moins fiable (GLM/Qwen) | Agent souverain en bêta ; fallback explicite vers « disponible en mode Performance » |
| Écart de calibration des scores entre modes | Bannière par mission + CTA re-scorer ; jamais de mix silencieux |
| Pas de prompt caching côté Scaleway | Impact coût négligeable (prix plancher) ; surveiller la latence des gros system prompts |
| Dérive des catalogues Scaleway (modèles dépréciés) | Le `MODEL_CATALOG` centralisé absorbe les renommages ; alerte si modèle 404 |
| Embeddings non migrés = souveraineté partielle | Affichage transparent en phase A/B (« LLM souverains ; embeddings en cours ») puis phase C |

## 10. Questions ouvertes (décisions business)

1. **Pricing** : répercuter le coût compute plus bas en crédits (souverain moins cher)
   ou vendre le mode souverain en premium (valeur = contrôle) à multiplicateur égal ?
   Recommandation : multiplicateurs réels (souverain moins cher en crédits) + le mode
   lui-même réservé aux plans payants → double argument commercial.
2. **BYO Scaleway key** (le client apporte son projet Scaleway) : hors scope v1,
   l'infra `organization_integrations` le permet plus tard.
3. GPT / Gemini dans le mode Performance : hors scope v1 (Claude only aujourd'hui),
   la passerelle multi-provider les rend triviaux à ajouter ensuite.
