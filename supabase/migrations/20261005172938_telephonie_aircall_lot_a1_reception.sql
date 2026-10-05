-- ======================================================================
-- Téléphonie, lot A1 : Aircall relié par organisation (réception des appels).
--
-- Pourquoi. L'ancienne réception (aircall-webhook, table aircall_calls) est
-- morte : un seul jeton pour toute la plateforme, des appels écrits sans
-- organisation (donc invisibles sous la RLS depuis le 10/04), un
-- rapprochement par Airtable qui n'a plus aucune ligne. Mesure du 24/09 : 0
-- appel. Ce lot pose le socle d'une réception propre, par organisation et
-- pour plusieurs fournisseurs (Aircall d'abord, Ringover ensuite) :
--
--   1. phone_calls : un appel, quel que soit le fournisseur. Clé
--      (organisation, fournisseur, identifiant du fournisseur). Lecture par
--      les membres de l'organisation, aucune écriture hors clé de service.
--      Le numéro du correspondant est gardé tel que reçu ET en E.164, clé du
--      rapprochement avec les coordonnées des candidats (fait à la lecture,
--      jamais figé à l'écriture : un numéro corrigé se rapproche aussitôt).
--   2. telephony_connections : la connexion d'une organisation à un
--      fournisseur. Elle garde l'empreinte SHA-256 du jeton de webhook que
--      le fournisseur renvoie dans chaque événement : c'est ainsi que le
--      récepteur retrouve l'organisation, sans jeton partagé. Illisible par
--      tout rôle client.
--   3. record_phone_call : l'écriture d'un événement d'appel, rejouable et
--      tolérante à l'ordre (un événement plus ancien que celui déjà appliqué
--      est sans effet). Clé de service seulement.
--   4. get_telephony_status : l'état de la connexion pour l'écran des
--      réglages (propriétaire et administrateur seulement).
--
-- Ce que ce lot ne touche pas : aircall_calls et ses lecteurs (retrait au
-- lot I0 du plan), les identifiants saisis dans organization_integrations
-- (restent écrits par set_integration_secret, jamais relus), les écrans.
--
-- Rejouable sur une base vide (règle 6 des migrations) : aucun objet
-- antérieur n'est supposé hors organizations et get_org_role/get_user_org_id.
-- ======================================================================

-- ---------------------------------------------------------------------
-- 1. phone_calls
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.phone_calls (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider            text NOT NULL,
  external_id         text NOT NULL,
  direction           text,
  status              text,
  missed_reason       text,
  started_at          timestamptz,
  answered_at         timestamptz,
  ended_at            timestamptz,
  -- Durée de conversation : de la décroche à la fin. La durée brute du
  -- fournisseur compte la sonnerie, elle n'est pas gardée.
  talk_seconds        integer NOT NULL DEFAULT 0,
  contact_number      text,
  contact_number_e164 text,
  contact_name        text,
  agent_external_id   text,
  agent_name          text,
  agent_email         text,
  recording_url       text,
  voicemail_url       text,
  tags                text[] NOT NULL DEFAULT '{}'::text[],
  notes               text,
  -- Horodatage du dernier événement appliqué (garde contre l'ordre inversé).
  last_event_at       timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phone_calls_provider_check CHECK (provider IN ('aircall')),
  CONSTRAINT phone_calls_direction_check CHECK (direction IS NULL OR direction IN ('inbound', 'outbound')),
  CONSTRAINT phone_calls_talk_check CHECK (talk_seconds >= 0),
  CONSTRAINT phone_calls_key UNIQUE (organization_id, provider, external_id)
);
CREATE INDEX IF NOT EXISTS idx_phone_calls_org_number
  ON public.phone_calls (organization_id, contact_number_e164) WHERE contact_number_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_phone_calls_org_started
  ON public.phone_calls (organization_id, started_at DESC);

ALTER TABLE public.phone_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS phone_calls_org_select ON public.phone_calls;
CREATE POLICY phone_calls_org_select ON public.phone_calls
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
-- Privilèges par défaut du schéma (20260421180000) : retirés ; lecture seule
-- pour authenticated, aucune écriture hors clé de service.
REVOKE ALL ON public.phone_calls FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.phone_calls TO authenticated;
GRANT ALL ON public.phone_calls TO service_role;

-- ---------------------------------------------------------------------
-- 2. telephony_connections
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telephony_connections (
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider            text NOT NULL,
  -- SHA-256 (hex) du jeton que le fournisseur joint à chaque événement.
  webhook_token_hash  text NOT NULL,
  external_webhook_id text,
  connected_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  connected_at        timestamptz NOT NULL DEFAULT now(),
  last_event_at       timestamptz,
  CONSTRAINT telephony_connections_pkey PRIMARY KEY (organization_id, provider),
  CONSTRAINT telephony_connections_provider_check CHECK (provider IN ('aircall')),
  CONSTRAINT telephony_connections_token_key UNIQUE (provider, webhook_token_hash)
);

ALTER TABLE public.telephony_connections ENABLE ROW LEVEL SECURITY;
-- Aucune policy : la table n'est lue ni écrite par un rôle client. L'état
-- passe par get_telephony_status, l'écriture par les fonctions serveur.
REVOKE ALL ON public.telephony_connections FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.telephony_connections TO service_role;

-- ---------------------------------------------------------------------
-- 3. record_phone_call : écriture d'un événement d'appel
--    Retourne 'inserted', 'updated' ou 'stale' (événement plus ancien que
--    le dernier appliqué : sans effet). SECURITY INVOKER : l'organisation
--    est donnée par l'appelant, qui est la fonction serveur après avoir
--    retrouvé l'organisation par le jeton. Les champs absents d'un
--    événement ne remplacent pas ceux déjà connus, sauf les étiquettes et
--    les notes, que chaque événement porte en entier.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_phone_call(
  p_organization_id uuid,
  p_provider        text,
  p_external_id     text,
  p_event_at        timestamptz,
  p_call            jsonb
) RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted boolean;
BEGIN
  IF p_organization_id IS NULL OR coalesce(p_external_id, '') = '' OR p_event_at IS NULL
     OR p_call IS NULL OR jsonb_typeof(p_call) <> 'object' THEN
    RAISE EXCEPTION 'Appel incomplet' USING ERRCODE = '22023', HINT = 'PHONE_CALL_INVALID';
  END IF;

  INSERT INTO public.phone_calls AS pc (
    organization_id, provider, external_id, direction, status, missed_reason,
    started_at, answered_at, ended_at, talk_seconds,
    contact_number, contact_number_e164, contact_name,
    agent_external_id, agent_name, agent_email,
    recording_url, voicemail_url, tags, notes, last_event_at
  ) VALUES (
    p_organization_id, p_provider, p_external_id,
    nullif(p_call->>'direction', ''), nullif(p_call->>'status', ''), nullif(p_call->>'missed_reason', ''),
    (nullif(p_call->>'started_at', ''))::timestamptz,
    (nullif(p_call->>'answered_at', ''))::timestamptz,
    (nullif(p_call->>'ended_at', ''))::timestamptz,
    greatest(coalesce((nullif(p_call->>'talk_seconds', ''))::integer, 0), 0),
    nullif(p_call->>'contact_number', ''), nullif(p_call->>'contact_number_e164', ''), nullif(p_call->>'contact_name', ''),
    nullif(p_call->>'agent_external_id', ''), nullif(p_call->>'agent_name', ''), nullif(p_call->>'agent_email', ''),
    nullif(p_call->>'recording_url', ''), nullif(p_call->>'voicemail_url', ''),
    coalesce(ARRAY(SELECT jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(p_call->'tags') = 'array' THEN p_call->'tags' ELSE '[]'::jsonb END)), '{}'::text[]),
    nullif(p_call->>'notes', ''),
    p_event_at
  )
  ON CONFLICT ON CONSTRAINT phone_calls_key DO UPDATE SET
    direction           = coalesce(EXCLUDED.direction, pc.direction),
    status              = coalesce(EXCLUDED.status, pc.status),
    missed_reason       = coalesce(EXCLUDED.missed_reason, pc.missed_reason),
    started_at          = coalesce(EXCLUDED.started_at, pc.started_at),
    answered_at         = coalesce(EXCLUDED.answered_at, pc.answered_at),
    ended_at            = coalesce(EXCLUDED.ended_at, pc.ended_at),
    talk_seconds        = greatest(EXCLUDED.talk_seconds, pc.talk_seconds),
    contact_number      = coalesce(EXCLUDED.contact_number, pc.contact_number),
    contact_number_e164 = coalesce(EXCLUDED.contact_number_e164, pc.contact_number_e164),
    contact_name        = coalesce(EXCLUDED.contact_name, pc.contact_name),
    agent_external_id   = coalesce(EXCLUDED.agent_external_id, pc.agent_external_id),
    agent_name          = coalesce(EXCLUDED.agent_name, pc.agent_name),
    agent_email         = coalesce(EXCLUDED.agent_email, pc.agent_email),
    recording_url       = coalesce(EXCLUDED.recording_url, pc.recording_url),
    voicemail_url       = coalesce(EXCLUDED.voicemail_url, pc.voicemail_url),
    tags                = EXCLUDED.tags,
    notes               = EXCLUDED.notes,
    last_event_at       = EXCLUDED.last_event_at,
    updated_at          = now()
  WHERE pc.last_event_at <= EXCLUDED.last_event_at
  RETURNING (xmax = 0) INTO v_inserted;

  IF NOT FOUND THEN
    RETURN 'stale';
  END IF;
  RETURN CASE WHEN v_inserted THEN 'inserted' ELSE 'updated' END;
END;
$$;
REVOKE ALL ON FUNCTION public.record_phone_call(uuid, text, text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_phone_call(uuid, text, text, timestamptz, jsonb) TO service_role;

-- ---------------------------------------------------------------------
-- 4. get_telephony_status : état de la connexion, pour les réglages
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_telephony_status(p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_connected    boolean;
  v_connected_at timestamptz;
  v_last_event   timestamptz;
  v_calls        bigint;
  v_last_call    timestamptz;
BEGIN
  IF auth.uid() IS NULL
     OR coalesce(public.get_org_role(auth.uid(), p_organization_id), '') NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Réservé aux propriétaires et administrateurs'
      USING ERRCODE = '42501', HINT = 'TELEPHONY_ADMIN_ONLY';
  END IF;

  SELECT true, c.connected_at, c.last_event_at
    INTO v_connected, v_connected_at, v_last_event
    FROM public.telephony_connections c
   WHERE c.organization_id = p_organization_id AND c.provider = 'aircall';

  SELECT count(*), max(pc.started_at)
    INTO v_calls, v_last_call
    FROM public.phone_calls pc
   WHERE pc.organization_id = p_organization_id AND pc.provider = 'aircall';

  RETURN jsonb_build_object(
    'provider', 'aircall',
    'connected', coalesce(v_connected, false),
    'connected_at', v_connected_at,
    'last_event_at', v_last_event,
    'calls_count', coalesce(v_calls, 0),
    'last_call_at', v_last_call
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_telephony_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_telephony_status(uuid) TO authenticated, service_role;
