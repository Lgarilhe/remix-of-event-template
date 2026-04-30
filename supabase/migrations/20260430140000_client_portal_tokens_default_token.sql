-- Migration : ajoute un DEFAULT gen_random_uuid() à la colonne token
-- de client_portal_tokens.
--
-- Avant : la colonne token était NOT NULL sans default, donc tout INSERT
-- qui oubliait de fournir un token (cf bug du hook useClientPortalTokens
-- avant le fix frontend) crashait avec :
--   null value in column "token" of relation "client_portal_tokens"
--   violates not-null constraint
--
-- Après : si le frontend ne fournit pas de token, Postgres en génère
-- automatiquement un (UUID v4 cast en text). Le frontend continue à
-- fournir le token via crypto.randomUUID() pour ne pas dépendre de ça,
-- mais cette migration sert de defense en profondeur.
--
-- Idempotente — peut être rejouée sans erreur.

DO $$
BEGIN
  -- Vérifie que la colonne existe avant de tenter l'ALTER (sécurité)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'client_portal_tokens'
      AND column_name = 'token'
  ) THEN
    -- Active l'extension pgcrypto pour gen_random_uuid() si pas déjà
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    -- Set default seulement s'il n'existe pas déjà
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'client_portal_tokens'
        AND column_name = 'token'
        AND column_default IS NOT NULL
    ) THEN
      ALTER TABLE public.client_portal_tokens
        ALTER COLUMN token SET DEFAULT gen_random_uuid()::text;
    END IF;
  END IF;
END $$;

COMMENT ON COLUMN public.client_portal_tokens.token IS
  'Token public unique pour accéder au portail client (URL /client/{token}). Auto-généré via gen_random_uuid() si non fourni à l''insert.';
