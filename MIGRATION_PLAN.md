# Plan de migration Lovable Cloud → Supabase konekt-production

**État au 2026-04-20 23h00**

## Décisions prises ce soir

- Migration vers nouveau Supabase `konekt-production` (ref: crckfywoyjxkawathdff, eu-west-3 Ireland, org "konekt-production")
- 70/173 migrations SQL appliquées via supabase db push, puis BLOCAGE sur doublons de policies (CREATE POLICY sans DROP IF EXISTS dans plusieurs migrations)
- Lovable Cloud actuel CONSERVÉ INTACT — aucune perte data possible
- Stratégie data adoptée : OPTION 1 — Migration minimale (~150 rows, repartir from scratch côté usage)
- Tables ignorées : toutes les airtable_*, aircall_*, notion_*, knowledge_chunks, match_scores, logs (data perso d'avant commercialisation, récupérables ultérieurement à la carte)
- Tables migrées : organizations, organization_members, profiles, user_roles, organization_subscriptions, subscription_plans, connector_registry, internal_config

## Plan d'exécution samedi/dimanche matin

### Phase 1 — Schéma (45 min)
- Reset Supabase konekt-production (vider toutes les tables publiques + supabase_migrations.schema_migrations)
- Au lieu de relancer 173 migrations qui se contredisent, faire un SQL DUMP COMPLET du schéma actuel Lovable Cloud via une des méthodes :
  - a) Bouton "Export schema" dans Lovable Cloud panel Database (à vérifier)
  - b) Extension Chrome NextLovable Migrator
  - c) Service payant lovablemigration.com (~300$ — dernier recours)
- Importer ce dump dans konekt-production via SQL Editor

### Phase 2 — Edge functions (15 min)
- supabase functions deploy --all
- 78 functions à déployer

### Phase 3 — Secrets (30 min)
Setter dans Supabase : Anthropic, Apollo, Unipile, Aircall, Airtable, Notion, Calendly, Stripe, Deepgram, PDL, n8n, Google, Resend, autres à identifier

### Phase 4 — Users + data minimale (15 min)
- Export des 8 tables minimales depuis Lovable Cloud en CSV
- Import dans konekt-production
- Migration des 4 auth.users via script Node + service role key

### Phase 5 — Frontend (30 min)
- Créer NOUVEAU projet Lovable konekt-app dans workspace Saas konekt
- Connecter au nouveau Supabase konekt-production (Cloud → Connect Supabase)
- Mettre à jour .env du repo avec credentials konekt-production
- Tester login + flow critique

### Phase 6 — Validation (45 min)
- Login fonctionne
- Au moins 1 mission visible
- Au moins 1 séquence créable
- Pas d'erreur Sentry/console

## Pièges identifiés

- Les migrations historiques contiennent des CREATE POLICY redondants → ne PAS les rejouer, prendre dump complet du schema actuel
- Migration 20260309170000_invalidate_match_scores_on_job_update.sql est orpheline (référence public.jobs qui n'existe pas) → vidée localement, à recommit après migration réussie
- pgcrypto installé dans schema "extensions" pas "public" sur les nouveaux Supabase → search_path à ajuster (déjà fait sur konekt-production via GRANT USAGE + ALTER DATABASE)

## Credentials konekt-production

Voir supabase-creds.txt sur le Bureau (jamais commit ce fichier).

## État actuel (bloqué)

- 70 migrations sur 173 appliquées, schema partiel
- À reset avant de reprendre samedi
- Lovable Cloud original intact, app actuelle continue de fonctionner
