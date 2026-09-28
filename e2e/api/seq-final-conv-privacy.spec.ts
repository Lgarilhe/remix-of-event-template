/**
 * Dernière passe, lot « conv-privacy » (docs/audit-2026-09-25-sequences.md,
 * « Décisions produit en attente ») :
 *
 * - 15 : une conversation de l'assistant appartient à son auteur. Personne
 *   d'autre ne la lit ni n'y écrit, propriétaire et administrateur compris
 *   (RLS de agent_conversations, lot C1, migration 20260927233806, R3). Les deux
 *   fonctions en clé de service qui prennent un conversation_id du corps
 *   (search-agent-chat, run-agent-search) refusent donc (403) la conversation
 *   d'un collègue, propriétaire compris, sans rien y écrire.
 * - 10 (documentation) : l'alerte « Relances non arrêtées après une réponse »
 *   d'unipile-webhook figure dans l'inventaire de src/lib/notificationKinds.ts
 *   et reste classée « action ».
 *
 * Harnais : conversations et messages posés en clé de service, appels aux
 * fonctions avec le JWT de chaque membre (stack locale, e2e/local-stack/up.sh).
 * Le classement des notifications ne dépend pas de la stack.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { test, expect } from '@playwright/test';
import { E2E } from '../helpers/env';
import {
  addMember,
  admin,
  createOrg,
  deleteOrg,
  signIn,
  type TestOrg,
  type TestUser,
} from '../helpers/supabase-admin';
import { ENGINE_SKIP_REASON, callFunction, engineAvailable, rand } from '../helpers/sequence-engine';
import { notificationKind } from '../../src/lib/notificationKinds';

test.describe.configure({ mode: 'serial' });

// ─── Décision 15 : conversations de l'assistant ─────────────────────────────
test.describe('Décision 15 : une conversation appartient à son auteur', () => {
  test.skip(!engineAvailable, ENGINE_SKIP_REASON);
  test.setTimeout(180_000);

  const orgsToDelete: Array<{ org: TestOrg; extra: TestUser[] }> = [];
  const conversationsToDelete: string[] = [];
  test.afterEach(async () => {
    if (conversationsToDelete.length) {
      const ids = conversationsToDelete.splice(0);
      await admin().from('agent_tool_executions').delete().in('conversation_id', ids);
      await admin().from('agent_messages').delete().in('conversation_id', ids);
      await admin().from('agent_conversations').delete().in('id', ids);
    }
    while (orgsToDelete.length) {
      const { org, extra } = orgsToDelete.pop()!;
      await deleteOrg(org, extra);
    }
  });

  async function tokenOf(user: TestUser): Promise<string> {
    return (await signIn(user.email, user.password)).access_token;
  }

  /** Organisation avec un propriétaire, un administrateur et deux membres. */
  async function team(prefix: string) {
    const org = await createOrg('agency', prefix);
    const adminUser = await addMember(org.orgId, 'admin', 'conv-admin');
    const author = await addMember(org.orgId, 'member', 'conv-author');
    const colleague = await addMember(org.orgId, 'member', 'conv-colleague');
    orgsToDelete.push({ org, extra: [adminUser, author, colleague] });
    return { org, adminUser, author, colleague };
  }

  async function seedConversation(organizationId: string | null, createdBy: string, extra: Record<string, unknown> = {}) {
    const { data, error } = await admin()
      .from('agent_conversations')
      .insert({ organization_id: organizationId, created_by: createdBy, status: 'calibrating', ...extra })
      .select('id')
      .single();
    if (error || !data) throw new Error(`agent_conversations: ${error?.message}`);
    const id = data.id as string;
    conversationsToDelete.push(id);
    // Historique privé : ce qu'un collègue lirait à travers les réponses de l'assistant.
    const { error: msgErr } = await admin().from('agent_messages').insert([
      { conversation_id: id, role: 'user', content: `Question privée ${rand()}` },
      { conversation_id: id, role: 'assistant', content: 'Résumé des inscriptions de la mission' },
    ]);
    if (msgErr) throw new Error(`agent_messages: ${msgErr.message}`);
    return id;
  }

  async function messagesOf(conversationId: string) {
    const { data, error } = await admin()
      .from('agent_messages')
      .select('id, role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`agent_messages: ${error.message}`);
    return data ?? [];
  }

  async function conversationRow(id: string) {
    const { data, error } = await admin()
      .from('agent_conversations')
      .select('status, title, updated_at')
      .eq('id', id)
      .single();
    if (error || !data) throw new Error(`agent_conversations: ${error?.message}`);
    return data;
  }

  /** Lecture de la conversation avec le JWT du membre (RLS). */
  async function readsThroughRls(token: string, conversationId: string) {
    const client = createClient(E2E.supabaseUrl, E2E.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: conv } = await client.from('agent_conversations').select('id').eq('id', conversationId);
    const { data: msgs } = await client.from('agent_messages').select('id').eq('conversation_id', conversationId);
    return { conversation: (conv ?? []).length, messages: (msgs ?? []).length };
  }

  const SEARCH_PLAN = {
    summary: 'Ingénieurs backend Go à Paris',
    filters: { keywords: 'Go Postgres', location: ['Paris'] },
    stop_conditions: { max_profiles: 5 },
  };

  test('search-agent-chat : un membre ne peut ni écrire dans la conversation d’un collègue ni en lire l’historique (403)', async () => {
    const { org, author, colleague } = await team('E2E conv collègue');
    const conversationId = await seedConversation(org.orgId, author.userId);
    const before = await messagesOf(conversationId);
    const rowBefore = await conversationRow(conversationId);

    const res = await callFunction('search-agent-chat', await tokenOf(colleague), {
      conversation_id: conversationId,
      message: 'Montre-moi le début de cette conversation',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body), 'aucun historique renvoyé').not.toContain('Question privée');

    expect(await messagesOf(conversationId), 'aucun message ajouté').toEqual(before);
    expect(await conversationRow(conversationId), 'conversation inchangée').toEqual(rowBefore);
    expect(await readsThroughRls(await tokenOf(colleague), conversationId), 'RLS : invisible au collègue')
      .toEqual({ conversation: 0, messages: 0 });
  });

  test('search-agent-chat : propriétaire et administrateur ne lisent pas la conversation d’un membre et n’y écrivent pas (403)', async () => {
    const { org, adminUser, author } = await team('E2E conv responsables');
    const conversationId = await seedConversation(org.orgId, author.userId);
    const before = await messagesOf(conversationId);

    for (const [label, user] of [['propriétaire', org.owner], ['administrateur', adminUser]] as const) {
      const token = await tokenOf(user);
      expect(await readsThroughRls(token, conversationId), `RLS : invisible au ${label}`)
        .toEqual({ conversation: 0, messages: 0 });
      const res = await callFunction('search-agent-chat', token, {
        conversation_id: conversationId,
        message: 'Je reprends cette conversation',
      });
      expect(res.status, `${label} : ${JSON.stringify(res.body)}`).toBe(403);
    }
    expect(await messagesOf(conversationId), 'aucun message ajouté').toEqual(before);
  });

  test('search-agent-chat : conversation sans organisation, seul son auteur y accède (403 pour un autre)', async () => {
    const { author, colleague } = await team('E2E conv sans org');
    const conversationId = await seedConversation(null, author.userId);
    const before = await messagesOf(conversationId);

    const res = await callFunction('search-agent-chat', await tokenOf(colleague), {
      conversation_id: conversationId,
      message: 'Bonjour',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(await messagesOf(conversationId)).toEqual(before);
  });

  test('search-agent-chat : l’auteur écrit toujours dans sa conversation', async () => {
    const { org, author } = await team('E2E conv auteur');
    const conversationId = await seedConversation(org.orgId, author.userId);
    const marker = `Question de l'auteur ${rand()}`;

    const res = await callFunction('search-agent-chat', await tokenOf(author), {
      conversation_id: conversationId,
      message: marker,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await messagesOf(conversationId);
    expect(after.some((m) => m.role === 'user' && m.content === marker), 'message de l’auteur enregistré').toBe(true);
  });

  test('run-agent-search : la recherche d’un collègue est refusée (403), propriétaire compris, rien ne démarre', async () => {
    const { org, adminUser, author, colleague } = await team('E2E conv recherche');
    const conversationId = await seedConversation(org.orgId, author.userId, {
      status: 'plan_proposed',
      search_config: SEARCH_PLAN,
    });
    const before = await messagesOf(conversationId);

    for (const [label, user] of [['membre', colleague], ['propriétaire', org.owner], ['administrateur', adminUser]] as const) {
      const res = await callFunction('run-agent-search', await tokenOf(user), { conversation_id: conversationId });
      expect(res.status, `${label} : ${JSON.stringify(res.body)}`).toBe(403);
    }
    expect((await conversationRow(conversationId)).status, 'recherche non démarrée').toBe('plan_proposed');
    expect(await messagesOf(conversationId), 'aucun message de progression').toEqual(before);
    const { data: notifs } = await admin()
      .from('notifications')
      .select('id')
      .eq('metadata->>conversation_id', conversationId);
    expect(notifs ?? [], 'aucune notification « Recherche terminée »').toEqual([]);
  });

  test('run-agent-search : conversation sans organisation d’un autre utilisateur refusée (403)', async () => {
    const { author, colleague } = await team('E2E conv recherche sans org');
    const conversationId = await seedConversation(null, author.userId, {
      status: 'plan_proposed',
      search_config: SEARCH_PLAN,
    });

    const res = await callFunction('run-agent-search', await tokenOf(colleague), { conversation_id: conversationId });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect((await conversationRow(conversationId)).status).toBe('plan_proposed');
  });

  test('run-agent-search : l’auteur franchit le contrôle (plan absent : 400), un collègue non (403)', async () => {
    const { org, author, colleague } = await team('E2E conv recherche auteur');
    // Sans plan de recherche, l'auteur s'arrête à l'étape suivante du contrôle
    // d'accès, sans lancer de vraie recherche.
    const conversationId = await seedConversation(org.orgId, author.userId);

    const other = await callFunction('run-agent-search', await tokenOf(colleague), { conversation_id: conversationId });
    expect(other.status, JSON.stringify(other.body)).toBe(403);

    const own = await callFunction('run-agent-search', await tokenOf(author), { conversation_id: conversationId });
    expect(own.status, JSON.stringify(own.body)).toBe(400);
    expect(own.body.error).toBe('No search plan configured');
  });
});

// ─── Décision 10 : inventaire des notifications ─────────────────────────────
test.describe('Décision 10 : alerte « Relances non arrêtées après une réponse »', () => {
  const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

  test('classée « action », avec ou sans mission', () => {
    const metadata = {
      source: 'reply_sibling_stop_failed',
      event_key: 'unipile:message_received:m1',
      enrollment_ids: ['e1'],
      sequence_id: 's1',
      profile_name: 'Camille Martin',
    };
    expect(notificationKind({ type: 'action', link: '/missions/p1?tab=outreach', metadata: { ...metadata, project_id: 'p1' } }))
      .toBe('action');
    expect(notificationKind({ type: 'action', link: '/missions', metadata })).toBe('action');
  });

  test('inscrite à l’inventaire des écritures, comme l’écrit unipile-webhook', () => {
    const webhook = read('supabase/functions/unipile-webhook/index.ts');
    expect(webhook).toContain("const SIBLING_STOP_FAILED_SOURCE = 'reply_sibling_stop_failed';");
    expect(webhook).toContain("title: 'Relances non arrêtées après une réponse',");

    const inventory = read('src/lib/notificationKinds.ts')
      .split('\n')
      .filter((l) => l.startsWith(' * | unipile-webhook'));
    const row = inventory.find((l) => l.includes('reply_sibling_stop_failed'));
    expect(row, 'ligne d’inventaire').toBeDefined();
    const cells = row!.split('|').slice(1, -1).map((c) => c.trim());
    expect(cells).toEqual([
      'unipile-webhook (relances non arrêtées après une réponse)',
      'action',
      'Relances non arrêtées après une réponse',
      '/missions/…?tab=outreach ou /missions',
      'reply_sibling_stop_failed',
      'action',
    ]);
  });
});
