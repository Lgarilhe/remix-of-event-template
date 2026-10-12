import { stopLinkedInAccountSending, type LinkedInSendingStopResult } from "../_shared/linkedin-sending-stop.ts";
import { projectWhatsAppAccount } from "../_shared/whatsapp-account.ts";
import {
  acceptRelationRequest,
  assertV2AccountId,
  cancelRelationRequest,
  chatPath,
  chatRef,
  deleteAccount,
  describeForLog,
  getAccount,
  getChat,
  getInmailCredits,
  getProfile,
  isUnipileConfigured,
  isUnipileError,
  isV2AccountId,
  listAllAccounts,
  listContracts,
  listRelationRequests,
  mapAccountStatus,
  normalizeEmail,
  selectContract,
  toKonektAccount,
  unipileJson,
  unipileVoid,
  updateAccount,
  userSafeMessage,
  type Contract,
  type V2Account,
} from "../_shared/unipile/index.ts";
import { readableAccountName } from "../_shared/connection-claim.ts";
import {
  assertAccountInOrg,
  assertCanManageAccount,
  assertCanReadAccount,
  assertOwnLinkedInAccount,
  getCallerOrgRole,
  HttpError,
  lookupAccountOwnership,
} from "./ownership.ts";
import {
  cancelConnection,
  checkpointConnection,
  ConnectionFailure,
  connectionCapabilities,
  connectionStatus,
  connectWithCookie,
  rateLimit,
  resendConnection,
  startConnection,
  type ConnectionContext,
} from "./connection.ts";
import { displayAccountName, httpStatusForKind } from "./connection-steps.ts";
import {
  hasCustomProxy,
  isValidProxyHost,
  mapWithLimit,
  outdatedLinkEntry,
  projectLinkedInEntry,
  TtlCache,
  unverifiedLinkEntry,
  type LinkedInListEntry,
} from "./account-list.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

/**
 * Échec du prestataire sur une action qui répond toujours 200 (le client Supabase
 * lirait sinon l'erreur comme une panne de la fonction). Texte neutre en français,
 * jamais celui du prestataire ; `status` reste un nombre, que l'écran du proxy lit.
 */
function providerFailure(error: unknown, where: string): Response {
  if (!isUnipileError(error)) throw error;
  console.error(`[unipile-accounts] ${where}:`, describeForLog(error));
  return json({ success: false, error: error.message, error_code: error.kind, status: error.status ?? httpStatusForKind(error.kind) });
}

// Valeurs lues chez le prestataire par compte, gardées quelques minutes : la liste est
// rechargée toutes les 5 minutes par onglet ouvert et toutes les 5 secondes pendant une connexion.
const pictureCache = new TtlCache<string | null>(15 * 60 * 1000);
const contractsCache = new TtlCache<Contract[] | null>(5 * 60 * 1000);
const CONTRACTS_FAILURE_TTL_MS = 20 * 1000;
const FOREIGN_IDS_PAGE = 1000;
// 1,5 s entre deux appels : 30 invitations tiennent dans les 60 s d'une fonction.
const BULK_INVITATIONS_MAX = 30;

/** Administrateurs de la plateforme (secret KONEKT_PLATFORM_ADMIN_USER_IDS) ; sans secret, personne. */
function isPlatformAdmin(userId: string): boolean {
  const raw = Deno.env.get('KONEKT_PLATFORM_ADMIN_USER_IDS') ?? '';
  return raw.split(',').map((id) => id.trim()).filter(Boolean).includes(userId);
}

async function readPictureUrl(accountId: string): Promise<string | null> {
  const cached = pictureCache.get(accountId);
  if (cached !== undefined) return cached;
  let url: string | null = null;
  try {
    const profile = await getProfile(accountId, 'me');
    url = typeof profile.public_picture_url === 'string' && profile.public_picture_url ? profile.public_picture_url : null;
  } catch (e) {
    console.warn('[unipile-accounts] profile picture unavailable:', isUnipileError(e) ? e.kind : 'error');
  }
  pictureCache.set(accountId, url);
  return url;
}

async function readContracts(accountId: string): Promise<Contract[] | null> {
  const cached = contractsCache.get(accountId);
  if (cached !== undefined) return cached;
  let contracts: Contract[] | null = null;
  try {
    contracts = await listContracts(accountId);
  } catch (e) {
    console.warn('[unipile-accounts] contracts unavailable:', isUnipileError(e) ? e.kind : 'error');
  }
  // Une lecture en échec n'est gardée que quelques secondes : elle ne doit pas faire passer
  // pendant 5 minutes un compte Recruiter pour un compte classique.
  contractsCache.set(accountId, contracts, contracts === null ? CONTRACTS_FAILURE_TTL_MS : undefined);
  return contracts;
}

type WhatsAppMappingRow = { id: string; whatsapp_account_id: string; name: string | null; phone_number: string | null; account_status: string | null };

type LinkedInLinkRow = {
  id: string;
  user_id: string;
  linkedin_account_id: string;
  linkedin_account_name: string | null;
  account_status?: string | null;
};

type LinkedInRead =
  | { row: LinkedInLinkRow; state: 'outdated' }
  | { row: LinkedInLinkRow; state: 'dead' }
  | { row: LinkedInLinkRow; state: 'unverified' }
  | { row: LinkedInLinkRow; state: 'live'; account: V2Account; contracts: Contract[] | null; picture: string | null };

/** Lit chez le prestataire le compte relié par une ligne (un appel par compte, jamais une liste partielle). */
async function readLinkedInLink(row: LinkedInLinkRow): Promise<LinkedInRead> {
  // Identifiant d'une génération précédente du service : aucun appel, compte à reconnecter.
  if (!isV2AccountId(row.linkedin_account_id)) return { row, state: 'outdated' };
  let account: V2Account;
  try {
    account = await getAccount(row.linkedin_account_id);
  } catch (e) {
    if (isUnipileError(e) && e.kind === 'not_found') return { row, state: 'dead' };
    if (!isUnipileError(e)) throw e;
    // 429, 5xx ou délai sur CE compte : les autres restent lisibles.
    console.error('[unipile-accounts] list: provider read failed for one account:', describeForLog(e));
    return { row, state: 'unverified' };
  }
  if (account.provider !== 'linkedin') return { row, state: 'dead' };
  const status = mapAccountStatus(account.status, account.is_locked === true);
  // Un compte à reconnecter ne peut ni lister ses contrats ni lire son profil.
  const readable = status === 'OK' || status === 'DEGRADED' || status === 'PARTIAL';
  const [contracts, picture] = readable
    ? await Promise.all([readContracts(account.id), readPictureUrl(account.id)])
    : [null, null];
  return { row, state: 'live', account, contracts, picture };
}

/** What the handler needs from its environment (the entry point wires the real ones; tests pass fakes). */
export interface HandlerDeps {
  authenticate(req: Request, cors: Record<string, string>): Promise<{ userId: string | null; method: string }>;
  // deno-lint-ignore no-explicit-any
  createAdmin(): any;
}

export async function handleRequest(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ===== AUTH CHECK =====
    let auth;
    try {
      auth = await deps.authenticate(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }
    if (!auth.userId) throw new HttpError(401, 'User authentication required');

    let body;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'Requête invalide');
    }
    const { action, organization_id: requestedOrgId, ...params } = body ?? {};

    if (typeof action !== 'string' || !action.trim()) {
      throw new HttpError(400, 'Action requise');
    }

    const adminClient = deps.createAdmin();

    const user = { id: auth.userId as string };

    let organizationId = typeof requestedOrgId === 'string' ? requestedOrgId : null;

    if (!organizationId) {
      const { data: profile, error: profileError } = await adminClient
        .from('profiles')
        .select('active_organization_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profileError) {
        throw new HttpError(400, 'Impossible de déterminer l’organisation active');
      }

      organizationId = profile?.active_organization_id ?? null;
    }

    if (!organizationId) {
      throw new HttpError(400, 'Aucune organisation active');
    }

    const { data: membership, error: membershipError } = await adminClient
      .from('organization_members')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership) {
      // Diagnostic RLS côté serveur UNIQUEMENT — ne jamais exposer d'info
      // sensible (préfixe de clé service-role) au client dans la réponse.
      console.error('[unipile-accounts] Membership check failed', {
        requestedOrgId: organizationId,
        userId: user.id,
        authMethod: auth.method,
        errorMsg: membershipError?.message,
        errorCode: membershipError?.code,
      });
      throw new HttpError(403, 'Accès non autorisé à cette organisation');
    }

    const connection: ConnectionContext = { admin: adminClient, organizationId, userId: user.id };

    // Actions qui n'écrivent qu'en base (arrêt des envois, liaison retirée) :
    // jamais bloquées par l'absence de configuration du prestataire, sinon
    // « Dissocier » et le retrait d'un membre deviennent impossibles sur un
    // environnement sans intégration LinkedIn.
    const DATABASE_ONLY_ACTIONS = new Set(['unlink_linkedin_account', 'stop_member_linkedin', 'unlink_email_account']);
    // Connexion : lire les capacités et annuler une tentative n'appellent pas le prestataire.
    const LOCAL_CONNECTION_ACTIONS = new Set(['connection_capabilities', 'connection_cancel']);
    const providerConfigured = isUnipileConfigured();
    if (!providerConfigured && !DATABASE_ONLY_ACTIONS.has(action) && !LOCAL_CONNECTION_ACTIONS.has(action)) {
      const whatsapp = action.includes('whatsapp') || params?.provider === 'whatsapp' ||
        (Array.isArray(params?.providers) && params.providers.some((p: unknown) => String(p).toUpperCase() === 'WHATSAPP'));
      return json({
        success: false,
        error: whatsapp ? 'La connexion WhatsApp est momentanément indisponible' : userSafeMessage('config'),
        error_code: 'config',
      });
    }

    switch (action) {
      case 'connection_capabilities': {
        return json(connectionCapabilities());
      }

      case 'connection_start': {
        const started = await startConnection(connection, params);
        return json({ success: true, attempt_id: started.attempt.id, mode: started.attempt.mode, next: started.next });
      }

      case 'connection_checkpoint': {
        const next = await checkpointConnection(connection, params);
        return json({ success: true, next });
      }

      case 'connection_resend': {
        const resent = await resendConnection(connection, params);
        return json({ success: true, ...(resent.next ? { next: resent.next } : {}) });
      }

      case 'connection_status': {
        return json(await connectionStatus(connection, params));
      }

      case 'connection_cancel': {
        await cancelConnection(connection, params);
        return json({ success: true });
      }

      case 'list': {
        // include_org_accounts : réservé aux administrateurs de la plateforme (secret
        // KONEKT_PLATFORM_ADMIN_USER_IDS). Il ajoute les comptes LinkedIn que la clé du
        // prestataire connaît et qu'aucune organisation n'a reliés (dépannage).
        //
        // 🔒 SÉCURITÉ MULTI-TENANT : la clé du prestataire est globale. Un orphelin peut être
        // la connexion en cours d'une autre organisation, ou le compte d'un ancien membre :
        // jamais montré à un membre ou à un administrateur d'organisation, qui relient leur
        // compte par une tentative de connexion (connection_start). Même pour la plateforme,
        // les comptes déjà mappés à une AUTRE org sont exclus.
        await rateLimit(connection, 'unipile_accounts_list', 60, { failClosed: false });
        const includeOrgAccounts = params?.include_org_accounts === true && isPlatformAdmin(user.id);

        // 1. account_ids mappés à l'ORG COURANTE (légitimes à voir)
        const { data: memberAccounts, error: memberAccountsError } = await adminClient
          .from('member_linkedin_accounts')
          .select('id, user_id, linkedin_account_id, linkedin_account_name, account_status')
          .eq('organization_id', organizationId);

        if (memberAccountsError) {
          console.error('[unipile-accounts] Failed to load org account IDs:', memberAccountsError);
        }

        const orgRows = ((memberAccounts ?? []) as LinkedInLinkRow[]).filter((r) => typeof r?.linkedin_account_id === 'string' && r.linkedin_account_id.length > 0);
        const allowedAccountIds = new Set(orgRows.map((r) => r.linkedin_account_id));

        // 2. account_ids mappés à des AUTRES orgs (interdits à voir/claim), par pages : une
        //    lecture plafonnée ferait passer un compte étranger pour un orphelin. Illisible =
        //    refus, jamais un ensemble vide.
        const loadForeignIds = async (): Promise<Set<string>> => {
          const ids = new Set<string>();
          for (let offset = 0; ; offset += FOREIGN_IDS_PAGE) {
            const { data: foreignRows, error: foreignError } = await adminClient
              .from('member_linkedin_accounts')
              .select('linkedin_account_id')
              .neq('organization_id', organizationId)
              .order('id', { ascending: true })
              .range(offset, offset + FOREIGN_IDS_PAGE - 1);
            if (foreignError) {
              console.error('[unipile-accounts] Failed to load foreign account IDs:', foreignError.code);
              throw new HttpError(500, 'Impossible de vérifier les comptes pour le moment');
            }
            const page = (foreignRows ?? []) as Array<{ linkedin_account_id: string | null }>;
            for (const r of page) if (r?.linkedin_account_id) ids.add(r.linkedin_account_id);
            if (page.length < FOREIGN_IDS_PAGE) break;
          }
          return ids;
        };
        let foreignAccountIds = new Set<string>();
        if (includeOrgAccounts) {
          foreignAccountIds = await loadForeignIds();
          console.log(`[unipile-accounts] include_org_accounts=true | own=${allowedAccountIds.size} | foreign blocked=${foreignAccountIds.size}`);
        }

        // 3. Un appel par compte relié, jamais une page de la liste globale : une page
        //    partielle ferait passer pour mort un compte vivant. Un compte que le prestataire
        //    ne répond pas pour l'instant (429, 5xx, délai) est rendu « non vérifié » avec son
        //    dernier état connu ; si AUCUN compte n'a pu être lu, c'est une erreur explicite,
        //    pas une liste vide (le contexte garde la liste précédente, LinkedInAccountsContext).
        const reads = await mapWithLimit(orgRows, 4, readLinkedInLink);
        if (reads.length > 0 && reads.every((r) => r.state === 'unverified')) {
          throw new HttpError(502, 'La liste des comptes LinkedIn est momentanément indisponible');
        }

        // Liste complète des comptes LinkedIn, lue seulement en mode dépannage.
        let listing: { items: V2Account[]; truncated: boolean } | null = null;
        if (includeOrgAccounts) {
          try {
            listing = await listAllAccounts({ provider: 'linkedin', limit: 100, maxPages: 10 });
          } catch (e) {
            if (!isUnipileError(e)) throw e;
            console.error('[unipile-accounts] list: full listing failed:', describeForLog(e));
            throw new HttpError(502, 'La liste des comptes LinkedIn est momentanément indisponible');
          }
        }

        // Un lien dont le compte n'existe plus chez le prestataire (404) n'est PAS repointé sur
        // un compte de même nom : un homonyme d'une autre organisation, ou une connexion en
        // cours, serait relié à tort. Il n'est pas listé ; la personne se reconnecte et la
        // nouvelle connexion remplace le lien.
        const linkedinAccounts: LinkedInListEntry[] = [];
        for (const read of reads) {
          if (read.state === 'outdated') {
            linkedinAccounts.push(outdatedLinkEntry(read.row));
          } else if (read.state === 'unverified') {
            linkedinAccounts.push(unverifiedLinkEntry(read.row));
          } else if (read.state === 'live') {
            linkedinAccounts.push(projectLinkedInEntry(read.account, {
              mapped: true,
              pictureUrl: read.picture,
              contracts: read.contracts,
              storedName: read.row.linkedin_account_name,
            }));
          }
        }
        if (includeOrgAccounts && listing) {
          for (const acc of listing.items) {
            if (acc?.provider !== 'linkedin' || !acc.id) continue;
            if (allowedAccountIds.has(acc.id) || foreignAccountIds.has(acc.id)) continue; // 🔒 sécu cross-tenant
            // Orphelin visible en mode dépannage : ni photo ni contrats, on ne lit rien de la
            // session d'un compte qui n'est pas encore le sien.
            linkedinAccounts.push(projectLinkedInEntry(acc, { mapped: false, pictureUrl: null, contracts: null }));
          }
        }

        return json({ success: true, accounts: linkedinAccounts });
      }

      case 'unlink_email_account': {
        const mappingId = typeof params.mapping_id === 'string' ? params.mapping_id.trim() : '';
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mappingId)) {
          throw new HttpError(400, 'Liaison e-mail invalide');
        }
        const expectedAccountId = typeof params.expected_account_id === 'string' ? params.expected_account_id.trim() : '';
        if (!expectedAccountId) throw new HttpError(400, 'Compte e-mail attendu manquant');
        // The current user can remove only their attested binding. No arbitrary
        // account claim, administrator reassignment or client-supplied status.
        const { data: mapping, error: mappingError } = await adminClient.from('member_email_accounts')
          .select('id,email_account_id').eq('id', mappingId)
          .eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle();
        if (mappingError) throw new HttpError(500, 'Impossible de vérifier votre compte e-mail');
        if (!mapping) throw new HttpError(403, 'Cette liaison e-mail ne vous appartient pas');
        if (mapping.email_account_id !== expectedAccountId) {
          throw new HttpError(409, 'Cette liaison a changé. Actualisez avant de réessayer.');
        }
        // Dissociation preserves the existing UX: the remote mailbox and its
        // messages remain intact. Linking requires a new connection attempt.
        const { data: removed, error: removeError } = await adminClient.from('member_email_accounts')
          .delete().eq('id', mapping.id).eq('organization_id', organizationId)
          .eq('user_id', user.id).eq('email_account_id', expectedAccountId).select('id');
        if (removeError) throw new HttpError(500, 'La dissociation n’a pas été enregistrée');
        if (removed?.length !== 1) throw new HttpError(409, 'Cette liaison a changé. Actualisez avant de réessayer.');
        return json({ success: true });
      }

      case 'list_email': {
        // Seulement les boîtes de l'utilisateur appelant dans l'org courante
        // (même logique multi-tenant que pour 'list' ci-dessus).
        const { data: memberEmailAccounts, error: memberEmailAccountsError } = await adminClient
          .from('member_email_accounts')
          .select('email_account_id, email_address, provider')
          .eq('organization_id', organizationId)
          .eq('user_id', user.id);

        if (memberEmailAccountsError) {
          console.error('[unipile-accounts] Failed to load org email account IDs:', memberEmailAccountsError);
          throw new HttpError(500, 'Impossible de lire vos comptes e-mail');
        }

        const emailRows = ((memberEmailAccounts ?? []) as Array<{ email_account_id: string; email_address: string | null; provider: string | null }>)
          .filter((r) => typeof r?.email_account_id === 'string' && r.email_account_id.length > 0);

        // Un appel par boîte reliée (Gmail, Outlook, IMAP). Un refus du prestataire est une
        // erreur explicite, pas une liste vide.
        let emailAccounts;
        try {
          emailAccounts = await mapWithLimit(emailRows, 4, async (row) => {
            const stored = row.email_address || displayAccountName(null, 'imap');
            // Identifiant d'une génération précédente du service : boîte à reconnecter, aucun appel.
            if (!isV2AccountId(row.email_account_id)) {
              return { id: row.email_account_id, name: stored, identifier: stored, type: row.provider, status: 'CREDENTIALS' };
            }
            let account: V2Account;
            try {
              account = await getAccount(row.email_account_id);
            } catch (e) {
              if (isUnipileError(e) && e.kind === 'not_found') {
                return { id: row.email_account_id, name: stored, identifier: stored, type: row.provider, status: 'DELETED' };
              }
              throw e;
            }
            if (!['google', 'outlook', 'imap'].includes(account.provider)) return null;
            const view = toKonektAccount(account);
            const name = displayAccountName(account.name, account.provider);
            return {
              id: account.id,
              name,
              // L'adresse : le nom du compte quand c'en est une, sinon celle enregistrée à la liaison.
              identifier: normalizeEmail(account.name) ?? row.email_address ?? name,
              type: view.type,
              status: view.status,
            };
          });
        } catch (e) {
          if (!isUnipileError(e)) throw e;
          console.error('[unipile-accounts] list_email: provider read failed:', describeForLog(e));
          throw new HttpError(502, 'La liste de vos comptes e-mail est momentanément indisponible');
        }

        return json({ success: true, accounts: emailAccounts.filter(Boolean) });
      }

      case 'list_whatsapp': {
        const { data: mappings, error } = await adminClient
          .from('member_whatsapp_accounts')
          .select('id, whatsapp_account_id, name, phone_number, account_status')
          .eq('organization_id', organizationId)
          .eq('user_id', user.id)
          .order('linked_at', { ascending: false });
        if (error) throw new HttpError(500, 'Impossible de lire vos comptes WhatsApp');
        // Exact owned IDs only: never list other members' or orphan accounts.
        const accounts = await Promise.all(((mappings ?? []) as WhatsAppMappingRow[]).map(async (mapping) => {
          let account;
          if (mapping.account_status === 'DELETED' || !isV2AccountId(mapping.whatsapp_account_id)) {
            // Retiré, ou identifiant d'une génération précédente : rien à lire chez le prestataire.
            account = {
              id: mapping.whatsapp_account_id, name: mapping.name, identifier: mapping.phone_number,
              type: 'WHATSAPP' as const, status: mapping.account_status === 'DELETED' ? 'DELETED' : 'CREDENTIALS',
            };
          } else {
            try {
              account = projectWhatsAppAccount(await getAccount(mapping.whatsapp_account_id));
            } catch (e) {
              if (isUnipileError(e) && e.kind === 'not_found') {
                account = { id: mapping.whatsapp_account_id, name: mapping.name, identifier: mapping.phone_number, type: 'WHATSAPP' as const, status: 'DELETED' };
              } else {
                if (isUnipileError(e)) console.error('[unipile-accounts] list_whatsapp: provider read failed:', describeForLog(e));
                throw new HttpError(502, 'Impossible de vérifier votre compte WhatsApp');
              }
            }
            if (!account || account.id !== mapping.whatsapp_account_id) throw new HttpError(502, 'Compte WhatsApp non reconnu');
          }
          const { error: updateError } = await adminClient.from('member_whatsapp_accounts')
            // Le nom et le numéro ne sont réécrits que s'ils sont lisibles : un nom de compte qui n'est
            // pas un numéro ne doit pas effacer celui déjà enregistré (l'envoi WhatsApp le réclame).
            .update({
              account_status: account.status,
              ...(account.name ? { name: account.name } : {}),
              ...(account.identifier ? { phone_number: account.identifier } : {}),
              updated_at: new Date().toISOString(),
            })
            .eq('id', mapping.id).eq('organization_id', organizationId).eq('user_id', user.id);
          if (updateError) throw new HttpError(500, 'Impossible de mettre à jour votre compte WhatsApp');
          return account;
        }));
        return json({ success: true, accounts });
      }

      case 'disconnect_whatsapp': {
        const whatsappAccountId = typeof params.account_id === 'string' ? params.account_id.trim() : '';
        if (!whatsappAccountId || whatsappAccountId.length > 512 || /[/\\?#]|\.\./.test(whatsappAccountId)) {
          throw new HttpError(400, 'Compte WhatsApp invalide');
        }
        const { data: mapping, error } = await adminClient.from('member_whatsapp_accounts')
          .select('id').eq('whatsapp_account_id', whatsappAccountId)
          .eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle();
        if (error) throw new HttpError(500, 'Impossible de vérifier votre compte WhatsApp');
        if (!mapping) throw new HttpError(403, 'Ce compte WhatsApp ne vous appartient pas');
        // Un identifiant d'une génération précédente n'existe plus chez le prestataire : seule
        // la liaison reste à marquer retirée.
        if (isV2AccountId(whatsappAccountId)) {
          let deleted = false;
          try {
            deleted = await deleteAccount(whatsappAccountId);
          } catch (e) {
            // Déjà supprimé chez le prestataire : la liaison est quand même retirée.
            if (isUnipileError(e) && e.kind === 'not_found') {
              deleted = true;
            } else {
              if (isUnipileError(e)) console.error('[unipile-accounts] disconnect_whatsapp:', describeForLog(e));
              throw new HttpError(502, 'Impossible de déconnecter votre compte WhatsApp');
            }
          }
          // Une réponse 200 `{ success: false }` n'est pas une suppression : sans cette garde la
          // pierre tombale DELETED serait posée sur un compte encore vivant, qu'on ne pourrait
          // plus jamais rattacher.
          if (!deleted) {
            console.error('[unipile-accounts] disconnect_whatsapp: the provider did not delete the account');
            throw new HttpError(502, 'Impossible de déconnecter votre compte WhatsApp');
          }
        }
        // Preserve ownership after revocation; an old ID cannot be claimed by a
        // different organization. DELETED requires a fresh create, not reconnect.
        const { error: updateError } = await adminClient.from('member_whatsapp_accounts')
          .update({ account_status: 'DELETED', updated_at: new Date().toISOString() })
          .eq('id', mapping.id).eq('organization_id', organizationId).eq('user_id', user.id);
        if (updateError) throw new HttpError(500, 'La connexion a été retirée mais son état reste à actualiser');
        return json({ success: true });
      }

      case 'connect_cookie': {
        // Connexion LinkedIn par cookie (extension Chrome seulement). Enveloppe de
        // connection_start en mode direct ; sans le mode direct, message neutre vers la
        // connexion standard. Contrat de l'extension : { success, account_id, ... }.
        try {
          return json(await connectWithCookie(connection, params));
        } catch (e) {
          if (e instanceof ConnectionFailure) {
            return json({ success: false, error: e.message, error_code: e.errorCode }, e.errorCode === 'validation' ? 400 : 200);
          }
          throw e;
        }
      }

      case 'disconnect': {
        // Disconnect an account
        const { account_id } = params;

        if (!account_id) {
          return json({ success: false, error: 'Account ID requis' }, 400);
        }

        {
          const ownership = await assertAccountInOrg(adminClient, organizationId, user.id, account_id);
          await assertCanManageAccount(adminClient, organizationId, user.id, ownership);
        }

        let disconnected: boolean;
        try {
          disconnected = await deleteAccount(assertV2AccountId(account_id));
        } catch (e) {
          // Always return 200 to avoid Supabase client interpreting upstream errors as function errors
          return providerFailure(e, 'disconnect');
        }
        if (!disconnected) {
          // Le prestataire a répondu 200 `{ success: false }` : le compte existe toujours.
          console.error('[unipile-accounts] disconnect: the provider did not delete the account');
          return json({ success: false, error: 'Impossible de déconnecter ce compte. Réessayez dans un instant.', error_code: 'server', status: 502 });
        }

        return json({ success: true });
      }

      case 'claim_linkedin_account': {
        // « C'est mon compte » (MyLinkedInAccount) et « Lier » (TeamManagement).
        // Remplace l'upsert du navigateur, refusé par la RLS à un membre
        // (admins_manage). Le titulaire se relie lui-même ; owner/admin relient un
        // membre de l'organisation.
        const accountId = assertV2AccountId(typeof params.account_id === 'string' ? params.account_id.trim() : params.account_id);
        const targetUserId = typeof params.user_id === 'string' && params.user_id.trim()
          ? params.user_id.trim()
          : user.id;

        if (targetUserId !== user.id) {
          await assertCanManageAccount(adminClient, organizationId, user.id, { mapped: 'org', userId: targetUserId, kind: 'linkedin' });
          if (!(await getCallerOrgRole(adminClient, organizationId, targetUserId))) {
            throw new HttpError(404, "Ce membre ne fait pas partie de l'organisation");
          }
        }

        const ownership = await lookupAccountOwnership(adminClient, organizationId, accountId);
        if (ownership.mapped === 'foreign') {
          throw new HttpError(403, 'Ce compte LinkedIn est déjà rattaché à un autre espace de travail');
        }
        if (ownership.mapped === 'org' && ownership.userId !== targetUserId) {
          throw new HttpError(409, 'Ce compte LinkedIn est déjà rattaché à un autre membre de votre organisation');
        }

        // Un compte relié nulle part (« orphelin ») peut être la connexion en cours d'une autre
        // organisation ou le compte d'un ancien membre : la clé du prestataire est globale. Il
        // ne se revendique donc pas (et n'est pas même lu chez le prestataire) par un membre ni par un administrateur d'organisation (la
        // connexion passe par connection_start), seulement par la plateforme, en dépannage.
        if (ownership.mapped === 'none' && !isPlatformAdmin(user.id)) {
          throw new HttpError(403, "Ce compte LinkedIn n'est pas rattaché à votre organisation. Connectez-le depuis Paramètres > Mon compte.");
        }

        // Le compte doit exister et être un compte LinkedIn ; son nom vient du
        // prestataire, jamais du navigateur.
        let acc: V2Account;
        try {
          acc = await getAccount(accountId);
        } catch (e) {
          if (isUnipileError(e) && e.kind === 'not_found') throw new HttpError(404, 'Compte LinkedIn introuvable');
          console.error('[claim_linkedin_account] provider read failed:', isUnipileError(e) ? describeForLog(e) : e);
          throw new HttpError(502, 'Vérification du compte LinkedIn momentanément impossible. Réessayez.');
        }
        if (acc?.provider !== 'linkedin') throw new HttpError(400, "Ce compte n'est pas un compte LinkedIn");

        // Vocabulaire Konekt (OK, CREDENTIALS, ERROR, DEGRADED, PARTIAL, LOCKED) : jamais le mot brut du prestataire.
        const accountStatus = mapAccountStatus(acc.status, acc.is_locked === true);

        const { data: current, error: currentError } = await adminClient
          .from('member_linkedin_accounts')
          .select('linkedin_account_id')
          .eq('organization_id', organizationId)
          .eq('user_id', targetUserId)
          .maybeSingle();
        if (currentError) throw new HttpError(500, 'Lecture de la liaison actuelle impossible. Réessayez.');

        // Changement de compte (SEQ-041) : l'ancien compte ne doit plus rien
        // envoyer une fois la liaison repointée. Ses inscriptions passent en
        // pause manuelle (reprise après avoir relié le compte, ou nouvelle
        // inscription depuis le nouveau compte), ses InMails programmés sont
        // annulés. Échec = changement refusé, comme la dissociation.
        const previousAccountId = typeof current?.linkedin_account_id === 'string' ? current.linkedin_account_id : '';
        if (previousAccountId && previousAccountId !== accountId) {
          try {
            await stopLinkedInAccountSending(adminClient, { organizationId, accountId: previousAccountId });
          } catch (stopError) {
            console.error('[claim_linkedin_account] previous account sending stop failed:', stopError);
            throw new HttpError(500, "Les envois de l'ancien compte LinkedIn n'ont pas pu être arrêtés : le changement de compte est annulé. Réessayez.");
          }
        }
        const nowIso = new Date().toISOString();

        const { data: linked, error: linkError } = await adminClient
          .from('member_linkedin_accounts')
          .upsert({
            organization_id: organizationId,
            user_id: targetUserId,
            linkedin_account_id: accountId,
            linkedin_account_name: readableAccountName(acc?.name) ?? 'Compte LinkedIn',
            linked_by: user.id,
            account_status: accountStatus,
            last_checked_at: nowIso,
            failure_reason: null,
            // Nouveau compte sur la liaison : la montée en charge repart de zéro
            // (getAccountRampFactor lit linked_at, _shared/linkedin-quotas.ts).
            ...(current?.linkedin_account_id === accountId ? {} : { linked_at: nowIso }),
          }, { onConflict: 'organization_id,user_id' })
          .select('id, user_id, linkedin_account_id');

        if (linkError) {
          console.error('[claim_linkedin_account] upsert failed:', linkError);
          if (linkError.code === '42501') throw new HttpError(403, 'Ce compte LinkedIn est déjà rattaché à un autre espace de travail');
          if (linkError.code === '23505') throw new HttpError(409, 'Ce compte LinkedIn est déjà rattaché à un autre membre de votre organisation');
          throw new HttpError(500, 'Le rattachement du compte LinkedIn a échoué');
        }
        if (!linked || linked.length !== 1) {
          throw new HttpError(500, "Le rattachement du compte LinkedIn n'a pas été enregistré");
        }
        return json({ success: true, mapping: linked[0] });
      }

      case 'unlink_linkedin_account': {
        // « Dissocier » (MyLinkedInAccount, TeamManagement). Remplace le DELETE du
        // navigateur : refusé par la RLS à un membre sans erreur (0 ligne, faux
        // succès), envois qui continuaient de partir du compte (process-sequences
        // et process-inmail-queue ne contrôlent que les comptes reliés).
        // Décision lot 1 : la session chez le prestataire n'est JAMAIS fermée ici
        // (aucune suppression de compte) ; on retire la liaison et on arrête les envois.
        const mappingId = typeof params.mapping_id === 'string' ? params.mapping_id.trim() : '';
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mappingId)) {
          throw new HttpError(400, 'Liaison invalide');
        }
        // Le compte que l'écran affichait : une ligne repointée entre-temps
        // (réconciliation de « list ») n'est jamais dissociée à l'aveugle.
        const expectedAccountId = typeof params.expected_account_id === 'string' ? params.expected_account_id.trim() : '';
        if (!expectedAccountId) throw new HttpError(400, 'Compte LinkedIn attendu manquant');

        const { data: row, error: rowError } = await adminClient
          .from('member_linkedin_accounts')
          .select('id, user_id, linkedin_account_id')
          .eq('id', mappingId)
          .eq('organization_id', organizationId)
          .maybeSingle();
        if (rowError) throw new HttpError(500, 'Lecture de la liaison impossible');
        if (!row) throw new HttpError(404, "Cette liaison LinkedIn n'existe plus");
        if (row.linkedin_account_id !== expectedAccountId) {
          throw new HttpError(409, 'Cette liaison a changé entre-temps. Rechargez la page puis réessayez.');
        }

        // Le titulaire sur sa ligne, owner/admin sur toutes celles de l'org.
        await assertCanManageAccount(adminClient, organizationId, user.id, { mapped: 'org', userId: row.user_id, kind: 'linkedin' });

        // 1. Envois qui partent de ce compte (pause, InMails, rotation) :
        //    helper partagé, idempotent. La liaison n'est jamais supprimée tant
        //    que l'arrêt n'a pas réussi.
        const keptLinked = "Les envois de ce compte n'ont pas pu être arrêtés : le compte reste relié";
        let stopped: LinkedInSendingStopResult;
        try {
          stopped = await stopLinkedInAccountSending(adminClient, {
            organizationId,
            accountId: row.linkedin_account_id,
          });
        } catch (stopError) {
          console.error('[unlink_linkedin_account] sending stop failed:', stopError);
          throw new HttpError(500, keptLinked);
        }

        // 2. La liaison, résultat vérifié.
        const { data: removed, error: removeError } = await adminClient
          .from('member_linkedin_accounts')
          .delete()
          .eq('id', row.id)
          .eq('organization_id', organizationId)
          .select('id');
        if (removeError) {
          console.error('[unlink_linkedin_account] delete failed:', removeError);
          throw new HttpError(500, "La dissociation n'a pas été enregistrée");
        }
        return json({
          success: true,
          removed: removed?.length ?? 0,
          paused_enrollments: stopped.pausedEnrollments,
          relabeled_enrollments: stopped.relabeledEnrollments,
          cancelled_inmails: stopped.cancelledInmails,
        });
      }

      case 'stop_member_linkedin': {
        // Retrait d'un membre de l'équipe (SEQ-042) : appelé par l'écran Équipe
        // AVANT la suppression du membre. Ses comptes LinkedIn reliés dans
        // l'organisation cessent d'envoyer (même arrêt que « Dissocier »), puis
        // la liaison est retirée. Échec = le membre n'est pas retiré.
        const memberUserId = typeof params.member_user_id === 'string' ? params.member_user_id.trim() : '';
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(memberUserId)) {
          throw new HttpError(400, 'Membre invalide');
        }

        const callerRole = await getCallerOrgRole(adminClient, organizationId, user.id);
        if (callerRole !== 'owner' && callerRole !== 'admin') {
          throw new HttpError(403, "Seul un propriétaire ou un administrateur de l'organisation peut retirer un membre");
        }
        const memberRole = await getCallerOrgRole(adminClient, organizationId, memberUserId);
        if (memberRole === 'owner' && callerRole !== 'owner') {
          throw new HttpError(403, 'Seul un propriétaire peut arrêter les envois d’un autre propriétaire');
        }

        const { data: memberLinks, error: memberLinksError } = await adminClient
          .from('member_linkedin_accounts')
          .select('id, linkedin_account_id')
          .eq('organization_id', organizationId)
          .eq('user_id', memberUserId);
        if (memberLinksError) throw new HttpError(500, 'Lecture des comptes LinkedIn du membre impossible. Réessayez.');
        const links = (memberLinks ?? []) as Array<{ id: string; linkedin_account_id: string | null }>;
        // Un membre déjà retiré dont la liaison est restée est accepté (nettoyage) ;
        // sinon l'utilisateur doit appartenir à l'organisation.
        if (!memberRole && links.length === 0) {
          throw new HttpError(404, "Ce membre ne fait pas partie de l'organisation");
        }

        const keptMember = "Les envois de ce membre n'ont pas pu être arrêtés : il n'a pas été retiré. Réessayez.";
        // Ses connexions en cours sont annulées : un compte qui se connecte après son départ ne
        // doit pas être rattaché à l'organisation qu'il quitte.
        const { error: attemptsError } = await adminClient.from('connection_attempts')
          .update({ status: 'cancelled', completed_at: new Date().toISOString(), intent_id: null })
          .eq('organization_id', organizationId).eq('user_id', memberUserId).eq('status', 'pending');
        if (attemptsError) {
          console.error('[stop_member_linkedin] pending connection attempts not cancelled:', attemptsError.code);
          throw new HttpError(500, keptMember);
        }
        let pausedTotal = 0;
        let relabeledTotal = 0;
        let cancelledInmailsTotal = 0;
        for (const link of links) {
          if (link.linkedin_account_id) {
            try {
              const stopped = await stopLinkedInAccountSending(adminClient, {
                organizationId,
                accountId: link.linkedin_account_id,
              });
              pausedTotal += stopped.pausedEnrollments;
              relabeledTotal += stopped.relabeledEnrollments;
              cancelledInmailsTotal += stopped.cancelledInmails;
            } catch (stopError) {
              console.error('[stop_member_linkedin] sending stop failed:', stopError);
              throw new HttpError(500, keptMember);
            }
          }
          const { error: removeError } = await adminClient
            .from('member_linkedin_accounts')
            .delete()
            .eq('id', link.id)
            .eq('organization_id', organizationId)
            .select('id');
          if (removeError) {
            console.error('[stop_member_linkedin] link delete failed:', removeError);
            throw new HttpError(500, keptMember);
          }
        }

        return json({
          success: true,
          paused_enrollments: pausedTotal,
          relabeled_enrollments: relabeledTotal,
          cancelled_inmails: cancelledInmailsTotal,
          removed_links: links.length,
        });
      }

      case 'inmail_balance': {
        // Solde d'InMails d'un compte : GET .../linkedin/inmail-credits (la clé `classic`
        // du prestataire est la clé `premium` du contrat Konekt).
        const { account_id } = params;

        if (!account_id) {
          return json({ success: false, error: 'Account ID requis' }, 400);
        }

        const readOwnership = await assertAccountInOrg(adminClient, organizationId, user.id, account_id);
        await assertCanReadAccount(adminClient, organizationId, user.id, readOwnership);

        let credits;
        try {
          credits = await getInmailCredits(assertV2AccountId(account_id));
        } catch (e) {
          return providerFailure(e, 'inmail_balance');
        }

        // Une licence que le compte n'a pas reste null (jamais 0).
        return json({
          success: true,
          balance: {
            premium: credits.classic,
            recruiter: credits.recruiter,
            sales_navigator: credits.sales_navigator,
          },
        });
      }

      case 'list_recruiter_contracts':
      case 'list_contracts': {
        // Contrats Recruiter et Sales Navigator du compte (un seul sélectionné à la fois).
        const { account_id } = params;

        if (!account_id) {
          return json({ success: false, error: 'Account ID requis' }, 400);
        }

        const readOwnership = await assertAccountInOrg(adminClient, organizationId, user.id, account_id);
        await assertCanReadAccount(adminClient, organizationId, user.id, readOwnership);

        let contracts: Contract[];
        try {
          contracts = await listContracts(assertV2AccountId(account_id));
        } catch (e) {
          return providerFailure(e, 'list_contracts');
        }

        return json({
          success: true,
          recruiter_info: {
            has_recruiter: contracts.some((c) => c.product === 'recruiter'),
            has_sales_navigator: contracts.some((c) => c.product === 'sales_navigator'),
          },
          contracts: contracts.map((c) => ({
            id: c.id,
            name: displayAccountName(c.name, 'linkedin'),
            product: c.product,
            selected: c.selected === true,
            ...(c.description ? { description: c.description } : {}),
          })),
        });
      }

      case 'select_contract': {
        // Choix du contrat utilisé pour la recherche (propriétaire du compte ou owner/admin).
        const { account_id, contract_id } = params;
        if (!account_id || typeof contract_id !== 'string' || !contract_id.trim()) {
          return json({ success: false, error: 'Account ID et contrat requis' }, 400);
        }
        const ownership = await assertAccountInOrg(adminClient, organizationId, user.id, account_id);
        await assertCanManageAccount(adminClient, organizationId, user.id, ownership);
        try {
          const selected = await selectContract(assertV2AccountId(account_id), contract_id.trim());
          contractsCache.delete(String(account_id)); // les licences lues avant le choix ne valent plus
          return json({ success: true, contract: { id: selected.id, product: selected.product, selected: true } });
        } catch (e) {
          return providerFailure(e, 'select_contract');
        }
      }

      case 'update_proxy': {
        // Update proxy configuration for an account via PATCH /accounts/{id}
        // Supports 2 modes: country, custom (le mode « ip » n'existe plus chez le prestataire)
        const {
          account_id,
          proxy_mode = 'country',
          proxy_country,
          proxy_ip: _proxyIpIgnored,
          proxy_protocol,
          proxy_host,
          proxy_port,
          proxy_username,
          proxy_password,
        } = params;

        if (!account_id) {
          throw new HttpError(400, 'Account ID requis');
        }

        // Build the PATCH input according to the provider spec
        let patchInput: Parameters<typeof updateAccount>[1] = {};
        let dbUpdates: Record<string, unknown> = {
          proxy_updated_at: new Date().toISOString(),
        };

        switch (proxy_mode) {
          case 'country': {
            if (!proxy_country || typeof proxy_country !== 'string' || proxy_country.length !== 2) {
              throw new HttpError(400, 'Le code pays doit être au format ISO 3166-1 alpha-2 (ex: FR, US, DE)');
            }
            const country = proxy_country.toUpperCase();
            // Le pays ne remplace pas un proxy personnalisé chez le prestataire : seul `proxy: null`
            // le retire (voir plus bas, où il est lu avant d'être effacé).
            patchInput = { autoProxyCountry: country };
            dbUpdates = {
              ...dbUpdates,
              proxy_mode: 'country',
              proxy_country: country,
              proxy_host: null,
              proxy_port: null,
              proxy_protocol: null,
            };
            break;
          }
          case 'ip': {
            throw new HttpError(400, "Le choix d'une adresse IP n'est plus disponible. Choisissez un pays ou un proxy personnalisé.");
          }
          case 'custom': {
            if (!proxy_host || !proxy_port || !proxy_protocol) {
              throw new HttpError(400, 'Host, port et protocole requis pour le mode custom');
            }
            if (!isValidProxyHost(proxy_host)) throw new HttpError(400, "L'adresse du proxy est invalide");
            for (const secret of [proxy_username, proxy_password]) {
              if (secret !== undefined && secret !== null && (typeof secret !== 'string' || secret.length > 256)) {
                throw new HttpError(400, 'Identifiants du proxy invalides');
              }
            }
            if (!['https', 'http', 'socks5', 'socks4'].includes(String(proxy_protocol))) {
              throw new HttpError(400, 'Protocole proxy invalide. Valeurs acceptées : https, http, socks5');
            }
            const port = Number(proxy_port);
            if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HttpError(400, 'Port proxy invalide');
            const proxyHost = (proxy_host as string).trim();
            patchInput = {
              proxy: {
                protocol: proxy_protocol as 'https' | 'http' | 'socks5' | 'socks4',
                host: proxyHost,
                port,
                ...(proxy_username ? { username: String(proxy_username) } : {}),
                ...(proxy_password ? { password: String(proxy_password) } : {}),
              },
            };
            dbUpdates = {
              ...dbUpdates,
              proxy_mode: 'custom',
              proxy_country: null,
              proxy_host: proxyHost,
              proxy_port: port,
              proxy_protocol: proxy_protocol,
            };
            break;
          }
          default:
            throw new HttpError(400, 'Mode proxy invalide. Valeurs acceptées : country, custom');
        }

        {
          const ownership = await assertAccountInOrg(adminClient, organizationId, user.id, account_id);
          await assertCanManageAccount(adminClient, organizationId, user.id, ownership);
        }

        console.log(`[update_proxy] Patching an account (mode: ${proxy_mode})`);

        let patched: V2Account;
        try {
          const proxyAccountId = assertV2AccountId(account_id);
          if (proxy_mode === 'country') {
            // Un pays ne retire pas un proxy personnalisé : on le lit, puis on l'efface dans un
            // appel à part (le prestataire ne dit pas si `proxy: null` et un pays passent ensemble).
            if (hasCustomProxy(await getAccount(proxyAccountId))) await updateAccount(proxyAccountId, { proxy: null });
          }
          patched = await updateAccount(proxyAccountId, patchInput);
        } catch (e) {
          if (!isUnipileError(e)) throw e;
          const failedStatus = e.status ?? httpStatusForKind(e.kind);
          // Track error in DB (texte neutre : jamais celui du prestataire)
          await adminClient
            .from('member_linkedin_accounts')
            .update({
              proxy_last_error: e.message,
              proxy_is_active: false,
              proxy_updated_at: new Date().toISOString(),
            })
            .eq('linkedin_account_id', account_id)
            .eq('organization_id', organizationId);
          console.error('[update_proxy] provider refused:', describeForLog(e));
          return json({ success: false, error: e.message, error_code: e.kind, status: failedStatus });
        }

        // Success: update DB with config + clear error.
        // 2026-05-13 (audit warning #260513-007211) : on ajoute select+count
        // pour détecter les 0-rows-updated qui passaient en silence avant
        // (Supabase JS ne lève pas d'erreur si l'UPDATE ne match aucune row).
        const { data: updateData, error: updateError } = await adminClient
          .from('member_linkedin_accounts')
          .update({
            ...dbUpdates,
            proxy_is_active: true,
            proxy_last_error: null,
          })
          .eq('linkedin_account_id', account_id)
          .eq('organization_id', organizationId)
          .select('id, linkedin_account_id, organization_id, proxy_mode, proxy_country');

        console.log(`[update_proxy] DB update rows=${updateData?.length ?? 0}`, updateError ? `error=${updateError.code}` : '');

        if (updateError) {
          console.error('[update_proxy] DB update failed:', updateError);
          return json({ success: false, error: "Le proxy a été mis à jour mais son état n'a pas pu être enregistré. Réessayez." });
        }

        if (!updateData || updateData.length === 0) {
          console.warn(`[update_proxy] No rows updated — organization_id=${organizationId}`);
          return json({
            success: false,
            error: "Aucune liaison trouvée pour ce compte dans votre organisation. Le proxy a bien été mis à jour côté LinkedIn, mais l'état n'a pas pu être enregistré dans Konekt.",
          });
        }

        return json({
          success: true,
          account_id: patched.id || account_id,
          proxy_mode,
          rows_updated: updateData.length,
        });
      }

      case 'add_reaction': {
        const { message_id, reaction, chat_id } = params;
        if (!message_id || !reaction || !chat_id) {
          throw new HttpError(400, 'chat_id, message_id et reaction requis');
        }
        // Le prestataire n'a plus de recherche globale d'un message : le compte et la
        // conversation voyagent ensemble. Sans compte dans la requête, celui de l'appelant.
        const reactionAccount = await resolveActionAccountId(adminClient, organizationId, user.id, params.account_id);
        await assertOwnLinkedInAccount(adminClient, organizationId, user.id, reactionAccount);
        try {
          const ref = chatRef(assertV2AccountId(reactionAccount), chat_id);
          await unipileJson({ method: 'POST', path: chatPath(ref, 'messages', String(message_id), 'reactions'), body: { reaction: String(reaction) }, idempotent: true });
        } catch (e) {
          return providerFailure(e, 'add_reaction');
        }
        return json({ success: true });
      }

      case 'delete_message': {
        const { message_id, chat_id } = params;
        if (!message_id || !chat_id) {
          throw new HttpError(400, 'chat_id et message_id requis');
        }
        const delMessageAccount = await resolveActionAccountId(adminClient, organizationId, user.id, params.account_id);
        await assertOwnLinkedInAccount(adminClient, organizationId, user.id, delMessageAccount);
        try {
          const ref = chatRef(assertV2AccountId(delMessageAccount), chat_id);
          await unipileVoid({ method: 'DELETE', path: chatPath(ref, 'messages', String(message_id)) });
        } catch (e) {
          return providerFailure(e, 'delete_message');
        }
        return json({ success: true });
      }

      case 'delete_chat': {
        const { chat_id } = params;
        if (!chat_id) {
          throw new HttpError(400, 'chat_id requis');
        }
        const delChatAccount = await resolveActionAccountId(adminClient, organizationId, user.id, params.account_id);
        await assertOwnLinkedInAccount(adminClient, organizationId, user.id, delChatAccount);
        try {
          const ref = chatRef(assertV2AccountId(delChatAccount), chat_id);
          await unipileVoid({ method: 'DELETE', path: chatPath(ref) });
        } catch (e) {
          return providerFailure(e, 'delete_chat');
        }
        return json({ success: true });
      }

      case 'list_invitations_received': {
        const { account_id, limit: invLimit, cursor: invCursor } = params;
        if (!account_id) {
          throw new HttpError(400, 'Account ID requis');
        }
        const readOwnership = await assertAccountInOrg(adminClient, organizationId, user.id, account_id);
        await assertCanReadAccount(adminClient, organizationId, user.id, readOwnership);

        let invPage;
        try {
          invPage = await listRelationRequests(assertV2AccountId(account_id), 'received', {
            limit: Math.min(Math.max(Number(invLimit) || 20, 1), 100),
            ...(invCursor ? { cursor: String(invCursor) } : {}),
          });
        } catch (e) {
          return providerFailure(e, 'list_invitations_received');
        }

        const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
        const mappedInvitations = invPage.items.map((item) => {
          const person = (item.user ?? {}) as Record<string, unknown>;
          const createdAt = text(item.created_at);
          return {
            id: item.id,
            inviter_name: text(person.display_name) || 'Inconnu',
            inviter_id: text(person.id) || '',
            inviter_public_identifier: text(person.public_identifier) || '',
            inviter_description: text(person.description) || text(person.headline),
            inviter_picture_url: text(person.public_picture_url),
            invitation_text: text(item.message),
            date: createdAt || '',
            parsed_datetime: createdAt,
            // Le prestataire n'a plus ni secret partagé ni fournisseur par invitation.
            shared_secret: '',
            provider: 'LINKEDIN',
          };
        });

        return json({ success: true, invitations: mappedInvitations, cursor: invPage.nextCursor });
      }

      case 'handle_invitation_received': {
        const { account_id, invitation_id, invitation_action: invAction, action: legacyAction } = params;
        const finalAction = invAction || legacyAction;
        if (!account_id || !invitation_id || !finalAction) {
          throw new HttpError(400, 'account_id, invitation_id et invitation_action requis');
        }
        if (finalAction !== 'accept' && finalAction !== 'decline') {
          throw new HttpError(400, 'invitation_action doit être "accept" ou "decline"');
        }

        await assertAccountInOrg(adminClient, organizationId, user.id, account_id);
        console.log(`[handle_invitation_received] ${finalAction} invitation`);
        try {
          const handledAccount = assertV2AccountId(account_id);
          if (finalAction === 'accept') await acceptRelationRequest(handledAccount, String(invitation_id));
          else await cancelRelationRequest(handledAccount, String(invitation_id));
        } catch (e) {
          return providerFailure(e, 'handle_invitation_received');
        }

        return json({ success: true, status: finalAction === 'accept' ? 'ACCEPTED' : 'DECLINED' });
      }

      case 'bulk_handle_invitations': {
        const { account_id, invitations: bulkInvitations } = params;
        if (!account_id || !Array.isArray(bulkInvitations) || bulkInvitations.length === 0) {
          throw new HttpError(400, 'account_id et invitations[] requis');
        }

        if (bulkInvitations.length > BULK_INVITATIONS_MAX) {
          throw new HttpError(400, `Trop d'invitations à traiter en une fois (${BULK_INVITATIONS_MAX} au plus)`);
        }
        await assertAccountInOrg(adminClient, organizationId, user.id, account_id);
        const bulkAccount = assertV2AccountId(account_id);
        console.log(`[bulk_handle_invitations] Processing ${bulkInvitations.length} invitations`);
        const results: Array<{ invitation_id: string; status: string; error?: string }> = [];

        for (const [position, inv] of bulkInvitations.entries()) {
          const { invitation_id, action: bulkAction } = (inv ?? {}) as { invitation_id: string; action: string };
          try {
            if (typeof invitation_id !== 'string' || !invitation_id || (bulkAction !== 'accept' && bulkAction !== 'decline')) {
              results.push({ invitation_id: String(invitation_id ?? ''), status: 'ERROR', error: 'Invitation invalide' });
            } else {
              if (bulkAction === 'accept') await acceptRelationRequest(bulkAccount, invitation_id);
              else await cancelRelationRequest(bulkAccount, invitation_id);
              console.log(`[bulk] ${bulkAction} ok`);
              results.push({ invitation_id, status: bulkAction === 'accept' ? 'ACCEPTED' : 'DECLINED' });
            }
          } catch (e) {
            if (isUnipileError(e) && (e.kind === 'rate_limited' || e.kind === 'provider_limit')) {
              results.push({ invitation_id: String(invitation_id), status: 'RATE_LIMITED', error: 'Rate limit atteint' });
              break; // Stop processing
            }
            if (isUnipileError(e)) console.error('[bulk_handle_invitations] item failed:', describeForLog(e));
            results.push({ invitation_id: String(invitation_id), status: 'ERROR', error: isUnipileError(e) ? e.message : 'Erreur' });
          }

          // Anti-detection delay: 1.5s between calls
          if (position < bulkInvitations.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        }

        return json({ success: true, results });
      }

      case 'get_account_details': {
        // Get full details for an account, including proxy info
        const { account_id } = params;

        if (!account_id) {
          throw new HttpError(400, 'Account ID requis');
        }

        const readOwnership = await assertAccountInOrg(adminClient, organizationId, user.id, account_id);
        await assertCanReadAccount(adminClient, organizationId, user.id, readOwnership);

        let detail: V2Account;
        let detailContracts: Contract[] | null = null;
        try {
          const detailAccountId = assertV2AccountId(account_id);
          detail = await getAccount(detailAccountId);
          if (detail.provider === 'linkedin') detailContracts = await readContracts(detailAccountId);
        } catch (e) {
          return providerFailure(e, 'get_account_details');
        }

        // Projection : jamais les identifiants proxy ni les paramètres bruts de la session
        // vers le navigateur.
        const proxyInfo = detail.proxy && typeof detail.proxy === 'object'
          ? { ...(detail.proxy as Record<string, unknown>) }
          : null;
        if (proxyInfo) {
          delete proxyInfo.username;
          delete proxyInfo.password;
        }
        const view = toKonektAccount(detail);

        return json({
          success: true,
          account: {
            id: detail.id,
            name: displayAccountName(detail.name, detail.provider),
            type: view.type,
            status: view.status,
            proxy: proxyInfo,
            premium_features: (detailContracts ?? []).map((c) => c.product),
          },
        });
      }

      case 'get_attendee_picture': {
        // Plus de « participant » chez le prestataire : la photo vient de la conversation
        // (chat_id) ou de la personne (user_id), sur le compte de l'appelant.
        const { chat_id, user_id } = params;
        if (!chat_id && !user_id) {
          return json({ success: false, error: 'Photo non disponible' });
        }
        const pictureAccount = await resolveActionAccountId(adminClient, organizationId, user.id, params.account_id);
        const readOwnership = await assertAccountInOrg(adminClient, organizationId, user.id, pictureAccount);
        await assertCanReadAccount(adminClient, organizationId, user.id, readOwnership);
        try {
          const pictureAccountId = assertV2AccountId(pictureAccount);
          let pictureUrl: string | null = null;
          if (chat_id) {
            const chat = await getChat(pictureAccountId, String(chat_id));
            pictureUrl = typeof chat.user?.public_picture_url === 'string' ? chat.user.public_picture_url : null;
          }
          if (!pictureUrl && user_id) {
            const profile = await getProfile(pictureAccountId, String(user_id));
            pictureUrl = typeof profile.public_picture_url === 'string' ? profile.public_picture_url : null;
          }
          if (pictureUrl) return json({ success: true, picture_url: pictureUrl });
        } catch (e) {
          console.warn('[get_attendee_picture] unavailable:', isUnipileError(e) ? e.kind : 'error');
        }
        return json({ success: false, error: 'Photo non disponible' });
      }

      default:
        return json({ success: false, error: 'Action non reconnue' }, 400);
    }
  } catch (error) {
    // Refus attendu d'une action de connexion : 200 et un code lisible par l'écran.
    if (error instanceof ConnectionFailure) {
      return json({ success: false, error: error.message, error_code: error.errorCode });
    }
    if (error instanceof HttpError) {
      return json({ success: false, error: error.message, ...(error.code ? { error_code: error.code } : {}) }, error.status);
    }
    // Échec du prestataire non traité par l'action : texte neutre, détail dans les journaux seulement.
    if (isUnipileError(error)) {
      console.error('Error:', describeForLog(error));
      return json({ success: false, error: error.message, error_code: error.kind }, httpStatusForKind(error.kind));
    }
    console.error('Error:', error);
    return json({ success: false, error: 'Erreur interne. Réessayez dans un instant.', error_code: 'server' }, 500);
  }
}

/**
 * Compte sur lequel agit une action de messagerie : celui de la requête, sinon le compte
 * LinkedIn de l'appelant dans l'organisation (le navigateur n'envoyait que la conversation).
 */
// deno-lint-ignore no-explicit-any
async function resolveActionAccountId(adminClient: any, organizationId: string, userId: string, accountId: unknown): Promise<string> {
  if (typeof accountId === 'string' && accountId.trim()) return accountId.trim();
  const { data } = await adminClient
    .from('member_linkedin_accounts')
    .select('linkedin_account_id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  const id = (data as { linkedin_account_id?: string } | null)?.linkedin_account_id;
  if (typeof id === 'string' && id) return id;
  throw new HttpError(400, 'Account ID requis');
}
