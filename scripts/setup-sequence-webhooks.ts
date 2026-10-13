/**
 * Script ponctuel : abonne le récepteur du suivi natif des e-mails de séquence
 * (supabase/functions/sequence-webhooks-handler) aux événements `tracking.open` et
 * `tracking.click` du service de connexion (API v2).
 *
 * Utilisation (Deno) :
 *   UNIPILE_V2_API_KEY=... UNIPILE_V2_WEBHOOK_TOKEN=... SUPABASE_URL=... \
 *     deno run --allow-net --allow-env scripts/setup-sequence-webhooks.ts
 *
 * Le point de terminaison v2 n'accepte aucun en-tête personnalisé : le récepteur
 * s'authentifie par le jeton `?v2_token=` de son URL (le même que celui de
 * unipile-webhook ; à défaut de UNIPILE_V2_WEBHOOK_TOKEN, dérivé de
 * UNIPILE_WEBHOOK_SECRET). Sans jeton, le script s'arrête avant tout appel.
 *
 * Idempotent : un point de terminaison déjà présent à cette adresse est mis à jour
 * sur place (événements, jeton, actif), les doublons sont supprimés, sinon il est
 * créé. Les événements `message.new`, `relation.new` et `email.new` sont traités par
 * unipile-webhook (abonné par unipile-manage-webhooks) : ils ne sont pas abonnés ici,
 * pour ne rien traiter deux fois.
 *
 * Le suivi natif n'émet rien tant que l'envoi d'e-mail ne le demande pas
 * (`tracking_options`) : le suivi par pixel de sequence-email-track reste la source
 * des ouvertures et des clics.
 */

import {
  createEndpoint,
  deleteEndpoint,
  describeForLog,
  listAllEndpoints,
  patchEndpoint,
  planEndpointSync,
  resolveWebhookToken,
  WEBHOOK_TOKEN_PARAM,
} from '../supabase/functions/_shared/unipile/index.ts';

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
const TRACKING_EVENTS = ['tracking.open', 'tracking.click'] as const;
const DESCRIPTION = 'Konekt, suivi des e-mails de séquence (ouvertures et clics)';

async function main() {
  if (!Deno.env.get('UNIPILE_V2_API_KEY') || !SUPABASE_URL) {
    console.error('Variables obligatoires manquantes : UNIPILE_V2_API_KEY, SUPABASE_URL');
    Deno.exit(1);
  }
  const token = await resolveWebhookToken();
  if (!token) {
    console.error('Aucun jeton de livraison : définir UNIPILE_V2_WEBHOOK_TOKEN (ou UNIPILE_WEBHOOK_SECRET). Rien n\'a été modifié.');
    Deno.exit(1);
  }

  const handlerBase = `${SUPABASE_URL}/functions/v1/sequence-webhooks-handler`;
  const targetUrl = `${handlerBase}?${WEBHOOK_TOKEN_PARAM}=${encodeURIComponent(token)}`;

  console.log('=== Webhooks de suivi des e-mails de séquence ===');
  console.log(`Récepteur : ${handlerBase}`);

  const listed = await listAllEndpoints();
  const plan = planEndpointSync(listed.items, handlerBase, TRACKING_EVENTS);
  if (plan.keepId === null && listed.truncated) {
    console.error('Liste des points de terminaison incomplète : rien n\'a été créé pour éviter un doublon.');
    Deno.exit(1);
  }

  if (plan.keepId !== null) {
    await patchEndpoint(plan.keepId, { url: targetUrl, triggerEvents: TRACKING_EVENTS, enabled: true, description: DESCRIPTION });
    console.log(`  Mis à jour : ${plan.keepId} (${TRACKING_EVENTS.join(', ')})`);
  } else {
    const created = await createEndpoint({ url: targetUrl, triggerEvents: TRACKING_EVENTS, description: DESCRIPTION });
    console.log(`  Créé : ${created.id} (${TRACKING_EVENTS.join(', ')})`);
  }

  for (const duplicateId of plan.deleteIds) {
    try {
      await deleteEndpoint(duplicateId);
      console.log(`  Doublon supprimé : ${duplicateId}`);
    } catch (err) {
      console.error(`  Doublon non supprimé : ${duplicateId}`, describeForLog(err));
    }
  }

  console.log('');
  console.log('Terminé.');
}

main().catch((err) => {
  console.error('Erreur :', describeForLog(err));
  Deno.exit(1);
});
