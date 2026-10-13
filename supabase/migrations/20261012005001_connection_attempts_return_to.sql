-- Page de retour d'une tentative de connexion (suite de 20261011204248_connection_attempts).
--
-- Le parcours d'accueil (/onboarding) envoyait une adresse de retour choisie par le
-- navigateur ; la connexion v2 la fixe côté serveur (page de retour des connexions).
-- Pour que l'accueil retrouve son écran, la tentative garde le NOM d'une page de retour
-- choisi dans une liste fermée, jamais une adresse : la page de retour lit ce nom dans
-- connection_status et renvoie la personne au bon endroit.
--
-- Rejouable, sur base neuve comme en production. Colonne nullable : les tentatives
-- existantes et les connexions faites depuis les Paramètres n'ont pas de page de retour.

ALTER TABLE public.connection_attempts
  ADD COLUMN IF NOT EXISTS return_to text;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.connection_attempts'::regclass
       AND conname = 'connection_attempts_return_to_check'
  ) THEN
    ALTER TABLE public.connection_attempts
      ADD CONSTRAINT connection_attempts_return_to_check
      CHECK (return_to IS NULL OR return_to IN ('onboarding'));
  END IF;
END
$constraint$;

COMMENT ON COLUMN public.connection_attempts.return_to IS
  'Nom de la page où la page de retour renvoie la personne (liste fermée : onboarding). Jamais une adresse.';
