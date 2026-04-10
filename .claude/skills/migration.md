# Skill: Create a Supabase SQL Migration

When the user asks to create a new database migration, follow these conventions from the Skalr codebase.

## File naming

```
supabase/migrations/YYYYMMDDHHMMSS_description_in_snake_case.sql
```

Use `date -u +%Y%m%d%H%M%S` to generate the timestamp prefix.

## Template

```sql
-- ============================================
-- Migration: {description}
-- ============================================

-- ============================================
-- Phase 1: Schema
-- ============================================

CREATE TABLE IF NOT EXISTS public.{table_name} (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
  -- add columns here
);

-- Index on organization_id (MANDATORY for RLS performance)
CREATE INDEX IF NOT EXISTS idx_{table_name}_org_id ON public.{table_name}(organization_id);

-- ============================================
-- Phase 2: RLS
-- ============================================

ALTER TABLE public.{table_name} ENABLE ROW LEVEL SECURITY;

-- Service role bypass (edge functions need this)
CREATE POLICY "Service role full access"
  ON public.{table_name}
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Org-scoped read
CREATE POLICY "Org members can view {table_name}"
  ON public.{table_name} FOR SELECT
  USING (
    organization_id = public.get_user_org_id(auth.uid())
  );

-- Org-scoped insert
CREATE POLICY "Org members can create {table_name}"
  ON public.{table_name} FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND public.is_org_member(auth.uid(), organization_id)
  );

-- Org-scoped update
CREATE POLICY "Org members can update {table_name}"
  ON public.{table_name} FOR UPDATE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
  );

-- Org-scoped delete
CREATE POLICY "Org members can delete {table_name}"
  ON public.{table_name} FOR DELETE
  USING (
    organization_id = public.get_user_org_id(auth.uid())
  );
```

## Mandatory rules

1. **`organization_id` is required** on every new table. It must be `uuid NOT NULL REFERENCES public.organizations(id)`.
2. **Always `ENABLE ROW LEVEL SECURITY`** — no exceptions.
3. **Always create an index** on `organization_id`: `idx_{table_name}_org_id`.
4. **RLS helper functions**: Use `public.get_user_org_id(auth.uid())` for SELECT/UPDATE/DELETE USING clauses, and `public.is_org_member(auth.uid(), organization_id)` for INSERT WITH CHECK clauses.
5. **Service role policy**: Always add "Service role full access" — edge functions use the service role key and need to bypass RLS.
6. **Use `IF NOT EXISTS` / `IF EXISTS`** for idempotent migrations (safe to re-run).
7. **Primary key**: Use `uuid PRIMARY KEY DEFAULT gen_random_uuid()` unless there's a specific reason not to.
8. **Timestamps**: Include `created_at timestamptz NOT NULL DEFAULT now()` and `updated_at timestamptz NOT NULL DEFAULT now()`.
9. **Foreign keys**: Always add `REFERENCES` constraints. Use `ON DELETE CASCADE` where parent deletion should cascade.

## Adding a column to an existing table

```sql
-- Add column
ALTER TABLE public.{table_name}
  ADD COLUMN IF NOT EXISTS {column_name} {type};

-- Add index if column will be filtered/joined on
CREATE INDEX IF NOT EXISTS idx_{table_name}_{column_name} ON public.{table_name}({column_name});
```

## Adding `organization_id` to an existing table (backfill pattern)

```sql
-- Step 1: Add column (nullable initially for backfill)
ALTER TABLE public.{table_name}
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

CREATE INDEX IF NOT EXISTS idx_{table_name}_org_id ON public.{table_name}(organization_id);

-- Step 2: Backfill from created_by -> profiles.active_organization_id
UPDATE public.{table_name}
  SET organization_id = (
    SELECT active_organization_id
    FROM profiles
    WHERE user_id = {table_name}.created_by
    LIMIT 1
  )
  WHERE organization_id IS NULL AND created_by IS NOT NULL;

-- Step 3: RLS policies (see template above)
-- Step 4: Optionally set NOT NULL after backfill is verified
```

## Modifying RLS policies

Always drop the old policy before creating the new one:
```sql
DROP POLICY IF EXISTS "Old policy name" ON public.{table_name};

CREATE POLICY "New policy name"
  ON public.{table_name} FOR SELECT
  USING (...);
```

## Legacy data handling

Some rows may have `organization_id IS NULL` (pre-multi-tenant data). RLS policies should handle this gracefully:
```sql
USING (
  organization_id = public.get_user_org_id(auth.uid())
  OR (organization_id IS NULL AND created_by = auth.uid())
)
```
