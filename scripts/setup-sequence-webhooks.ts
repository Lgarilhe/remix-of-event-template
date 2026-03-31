/**
 * One-shot script to configure Unipile webhooks for the sequences module.
 *
 * Usage:
 *   UNIPILE_BASE_URL=... UNIPILE_API_KEY=... SUPABASE_URL=... SEQUENCE_WEBHOOK_SECRET=... npx ts-node scripts/setup-sequence-webhooks.ts
 *
 * Or with Deno:
 *   deno run --allow-net --allow-env scripts/setup-sequence-webhooks.ts
 */

const UNIPILE_BASE_URL = (process.env.UNIPILE_BASE_URL || process.env.UNIPILE_DSN || '').replace(/\/$/, '');
const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const WEBHOOK_SECRET = process.env.SEQUENCE_WEBHOOK_SECRET || process.env.UNIPILE_WEBHOOK_SECRET || '';

if (!UNIPILE_BASE_URL || !UNIPILE_API_KEY || !SUPABASE_URL) {
  console.error('Missing required env vars: UNIPILE_BASE_URL, UNIPILE_API_KEY, SUPABASE_URL');
  process.exit(1);
}

if (!WEBHOOK_SECRET) {
  console.warn('WARNING: No SEQUENCE_WEBHOOK_SECRET set. Webhooks will not be authenticated.');
}

const WEBHOOK_HANDLER_URL = `${SUPABASE_URL}/functions/v1/sequence-webhooks-handler`;
const PREFIX = 'konekt-seq-';

interface WebhookConfig {
  name: string;
  source: string;
  events: string[];
}

const WEBHOOKS: WebhookConfig[] = [
  {
    name: `${PREFIX}messaging`,
    source: 'messaging',
    events: ['message_received'],
  },
  {
    name: `${PREFIX}relations`,
    source: 'users',
    events: ['new_relation'],
  },
  {
    name: `${PREFIX}email-tracking`,
    source: 'email_tracking',
    events: ['mail_opened', 'mail_link_clicked'],
  },
  {
    name: `${PREFIX}email-received`,
    source: 'email',
    events: ['mail_received'],
  },
];

async function apiCall(method: string, path: string, body?: unknown): Promise<unknown> {
  const url = `${UNIPILE_BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'X-API-KEY': UNIPILE_API_KEY,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }

  return res.json();
}

async function main() {
  console.log('=== Sequence Webhooks Setup ===');
  console.log(`Unipile: ${UNIPILE_BASE_URL}`);
  console.log(`Handler: ${WEBHOOK_HANDLER_URL}`);
  console.log('');

  // 1. List existing webhooks
  console.log('Listing existing webhooks...');
  const existing = (await apiCall('GET', '/api/v1/webhooks')) as { items?: { id: string; name: string }[] };
  const existingItems = existing.items || [];

  // 2. Delete existing konekt-seq-* webhooks
  const toDelete = existingItems.filter(w => w.name.startsWith(PREFIX));
  if (toDelete.length > 0) {
    console.log(`Deleting ${toDelete.length} existing konekt-seq-* webhook(s)...`);
    for (const webhook of toDelete) {
      try {
        await apiCall('DELETE', `/api/v1/webhooks/${webhook.id}`);
        console.log(`  ✓ Deleted: ${webhook.name} (${webhook.id})`);
      } catch (err) {
        console.error(`  ✗ Failed to delete ${webhook.name}:`, err);
      }
    }
  } else {
    console.log('No existing konekt-seq-* webhooks to clean up.');
  }

  // 3. Create new webhooks
  console.log('');
  console.log('Creating new webhooks...');
  for (const config of WEBHOOKS) {
    try {
      const payload = {
        request_url: WEBHOOK_HANDLER_URL,
        name: config.name,
        format: 'json',
        source: config.source,
        events: config.events,
        headers: WEBHOOK_SECRET
          ? [{ key: 'x-webhook-secret', value: WEBHOOK_SECRET }]
          : [],
      };

      const result = await apiCall('POST', '/api/v1/webhooks', payload);
      console.log(`  ✓ Created: ${config.name} (${config.events.join(', ')})`);
    } catch (err) {
      console.error(`  ✗ Failed to create ${config.name}:`, err);
    }
  }

  console.log('');
  console.log('Done! Webhooks configured.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
