// Place du plafond LinkedIn rendue quand une action ne part pas.
//
// Le gate quota (enforceLinkedInAction) journalise l'action dès qu'il l'autorise,
// avant l'envoi. Si l'envoi est ensuite refusé sans rien envoyer et que l'élément
// repart plus tard, la ligne du journal doit disparaître, sinon chaque nouvel
// essai remplit les plafonds du compte avec des actions qui n'ont pas eu lieu.
//
// La ligne retirée est la plus récente du compte pour ce type et cette source
// depuis `since` (avant le gate, avec une marge d'horloge entre la fonction et la
// base). Non bloquant : en cas d'échec, la place reste prise.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/sequence-ledger-slot.test.ts

export interface LedgerSlotRef {
  accountId: string;
  actionType: string;
  /** Source journalisée par le gate : 'sequence' (moteur) ou 'inmail_queue' (file). */
  source: string;
  /** Borne basse (ISO) : instant du gate moins la marge d'horloge. */
  since: string;
}

/** Marge d'horloge entre la fonction et la base, retranchée à l'instant du gate. */
export const LEDGER_SLOT_CLOCK_MARGIN_MS = 60_000;

/** Borne `since` d'une place réservée à l'instant `nowMs`. */
export function ledgerSlotSince(nowMs: number): string {
  return new Date(nowMs - LEDGER_SLOT_CLOCK_MARGIN_MS).toISOString();
}

// deno-lint-ignore no-explicit-any
export async function releaseLedgerSlotRow(supabase: any, slot: LedgerSlotRef): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('linkedin_action_log').select('id')
      .eq('account_id', slot.accountId).eq('action_type', slot.actionType).eq('source', slot.source)
      .gte('created_at', slot.since).order('created_at', { ascending: false }).limit(1);
    if (error) {
      console.warn(`[ledger-slot] Place du plafond non rendue (${slot.accountId}, ${slot.actionType}) : journal illisible`, error);
      return false;
    }
    const rowId = (data?.[0]?.id ?? null) as string | null;
    if (!rowId) return false;
    const { error: deleteErr } = await supabase.from('linkedin_action_log').delete().eq('id', rowId);
    if (deleteErr) {
      console.warn(`[ledger-slot] Place du plafond non rendue (${slot.accountId}, ${slot.actionType}):`, deleteErr);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[ledger-slot] Place du plafond non rendue (${slot.accountId}, ${slot.actionType}):`, e);
    return false;
  }
}
