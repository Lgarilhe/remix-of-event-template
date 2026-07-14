-- Jarvis 24/7 de Laurent (autorisé explicitement le 13/07/2026) : fil de conversation + base de connaissance
-- Tables isolées jarvis_*, RLS sans policy publique (service role uniquement), zéro impact sur l'app.
--
-- ⚠️ Fichier reconstruit a posteriori (2026-07-14) : cette migration avait été
-- appliquée directement en prod (via MCP) sans être commitée au repo, ce qui
-- désynchronisait la table de suivi et cassait le workflow deploy-migrations
-- (« Remote migration versions not found in local migrations directory »).
-- Contenu = copie exacte des statements stockés dans
-- supabase_migrations.schema_migrations pour la version 20260713153549.
-- Idempotente — ne ré-exécute rien en prod (déjà trackée applied).
create table if not exists public.jarvis_messages (
  id uuid primary key default gen_random_uuid(),
  message_id text unique,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists jarvis_messages_created_idx on public.jarvis_messages (created_at desc);

create table if not exists public.jarvis_kb (
  id bigint generated always as identity primary key,
  doc text not null,
  chunk_no int not null,
  content text not null,
  updated_at timestamptz not null default now()
);
create index if not exists jarvis_kb_fts_idx on public.jarvis_kb using gin (to_tsvector('french', content));

alter table public.jarvis_messages enable row level security;
alter table public.jarvis_kb enable row level security;

comment on table public.jarvis_messages is 'Fil de conversation du Jarvis WhatsApp 24/7 de Laurent (groupe 🤖 Jarvis). Écrit par la fonction jarvis-whatsapp (service role).';
comment on table public.jarvis_kb is 'Base de connaissance de Laurent (miroir des fichiers 🧠 Base de connaissance OneDrive). Rafraîchie depuis le PC.';
