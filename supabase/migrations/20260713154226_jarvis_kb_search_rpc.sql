-- Recherche plein-texte française pour le Jarvis (service role only, search_path fixé)
--
-- ⚠️ Fichier reconstruit a posteriori (2026-07-14) : cette migration avait été
-- appliquée directement en prod (via MCP) sans être commitée au repo — voir
-- 20260713153549_jarvis_whatsapp_foundation.sql pour le contexte complet.
-- Contenu = copie exacte des statements stockés dans
-- supabase_migrations.schema_migrations pour la version 20260713154226.
-- Idempotente — ne ré-exécute rien en prod (déjà trackée applied).
create or replace function public.jarvis_kb_search(q text)
returns table (doc text, content text)
language sql
security definer
set search_path = public
stable
as $$
  select doc, content
  from public.jarvis_kb
  where to_tsvector('french', content) @@ plainto_tsquery('french', q)
  order by ts_rank(to_tsvector('french', content), plainto_tsquery('french', q)) desc
  limit 6;
$$;
revoke execute on function public.jarvis_kb_search(text) from public, anon, authenticated;
