#!/usr/bin/env node
/**
 * Banc visuel du chantier design : données de démo fictives (docs/design/05-banc-visuel.md).
 *
 * Un cabinet (« Cabinet Horizon »), quatre missions, 28 candidats à tous les
 * stades, deux séquences, des tâches, des entretiens et des notifications ;
 * plus un compte indépendant vide pour les états vides. Noms et entreprises
 * inventés. Le script efface puis réécrit ses propres lignes : il se rejoue.
 *
 * Refuse toute cible qui n'est pas une base locale (127.0.0.1 / localhost).
 *
 * Usage :
 *   SUPABASE_SERVICE_ROLE_KEY=<clé de `supabase status`> node scripts/design/seed-demo.mjs
 * Variables : SUPABASE_URL (défaut http://127.0.0.1:54321),
 *             DATABASE_URL (défaut postgresql://postgres:postgres@127.0.0.1:54322/postgres)
 */
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SB_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const isLocal = (u) => /^(https?|postgres(ql)?):\/\/([^@/]*@)?(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(u);
if (!isLocal(SB_URL) || !isLocal(DB_URL)) {
  console.error('Refus : le banc visuel ne tourne que contre une base locale (127.0.0.1 ou localhost).');
  process.exit(1);
}
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE) {
  console.error('SUPABASE_SERVICE_ROLE_KEY manquante (voir `supabase status -o env`).');
  process.exit(1);
}
const admin = createClient(SB_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

async function user(email, password, name) {
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list?.users?.find((u) => u.email === email);
  if (existing) return existing.id;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: name },
  });
  if (error) throw error;
  return data.user.id;
}

const owner = await user('camille.martin@demo.konekt.test', 'Demo!Konekt2026', 'Camille Martin');
const admin2 = await user('hugo.bernard@demo.konekt.test', 'Demo!Konekt2026', 'Hugo Bernard');
const collab = await user('lea.petit@demo.konekt.test', 'Demo!Konekt2026', 'Léa Petit');
const empty = await user('nora.vide@demo.konekt.test', 'Demo!Konekt2026', 'Nora Lambert');

const q = (s) => (s === null || s === undefined ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const j = (o) => `${q(JSON.stringify(o))}::jsonb`;

const ORG = '11111111-1111-4111-8111-111111111111';
const ORG_EMPTY = '11111111-1111-4111-8111-222222222222';
const M = [
  '22222222-2222-4222-8222-000000000001',
  '22222222-2222-4222-8222-000000000002',
  '22222222-2222-4222-8222-000000000003',
  '22222222-2222-4222-8222-000000000004',
];
const SEARCH = '22222222-2222-4222-8222-000000000009';

const missions = [
  {
    id: M[0], name: 'Lead Developer Backend · Nova Pay', client: 'Nova Pay', title: 'Lead Developer Backend',
    jd: {
      title: 'Lead Developer Backend', contract_type: 'cdi', urgency: 'high',
      client: { name: 'Nova Pay', sector: 'Fintech', size: 'scale-up', website: 'https://novapay.example',
        hiring_manager: { name: 'Julien Morel', title: 'CTO' } },
      location: 'Paris', remote_policy: 'hybrid', remote_days: 2, team_size: 8, reports_to: 'CTO', manages: 4,
      context: "Nova Pay double son équipe paiement après une levée de série B.",
      mission_description: "Encadrer l'équipe paiement, fiabiliser l'architecture et livrer le nouveau moteur de rapprochement.",
      seniority: 'lead', experience_min: 7, experience_max: 12, salary_min: 85000, salary_max: 105000, salary_currency: 'EUR', salary_type: 'annual',
      skills_must_have: ['Go', 'PostgreSQL', 'Kubernetes'], skills_should_have: ['Kafka', 'DDD'], skills_nice_to_have: ['Rust'],
      languages: [{ language: 'Anglais', level: 'courant' }],
      evaluation_criteria: [
        { id: 'c1', label: 'Architecture distribuée', description: 'A conçu un système à fort volume', category: 'technical', weight: 3 },
        { id: 'c2', label: 'Management', description: 'A encadré au moins 3 personnes', category: 'soft_skill', weight: 2 },
        { id: 'c3', label: 'Culture produit', description: 'Parle usage avant technique', category: 'culture_fit', weight: 2 },
      ],
    },
  },
  {
    id: M[1], name: 'Product Designer Senior · Atelier Lumen', client: 'Atelier Lumen', title: 'Product Designer Senior',
    jd: {
      title: 'Product Designer Senior', contract_type: 'cdi', urgency: 'medium',
      client: { name: 'Atelier Lumen', sector: 'SaaS B2B', size: 'startup' },
      location: 'Lyon', remote_policy: 'full_remote', seniority: 'senior', experience_min: 5, experience_max: 9,
      salary_min: 60000, salary_max: 72000, salary_currency: 'EUR', salary_type: 'annual',
      mission_description: "Porter la refonte du parcours d'onboarding et structurer le design system.",
      skills_must_have: ['Figma', 'Design system', 'Recherche utilisateur'], skills_should_have: ['Prototypage'],
    },
  },
  {
    id: M[2], name: 'Head of Sales · Médicis Santé', client: 'Médicis Santé', title: 'Head of Sales',
    jd: {
      title: 'Head of Sales', contract_type: 'cdi', urgency: 'critical',
      client: { name: 'Médicis Santé', sector: 'Santé', size: 'mid-market' },
      location: 'Bordeaux', remote_policy: 'onsite', seniority: 'head', experience_min: 10,
      salary_min: 110000, salary_max: 140000, salary_currency: 'EUR', salary_type: 'annual',
      skills_must_have: ['Vente complexe', 'Management commercial'],
    },
  },
  {
    id: M[3], name: 'Data Engineer · Batiloop', client: 'Batiloop', title: 'Data Engineer',
    jd: { title: 'Data Engineer', contract_type: 'freelance', client: { name: 'Batiloop', sector: 'Construction' }, location: 'Nantes' },
  },
];

const firstNames = ['Inès', 'Thomas', 'Sarah', 'Maxime', 'Chloé', 'Antoine', 'Manon', 'Lucas', 'Camille', 'Nicolas', 'Julie', 'Hugo', 'Emma', 'Paul', 'Laura', 'Mehdi', 'Clara', 'Romain', 'Zoé', 'Karim', 'Alice', 'Bastien', 'Yasmine', 'Olivier', 'Margaux', 'Florian', 'Lina', 'Quentin'];
const lastNames = ['Durand', 'Lefèvre', 'Moreau', 'Girard', 'Roux', 'Fournier', 'Mercier', 'Blanc', 'Guerin', 'Faure', 'Andre', 'Chevalier', 'Garnier', 'Lambert', 'Bonnet', 'Benali', 'Rousseau', 'Vincent', 'Muller', 'Haddad', 'Perrin', 'Clement', 'Morin', 'Nicolas', 'Gauthier', 'Masson', 'Marchand', 'Duval'];
const headlines = [
  'Staff Engineer Go · Paiements', 'Backend Lead chez Qamo', 'Senior Software Engineer · Kubernetes, Go',
  'Engineering Manager · Fintech', 'Product Designer · Design systems', 'Lead UX Researcher',
  'Directeur commercial santé', 'VP Sales · MedTech', 'Data Engineer · Spark, dbt', 'Senior Backend Engineer · Rust, Go',
];
const statuses = ['discovered', 'scored', 'shortlisted', 'messaged', 'replied', 'interested', 'qualification', 'dismissed'];

let sql = `begin;
set local session_replication_role = replica;
delete from public.job_candidate_status where organization_id in ('${ORG}','${ORG_EMPTY}');
delete from public.sequence_enrollments where organization_id = '${ORG}';
delete from public.outreach_sequences where organization_id = '${ORG}';
delete from public.candidate_reminders where organization_id = '${ORG}';
delete from public.qualification_sessions where organization_id = '${ORG}';
delete from public.notifications where organization_id = '${ORG}';
delete from public.mission_process_steps where organization_id = '${ORG}';
delete from public.mission_team where project_id in (${M.map(q).join(',')});
delete from public.sourcing_projects where organization_id in ('${ORG}','${ORG_EMPTY}');
delete from public.member_linkedin_accounts where organization_id = '${ORG}';
delete from public.organization_subscriptions where organization_id in ('${ORG}','${ORG_EMPTY}');
delete from public.ai_credit_balances where organization_id in ('${ORG}','${ORG_EMPTY}');
delete from public.organization_members where organization_id in ('${ORG}','${ORG_EMPTY}');
delete from public.organizations where id in ('${ORG}','${ORG_EMPTY}');

insert into public.organizations (id, name, slug, created_by, org_type, website, team_size)
values ('${ORG}', 'Cabinet Horizon', 'cabinet-horizon-demo', '${owner}', 'agency', 'https://horizon.example', '2-10'),
       ('${ORG_EMPTY}', 'Studio Lambert', 'studio-lambert-demo', '${empty}', 'freelance', null, '1');
insert into public.organization_members (organization_id, user_id, role) values
  ('${ORG}', '${owner}', 'owner'), ('${ORG}', '${admin2}', 'admin'), ('${ORG}', '${collab}', 'collaborator'),
  ('${ORG_EMPTY}', '${empty}', 'owner')
on conflict (organization_id, user_id) do update set role = excluded.role;
insert into public.profiles (user_id, display_name, active_organization_id, job_title) values
  ('${owner}', 'Camille Martin', '${ORG}', 'Associée fondatrice'),
  ('${admin2}', 'Hugo Bernard', '${ORG}', 'Consultant senior'),
  ('${collab}', 'Léa Petit', '${ORG}', 'Chargée de recherche'),
  ('${empty}', 'Nora Lambert', '${ORG_EMPTY}', 'Recruteuse indépendante')
on conflict (user_id) do update set display_name = excluded.display_name, active_organization_id = excluded.active_organization_id, job_title = excluded.job_title;
insert into public.organization_subscriptions (organization_id, plan_id, status, billing_cycle, seats, current_period_start, current_period_end)
values ('${ORG}', 'cabinet', 'active', 'monthly', 3, now() - interval '10 days', now() + interval '20 days'),
       ('${ORG_EMPTY}', 'solo', 'trialing', 'monthly', 1, now() - interval '11 days', now() + interval '3 days')
on conflict (organization_id) do update set plan_id = excluded.plan_id, status = excluded.status, seats = excluded.seats;
update public.organization_subscriptions set trial_ends_at = now() + interval '3 days' where organization_id = '${ORG_EMPTY}';
insert into public.ai_credit_balances (organization_id, credits_remaining, credits_total, plan_credits, topup_credits, period_start, period_end)
values ('${ORG}', 1840, 3000, 3000, 0, now() - interval '10 days', now() + interval '20 days'),
       ('${ORG_EMPTY}', 300, 300, 300, 0, now() - interval '3 days', now() + interval '11 days')
on conflict (organization_id) do update set credits_remaining = excluded.credits_remaining, credits_total = excluded.credits_total;
insert into public.member_linkedin_accounts (organization_id, user_id, linkedin_account_id, linkedin_account_name, linked_by, account_status, last_checked_at)
values ('${ORG}', '${owner}', 'acc_demo_camille', 'Camille Martin', '${owner}', 'OK', now());
`;

missions.forEach((m, i) => {
  sql += `insert into public.sourcing_projects (id, name, client_name, job_title, status, kind, created_by, organization_id, job_details, created_at, updated_at, last_search_at, stats_total_found, stats_scored, stats_messaged, stats_shortlisted)
values ('${m.id}', ${q(m.name)}, ${q(m.client)}, ${q(m.title)}, 'active', 'mission', '${owner}', '${ORG}', ${j(m.jd)}, now() - interval '${(i + 1) * 6} days', now() - interval '${i} days', now() - interval '${i + 1} hours', ${140 - i * 30}, ${60 - i * 10}, ${24 - i * 5}, ${12 - i * 3});
insert into public.mission_team (project_id, user_id, role) values ('${m.id}', '${owner}', 'lead');
`;
});
sql += `insert into public.mission_team (project_id, user_id, role) values ('${M[0]}', '${admin2}', 'sourcer');
insert into public.sourcing_projects (id, name, status, kind, created_by, organization_id, created_at, updated_at, stats_total_found)
values ('${SEARCH}', 'Veille · Engineering managers Paris', 'active', 'search', '${owner}', '${ORG}', now() - interval '12 days', now() - interval '2 days', 57);
`;

// Process d'entretien de la mission 1
const steps = [
  ['33333333-3333-4333-8333-000000000001', 'Pré-qualification téléphonique', 30, 'internal'],
  ['33333333-3333-4333-8333-000000000002', 'Entretien technique', 60, 'client'],
  ['33333333-3333-4333-8333-000000000003', 'Rencontre équipe', 45, 'panel'],
  ['33333333-3333-4333-8333-000000000004', 'Entretien final CTO', 45, 'client'],
];
steps.forEach(([id, name, dur, who], i) => {
  sql += `insert into public.mission_process_steps (id, project_id, organization_id, step_order, name, duration_minutes, interviewer_type, description)
values ('${id}', '${M[0]}', '${ORG}', ${i + 1}, ${q(name)}, ${dur}, ${q(who)}, ${q('Étape ' + (i + 1) + ' du process Nova Pay')});
`;
});

// Candidats
let n = 0;
const candidates = [];
M.forEach((mid, mi) => {
  const count = [12, 8, 5, 3][mi];
  for (let k = 0; k < count; k++) {
    const fn = firstNames[n % firstNames.length];
    const ln = lastNames[(n * 7) % lastNames.length];
    const name = `${fn} ${ln}`;
    const headline = headlines[(n + mi) % headlines.length];
    const status = statuses[(n + k) % statuses.length];
    const score = 48 + ((n * 13) % 50);
    const slug = `${fn}-${ln}`.toLowerCase().normalize('NFD').replace(/[^a-z-]/g, '');
    let stage = null;
    if (mi === 0) {
      stage = [null, 'sourced', 'messaged', steps[0][0], steps[1][0], steps[1][0], steps[2][0], steps[3][0], 'hired', null, 'messaged', steps[0][0]][k];
    }
    const cid = `demo-cand-${n}`;
    candidates.push({ cid, name, headline, mid, mi, score, status });
    const profile = {
      name, headline, first_name: fn, last_name: ln, location: ['Paris', 'Lyon', 'Bordeaux', 'Nantes', 'Lille'][n % 5],
      public_identifier: slug, network_distance: 'DISTANCE_2',
      work_experience: [
        { position: headline.split('·')[0].trim(), company: ['Qamo', 'Lydia Labs', 'Doctoline', 'Alan Care', 'Swile Pro'][n % 5], start: '2021-03', end: null },
        { position: 'Software Engineer', company: ['Capgemini', 'Sopra', 'OVH', 'BlaBla', 'Criteo'][n % 5], start: '2017-01', end: '2021-02' },
      ],
      skills: ['Go', 'PostgreSQL', 'Kubernetes', 'Kafka', 'Figma', 'Leadership'].slice(0, 3 + (n % 3)),
    };
    const scoring = {
      summary: `Profil ${score >= 75 ? 'très aligné' : score >= 60 ? 'partiellement aligné' : 'éloigné'} avec le brief.`,
      matched_skills: ['Go', 'PostgreSQL'].slice(0, 1 + (n % 2)),
      missing_skills: score >= 75 ? [] : ['Kubernetes'],
      experience_match: score >= 70 ? 'Conforme' : 'Juste',
      location_match: n % 3 !== 0,
      recommendation: score >= 75 ? 'strong_match' : score >= 60 ? 'potential' : 'weak',
    };
    sql += `insert into public.job_candidate_status (job_id, candidate_id, linkedin_profile_url, candidate_name, candidate_headline, status, score, recommendation, created_by, project_id, scoring_details, pipeline_stage, linkedin_profile_data, organization_id, created_at, updated_at)
values ('project:${mid}', '${cid}', 'https://www.linkedin.com/in/${slug}-demo', ${q(name)}, ${q(headline)}, '${status}', ${score}, ${q(scoring.recommendation)}, '${owner}', '${mid}', ${j(scoring)}, ${q(stage)}, ${j(profile)}, '${ORG}', now() - interval '${n} hours', now() - interval '${Math.floor(n / 2)} hours');
`;
    n++;
  }
});

// Séquences
const SEQ1 = '44444444-4444-4444-8444-000000000001';
const SEQ2 = '44444444-4444-4444-8444-000000000002';
sql += `insert into public.outreach_sequences (id, name, description, created_by, is_active, organization_id, project_id)
values ('${SEQ1}', 'Approche Lead Backend', 'Invitation, message court puis relance', '${owner}', true, '${ORG}', '${M[0]}'),
       ('${SEQ2}', 'Relance Product Designer', 'Deux messages espacés de 4 jours', '${owner}', false, '${ORG}', '${M[1]}');
insert into public.sequence_steps (sequence_id, step_order, action_type, delay_days, message_template, step_channel, organization_id) values
  ('${SEQ1}', 1, 'connection_request', 0, 'Bonjour {{first_name}}, votre parcours chez {{company}} m''a interpellée.', 'linkedin', '${ORG}'),
  ('${SEQ1}', 2, 'wait_connection', 3, null, 'linkedin', '${ORG}'),
  ('${SEQ1}', 3, 'message', 1, 'Merci pour la connexion {{first_name}}. Nova Pay recrute un Lead Backend, seriez-vous ouvert à un échange ?', 'linkedin', '${ORG}'),
  ('${SEQ1}', 4, 'message', 4, 'Je me permets de revenir vers vous, {{first_name}}.', 'linkedin', '${ORG}'),
  ('${SEQ2}', 1, 'message', 0, 'Bonjour {{first_name}}, un poste de Product Designer Senior pourrait vous intéresser.', 'linkedin', '${ORG}'),
  ('${SEQ2}', 2, 'message', 4, 'Petite relance {{first_name}}.', 'linkedin', '${ORG}');
`;
const enrollStatuses = ['active', 'active', 'replied', 'completed', 'paused', 'active', 'replied', 'active', 'cancelled', 'active'];
candidates.filter((c) => c.mi <= 1).slice(0, 10).forEach((c, i) => {
  sql += `insert into public.sequence_enrollments (sequence_id, account_id, profile_id, profile_name, profile_headline, profile_url, job_id, job_title, status, current_step_order, created_by, organization_id, connection_status, created_at, replied_at, pause_reason)
values ('${c.mi === 0 ? SEQ1 : SEQ2}', 'acc_demo_camille', '${c.cid}', ${q(c.name)}, ${q(c.headline)}, 'https://www.linkedin.com/in/demo-${i}', 'project:${c.mid}', ${q(missions[c.mi].title)}, '${enrollStatuses[i]}', ${1 + (i % 3)}, '${owner}', '${ORG}', ${q(i % 2 ? 'connected' : 'pending')}, now() - interval '${i + 1} days', ${enrollStatuses[i] === 'replied' ? 'now()' : 'null'}, ${enrollStatuses[i] === 'paused' ? q('manual') : 'null'});
`;
});

// Tâches (rappels)
const tasks = [
  ['Relancer Inès Durand après l’entretien technique', 'follow_up', '-1 day'],
  ['Préparer le debrief client Nova Pay', 'client', '+2 hours'],
  ['Envoyer la shortlist Product Designer', 'client', '+1 day'],
  ['Vérifier les références de Thomas Lefèvre', 'admin', '+3 days'],
  ['Lancer une nouvelle recherche Head of Sales', 'sourcing', '-3 days'],
  ['Préparer l’entretien final de Sarah Moreau', 'interview_prep', '+5 hours'],
];
tasks.forEach(([t, cat, due], i) => {
  sql += `insert into public.candidate_reminders (candidate_id, candidate_name, job_id, job_title, title, category, due_at, created_by, organization_id, completed_at)
values ('demo-cand-${i}', ${q(candidates[i].name)}, 'project:${M[0]}', 'Lead Developer Backend', ${q(t)}, '${cat}', now() + interval '${due}', '${owner}', '${ORG}', ${i === 3 ? "now() - interval '1 hour'" : 'null'});
`;
});

// Agenda (sessions de qualification) sur la semaine courante
[
  [0, 10, 'Pré-qualification'], [0, 14, 'Entretien technique'], [1, 9, 'Pré-qualification'],
  [2, 11, 'Rencontre équipe'], [3, 16, 'Entretien final'], [4, 10, 'Pré-qualification'],
].forEach(([d, h, label], i) => {
  const c = candidates[i + 2];
  sql += `insert into public.qualification_sessions (event_name, event_start_at, event_end_at, event_location, candidate_name, candidate_headline, candidate_profile_id, job_id, job_title, client_name, project_id, created_by, organization_id, status)
values (${q(label + ' · ' + c.name)}, date_trunc('week', now()) + interval '${d} days ${h} hours', date_trunc('week', now()) + interval '${d} days ${h} hours 45 minutes', 'Visio', ${q(c.name)}, ${q(c.headline)}, '${c.cid}', 'project:${M[0]}', 'Lead Developer Backend', 'Nova Pay', '${M[0]}', '${owner}', '${ORG}', 'scheduled');
`;
});

// Notifications
[
  ['new_message', 'Inès Durand a répondu', 'Merci pour votre message, je suis disponible jeudi.', '/inbox'],
  ['candidate_stage', 'Thomas Lefèvre passe en entretien technique', null, `/missions/${M[0]}?tab=pipeline`],
  ['sequence', 'Séquence « Approche Lead Backend » : 3 invitations acceptées', null, `/missions/${M[0]}?tab=outreach`],
].forEach(([type, title, body, link], i) => {
  sql += `insert into public.notifications (user_id, type, title, body, link, organization_id, created_at) values ('${owner}', '${type}', ${q(title)}, ${q(body)}, ${q(link)}, '${ORG}', now() - interval '${i * 3} hours');
`;
});

sql += 'commit;\n';
const file = path.join(os.tmpdir(), 'konekt-seed-demo.sql');
fs.writeFileSync(file, sql);
execFileSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], { stdio: 'inherit' });
console.log(`Données de démo écrites : ${candidates.length} candidats.`);
console.log('Comptes (mot de passe Demo!Konekt2026) : camille.martin@demo.konekt.test (cabinet rempli), nora.vide@demo.konekt.test (indépendante, vide, essai à J-3).');
