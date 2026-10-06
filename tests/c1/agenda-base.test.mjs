/**
 * Agenda Outlook (lot I3), demande de fusion A : garde-fous statiques de la
 * base de données et du RGPD (plan : docs/refonte-mission/agenda-outlook-
 * construction-2026-10-05.md, sections 4 et 8).
 *
 * Même forme que c1-fonctions.test.mjs : lecture du source et assertions sur
 * les motifs, sans dépendance, sans base ni runtime Deno. L'audit SQL
 * (supabase/tests/calendar_accounts_audit.sql) vérifie la base elle-même.
 *
 * Lancer : node --test tests/c1/agenda-base.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre (ex. une extraction de HEAD) : c'est
 * ainsi qu'on vérifie que ces tests échouent sur le code d'origine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const VERSION = '20261006164408';
const MIGRATION = `supabase/migrations/${VERSION}_agenda_outlook_base.sql`;
const CONTACT = 'supabase/functions/_shared/get-or-fetch-contact.ts';
const ERASE = 'supabase/functions/rgpd-erase-contact/index.ts';
const PURGE = 'supabase/functions/rgpd-purge/index.ts';
const EXPORT = 'supabase/functions/export-org-data/index.ts';

// Tranche de source entre deux repères, repères compris côté début seulement.
function between(src, from, to) {
  const start = src.indexOf(from);
  assert.ok(start >= 0, `${from} introuvable`);
  const end = src.indexOf(to, start + from.length);
  assert.ok(end > start, `${to} introuvable après ${from}`);
  return src.slice(start, end);
}

function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

test('agenda A : la table member_calendar_accounts est lue, jamais écrite, par le navigateur', () => {
  const sql = read(MIGRATION);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.member_calendar_accounts \(/);
  assert.match(sql, /organization_id uuid NOT NULL REFERENCES public\.organizations\(id\) ON DELETE CASCADE/);
  assert.match(sql, /provider text NOT NULL CHECK \(provider IN \('outlook', 'google'\)\)/);
  assert.match(sql, /UNIQUE \(organization_id, account_id\)/);
  assert.match(sql, /UNIQUE \(organization_id, user_id, provider\)/);
  assert.match(sql, /ALTER TABLE public\.member_calendar_accounts ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /REVOKE ALL ON public\.member_calendar_accounts FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /GRANT SELECT ON public\.member_calendar_accounts TO authenticated;/);
  assert.match(sql, /GRANT ALL ON public\.member_calendar_accounts TO service_role;/);
  // Une seule policy, en lecture : la personne, ou un propriétaire / administrateur.
  const policies = sql.match(/CREATE POLICY [a-z_]+ ON public\.member_calendar_accounts/g) ?? [];
  assert.equal(policies.length, 1);
  const policy = between(sql, 'CREATE POLICY member_calendar_accounts_select', ');\n');
  assert.match(policy, /FOR SELECT TO authenticated/);
  assert.match(policy, /user_id = auth\.uid\(\) AND public\.is_org_member\(auth\.uid\(\), organization_id\)/);
  assert.match(policy, /public\.get_org_role\(auth\.uid\(\), organization_id\) IN \('owner', 'admin'\)/);
  // Ni autorisation d'écriture, ni fonction, ni tâche planifiée dans cette demande.
  assert.doesNotMatch(sql, /GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*TO authenticated/);
  assert.doesNotMatch(sql, /CREATE (OR REPLACE )?FUNCTION|cron\.schedule/);
  // Le navigateur n'écrit jamais dans la table (les fonctions serveur s'en chargent).
  for (const file of walk('src')) {
    const src = read(file);
    assert.doesNotMatch(
      src,
      /from\(\s*['"]member_calendar_accounts['"]\s*\)\s*\.\s*(insert|update|upsert|delete)\b/,
      `${file} écrit dans member_calendar_accounts`,
    );
  }
});

test('agenda A : séances, origine, index unique et reprise des séances Calendly', () => {
  const sql = read(MIGRATION);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS calendar_account_id uuid REFERENCES public\.member_calendar_accounts\(id\) ON DELETE SET NULL/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS external_event_id text/);
  assert.match(sql, /CHECK \(source IN \('manual', 'agenda', 'invitation', 'booking'\)\)/);
  // Calendly : seules les lignes encore à la valeur par défaut passent à « booking ».
  assert.match(sql, /SET source = 'booking'\s+WHERE calendly_event_id IS NOT NULL\s+AND source = 'manual';/);
  // Un événement d'un agenda ne crée qu'une séance (index partiel).
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS qualification_sessions_agenda_event_key\s+ON public\.qualification_sessions \(calendar_account_id, external_event_id\)\s+WHERE calendar_account_id IS NOT NULL AND external_event_id IS NOT NULL;/);
  assert.match(sql, /ON public\.qualification_sessions \(organization_id, event_start_at\);/);
  // Les policies existantes de qualification_sessions ne sont pas touchées.
  assert.doesNotMatch(sql, /POLICY[^;]*ON public\.qualification_sessions/);
  assert.doesNotMatch(sql, /\bDROP TABLE\b|\bDROP COLUMN\b|^\s*TRUNCATE\b/im);
});

test('agenda A : une seule migration porte cette version (règle 3, CLAUDE.md)', () => {
  const files = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.startsWith(`${VERSION}_`));
  assert.deepEqual(files, [`${VERSION}_agenda_outlook_base.sql`]);
});

test('agenda A : effacement RGPD, les séances du candidat sont supprimées dans le périmètre', () => {
  const src = read(CONTACT);
  assert.match(src, /\/\*\* Séances de qualification \(agenda, Calendly\) supprimées\. \*\/\s+deletedSessions: number;/);
  assert.match(src, /cancelledInmails: 0,\s+deletedSessions: 0,/);

  const step = between(src, '  // 11. Séances de qualification', '  return { ...result, success: true };');
  // Trois lectures (identifiant, adresse du profil, adresse e-mail) et une suppression.
  assert.equal((step.match(/\.from\('qualification_sessions'\)/g) ?? []).length, 4);
  assert.match(step, /\.in\('candidate_profile_id', knownIds\.slice\(i, i \+ 100\)\)/);
  assert.match(step, /\.ilike\('candidate_linkedin_url', lookup\.pattern\)/);
  assert.match(step, /\.ilike\('invitee_email', escapeLikePattern\(emailNorm\)\)/);
  // Chaque requête (séances et extraits) reste dans l'organisation de l'effacement.
  assert.equal((step.match(/if \(orgId\) \w+ = \w+\.eq\('organization_id', orgId\);/g) ?? []).length, 5);
  // Les extraits de connaissance partent avant les séances : une reprise retrouve ses séances.
  const chunks = step.indexOf(".from('knowledge_chunks')");
  const sessions = step.indexOf(".from('qualification_sessions').delete()");
  assert.ok(chunks > 0 && sessions > chunks, 'extraits supprimés avant les séances');
  assert.match(step, /\.eq\('source_table', 'qualification_sessions'\)/);
  assert.match(step, /result\.deletedSessions \+= \(deleted \?\? \[\]\)\.length;/);
  // Toute erreur arrête l'effacement (le succès n'est rendu qu'à la fin).
  for (const label of ['lecture des séances', 'suppression des extraits de séances', 'suppression des séances']) {
    assert.match(step, new RegExp(`return fail\\('${label}'`), label);
  }

  assert.match(read(ERASE), /deleted_sessions: result\.deletedSessions,/);
});

test('agenda A : purge RGPD, séances de plus de 24 mois, comptées seulement sans dry_run: false', () => {
  const src = read(PURGE);
  assert.match(src, /qualification_sessions_purged: 0,/);
  const step = between(src, '// ── 6. Séances de qualification', '// ── Summary');
  assert.match(step, /event_end_at\.lt\."\$\{cutoff24mIso\}"/);
  assert.match(step, /\.from\("qualification_sessions"\)\s+\.select\("id, organization_id"\)\s+\.or\(SESSION_AGE_FILTER\)/);
  // En « compte seulement », seule la lecture a lieu : toute suppression est dans la boucle gardée par !dryRun.
  assert.match(step, /for \(let i = 0; !dryRun && i < ids\.length; i \+= 100\) \{/);
  assert.ok(step.indexOf('.delete()') > step.indexOf('!dryRun && i < ids.length'), 'aucune suppression avant la boucle gardée');
  // Extraits de connaissance : toujours par organisation.
  assert.match(step, /\.delete\(\)\s+\.eq\("organization_id", orgId\)\s+\.eq\("source_table", "qualification_sessions"\)/);
  // Le filtre d'âge est rejoué à la suppression.
  assert.match(step, /\.delete\(\)\s+\.in\("id", ids\.slice\(i, i \+ 100\)\)\s+\.or\(SESSION_AGE_FILTER\)/);
  assert.match(step, /stats\.qualification_sessions_purged \+= \(deleted \?\? \[\]\)\.length;/);
});

test('agenda A : export de l\'organisation, séances et agendas reliés', () => {
  const src = read(EXPORT);
  assert.match(src, /\.from\("qualification_sessions"\)\s+\.select\("\*"\)\s+\.eq\("organization_id", organizationId\)/);
  const calendars = between(src, '.from("member_calendar_accounts")', '.order(');
  assert.match(calendars, /\.select\("user_id, provider, email_address, status, last_synced_at, created_at"\)/);
  assert.doesNotMatch(calendars, /account_id/, 'l\'identifiant du compte chez le prestataire n\'est pas exporté');
  assert.match(calendars, /\.eq\("organization_id", organizationId\)/);
  // Un export incomplet échoue (art. 20) : les deux erreurs sont dans le contrôle commun.
  assert.match(src, /\|\| qualificationSessionsError \|\| calendarAccountsError( \|\| phoneCallsError)?;/);
  assert.match(src, /qualification_sessions: qualificationSessions \|\| \[\],/);
  assert.match(src, /calendar_accounts: calendarAccounts \|\| \[\],/);
  assert.match(src, /qualification_sessions_count: \(qualificationSessions \|\| \[\]\)\.length,/);
  assert.match(src, /calendar_accounts_count: \(calendarAccounts \|\| \[\]\)\.length,/);
});

test('agenda A : l\'audit SQL et ce test sont rejoués par la CI', () => {
  const e2e = read('.github/workflows/e2e.yml');
  assert.match(e2e, /-f supabase\/tests\/calendar_accounts_audit\.sql/);
  assert.match(e2e, /rest\/v1\/member_calendar_accounts\?select=id&limit=1/);
  assert.match(read('.github/workflows/ci.yml'), /node --test tests\/c1\/agenda-base\.test\.mjs/);
  const audit = read('supabase/tests/calendar_accounts_audit.sql');
  assert.match(audit, /RAISE EXCEPTION 'calendar_accounts_audit : %'/);
  assert.match(audit, /qualification_sessions_agenda_event_key|un même événement a créé deux séances/);
});
