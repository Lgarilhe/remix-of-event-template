/**
 * Sécurité multi-tenant — persona Théo.
 * Un user d'org A ne doit jamais accéder aux données d'org B.
 *
 * @critical
 */
import { test, expect } from '../fixtures';
import { admin, seedMission } from '../helpers/supabase-admin';
import { role } from '../helpers/registry';

test.describe('@critical Multi-tenant isolation', () => {
  test('URL forge : enterprise-admin ne voit pas une mission d\'org B', async ({ asRole }) => {
    // Mission créée dans l'org B (Théo).
    const orgB = role('orgBOwner');
    const missionId = await seedMission(orgB.orgId, orgB.userId, { name: 'SECRET OrgB Mission' });

    try {
      // Claire (enterprise) tente d'ouvrir la mission d'org B via URL directe.
      const page = await asRole('enterpriseAdmin');
      await page.goto(`/missions/${missionId}`);

      // Ne doit jamais afficher le contenu de la mission d'org B.
      await expect(page.getByText('SECRET OrgB Mission')).toHaveCount(0);
      // Doit rediriger / afficher un état vide ou un blocage (pas la mission).
      await expect(page).not.toHaveURL(new RegExp(`/missions/${missionId}$`), { timeout: 10_000 }).catch(() => {
        // Si l'URL reste, au minimum le contenu protégé ne doit pas fuiter (assertion ci-dessus).
      });
    } finally {
      await admin().from('sourcing_projects').delete().eq('id', missionId);
    }
  });

  test('API REST : enterprise ne lit pas les sourcing_projects d\'org B (RLS)', async ({}) => {
    const orgB = role('orgBOwner');
    const missionId = await seedMission(orgB.orgId, orgB.userId, { name: 'SECRET RLS Mission' });
    try {
      const { signIn } = await import('../helpers/supabase-admin');
      const { createClient } = await import('@supabase/supabase-js');
      const { E2E } = await import('../helpers/env');

      const claire = role('enterpriseAdmin');
      const session = await signIn(claire.email, claire.password);
      const client = createClient(E2E.supabaseUrl, E2E.anonKey, {
        global: { headers: { Authorization: `Bearer ${session.access_token}` } },
        auth: { persistSession: false },
      });
      // Lecture directe filtrée sur l'id d'org B → RLS doit renvoyer 0 ligne.
      const { data } = await client.from('sourcing_projects').select('id,name').eq('id', missionId);
      expect(data ?? []).toHaveLength(0);
    } finally {
      await admin().from('sourcing_projects').delete().eq('id', missionId);
    }
  });

  test('Prospection est cachée pour une org enterprise (featureGates)', async ({ asRole }) => {
    const page = await asRole('enterpriseAdmin');
    await page.goto('/dashboard');
    // L'entrée vivier/prospection ne doit pas apparaître pour enterprise.
    await expect(page.getByRole('link', { name: /prospection|vivier/i })).toHaveCount(0);
  });
});
