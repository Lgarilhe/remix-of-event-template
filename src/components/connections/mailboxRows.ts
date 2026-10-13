/**
 * Lignes de la carte « Mon compte e-mail » : une par boîte reliée à la personne, avec son
 * état et ses gestes, sans React.
 *
 * Une personne peut relier plusieurs boîtes (Gmail, Outlook, une boîte à mot de passe) : la
 * table member_email_accounts n'est unique que par (organisation, compte), jamais par
 * personne. Chaque liaison donne une ligne ; celle qui demande un geste passe devant.
 *
 * - boîte lue dans la liste du serveur : son état, avec la phrase de sa cause ;
 * - liste non reçue : « État à vérifier » et « Réessayer », jamais un état deviné ;
 * - liste reçue sans cette boîte : compte retiré, à reconnecter par une nouvelle connexion.
 *
 * Testé par tests/ux/connexion-etats-comptes.test.mjs.
 */

import { classifyConnectionHealth } from '@/lib/linkedinStatus';
import { readableConnectionName } from '@/lib/connectionCopy';
import {
  attentionRank,
  emailProviderOf,
  viewOfAccount,
  withoutSupersededRemoved,
  type ConnectionView,
} from './connectionView';

/** Liaison d'une boîte à la personne (member_email_accounts). */
export interface MailboxMapping {
  id: string;
  email_account_id: string;
  email_address: string | null;
  provider: string | null;
}

/** Boîte telle que la liste du serveur (list_email) la décrit. */
export interface ListedMailbox {
  id: string;
  name?: string;
  identifier?: string;
  status?: string;
  type?: string;
}

export interface MailboxRow {
  key: string;
  mapping: MailboxMapping;
  /** Adresse à afficher, jamais vide. */
  address: string;
  provider: 'google' | 'outlook' | 'imap' | null;
  view: ConnectionView;
  /** Statut de la liste, pour retirer une liaison retirée que la nouvelle connexion remplace. */
  status: string | null;
  /**
   * Adresse que lit `withoutSupersededRemoved` pour savoir si une boîte en remplace une autre : la vraie adresse
   * e-mail, sinon vide. Un nom de repli (« Messagerie Outlook ») est le même pour deux boîtes qu'on ne sait pas
   * nommer : il ne prouve jamais qu'elles se remplacent.
   */
  identifier: string;
}

/** Vraie adresse e-mail lisible, pas le nom de repli ni un nom d'ancienne connexion. */
function provableAddress(raw: unknown, readable: string): string {
  return typeof raw === 'string' && raw.includes('@') && raw.trim() === readable ? readable : '';
}

export function buildMailboxRows(
  mappings: readonly MailboxMapping[],
  accounts: readonly ListedMailbox[],
  listFailed: boolean,
): MailboxRow[] {
  const rows = mappings.map((mapping): MailboxRow => {
    const account = accounts.find((a) => a.id === mapping.email_account_id) ?? null;
    const provider = emailProviderOf(mapping.provider) ?? emailProviderOf(account?.type);
    // Absente d'une liste reçue : le compte n'existe plus. Liste non reçue : on ne sait pas.
    const status = account ? account.status ?? null : listFailed ? null : 'DELETED';
    const view = viewOfAccount(
      {
        health: account ? classifyConnectionHealth({ status: account.status }) : 'needs_reconnect',
        status,
        accountId: mapping.email_account_id,
        unverified: !account && listFailed,
      },
      provider ?? 'imap',
    );
    const rawAddress = mapping.email_address || account?.identifier || account?.name;
    const address = readableConnectionName(rawAddress, provider ?? 'imap');
    return { key: mapping.id, mapping, address, provider, view, status, identifier: provableAddress(rawAddress, address) };
  });
  return withoutSupersededRemoved(rows, 'email')
    .map((row, index) => ({ row, index }))
    .sort((a, b) => attentionRank(a.row.view) - attentionRank(b.row.view) || a.index - b.index)
    .map(({ row }) => row);
}
