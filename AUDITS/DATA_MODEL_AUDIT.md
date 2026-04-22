# DATA_MODEL_AUDIT.md

Date : 2026-04-16
Branche : `claude/app-audit-jHxht`

## 1. Vue d'ensemble du schéma

Le modèle Skalr est organisé en **9 domaines** cohérents :

| Domaine | Tables clés | MCD implicite |
|---------|-------------|---------------|
| **Auth** | `organizations`, `organization_members`, `organization_invitations`, `profiles` | Hiérarchie tenant (org) ✓ |
| **Missions** | `sourcing_projects`, `mission_process_steps`, `mission_team`, `mission_invitations` | Bien lié par `project_id` ✓ |
| **Candidats** | `job_candidate_status`, `candidate_profiles`, `job_profiles`, `match_scores` | Fragmentation (§2) ⚠ |
| **Outreach** | `outreach_sequences`, `sequence_steps`, `sequence_enrollments`, `sequence_step_executions` | Pipeline bien structuré ✓ |
| **Connaissances** | `knowledge_chunks`, `agent_conversations`, `agent_messages` | Sous-exploité |
| **Billing** | `organization_subscriptions`, `subscription_plans`, `ai_credit_balances`, `ai_credit_transactions` | Modèle complet ✓ |
| **Intégrations** | `airtable_*` (13 tables), `enrichment_cache`, `vivier_enrichments` | Isolation acceptable |
| **Séquences** | `sequence_steps`, `sequence_templates`, `sequence_snippets` | Doublons ? |
| **Connecteurs** | `connector_entity_mappings`, `connector_field_mappings`, `connector_sync_runs` | Framework v2 |

**Verdict** : MCD implicite cohérent mais **2 zones de risque** :
1. Fragmentation candidat (4 entités distinctes)
2. Prolifération Airtable (13 tables legacy)

---

## 2. Incohérences de nommage

### `sourcing_projects` = "missions" ?
La table s'appelle `sourcing_projects` mais représente des missions de recrutement. Le code utilise `SourcingProject` alors que le contexte UX parle de "mission".

**Recommandation** : renommer vers `recruitment_missions` (ou alias dans `types.ts`).

### Fragmentation candidat : 4 entités

| Table | Purpose | Utilisée ? | Couplage |
|-------|---------|-----------|----------|
| `profiles` | User profiles (auth) | ✓ OUI | Faible |
| `candidate_profiles` | Embeddings ML (1536D) | ❓ 3 refs | Fort (pgvector) |
| `job_profiles` | Job embeddings (ML matching) | ❓ 3 refs | Fort (pgvector) |
| `job_candidate_status` | Tracking statut candidat par mission | ✓ OUI | Fort |

**Problème** : 2 systèmes parallèles — Legacy (texte) vs AI (vecteurs). Pas d'erreur mais manque de synchro. Vérifier triggers embedding à chaque création/update candidat.

---

## 3. Couplage fort / faible

### JSONB Columns

| Colonne | Table | Queryable ? | Recommandation |
|---------|-------|-------------|----------------|
| `job_details` | `sourcing_projects` | Partiellement | **EXTRAIRE** |
| `filters_snapshot` | `sourcing_projects` | ✓ (47 refs) | KEEP |
| `search_config` | `agent_conversations` | Rare | KEEP |
| `metadata` | `agent_messages`, `knowledge_chunks` | Non | **NORMALISER** si queryé |
| `scoring_result` | `match_scores` | Non | KEEP (audit trail) |
| `evaluation_criteria` | `mission_process_steps` | Non | **PROBLÈME** |

### Problème : `job_details` JSONB

Contient : `title, seniority, salary_min, salary_max, salary_currency, client, location, remote_policy, skills_must_have, ...`

**Problèmes** : pas d'index GIN, duplication (`job_title` en colonne ET dans JSONB), pas de CHECK constraint.

**Extraction recommandée** :
```sql
CREATE TABLE job_details_snapshot (
  id uuid, -- FK sourcing_project
  title text, seniority text, location text,
  salary_min int, salary_max int, salary_currency text,
  remote_policy text, contract_type text,
  raw_job_details jsonb  -- historique complet
);
CREATE INDEX ON job_details_snapshot (salary_min, salary_max, remote_policy, seniority);
```

### Problème : `evaluation_criteria` JSONB

Stocké mais jamais queryé. Si critères à filtrer, créer :
```sql
CREATE TABLE process_step_criteria (
  id uuid, step_id uuid,
  criterion_label text, category text,
  weight int, deal_breaker boolean,
  interview_stage text
);
```

---

## 4. Orphelins & tables mortes

| Table | Statut | Raison |
|-------|--------|--------|
| `airtable_*` (13 tables) | VIVANT | Sync backend |
| `vivier_enrichments` | VIVANT | `VivierList.tsx` |
| `enrichment_cache` | VIVANT | Cache enrichissements |
| `sequence_templates` | **SUSPECT** | Vs `outreach_sequences` ? |
| `sequence_snippets` | **SUSPECT** | Similaire `sequence_steps` ? |
| `sequence_email_tracking` | **SUSPECT** | Doublé par `sequence_step_executions` ? |
| `hunt_applications` | **SUSPECT** | Pas de ref |
| `process_templates` | **SUSPECT** | Redondant ? |

**Action** : vérifier edge functions, supprimer `hunt_applications` si mort, consolider `sequence_templates`.

---

## 5. Évolutivité

### 1M candidats

| Goulot | Mitigation |
|--------|------------|
| `job_candidate_status` | Partitionner `(organization_id, month)` |
| `candidate_profiles.embedding` IVFFlat | Passer **HNSW** ; `lists=500` |
| `match_scores` cache | Trigger `invalidated_at` |
| JSONB `filters_snapshot` | **GIN index** |

### 10k missions

| Goulot | Mitigation |
|--------|------------|
| `sourcing_projects.stats_*` denorm | MATERIALIZED VIEW ou async task |
| `mission_process_steps` UNIQUE+CASCADE | Accepté (peu de DELETE) |
| `mission_team` (7 rôles) | Cache ou trigger |

---

## 6. Custom fields & extensibilité org

Actuellement : ajout champ = migration Postgres, typage manuel, pas de versioning. `job_details` JSONB masque le besoin.

**Option A (légère)** — colonne `custom_metadata jsonb` sur `sourcing_projects` + doc. Rapide mais pas typé.

**Option B (robuste)** — table dédiée :
```sql
CREATE TABLE organization_custom_fields (
  id uuid, organization_id uuid,
  entity_type text, -- job, candidate, process_step
  field_name text, field_type text,
  required boolean, default_value jsonb
);
```

**Recommandation** : Option A maintenant, Option B en Q3 2026.

---

## 7. Types TypeScript générés

| File | Source | Statut |
|------|--------|--------|
| `src/integrations/supabase/types.ts` | Auto-généré | À jour ✓ |
| `src/types/jobDetails.ts` | Manuel | À jour ✓ |
| `src/types/projects.ts` | Custom | À jour ✓ |

**Problème** : Pas de hook pre-commit pour régénérer les types. Divergence possible entre `types.ts` (auto) et `jobDetails.ts` (manuel).

**Recommandation** :
```json
"scripts": {
  "db:types": "supabase gen types typescript --project-id xxx > src/integrations/supabase/types.ts",
  "db:push": "supabase db push && npm run db:types"
}
```

---

## 8. Soft delete vs hard delete

| Table | Stratégie | Observé |
|-------|-----------|---------|
| `sourcing_projects` | Soft (status='archived') | OK |
| `outreach_sequences` | Soft (`is_active`) | Hard CASCADE en pratique |
| `job_candidate_status` | Hard | CASCADE |
| `organization_members` | Soft (`archived_at`?) | Non trouvé |
| `profiles` | Hard | Via FK auth.users |

**Incohérence** : mix sans stratégie claire.

**Problèmes RGPD** : `candidate_profiles` sans delete policy → impossible à purger.

**Recommandation** :
1. Standardiser **soft delete** sur tables org-scoped (audit trail)
2. Hard delete sur données user-scoped temporaires
3. Ajouter `archived_at` à `organization_members`, `outreach_sequences`, `job_candidate_status`
4. Implémenter `purge_user_data(user_id)` RGPD

---

## 9. Audit trail

| Table | created_at | updated_at | Audit log | Historique |
|-------|-----------|------------|-----------|-----------|
| `sourcing_projects` | ✓ | ✓ (trigger) | ✗ | Versioning implicite |
| `outreach_sequences` | ✓ | ✓ | ✗ | ✗ |
| `mission_process_steps` | ✓ | ✓ | ✗ | ✗ |
| `ai_credit_transactions` | ✓ | ✗ | **✓ explicit** | ✓ Immutable |
| `sequence_step_executions` | ✓ | ✓ | ✓ implicit | ✓ |
| `agent_messages` | ✓ | ✗ | Implicit | Conversationnel |

**Manques** :
1. Changement de statut candidat (pourquoi dismissed → shortlisted ?)
2. Modifications `mission_process_steps` (evaluation_criteria change = no trace)
3. Changements `mission_team` permissions

**Recommandation** :
```sql
CREATE TABLE audit_log (
  id uuid, created_at timestamptz DEFAULT now(),
  entity_type text, entity_id uuid,
  user_id uuid, organization_id uuid,
  action text, -- INSERT | UPDATE | DELETE
  old_values jsonb, new_values jsonb
);
-- Triggers sur sourcing_projects, outreach_sequences, mission_team, job_candidate_status
```

---

## 10. Top 12 améliorations prioritaires

| P | Action | Impact | Effort | Q |
|---|--------|--------|--------|---|
| **P1** | Normaliser `job_details` JSONB → colonnes indexées | Perf queries + RGPD | M | Q2 |
| **P1** | Standardiser soft/hard delete + RGPD purge | Conformité | M | Q2 |
| **P1** | Vérifier synchro embeddings `candidate_profiles` | Matching ML fiable | S | Q2 |
| **P2** | Audit trail `job_candidate_status` | Transparence sourcing | M | Q2 |
| **P2** | Partitionner `job_candidate_status` (org, month) | Scalabilité 1M | L | Q3 |
| **P2** | Consolider Airtable legacy (13 tables) | Maintenance | L | Q3 |
| **P3** | Renommer `sourcing_projects` → `recruitment_missions` | Clarté | S | Q2-Q3 |
| **P3** | GIN index sur `filters_snapshot`, `job_details` | Perf recherche | S | Q2 |
| **P3** | Custom fields org (Option B) | Extensibilité | L | Q3 |
| **P3** | Nettoyer orphelines (`hunt_applications`…) | Surface réduite | S | Q2 |
| **P4** | Auto-sync types TS via hook pre-commit | DX | S | Ongoing |
| **P4** | Doc MCD (DBDocs / Miro) | Onboarding | M | Q2 |

---

## Conclusion

Modèle globalement **sain (6.5/10)** avec MCD cohérent et RLS robuste. **3 risques majeurs** :

1. **JSONB non-queryable** (`job_details`, `evaluation_criteria`) → normaliser
2. **Fragmentation candidat** (4 tables, sync floue) → vérifier triggers
3. **Soft/hard delete inconsistant** → unifier + RGPD

Remédier aux **P1-P2** avant 1M candidats ou 10k missions.
