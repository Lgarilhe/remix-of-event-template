/**
 * Recherche LinkedIn, profils et messagerie : point d'entrée de l'edge function.
 *
 * Les appels au prestataire passent tous par le client partagé
 * (`_shared/unipile/index.ts`), sur l'API v2 seule : une clé globale, le compte
 * dans le chemin. La clé est commune à toutes les organisations, donc la seule
 * frontière entre elles est le rattachement du compte à l'organisation de
 * l'appelant, contrôlé ici avant tout appel (`assertAccountOwnedByOrg`).
 *
 * Actions : search, get_parameters, search_from_url, list_recruiter_projects, get_profile, get_chats,
 * get_messages, sync_chat_history, send_message, mark_as_read, get_user_posts, endorse_skill,
 * list_sent_invitations, withdraw_invitation.
 * Les gestionnaires vivent dans search.ts, search-url.ts, recruiter-projects.ts, profile.ts, chats.ts,
 * send.ts et invitations.ts.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';
import { enforceLinkedInAction, type LinkedInActionType } from '../_shared/linkedin-quotas.ts';
import { assertContinuousOperationContext } from '../_shared/continuous-sourcing.ts';
import {
  AccountNotOwnedError,
  assertAccountOwnedByOrg,
  assertV2AccountId,
  isUnipileConfigured,
  isUnipileError,
  OutdatedAccountIdError,
  userSafeMessage,
  type AccountOwnership,
} from '../_shared/unipile/index.ts';
import { collaboratorOwnAccountRefusal, ownerOnlyRefusal } from './account-rules.ts';
import { handleGetChats, handleGetMessages, handleMarkAsRead, handleSyncChatHistory } from './chats.ts';
import { handleListSentInvitations, handleWithdrawInvitation } from './invitations.ts';
import { handleEndorseSkill, handleGetProfile, handleGetUserPosts } from './profile.ts';
import { handleListRecruiterProjects } from './recruiter-projects.ts';
import { corsHeaders, failureResponse, INTERNAL_ERROR_MESSAGE, json, UnipileInputError } from './responses.ts';
import { handleSearchFromUrl } from './search-url.ts';
import { handleGetParameters, prepareSearch, runSearch, type PreparedSearch, type SearchFailureRow } from './search.ts';
import { handleSendMessage, planSend, type SendContext, type SendPlan } from './send.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth: JWT + org membership, OR internal service-role (Mode B) ---
    // Mode B = appel interne edge→edge avec la clé service-role (ex. l'outil
    // copilot get_candidate_outreach qui lit le fil LinkedIn verbatim côté
    // serveur). Cloisonnement org assuré par organization_id requis + le
    // rattachement du compte à cette organisation (plus bas) ; l'appelant a déjà
    // vérifié l'accès au candidat (rôle/org). Même pattern éprouvé que
    // retrieve-context / ingest-context / auto-ingest-context.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401);
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const _bearer = authHeader.replace('Bearer ', '').trim();
    const _serviceKey = Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const isInternal = !!_serviceKey && _bearer === _serviceKey;

    let userId = '';
    if (!isInternal) {
      const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
      if (authError || !user) {
        return json({ error: 'Unauthorized' }, 401);
      }
      userId = user.id;
    }

    const { action, account_id, organization_id, ...params } = await req.json();

    // organization_id OBLIGATOIRE pour tous les modes, ET membership vérifié pour tout appel user.
    if (!organization_id) {
      return json({ error: 'organization_id required' }, 400);
    }
    const admin = createClient(supabaseUrl, _serviceKey!);
    // Rôle de l'appelant dans l'organisation, lu avec l'appartenance : il règle l'usage des comptes de l'équipe.
    let callerRole: string | null = null;
    if (!isInternal) {
      const { data: membership } = await admin.from('organization_members').select('id, role').eq('user_id', userId).eq('organization_id', organization_id).maybeSingle();
      if (!membership) {
        return json({ error: 'Forbidden' }, 403);
      }
      callerRole = typeof membership.role === 'string' ? membership.role : null;
    }

    // --- Rate limiting: 60 req/min per user (skipped for internal service-role) ---
    if (!isInternal) {
      const { data: allowed } = await admin.rpc('check_rate_limit', {
        p_user_id: userId,
        p_action: 'unipile_search',
        p_max_requests: 60,
        p_window_seconds: 60,
      });
      if (allowed === false) {
        return json({
          success: false,
          error: 'Trop de demandes. Patientez quelques secondes.',
          errorType: 'RATE_LIMIT',
          retryAfter: 60,
        }, 429);
      }
    }

    // Clé de l'application absente : panne de configuration, dite sans nommer le prestataire.
    if (!isUnipileConfigured()) {
      console.error('[unipile-search] clé du prestataire absente (UNIPILE_V2_API_KEY)');
      return json({ success: false, error: userSafeMessage('config'), errorType: 'NOT_CONFIGURED' }, 500);
    }

    if (!account_id) {
      return json({ success: false, error: 'Account ID requis' }, 400);
    }

    // Un identifiant qui n'est pas du format v2 est un ancien identifiant : le compte est à reconnecter.
    const accountIdRaw = String(account_id).trim();
    try {
      assertV2AccountId(accountIdRaw);
    } catch (e) {
      if (!(e instanceof OutdatedAccountIdError)) throw e;
      return json({ success: false, errorType: 'ACCOUNT_OUTDATED', error: userSafeMessage('account_disconnected') }, 403);
    }

    // ─── Rattachement du compte LinkedIn à l'organisation (SEC-006) ────────
    // La clé du prestataire est partagée entre toutes les organisations : sans ce
    // contrôle, un account_id d'une autre org donnait accès à sa boîte, à ses
    // recherches et à ses envois. Vaut aussi pour les appels internes
    // (organization_id est requis dans tous les modes).
    let ownership: AccountOwnership;
    try {
      ownership = await assertAccountOwnedByOrg(admin, String(organization_id), accountIdRaw, { kinds: ['linkedin'] });
    } catch (e) {
      if (!(e instanceof AccountNotOwnedError)) throw e;
      return json({
        success: false,
        errorType: 'ACCOUNT_NOT_LINKED',
        error: "Ce compte LinkedIn n'est pas rattaché à votre organisation. Associez-le depuis Paramètres > Connecteurs.",
      }, 403);
    }
    // Règles de sécurité (SEC-006) et non conséquences de l'API v2 : un membre n'envoie et ne retire une invitation
    // que depuis le compte qu'il a relié, et un collaborateur ne se sert, pour AUCUNE action, du compte d'un
    // collègue (voir account-rules.ts : la règle ne liste pas d'actions, une action ajoutée plus tard est couverte).
    const refusal = ownerOnlyRefusal(action, { isInternal, userId, accountOwnerId: ownership.userId })
      ?? collaboratorOwnAccountRefusal({ isInternal, userId, accountOwnerId: ownership.userId, role: callerRole });
    if (refusal) return json(refusal.body, refusal.status);

    // The cron worker has already reserved the automatic quota. Fence again
    // immediately before the actual provider call.
    let continuousGuard: (() => Promise<void>) | undefined;
    if (isInternal && params.continuous_agent_run === true) {
      if (!['search', 'get_profile'].includes(action)) {
        throw new UnipileInputError('Cette action n’est pas disponible pour l’agent de sourcing.', 403);
      }
      const agentClient = createClient(supabaseUrl, _serviceKey!);
      continuousGuard = async () => {
        const { data, error } = await agentClient.rpc('sourcing_agent_assert_lease', {
          p_agent_id: params.continuous_agent_id, p_lease_token: params.continuous_lease_token,
        });
        const agent = Array.isArray(data) ? data[0] : data;
        if (error || !agent || !params.continuous_context_key
          || agent.organization_id !== organization_id || agent.created_by !== params.user_id
          || agent.account_id !== accountIdRaw || agent.api !== params.api
          || agent.context_snapshot?.context_key !== params.continuous_context_key) {
          throw new UnipileInputError('L’agent a été interrompu. Aucune nouvelle consultation LinkedIn n’a été lancée.', 409, 'AGENT_LEASE_CHANGED');
        }
        try { await assertContinuousOperationContext(agentClient, agent); }
        catch { throw new UnipileInputError('Les critères de la mission ont changé. Revoyez-les avant de reprendre.', 409, 'CONTEXT_CHANGED'); }
        // Context reads may outlive a confirmed pause. Fence once more after them.
        const latest = await agentClient.rpc('sourcing_agent_assert_lease', {
          p_agent_id: params.continuous_agent_id, p_lease_token: params.continuous_lease_token,
        });
        const currentAgent = Array.isArray(latest.data) ? latest.data[0] : latest.data;
        if (latest.error || !currentAgent || currentAgent.context_snapshot?.context_key !== params.continuous_context_key) {
          throw new UnipileInputError('L’agent a été interrompu. Aucune nouvelle consultation LinkedIn n’a été lancée.', 409, 'AGENT_LEASE_CHANGED');
        }
      };
    }

    // ─── Contrôles sans effet, AVANT le plafond ───────────────────────────
    // Une recherche ou un envoi refusé (licence absente, page périmée, mots-clés trop longs, objet ou signature
    // d'InMail manquant, conversation mal formée) ne consomme pas d'unité du plafond LinkedIn : le gate journalise
    // l'usage dès qu'il laisse passer, et la nouvelle tentative de l'utilisateur coûterait une seconde unité.
    const searchDeps = {
      beforeProvider: continuousGuard,
      recordFailure: async (row: SearchFailureRow) => { await admin.from('search_failure_log').insert(row); },
    };
    let preparedSearch: PreparedSearch | undefined;
    let sendPlan: SendPlan | undefined;
    const sendContext: SendContext = {
      organizationId: String(organization_id),
      userId,
      isInternal,
      accountOwnerId: ownership.userId,
      admin: () => admin,
    };
    if (action === 'search') {
      const step = await prepareSearch(accountIdRaw, params, searchDeps);
      if ('response' in step) return step.response;
      preparedSearch = step.prepared;
    } else if (action === 'send_message') {
      const checked = await planSend(accountIdRaw, params, sendContext);
      if (!checked.ok) return checked.response;
      sendPlan = checked.plan;
    }

    // ─── Gate quota LinkedIn (actions manuelles user) ─────────────────────
    // Conformité #260513-007211 : les vues de profil / recherches / envois
    // déclenchés depuis l'app comptent désormais dans le MÊME plafond que
    // l'automatique (avant : seulement 60 req/min génériques, aucun cap
    // LinkedIn). Mode MANUAL = buffer 5 % (blocage uniquement near-limit) pour
    // ne pas couper l'utilisateur en pleine session. Les appels internes
    // (service-role, edge→edge) ne sont pas plafonnés (lecture serveur).
    if (!isInternal) {
      const gatedType: LinkedInActionType | undefined =
        action === 'search' ? 'search'
        : action === 'get_profile' ? 'profile_view'
        : action === 'send_message' ? (params?.is_inmail ? 'inmail' : 'message')
        : action === 'endorse_skill' ? 'endorse'
        : undefined;
      if (gatedType) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cross-version supabase-js client type mismatch (different import specifier than linkedin-quotas.ts)
        const gate = await enforceLinkedInAction(admin as any, {
          accountId: accountIdRaw,
          actionType: gatedType,
          userId: userId || null,
          organizationId: organization_id || null,
          source: action === 'send_message' ? 'manual_inbox' : 'manual_search',
          mode: 'manual',
        });
        if (!gate.allowed) {
          return json({
            success: false,
            error: gate.reason || 'Limite LinkedIn quotidienne atteinte. Réessayez demain.',
            errorType: 'QUOTA',
            scope: gate.scope,
          }, 429);
        }
      }
    }

    switch (action) {
      case 'search':
        return await runSearch(accountIdRaw, preparedSearch as PreparedSearch, searchDeps);

      case 'get_parameters':
        return await handleGetParameters(accountIdRaw, params);

      case 'search_from_url':
        return await handleSearchFromUrl(accountIdRaw, params);

      case 'list_recruiter_projects':
        return await handleListRecruiterProjects(accountIdRaw, params);

      case 'list_sent_invitations':
        return await handleListSentInvitations(accountIdRaw, params);

      case 'withdraw_invitation':
        return await handleWithdrawInvitation(accountIdRaw, params, { organizationId: String(organization_id), userId, admin: () => admin });

      case 'get_profile':
        return await handleGetProfile(accountIdRaw, params, continuousGuard);

      case 'get_chats':
        return await handleGetChats(accountIdRaw, params);

      case 'get_messages':
        return await handleGetMessages(accountIdRaw, params);

      case 'sync_chat_history':
        return await handleSyncChatHistory(accountIdRaw, params);

      case 'send_message':
        return await handleSendMessage(accountIdRaw, params, sendContext, sendPlan);

      case 'mark_as_read':
        return await handleMarkAsRead(accountIdRaw, params);

      case 'get_user_posts':
        return await handleGetUserPosts(accountIdRaw, params);

      case 'endorse_skill':
        return await handleEndorseSkill(accountIdRaw, params);

      default:
        return json({ success: false, error: 'Action non reconnue' }, 400);
    }
  } catch (error) {
    if (error instanceof UnipileInputError) {
      return json({ success: false, error: error.message, ...(error.code ? { error_code: error.code } : {}) }, error.status);
    }
    if (isUnipileError(error)) return failureResponse(error, 'request');
    // Le texte d'une exception inattendue ne va jamais à l'utilisateur : il reste dans les journaux.
    console.error('Error:', error);
    return json({ success: false, error: INTERNAL_ERROR_MESSAGE, errorType: 'INTERNAL' }, 500);
  }
});
