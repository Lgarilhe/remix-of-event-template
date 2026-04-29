-- Migration : chat_categories.category nullable
--
-- Problème : la colonne `category` était NOT NULL, ce qui bloquait
-- toute INSERT depuis le code snooze/archive (qui ne passe pas
-- `category`). Les upsert pour snooze/archive crashaient avec :
--   "null value in column 'category' violates not-null constraint"
--
-- Fix : rendre category nullable. Ça reflète mieux la réalité :
-- une row chat_categories peut être uniquement pour snooze/archive,
-- pas forcément pour catégoriser.

ALTER TABLE public.chat_categories
  ALTER COLUMN category DROP NOT NULL;

COMMENT ON COLUMN public.chat_categories.category IS
  'Catégorie de classification du chat (interested, not_interested, etc.). NULL si la row sert uniquement pour snooze/archive sans catégorie explicite.';
