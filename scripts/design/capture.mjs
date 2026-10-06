#!/usr/bin/env node
/**
 * Banc visuel du chantier design : capture chaque écran de l'application,
 * connecté avec les données de démo (scripts/design/seed-demo.mjs) et public.
 * Quatre variantes : sombre et clair, ordinateur (1440×900) et téléphone (390×844).
 *
 * Les fonctions edge ne tournent pas en local : leurs appels reçoivent une
 * réponse figée (un compte LinkedIn connecté, des crédits IA), comme la suite e2e.
 *
 * Usage :
 *   node scripts/design/capture.mjs <dossier> [filtre]
 *   VARIANTS=dark-desktop,light-mobile node scripts/design/capture.mjs captures/apres dashboard
 * Variables : BASE_URL (défaut http://127.0.0.1:8080), SUPABASE_URL (défaut
 * http://127.0.0.1:54321), SUPABASE_ANON_KEY (défaut : clé anon de `supabase start`),
 * CHROMIUM_PATH (navigateur à utiliser si Playwright ne trouve pas le sien),
 * ACCOUNT=vide (compte indépendant sans données : états vides, bandeau d'essai).
 * Détail : docs/design/05-banc-visuel.md.
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
const FILTER = process.argv[3] || '';
if (!OUT) {
  console.error('Usage : node scripts/design/capture.mjs <dossier> [filtre]');
  process.exit(1);
}
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
const SB_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
// Clé anon publique et déterministe de `supabase start` (aucun secret).
const ANON =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
if (!/127\.0\.0\.1|localhost/.test(SB_URL)) {
  console.error('Refus : le banc visuel ne tourne que contre une base locale.');
  process.exit(1);
}
const STORAGE_KEY = `sb-${new URL(SB_URL).hostname.split('.')[0]}-auth-token`;
const VARIANTS = (process.env.VARIANTS || 'dark-desktop,dark-mobile,light-desktop,light-mobile').split(',');
const M1 = '22222222-2222-4222-8222-000000000001';
const SEARCH = '22222222-2222-4222-8222-000000000009';

const authed = [
  ['dashboard', '/dashboard'],
  ['missions', '/missions'],
  ['mission-overview', `/missions/${M1}?tab=overview`],
  ['mission-brief', `/missions/${M1}?tab=brief`],
  ['mission-process', `/missions/${M1}?tab=process`],
  ['mission-config', `/missions/${M1}?tab=config`],
  ['mission-sourcing', `/missions/${M1}?tab=sourcing`],
  ['mission-outreach', `/missions/${M1}?tab=outreach`],
  ['mission-pipeline', `/missions/${M1}?tab=pipeline`],
  ['mission-insights', `/missions/${M1}?tab=insights`],
  ['sourcing', '/sourcing'],
  ['sourcing-search', `/sourcing/${SEARCH}`],
  ['agents', '/agents'],
  ['pipeline', '/pipeline'],
  ['inbox', '/inbox'],
  ['calendar', '/calendar'],
  ['tasks', '/tasks'],
  ['marketplace', '/marketplace'],
  ['settings-connections', '/settings/account/connections'],
  ['settings-writing', '/settings/account/writing'],
  ['settings-journal', '/settings/account/journal'],
  ['settings-general', '/settings/org/general'],
  ['settings-team', '/settings/org/team'],
  ['settings-billing', '/settings/org/billing'],
  ['settings-assistant', '/settings/org/assistant'],
  ['scorecard', '/pipeline/scorecard/demo-cand-3'],
  ['notfound', '/cette-page-nexiste-pas'],
];
const publicRoutes = [
  ['landing', '/'],
  ['auth', '/auth'],
  ['pricing', '/pricing'],
  ['privacy', '/privacy'],
  ['unsubscribe', '/unsubscribe'],
  ['portal-invalid', '/portal/jeton-invalide'],
  ['client-invalid', '/client/jeton-invalide'],
  ['invite-invalid', '/mission-invite/jeton-invalide'],
  ['recruiter-profile', '/r/inconnu'],
];

async function signIn() {
  const sb = createClient(SB_URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({
    email: process.env.ACCOUNT === 'vide' ? 'nora.vide@demo.konekt.test' : 'camille.martin@demo.konekt.test',
    password: 'Demo!Konekt2026',
  });
  if (error) throw new Error(`Connexion du compte de démo impossible (seed-demo.mjs lancé ?) : ${error.message}`);
  return data.session;
}

/** Réponses figées des fonctions edge (non servies en local). */
async function mockFunctions(page) {
  await page.route('**/functions/v1/**', async (route) => {
    const name = (route.request().url().match(/functions\/v1\/([^/?]+)/) || [])[1] || '';
    let body = {};
    try {
      body = route.request().postDataJSON() || {};
    } catch {
      /* pas de corps JSON */
    }
    let res = { success: true };
    if (name === 'unipile-accounts') {
      res = {
        success: true,
        accounts: [{ id: 'acc_demo_camille', account_status: 'OK', provider: 'LINKEDIN', name: 'Camille Martin', type: 'LINKEDIN' }],
      };
    } else if (name === 'ai-credits') {
      res = { success: true, balance: 1840, credits_remaining: 1840, credits_total: 3000 };
    } else if (name === 'unipile-search') {
      res = body.action === 'get_chats' ? { success: true, chats: [], cursor: null } : { success: true, results: [], items: [] };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(res) });
  });
}

async function shoot(browser, { theme, device, session, routes, dir }) {
  const viewport = device === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    reducedMotion: 'reduce',
  });
  await context.addInitScript(
    ([key, s, t]) => {
      try {
        if (s) localStorage.setItem(key, s);
        localStorage.setItem('konekt-theme', t);
        localStorage.setItem('konekt_welcome_pending', '0');
        localStorage.setItem('konekt:tuto:seen:pipeline', '1');
      } catch {
        /* stockage indisponible */
      }
    },
    [STORAGE_KEY, session ? JSON.stringify(session) : null, theme],
  );
  const page = await context.newPage();
  await mockFunctions(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, url] of routes) {
    if (FILTER && !name.includes(FILTER)) continue;
    try {
      await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(3500);
      await page.screenshot({ path: path.join(dir, `${name}.png`) });
      process.stdout.write('.');
    } catch (e) {
      console.log(`\n[${theme}/${device}] ${name} : ${String(e).slice(0, 160)}`);
    }
  }
  await context.close();
  return errors;
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const session = await signIn();
const report = {};
for (const theme of ['dark', 'light']) {
  for (const device of ['desktop', 'mobile']) {
    if (!VARIANTS.includes(`${theme}-${device}`)) continue;
    const dir = path.join(OUT, `${theme}-${device}`);
    report[`${theme}-${device}-connecte`] = await shoot(browser, { theme, device, session, routes: authed, dir });
    report[`${theme}-${device}-public`] = await shoot(browser, { theme, device, session: null, routes: publicRoutes, dir });
  }
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'erreurs-js.json'), JSON.stringify(report, null, 2));
console.log(`\nCaptures dans ${OUT}`);
