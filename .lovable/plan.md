

## Plan : Multi-tenant -- Phase 1

L'objectif est de passer d'une app mono-utilisateur (filtrage par `created_by` = user_id) a une app multi-tenant ou les donnees sont isolees par organisation.

---

### Architecture cible

```text
organizations
  id (uuid, PK)
  name (text)
  slug (text, unique)  -- pour URLs futures
  created_by (uuid)    -- fondateur
  created_at, updated_at

organization_members
  id (uuid, PK)
  organization_id (uuid, FK -> organizations)
  user_id (uuid, FK -> auth.users)
  role (text: 'owner' | 'admin' | 'member')
  created_at

profiles (existante)
  + active_organization_id (uuid, FK -> organizations, nullable)
```

### Migration DB (1 migration SQL)

1. Creer `organizations` avec RLS (membres peuvent lire, owner peut modifier)
2. Creer `organization_members` avec RLS (membres voient leur org, owners gerent)
3. Ajouter `organization_id` (nullable pour l'instant) sur les tables business :
   - `sourcing_projects`
   - `search_history`
   - `job_candidate_status`
   - `outreach_sequences`
   - `sequence_steps`
   - `sequence_enrollments`
   - `sequence_step_executions`
   - `saved_filter_presets`
   - `inmail_queue`
   - `qualification_sessions`
   - `candidate_evaluations`
   - `call_coaching_sessions`
   - `candidate_portal_tokens`
   - `chat_categories`
4. Ajouter `active_organization_id` sur `profiles`
5. Creer une fonction `get_user_org_id(uuid)` SECURITY DEFINER qui retourne l'`organization_id` active de l'utilisateur
6. Creer un trigger `on_organization_created` qui ajoute automatiquement le createur comme `owner` dans `organization_members`

### Onboarding flow

- Apres login, si l'utilisateur n'a pas d'organisation, afficher un ecran "Creer votre organisation" (nom + slug)
- Creer l'org, ajouter le membre, mettre `active_organization_id` sur le profil
- Rediriger vers `/outreach`

### Hook `useOrganization`

Un hook central qui :
- Charge l'org active de l'utilisateur depuis `profiles.active_organization_id`
- Expose `organizationId`, `organizationName`, `userRole`, `isOwner`
- Utilise dans tous les hooks existants pour filtrer par `organization_id` au lieu de `created_by`

### Migration du code (hooks)

Pour chaque hook qui filtre par `created_by` :
- Ajouter `organization_id` dans les inserts (depuis `useOrganization`)
- Garder `created_by` pour savoir QUI a fait l'action
- Filtrer les SELECT par `organization_id` au lieu de `created_by` seul
- Les RLS seront mises a jour dans une phase 2 (pour l'instant on garde les RLS existantes + le filtre cote code)

### Page Settings / Equipe

- Nouvelle page `/settings` avec onglet "Equipe"
- Lister les membres de l'org
- Inviter un membre par email (insert dans `organization_members` + email magic link)
- Changer le role d'un membre (owner seulement)

### Ce qui ne change PAS dans cette phase

- Les Edge Functions (elles utilisent service_role, pas de RLS)
- Les tables Airtable/Notion (donnees partagees globalement)
- Le systeme d'events (module separe)
- Les RLS existantes (on ajoute le filtre org cote code d'abord, migration RLS en phase 2)

---

### Ordre d'implementation

1. **Migration SQL** : tables `organizations` + `organization_members` + colonnes `organization_id` + fonction helper
2. **Hook `useOrganization`** + ecran onboarding "Creer organisation"
3. **Adapter les hooks metier** (`useSourcingProjects`, `useJobCandidateStatus`, `useSearchHistory`, etc.) pour utiliser `organization_id`
4. **Page Settings/Equipe** pour inviter des membres
5. **Migrer localStorage vers DB** (sender_name, subscription overrides)

