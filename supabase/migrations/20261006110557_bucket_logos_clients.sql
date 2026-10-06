-- Logos des clients des missions (fonction resolve-client-logo) : bucket public
-- dédié, écrit par le serveur seulement (clé de service, aucune policy
-- d'écriture). Les logos de sites modernes sont souvent des SVG, refusés par
-- org-logos (logos de l'organisation, PNG, JPEG, WebP et GIF seulement).
-- La fonction écarte tout SVG contenant un script avant l'envoi.
-- Rejouable sur une base vide.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'client-logos',
  'client-logos',
  true,
  1048576,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
