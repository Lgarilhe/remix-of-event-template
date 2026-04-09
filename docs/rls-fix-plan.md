# Plan de correction RLS — Phase 2 Audit Sécurité

> Date : 2026-04-09
> Scope : toutes les migrations dans `supabase/migrations/`
> Instruction : NE PAS créer de migration. Ce document est le plan uniquement.

---

## Table des matières

1. [CRITIQUE — USING(true) exposant toutes les données](#1-critique--usingtrue-exposant-toutes-les-données)
2. [HAUT — USING(true) à scope limité](#2-haut--usingtrue-à-scope-limité)
3. [MOYEN — Bypass via organization_id IS NULL](#3-moyen--bypass-via-organization_id-is-null)
4. [Tables sans policy DELETE](#4-tables-sans-policy-delete)
5. [Accès cross-org via mission_team](#5-accès-cross-org-via-mission_team)
6. [Résumé des actions](#6-résumé-des-actions)

---

## 1. CRITIQUE — USING(true) exposant toutes les données

Ces policies rendent la table entière lisible par **n'importe qui** (y compris `anon`), annulant toutes les autres restrictions RLS sur la même table.

### 1.1 `sourcing_projects` — "sourcing_projects_public_portal_read"

| Champ | Valeur |
|---|---|
| **Table** | `sourcing_projects` |
| **Policy** | `sourcing_projects_public_portal_read` |
| **Opération** | SELECT |
| **USING actuel** | `true` |
| **Migration** | `20260326100000_fix_client_portal_rls.sql` / `20260326143307_be50d751...sql` |
| **Impact** | Toutes les missions (noms, job_details, filters_snapshot, statistiques) sont lisibles par n'importe quel utilisateur non authentifié. Les policies org-scoped sont court-circuitées car PostgreSQL fait un OR entre toutes les SELECT policies. |

**USING corrigé proposé :**
```sql
-- Supprimer la policy USING(true)
DROP POLICY IF EXISTS "sourcing_projects_public_portal_read" ON public.sourcing_projects;

-- Remplacer par un accès ciblé via le token du portail client
CREATE POLICY "sourcing_projects_portal_read" ON public.sourcing_projects
  FOR SELECT TO anon
  USING (
    id IN (
      SELECT unnest(cpt.project_ids)
      FROM public.client_portal_tokens cpt
      WHERE cpt.expires_at IS NULL OR cpt.expires_at > now()
    )
  );
```
> Alternative plus performante : utiliser une fonction `SECURITY DEFINER` côté edge function pour le portail client, et supprimer complètement la policy anon.

---

### 1.2 `job_candidate_status` — "jcs_public_portal_read"

| Champ | Valeur |
|---|---|
| **Table** | `job_candidate_status` |
| **Policy** | `jcs_public_portal_read` |
| **Opération** | SELECT |
| **USING actuel** | `true` |
| **Migration** | `20260326100000_fix_client_portal_rls.sql` / `20260326143307_be50d751...sql` |
| **Impact** | Tous les statuts candidats (scores, notes de scoring, statuts pipeline) sont lisibles publiquement. Données très sensibles exposées. |

**USING corrigé proposé :**
```sql
DROP POLICY IF EXISTS "jcs_public_portal_read" ON public.job_candidate_status;

CREATE POLICY "jcs_portal_read" ON public.job_candidate_status
  FOR SELECT TO anon
  USING (
    project_id IN (
      SELECT unnest(cpt.project_ids)
      FROM public.client_portal_tokens cpt
      WHERE cpt.expires_at IS NULL OR cpt.expires_at > now()
    )
  );
```

---

### 1.3 `organizations` — "organizations_public_portal_read"

| Champ | Valeur |
|---|---|
| **Table** | `organizations` |
| **Policy** | `organizations_public_portal_read` |
| **Opération** | SELECT |
| **USING actuel** | `true` |
| **Migration** | `20260326100000_fix_client_portal_rls.sql` / `20260326143307_be50d751...sql` |
| **Impact** | Toutes les organisations (noms, slugs, types, permissions agency) sont lisibles publiquement. Fuite de données commerciales. |

**USING corrigé proposé :**
```sql
DROP POLICY IF EXISTS "organizations_public_portal_read" ON public.organizations;

CREATE POLICY "organizations_portal_read" ON public.organizations
  FOR SELECT TO anon
  USING (
    id IN (
      SELECT cpt.organization_id
      FROM public.client_portal_tokens cpt
      WHERE cpt.expires_at IS NULL OR cpt.expires_at > now()
    )
  );
```

---

## 2. HAUT — USING(true) à scope limité

### 2.1 `client_portal_tokens` — "client_portal_tokens_read_by_token"

| Champ | Valeur |
|---|---|
| **Table** | `client_portal_tokens` |
| **Policy** | `client_portal_tokens_read_by_token` |
| **Opération** | SELECT |
| **USING actuel** | `true` |
| **Migration** | `20260326100000_fix_client_portal_rls.sql` / `20260326143307_be50d751...sql` |
| **Impact** | Tous les tokens de portail client sont listables. Un attaquant peut énumérer tous les tokens et accéder à tous les portails clients. |

**USING corrigé proposé :**
```sql
DROP POLICY IF EXISTS "client_portal_tokens_read_by_token" ON public.client_portal_tokens;
DROP POLICY IF EXISTS "client_portal_tokens_read" ON public.client_portal_tokens;

-- Le portail client doit passer le token en paramètre : lookup par token uniquement
-- Approche recommandée : fonction SECURITY DEFINER qui prend le token en param
-- Si on doit garder une policy RLS :
CREATE POLICY "client_portal_tokens_read_by_token" ON public.client_portal_tokens
  FOR SELECT TO anon
  USING (
    -- Jamais de listing complet ; l'accès se fait via .eq('token', ?) côté client
    -- On restreint aux tokens non expirés au minimum
    (expires_at IS NULL OR expires_at > now())
  );
```
> **Recommandation forte** : remplacer par une fonction RPC `SECURITY DEFINER` `get_portal_by_token(p_token text)` qui retourne uniquement le token correspondant. Supprimer toute policy SELECT anon sur cette table.

---

### 2.2 `message_analysis_cache` — INSERT WITH CHECK(true)

| Champ | Valeur |
|---|---|
| **Table** | `message_analysis_cache` |
| **Policy** | `Authenticated users can insert analysis cache` |
| **Opération** | INSERT |
| **WITH CHECK actuel** | `true` |
| **Migration** | `20260311123043_0bb1bf15...sql` |
| **Impact** | N'importe quel utilisateur authentifié peut insérer dans le cache d'analyse avec n'importe quel `account_id`, potentiellement polluant le cache d'autres utilisateurs/orgs. |

**WITH CHECK corrigé proposé :**
```sql
DROP POLICY IF EXISTS "Authenticated users can insert analysis cache"
  ON public.message_analysis_cache;

CREATE POLICY "Users can insert own analysis cache"
  ON public.message_analysis_cache FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.member_linkedin_accounts mla
      WHERE mla.linkedin_account_id = message_analysis_cache.account_id
        AND mla.user_id = auth.uid()
    )
  );
```

---

### 2.3 `sequence_email_tracking` — SELECT USING(true)

| Champ | Valeur |
|---|---|
| **Table** | `sequence_email_tracking` |
| **Policy** | `sequence_email_tracking_anon_select` |
| **Opération** | SELECT |
| **USING actuel** | `true` |
| **Migration** | `20260331120000_enhance_sequences_module.sql` |
| **Impact** | Tous les tracking IDs et message IDs email sont listables publiquement. Risque d'énumération et de fuite d'activité email. |

**USING corrigé proposé :**
```sql
DROP POLICY IF EXISTS "sequence_email_tracking_anon_select"
  ON public.sequence_email_tracking;

-- Le pixel de tracking doit passer par une edge function SECURITY DEFINER
-- qui fait le lookup par tracking_id sans exposer la table entière.
-- Si une policy anon est nécessaire pour le pixel :
CREATE POLICY "sequence_email_tracking_anon_lookup" ON public.sequence_email_tracking
  FOR SELECT TO anon
  USING (false);
-- Accès uniquement via edge function service_role
```

---

## 3. MOYEN — Bypass via organization_id IS NULL

Pattern récurrent : `USING(organization_id = get_user_org_id(auth.uid()) OR organization_id IS NULL)`.

Quand `organization_id IS NULL`, **tout utilisateur authentifié** peut accéder à la ligne, quel que soit son org. Ce pattern a été utilisé pour la rétrocompatibilité lors de la migration vers le multi-org, mais constitue un risque permanent.

### Tables affectées (pattern `OR organization_id IS NULL` sans check `created_by`)

| Table | Policies | Opérations exposées |
|---|---|---|
| `aircall_calls` | Org members can view/update/delete | SELECT, UPDATE, DELETE |
| `airtable_appointments` | Org members can view | SELECT |
| `airtable_candidates` | Org-scoped read candidates | SELECT |
| `airtable_companies` | Org members can view | SELECT |
| `airtable_contacts` | Org-scoped read contacts | SELECT |
| `airtable_jobs` | Org members can view | SELECT |
| `airtable_kpi` | Org members can view | SELECT |
| `airtable_notes` | Org-scoped read notes | SELECT |
| `airtable_placements` | Org-scoped read placements | SELECT |
| `airtable_shortlists` | Org-scoped read shortlists | SELECT |
| `airtable_shortlists_cumulated` | Org members can view | SELECT |
| `airtable_tasks` | Org members can view | SELECT |
| `job_profiles` | Org members can view + manage | SELECT, ALL |
| `job_skills_cache` | Org members can view + manage | SELECT, ALL |
| `sequence_analytics` | Org members can view + manage | SELECT, ALL |
| `sequence_step_executions` | Org members can view + manage | SELECT, ALL |

**USING corrigé proposé (pattern général) :**
```sql
-- Remplacer :
USING (organization_id = get_user_org_id(auth.uid()) OR organization_id IS NULL)
-- Par :
USING (organization_id = get_user_org_id(auth.uid()))
```
> **Pré-requis** : vérifier que le backfill `organization_id` est complet sur chaque table. Lancer : `SELECT count(*) FROM <table> WHERE organization_id IS NULL;` — si > 0, compléter le backfill avant de resserrer la policy.

---

## 4. Tables sans policy DELETE

Ces tables ont des policies SELECT, INSERT et/ou UPDATE mais **aucune policy DELETE** pour les utilisateurs authentifiés (hors service_role). Cela signifie que les utilisateurs ne peuvent pas supprimer leurs propres enregistrements, OU que le DELETE est implicitement interdit (ce qui peut être voulu).

| Table | Policies existantes | DELETE manquant ? | Recommandation |
|---|---|---|---|
| `agent_conversations` | SELECT (org), INSERT (uid), UPDATE (org) | **Oui** | Ajouter DELETE org-scoped |
| `agent_messages` | SELECT (org join), INSERT (org join) | **Oui** (+ UPDATE manquant) | Ajouter UPDATE + DELETE via conversation org check |
| `notifications` | SELECT (user), INSERT (org), UPDATE (user) | **Oui** | Ajouter `DELETE USING (user_id = auth.uid())` |
| `vivier_enrichments` | SELECT (org), INSERT (org), UPDATE (org) | **Oui** | Ajouter DELETE org-scoped |
| `message_analysis_cache` | SELECT (role), INSERT (true), UPDATE (user) | **Oui** | Ajouter DELETE scoped via member_linkedin_accounts |
| `sequence_enrollments` | SELECT (org), INSERT (org), UPDATE (org), **DELETE stale** (`auth.uid() = created_by`) | **Stale** | Remplacer la vieille policy DELETE par une org-scoped |
| `profiles` | SELECT, INSERT, UPDATE | Non (voulu) | Pas de DELETE — un profil ne se supprime pas via RLS |

### Corrections proposées :

```sql
-- agent_conversations
CREATE POLICY "Org members can delete conversations"
  ON public.agent_conversations FOR DELETE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

-- agent_messages
CREATE POLICY "Users can update messages in their org conversations"
  ON public.agent_messages FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agent_conversations ac
    WHERE ac.id = conversation_id
      AND ac.organization_id = public.get_user_org_id(auth.uid())
  ));

CREATE POLICY "Users can delete messages in their org conversations"
  ON public.agent_messages FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agent_conversations ac
    WHERE ac.id = conversation_id
      AND ac.organization_id = public.get_user_org_id(auth.uid())
  ));

-- notifications
CREATE POLICY "Users can delete their own notifications"
  ON public.notifications FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- vivier_enrichments
CREATE POLICY "Users can delete enrichments for their org"
  ON public.vivier_enrichments FOR DELETE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

-- message_analysis_cache
CREATE POLICY "Users can delete own analysis cache"
  ON public.message_analysis_cache FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.member_linkedin_accounts mla
    WHERE mla.linkedin_account_id = message_analysis_cache.account_id
      AND mla.user_id = auth.uid()
  ));

-- sequence_enrollments : remplacer la vieille policy
DROP POLICY IF EXISTS "Users can delete their enrollments" ON public.sequence_enrollments;
CREATE POLICY "Org members can delete enrollments"
  ON public.sequence_enrollments FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    OR (organization_id IS NULL AND created_by = auth.uid())
  );
```

---

## 5. Accès cross-org via mission_team

### 5.1 Problème principal : USING(true) rend mission_team inutile

Les policies `sourcing_projects_public_portal_read` et `jcs_public_portal_read` avec `USING(true)` **court-circuitent complètement** les restrictions cross-org. Même sans être dans `mission_team`, n'importe qui (y compris anon) peut lire toutes les missions et tous les candidats.

**→ Résolu par les corrections du §1.**

### 5.2 mission_team ne vérifie pas que le projet appartient à l'org de l'utilisateur invité

| Champ | Valeur |
|---|---|
| **Table** | `sourcing_projects` |
| **Policy** | `Mission team members can view assigned projects` / `mission_team_view_projects` |
| **Opération** | SELECT |
| **USING actuel** | `id IN (SELECT mt.project_id FROM mission_team mt WHERE mt.user_id = auth.uid())` |
| **Risque** | Un utilisateur ajouté à `mission_team` accède au projet même s'il est dans une autre org. C'est **voulu** pour les freelances. Mais la table `mission_team` n'a pas de colonne `organization_id` propre — le contrôle repose entièrement sur l'INSERT policy de `mission_team`. |

**Analyse de l'INSERT policy de mission_team :**
```sql
-- Policy actuelle (20260325120000 / 20260326182810)
FOR ALL USING (
  project_id IN (
    SELECT sp.id FROM sourcing_projects sp
    WHERE sp.organization_id IN (
      SELECT om.organization_id FROM organization_members om
      WHERE om.user_id = auth.uid()
    )
  )
)
```
Seuls les membres de l'org propriétaire du projet peuvent ajouter des entrées à `mission_team`. C'est correct. **Mais** il manque une vérification que le `user_id` ajouté est bien un membre de l'org OU un invité valide (`mission_invitations`).

**Risque** : Un admin de Org A peut ajouter n'importe quel `user_id` (même d'Org B) à la mission_team, donnant à cet utilisateur accès au projet sans invitation formelle.

**USING corrigé proposé (WITH CHECK pour INSERT) :**
```sql
DROP POLICY IF EXISTS "mission_team_policy" ON public.mission_team;
DROP POLICY IF EXISTS "Users can see team for their org projects" ON public.mission_team;

-- SELECT : org members + le membre lui-même
CREATE POLICY "mission_team_select" ON public.mission_team
  FOR SELECT USING (
    user_id = auth.uid()
    OR project_id IN (
      SELECT sp.id FROM sourcing_projects sp
      WHERE sp.organization_id IN (
        SELECT om.organization_id FROM organization_members om
        WHERE om.user_id = auth.uid()
      )
    )
  );

-- INSERT : uniquement les membres de l'org propriétaire
-- ET le user_id doit être soit membre de l'org, soit avoir une invitation acceptée
CREATE POLICY "mission_team_insert" ON public.mission_team
  FOR INSERT WITH CHECK (
    project_id IN (
      SELECT sp.id FROM sourcing_projects sp
      WHERE sp.organization_id IN (
        SELECT om.organization_id FROM organization_members om
        WHERE om.user_id = auth.uid()
      )
    )
    AND (
      -- Le user ajouté est membre de l'org
      EXISTS (
        SELECT 1 FROM organization_members om2
        JOIN sourcing_projects sp2 ON sp2.organization_id = om2.organization_id
        WHERE sp2.id = mission_team.project_id
          AND om2.user_id = mission_team.user_id
      )
      -- OU le user a une invitation acceptée pour ce projet
      OR EXISTS (
        SELECT 1 FROM mission_invitations mi
        WHERE mi.project_id = mission_team.project_id
          AND mi.accepted_by = mission_team.user_id
          AND mi.status = 'accepted'
      )
    )
  );

-- UPDATE/DELETE : org members uniquement
CREATE POLICY "mission_team_manage" ON public.mission_team
  FOR ALL USING (
    project_id IN (
      SELECT sp.id FROM sourcing_projects sp
      WHERE sp.organization_id IN (
        SELECT om.organization_id FROM organization_members om
        WHERE om.user_id = auth.uid()
      )
    )
  );
```

### 5.3 mission_team donne accès INSERT/UPDATE sur job_candidate_status sans vérification org

| Champ | Valeur |
|---|---|
| **Table** | `job_candidate_status` |
| **Policies** | `Mission team can manage project candidates` (INSERT) / `Mission team can update project candidates` (UPDATE) / `mission_team_insert_candidates` / `mission_team_update_candidates` |
| **USING actuel** | `project_id IN (SELECT mt.project_id FROM mission_team mt WHERE mt.user_id = auth.uid())` |
| **Risque** | Un freelance ajouté à mission_team peut INSERT et UPDATE des candidats pour ce projet. C'est voulu. Mais il n'y a pas de vérification que `created_by` ou `organization_id` est correctement renseigné lors de l'INSERT. |

**WITH CHECK corrigé proposé :**
```sql
DROP POLICY IF EXISTS "Mission team can manage project candidates" ON public.job_candidate_status;
DROP POLICY IF EXISTS "mission_team_insert_candidates" ON public.job_candidate_status;

CREATE POLICY "mission_team_insert_candidates" ON public.job_candidate_status
  FOR INSERT WITH CHECK (
    project_id IN (
      SELECT mt.project_id FROM mission_team mt
      WHERE mt.user_id = auth.uid()
    )
    AND created_by = auth.uid()
    -- L'organization_id doit correspondre à celle du projet
    AND (
      organization_id IS NULL
      OR organization_id = (
        SELECT sp.organization_id FROM sourcing_projects sp
        WHERE sp.id = project_id
      )
    )
  );
```

### 5.4 mission_process_steps inaccessible aux freelances

| Champ | Valeur |
|---|---|
| **Table** | `mission_process_steps` |
| **Policy** | `Users can manage process steps for their org projects` / `process_steps_policy` |
| **USING actuel** | `organization_id IN (SELECT om.organization_id FROM organization_members om WHERE om.user_id = auth.uid())` |
| **Problème** | Un freelance ajouté via `mission_team` ne peut PAS voir les étapes du processus de recrutement car il n'est pas dans l'org propriétaire. Bug fonctionnel, pas un risque de sécurité. |

**USING corrigé proposé :**
```sql
-- Ajouter une policy SELECT pour les membres de mission_team
CREATE POLICY "mission_team_view_process_steps" ON public.mission_process_steps
  FOR SELECT USING (
    project_id IN (
      SELECT mt.project_id FROM mission_team mt
      WHERE mt.user_id = auth.uid()
    )
  );
```

---

## 6. Résumé des actions

### Priorité CRITIQUE (à traiter immédiatement)

| # | Table | Action | Risque |
|---|---|---|---|
| C1 | `sourcing_projects` | Supprimer `sourcing_projects_public_portal_read`, remplacer par policy anon restreinte aux project_ids des tokens valides | Toutes les missions lisibles par anon |
| C2 | `job_candidate_status` | Supprimer `jcs_public_portal_read`, remplacer par policy anon restreinte | Tous les candidats lisibles par anon |
| C3 | `organizations` | Supprimer `organizations_public_portal_read`, remplacer par policy anon restreinte | Toutes les orgs lisibles par anon |

### Priorité HAUTE

| # | Table | Action | Risque |
|---|---|---|---|
| H1 | `client_portal_tokens` | Remplacer `USING(true)` par RPC SECURITY DEFINER | Énumération de tous les tokens portail |
| H2 | `message_analysis_cache` | Restreindre INSERT au compte LinkedIn de l'utilisateur | Pollution du cache cross-org |
| H3 | `sequence_email_tracking` | Supprimer SELECT anon, passer par edge function | Fuite des tracking IDs email |
| H4 | `mission_team` | Ajouter WITH CHECK sur INSERT vérifiant invitation ou membership | Ajout arbitraire de user_ids externes |

### Priorité MOYENNE

| # | Table | Action | Risque |
|---|---|---|---|
| M1 | 16 tables (voir §3) | Supprimer `OR organization_id IS NULL` après backfill complet | Données orphelines visibles cross-org |
| M2 | `sequence_enrollments` | Remplacer vieille DELETE policy user-scoped par org-scoped | Incohérence avec les autres policies |
| M3 | 5 tables (voir §4) | Ajouter policies DELETE manquantes | Impossibilité de supprimer ses données |
| M4 | `job_candidate_status` | Ajouter `created_by` et `organization_id` check sur INSERT mission_team | INSERT sans contrainte org |
| M5 | `mission_process_steps` | Ajouter SELECT pour mission_team members | Bug fonctionnel freelances |

### Ordre d'exécution recommandé

1. **Migration 1** : Corriger les 3 policies USING(true) critiques (C1, C2, C3)
2. **Migration 2** : Corriger client_portal_tokens, message_analysis_cache, sequence_email_tracking (H1, H2, H3)
3. **Migration 3** : Resserrer mission_team INSERT + ajouter policies DELETE manquantes (H4, M2, M3)
4. **Migration 4** : Ajouter cross-org checks sur job_candidate_status INSERT via mission_team (M4, M5)
5. **Migration 5** : Audit et suppression des `OR organization_id IS NULL` après backfill confirmé (M1)

### Vérifications pré-migration

Avant chaque migration, exécuter :
```sql
-- Vérifier le backfill des organization_id
SELECT 'sourcing_projects' AS tbl, count(*) FROM sourcing_projects WHERE organization_id IS NULL
UNION ALL
SELECT 'job_candidate_status', count(*) FROM job_candidate_status WHERE organization_id IS NULL
UNION ALL
SELECT 'outreach_sequences', count(*) FROM outreach_sequences WHERE organization_id IS NULL
UNION ALL
SELECT 'sequence_enrollments', count(*) FROM sequence_enrollments WHERE organization_id IS NULL
UNION ALL
SELECT 'sequence_step_executions', count(*) FROM sequence_step_executions WHERE organization_id IS NULL
-- ... (pour chaque table du §3)
;
```
