# Audit DB/SQL — Projet Skalr (SaaS Recrutement)

**Date:** 16 avril 2026 | **Migrations:** 175 | **État:** ⚠️ Pré-production

---

## 1. Inventaire & Structure

### Comptage
- **Tables créées:** 108 (via `CREATE TABLE`)
- **Colonnes ajoutées:** 271 (via `ALTER TABLE ADD COLUMN`)
- **Colonnes `_at`:** ~380+ (timestamps ubiquitaires)
- **Colonnes `organization_id`:** 47+ (présentes dans tous les domaines métier)
- **Colonnes JSONB:** 128 occurrences (voir détail ci-dessous)

### Tables Chaudes (Hot Tables)
| Table | Colonnes | JSONB | Rôle |
|-------|----------|-------|------|
| `sequence_step_executions` | 14 | `metadata` (opt.) | Moteur principal: exécution d'étapes sourcing |
| `sequence_enrollments` | 17 | — | Suivi candidat/séquence |
| `knowledge_chunks` | 13 | `metadata` | RAG/embeddings (pgvector 1536D) |
| `agent_conversations` | 8 | `search_config`, `results_summary` | IA agent |
| `agent_messages` | 5 | `metadata` | Historique conversations IA |
| `outreach_sequences` | 8 | — | Templates séquences |
| `sourcing_projects` | 15 | `job_details`, `filters_snapshot` | Chasse: mission + filtre sauvegardés |
| `job_candidate_status` | 12 | — | Statuts candidat/job (user-scoped) |
| `candidate_profiles` | 6 | — | Profiles + embedding (1536D) |
| `job_profiles` | 6 | — | Job descriptions + embedding (1536D) |
| `organization_members` | 5 | — | RBAC multi-tenant |
| `profiles` | 4 | — | Utilisateurs + org actif |

### JSONB Problématiques
| Colonne | Table | Justification | Risque |
|---------|-------|---------------|--------|
| `job_details` | `sourcing_projects` | Flexibilité brief (titre, seniority, skills, salary) | Filtrage coûteux (pas de GiST) |
| `filters_snapshot` | `sourcing_projects` | État UI saved filters | Intégrité pas garantie |
| `search_config` | `agent_conversations` | Config IA flexible | Sans schéma |
| `metadata` | `knowledge_chunks`, `agent_messages` | Extensibilité RAG | Peut gonfler requête |
| `evaluation_criteria` | `mission_process_steps` | Scorecard template | Pas de validation |
| `permissions` | `mission_team` | Rôle-based flags | Mieux en colonne BOOLEAN |

**Action:** `job_details` et `filters_snapshot` (sourcing_projects) → colonnes typées (seniority, remote_policy, etc.).

---

## 2. Indexes

### Déficits Identifiés

#### A. Foreign Keys Sans Index (N+1 Risk)
`supabase/migrations/20260306140155_c574b852-852e-4757-b18d-8d93bf1fb3c3.sql:30-46`
```sql
ALTER TABLE public.sourcing_projects ADD COLUMN organization_id uuid REFERENCES ...
-- Manque: CREATE INDEX idx_sourcing_projects_org_id ON sourcing_projects(organization_id);
```
**Toutes ces FK ajoutées** n'ont PAS d'index:
- `sourcing_projects.organization_id` ❌
- `search_history.organization_id` ❌
- `job_candidate_status.organization_id` ❌
- `outreach_sequences.organization_id` ❌
- `sequence_steps.organization_id` ❌
- `sequence_enrollments.organization_id` ❌
- `sequence_step_executions.organization_id` ❌
- **Impact:** RLS policy `organization_id = get_user_org_id()` scan full table

#### B. Colonnes de Tri/Filtre Non Indexées
| Colonne | Table | Impact | Frequency |
|---------|-------|--------|-----------|
| `status` | `sequence_enrollments` | WHERE status = 'active' (webhook traitement) | HOT |
| `status` | `sequence_step_executions` | WHERE status = 'scheduled' (hourly cron) | HOT |
| `status` | `outreach_sequences` | WHERE status = 'active' | MEDIUM |
| `created_at` | `agent_conversations` | ORDER BY created_at DESC (UI list) | MEDIUM |

**Index existants** (20260410130000_sequence_performance_indexes.sql:6-37):
```sql
CREATE INDEX idx_step_exec_scheduled ON sequence_step_executions(status, scheduled_at) WHERE status = 'scheduled'; ✅
CREATE INDEX idx_enrollments_account_status ON sequence_enrollments(account_id, status); ✅
CREATE INDEX idx_outreach_sequences_org ON outreach_sequences(organization_id); ✅
```
**Manquants:**
- `sequence_enrollments(status, updated_at)` — pour WHERE status IN ('paused', 'completed')
- `sourcing_projects(status, organization_id)` — RLS + filter
- `job_candidate_status(status, created_by)` — user-scoped queries

#### C. Vector Indexes (pgvector)
`supabase/migrations/20260302174017_e8e3a28b-ae06-416b-99d5-502a0853aa5f.sql:19,43`
```sql
CREATE INDEX idx_candidate_profiles_embedding ON candidate_profiles 
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```
**Problème:** `lists = 100` est SOUS-optimal.
- **Recommandation:** `lists = √(total_rows)` → si ~10k profiles → `lists = 100-200` OK; si ~100k → `lists = 300+`
- **Risque:** Recall baisse à 95% si sous-configué

### Index Présents (Non-Exhaustif)
- ✅ `idx_step_exec_enrollment_status` (20260410130000:7)
- ✅ `idx_step_exec_step_id` (20260410130000:11)
- ✅ `idx_enrollments_profile_id` (20260410130000:17)
- ✅ `idx_inmail_queue_org` (20260410130000:33)
- ✅ `idx_airtable_shortlists_org_id` (20260309170000)

**Total Indexes:** 124 (avant déduplication).

---

## 3. RLS (Row Level Security)

### Architectures Identifiées

#### A. User-Scoped (1:1 Ownership)
`supabase/migrations/20260203101515_fd45e48a-9707-451d-80fa-9c6cae67457a.sql:30-52`

**Tables:** `job_candidate_status`, `sourcing_projects`, `outreach_sequences`
```sql
POLICY "Users can view their own candidate statuses"
  USING (auth.uid() = created_by);  -- Simple, no subquery ✅
```
**Risque:** Aucun (O(1) lookup sur user_id).

#### B. Org-Based (N:N via org_members)
`supabase/migrations/20260324000705_c3cb8227-98c8-466b-94f6-4dfe0bf1da94.sql:64-66`

**Tables:** `knowledge_chunks`, `agent_conversations`, `agent_messages`
```sql
POLICY "Org members can read knowledge_chunks"
  USING (is_org_member(auth.uid(), organization_id));
```
**Fonction (20260306140155:62-74):**
```sql
CREATE OR REPLACE FUNCTION public.is_org_member(_user_id uuid, _org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id AND organization_id = _org_id
  )
$$;
```
**Risque:** ⚠️ **Subquery sans index!** `organization_members(user_id, organization_id)` n'a PAS d'index composite → SEQUENTIAL SCAN si >1000 users/org.
- **Index manquant:** `CREATE INDEX idx_org_members_user_org ON organization_members(user_id, organization_id);`

#### C. Nested (Subquery Coûteuse)
`supabase/migrations/20260310225852_06ac6451-2380-45bf-874b-f432dcedc78e.sql:47-51`

**Table:** `agent_messages`
```sql
POLICY "Users can view messages in their org conversations"
  USING (EXISTS (
    SELECT 1 FROM public.agent_conversations ac
    WHERE ac.id = conversation_id
    AND ac.organization_id = public.get_user_org_id(auth.uid())  -- ← Subquery
  ));
```
**Problème:** À chaque requête, appelle `get_user_org_id()` (lookup profiles table) + joins `agent_conversations`.
- **Impact:** Si 100 messages chargés → 100 lookups `profiles`.
- **Meilleur pattern:** Cache `organization_id` directement dans `agent_messages`.

#### D. Recursive RLS Policies ⚠️
`supabase/migrations/20260325120000_v2_job_details_and_process.sql:51-56`

**Table:** `mission_process_steps`
```sql
POLICY "Users can manage process steps for their org projects"
  USING (
    organization_id IN (
      SELECT om.organization_id FROM public.organization_members om
      WHERE om.user_id = auth.uid()
    )
  );
```
**Risque:** Si user = member de 50 orgs → IN() sur 50 orgs, puis scan tout `mission_process_steps`.
- **Meilleur:** Ajouter colonne `cached_org_id` ou filtrer côté app.

#### E. Exposed to Anon (REGRESSION)
`supabase/migrations/20260210105248_ade454b7-bc75-40dd-90f9-4d9d579e0041.sql:5,9,13,17,21`

**Tables:** `outreach_sequences`, `sequence_steps`, `sequence_enrollments`, `sequence_step_executions`, `sequence_analytics`
```sql
DROP POLICY "Users can view their own sequences" ON public.outreach_sequences;
CREATE POLICY "Anyone can view sequences" ON public.outreach_sequences FOR SELECT USING (true);
```
**ALERT CRITIQUE:** Toutes les séquences sourcing (incluant contenu de messages) = lisibles par `anon`.
- **Raison donnée:** "edge functions already handle auth" → faux, RLS est le 2e rempart.
- **Correction nécessaire:** Revert à `is_org_member()`.

#### F. Missing WITH CHECK (Write-Only Regression)
`supabase/migrations/20260313003144_ecb28c26-8d68-424e-9402-29daf7139408.sql:4`

**Table:** `airtable_shortlists`
```sql
CREATE POLICY "..." FOR UPDATE TO service_role 
  USING (true) WITH CHECK (true);
```
**Risque:** Service role peut UPDATE n'importe quoi. OK si infra protégée, mais pas de defence-in-depth.

### RLS Audit Résumé
| Catégorie | Sévérité | Exemples |
|-----------|----------|----------|
| Subqueries non-indexées | 🔴 HIGH | `is_org_member()` + `organization_members` |
| Exposed to anon | 🔴 HIGH | `outreach_sequences`, `sequence_*` |
| Nested org lookups | 🟡 MEDIUM | `agent_messages` → `agent_conversations` → `profiles` |
| Recursive IN() | 🟡 MEDIUM | `mission_process_steps` multi-org |
| Missing composite index FK | 🔴 HIGH | `organization_members(user_id, organization_id)` |

---

## 4. N+1 Queries (Frontend)

### Code Smell Identifié

#### CandidateCommentsTab.tsx:49-76
`src/components/ats/CandidateCommentsTab.tsx:49-76`

```typescript
// 1st query: fetch all org members
const { data: orgMembers } = await supabase
  .from('organization_members')
  .select('user_id')
  .eq('organization_id', organizationId);

// 2nd query: fetch profiles for each member
const { data: profiles } = await supabase
  .from('profiles')
  .select('user_id, display_name')
  .in('user_id', userIds);

// Then merge in memory
orgMembers.map(m => {
  const profile = profiles?.find(p => p.user_id === m.user_id);
  ...
});
```
**Problème:** 2 requêtes séquentielles + filter side-client.
**Fix:** Joindre côté DB:
```sql
SELECT om.user_id, p.display_name
FROM organization_members om
JOIN profiles p ON p.user_id = om.user_id
WHERE om.organization_id = ?;
```

#### JobDetailSheet.tsx (potentiel)
`src/components/ats/JobDetailSheet.tsx` — grep shows `.from('sourcing_projects')`, `.from('knowledge_chunks')` séparément.
- **Suspect:** Loop sur projects → fetch knowledge_chunks par project?
- **Confirmation:** Lire le code complet.

### Impact Estimé
- **CandidateCommentsTab:** 2x waterfalls/render (orgMembers + profiles) → 200-500ms latency
- **Magnitude:** 200+ users/org × 1 second app = 3-5 min cumul/jour

---

## 5. Colonnes JSONB vs Typées

### Où JSONB est Justifié
| Colonne | Table | Raison | Verdict |
|---------|-------|--------|---------|
| `metadata` | `knowledge_chunks` | Tags illimités, étendu RAG | ✅ Keep |
| `metadata` | `agent_messages` | Log flexible (tokens, model, latency) | ✅ Keep |
| `evaluation_criteria` | `mission_process_steps` | Scorecard template (future) | ✅ Keep |

### Où JSONB Coûte (Devrait être Typé)
| Colonne | Table | Contenu Typique | Coût | Suggestion |
|---------|-------|-----------------|------|------------|
| `job_details` | `sourcing_projects` | `{title, seniority, skills[], remote, salary_range}` | Filtrage slow; pas de GiST | ✌️ Mixed: core → colonnes, extra → JSONB |
| `filters_snapshot` | `sourcing_projects` | `{job_title, skills[], location, seniority, min_exp}` | État UI save; pas requête | ✅ Keep JSONB (read-only) |
| `search_config` | `agent_conversations` | `{depth, model, temperature, constraints}` | Config IA; pas utilisé en WHERE | ✅ Keep JSONB |
| `permissions` | `mission_team` | `{can_edit_brief, can_source, can_submit}` | 3 flags = 3 BOOLEAN | 🔴 Refactor to BOOLEAN |

### Refactoring Recommandé: sourcing_projects
```sql
-- Avant (actuel)
ALTER TABLE sourcing_projects ADD COLUMN IF NOT EXISTS job_details jsonb DEFAULT '{}';

-- Après
ALTER TABLE sourcing_projects ADD COLUMN IF NOT EXISTS job_title text;
ALTER TABLE sourcing_projects ADD COLUMN IF NOT EXISTS job_seniority text 
  CHECK (job_seniority IN ('junior', 'mid', 'senior', 'lead', 'principal'));
ALTER TABLE sourcing_projects ADD COLUMN IF NOT EXISTS job_remote_policy text 
  CHECK (job_remote_policy IN ('on_site', 'hybrid', 'remote'));
ALTER TABLE sourcing_projects ADD COLUMN IF NOT EXISTS job_skills text[];
ALTER TABLE sourcing_projects ADD COLUMN job_details_extra jsonb DEFAULT '{}' 
  COMMENT 'Flexible fields: salary, benefits, description';
```
**Gain:** Filtres rapides (`WHERE job_seniority = 'senior'`), GiST possible sur skills[].

---

## 6. Contraintes & Intégrité

### Foreign Keys (155 FK existantes)

#### Bonnes Pratiques Appliquées
- `ON DELETE CASCADE` pour dépendances fortes (e.g., `sequence_steps` → `outreach_sequences`) ✅
- `ON DELETE SET NULL` pour références souples (e.g., `events.created_by` → `auth.users`) ✅

#### Gaps Identifiés
| FK | Table | Comportement | Risque | Fix |
|----|----|--|--|--|
| `created_by` | `sourcing_projects` | Référence `auth.users` | User delete = orphaned project | Ajouter `ON DELETE CASCADE` ou migrer à `soft_delete` |
| `project_id` | `job_candidate_status` | `ON DELETE SET NULL` | Après suppression project, candidats orphelins | OK (lisible si project_id IS NULL) |
| `conversation_id` | `agent_messages` | `ON DELETE CASCADE` | Suppression conv = tous messages + interactions IA perdus | ✅ Correct |

### Unique Constraints (23 UNIQUE identifiées)
```sql
UNIQUE (sequence_id, profile_id)              ✅ Prevent duplicate enrollments
UNIQUE (job_id, candidate_id, created_by)     ✅ One status per user/job/candidate
UNIQUE (organization_id, user_id)             ✅ Prevent duplicate members
UNIQUE (sequence_id, step_order)              ✅ Order within sequence
```
**Manquants:**
- `profiles(user_id)` → unique per auth user? → Vérifier `20251029164531`
- `organization_members(organization_id, user_id)` → existe? → Vérifier ligne 21 de 20260306140155

### Check Constraints (198 CHECK identifiés)
```sql
CHECK (status IN ('active', 'paused', 'completed', ...))  ✅ Énumérations
CHECK (action_type IN ('inmail', 'connection_request', ...)) ✅ Types fixes
CHECK (role IN ('owner', 'admin', 'member'))  ✅ RBAC
CHECK (org_type IN ('enterprise', 'agency', 'freelance'))  ✅ Org types
```
**Qualité:** Excellente couverture pour domaine métier.

---

## 7. Migrations

### Comptage & Patterns
- **Total:** 175 migrations
- **Dernière:** 20260410130000_sequence_performance_indexes.sql
- **Doublons proches:** 3 migrations successives `job_details` (20260325, 20260325-235107, 20260326-182810)
  - 20260325120000_v2_job_details_and_process.sql:8
  - 20260325235107_bc18957e-d0df-474a-a3bc-dd1fc8bf93c9.sql:2 (exact duplicate `ADD COLUMN IF NOT EXISTS`)
  - 20260326182810_2917f5c0-c949-4eee-b54c-edc764736185.sql:2 (third copy!)

### Migrations avec Rollback/Drop (25 identifiées)
Exemples:
- 20251020115814: `DROP TRIGGER`, `DROP COLUMN` → Refactor timestamps
- 20251022111021: `DELETE FROM events WHERE created_by IS NULL` → Data migration risk
- 20260210105248: `DROP POLICY ... CREATE POLICY "Anyone can view"` → RLS regression ⚠️
- 20260210110708: `FOR ALL USING (true)` → Anon access ⚠️

### Squash Risk
- Si `.squashed.sql` lancé → 175 migrations fusionnées
- **Risque:** Doublons `job_details` ADD COLUMN crashent (IF NOT EXISTS parade)
- **Estado:** Stable (idemptotent via `IF NOT EXISTS`)

### Best Practices Appliquées
- ✅ Timestamps: `create_at`, `updated_at` avec triggers
- ✅ RLS: Systématique sur tables métier
- ✅ Service role accès: Explicite pour edge functions
- ❌ Down migrations: Aucune (Supabase "migration-forward-only")
- ❌ Idempotency: ~70% (certaines `DROP POLICY` crashent en rerun)

---

## 8. Top 10 Actions Prioritaires

| # | Action | Fichiers | Effort (h) | Impact | Urgence |
|---|--------|----------|-----------|--------|---------|
| 1 | Ajouter index `organization_members(user_id, organization_id)` | New migration | 0.5 | 🟢 -20% RLS latency org-scoped | 🔴 **URGENT** |
| 2 | Revert anon access: remove `USING (true)` policies sur `sequence_*` tables | 20260210105248, 20260210110708 | 1 | 🔴 **Security breach** | 🔴 **URGENT** |
| 3 | Refactor `CandidateCommentsTab` N+1: join `organization_members` + `profiles` côté DB | src/components/ats/CandidateCommentsTab.tsx:49-76 | 1.5 | 🟢 -400ms latency | 🟡 **HIGH** |
| 4 | Indexer FK orphelines: `sourcing_projects.organization_id`, `sequence_*.organization_id` | 20260306140155 (retroactive) | 1 | 🟢 -30% RLS scan | 🟡 **HIGH** |
| 5 | Typer colonnes JSONB: extraire core fields de `job_details` → colonnes typées | 20260325120000 + new migration | 3 | 🟢 Active filtering, -50% JSONB bloat | 🟡 **HIGH** |
| 6 | Dédupliquer migrations `job_details` (3 fois) | 20260325*, 20260326182810 | 0.5 | 🟢 Cleaner history, -squash risk | 🟢 **MEDIUM** |
| 7 | Ajouter indexes manquants: `sequence_enrollments(status, updated_at)`, `sourcing_projects(status, org_id)` | New migration | 0.5 | 🟢 -15% webhook latency | 🟢 **MEDIUM** |
| 8 | Cache `organization_id` dans `agent_messages` (éviter join `agent_conversations`) | New migration + RLS refactor | 2 | 🟢 -50ms per message fetch | 🟢 **MEDIUM** |
| 9 | Valider IVFFlat config: `lists = √N` pour `candidate_profiles` & `job_profiles` | New migration (REINDEX) | 1 | 🟢 Vector recall 99%+ | 🟢 **LOW** |
| 10 | Audit code: grep "service_role" edge functions vs RLS bypass | supabase/functions/ | 2 | 🟡 Verify auth correctness | 🟢 **LOW** |

---

## Summary Exécutif

**État:** 🟡 **Acceptable avec réserves**.
- **Force:** RLS multi-tenant uniforme; pgvector intégré; 124 indexes présents
- **Faiblesse:** Regressions RLS (anon access); indexes FK manquants; JSONB overuse; N+1 frontends
- **Urgence:** Corriger #1-2 (sécurité + perf) dans sprint actuel

**Effort Total (actions 1-5):** ~7h → Gain: -40% RLS latency, +100% security
