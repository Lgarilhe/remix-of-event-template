-- Run on the local test database after migrations. Synthetic data is rolled back.
BEGIN;
DO $$
DECLARE
  own_user uuid := '89111111-1111-4111-8111-111111111111';
  peer_user uuid := '89222222-2222-4222-8222-222222222222';
  foreign_user uuid := '89333333-3333-4333-8333-333333333333';
  org_a uuid := '89aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  org_b uuid := '89bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  count_rows integer;
  refused boolean;
BEGIN
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (own_user, 'wa-own@fixture.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
         (peer_user, 'wa-peer@fixture.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'),
         (foreign_user, 'wa-foreign@fixture.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}');
  INSERT INTO public.organizations (id, name, slug, created_by, org_type)
  VALUES (org_a, 'WhatsApp fixture A', 'whatsapp-fixture-a', own_user, 'agency'),
         (org_b, 'WhatsApp fixture B', 'whatsapp-fixture-b', foreign_user, 'agency');
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (org_a, peer_user, 'admin'), (org_b, own_user, 'member');
  UPDATE public.profiles SET active_organization_id = org_a WHERE user_id IN (own_user, peer_user);
  UPDATE public.profiles SET active_organization_id = org_b WHERE user_id = foreign_user;
  INSERT INTO public.member_whatsapp_accounts (organization_id, user_id, whatsapp_account_id, account_status)
  VALUES (org_a, own_user, 'fixture-wa-own', 'OK'),
         (org_a, peer_user, 'fixture-wa-peer', 'OK'),
         (org_b, foreign_user, 'fixture-wa-foreign', 'OK'),
         (org_b, own_user, 'fixture-wa-own-other-org', 'OK');
  INSERT INTO public.candidate_action_messages
    (organization_id, candidate_id, owner_user_id, account_id, channel, service, audience, direction,
     provider_message_id, counterpart, sender, recipient, content, occurred_at)
  VALUES
    (org_a, 'wa-candidate', own_user, 'fixture-wa-own', 'whatsapp', 'whatsapp', 'candidate', 'inbound',
     'fixture-wa-inbound', '33611111111', '33611111111', '33612345678', 'Candidate reply', now()),
    (org_a, 'wa-candidate', peer_user, 'fixture-wa-peer', 'whatsapp', 'whatsapp', 'candidate', 'inbound',
     'fixture-wa-peer-inbound', '33611111111', '33611111111', '33612345678', 'Peer private reply', now());

  PERFORM set_config('request.jwt.claims', json_build_object('sub', own_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', own_user::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO count_rows FROM public.member_whatsapp_accounts;
  IF count_rows <> 1 THEN RAISE EXCEPTION 'Own WhatsApp read leaked peer or inactive organization: %', count_rows; END IF;
  SELECT count(*) INTO count_rows FROM public.candidate_action_messages WHERE provider_message_id IN ('fixture-wa-inbound', 'fixture-wa-peer-inbound');
  IF count_rows <> 1 THEN RAISE EXCEPTION 'Own incoming reply is hidden, or colleague private reply leaked: %', count_rows; END IF;
  refused := false;
  BEGIN
    INSERT INTO public.member_whatsapp_accounts (organization_id, user_id, whatsapp_account_id)
    VALUES (org_a, own_user, 'fixture-wa-claim');
  EXCEPTION WHEN insufficient_privilege THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'Browser could claim a provider account ID'; END IF;
  refused := false;
  BEGIN UPDATE public.member_whatsapp_accounts SET account_status = 'OK';
  EXCEPTION WHEN insufficient_privilege THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'Browser could change a connection status'; END IF;
  refused := false;
  BEGIN DELETE FROM public.member_whatsapp_accounts;
  EXCEPTION WHEN insufficient_privilege THEN refused := true; END;
  IF NOT refused THEN RAISE EXCEPTION 'Browser could remove an ownership mapping'; END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', peer_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', peer_user::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO count_rows FROM public.member_whatsapp_accounts WHERE user_id = own_user;
  IF count_rows <> 0 THEN RAISE EXCEPTION 'Organization admin can see a colleague personal WhatsApp mapping'; END IF;

  RESET ROLE;
  SET LOCAL ROLE service_role;
  UPDATE public.member_whatsapp_accounts SET account_status = 'CREDENTIALS' WHERE whatsapp_account_id = 'fixture-wa-own';
  GET DIAGNOSTICS count_rows = ROW_COUNT;
  IF count_rows <> 1 THEN RAISE EXCEPTION 'Server cannot update verified account status'; END IF;
  RESET ROLE;
END $$;
ROLLBACK;
