/** Exercise the actual UI components with local, deterministic data boundaries.
 * Run: node tests/ux/sidebar-feedback.browser.mjs
 */
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig.js';

const root = resolve('.');
const temp = mkdtempSync(join(tmpdir(), 'konekt-sidebar-ui-'));
const mocks = {
  '@/hooks/useAuthReady': 'export const useAuthReady = () => ({ user: { id: window.__testUserId || "user-a" } });',
  '@/hooks/useOrganization': 'export const useOrganization = () => ({ organizationId: "org-a", orgType: "agency", isLoading: false });',
  '@/hooks/sidebar/useHasPhoneCalls': 'export const useHasPhoneCalls = () => true;',
  '@/hooks/useSequencesBeta': 'export const useSequencesBeta = () => true;',
  '@/hooks/sidebar/useCloseMobileSidebar': 'export const useCloseMobileSidebar = () => () => { window.__closeCount = (window.__closeCount || 0) + 1; };',
  '@/hooks/sidebar/useTodoSignal': 'export const useTodoSignal = () => ({ count: 0 });',
  '@/integrations/supabase/client': `export const supabase = { from() {
    const query = { select(){return query}, eq(){return query}, or(){return query},
      is(){return Promise.resolve({ count: window.__unreadCount ?? 3, error: null })} };
    return query;
  } };`,
};
let browser;
let server;
try {
  await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { MemoryRouter } from 'react-router-dom';
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
      import { TooltipProvider } from '@/components/ui/tooltip';
      import { SidebarProvider } from '@/components/ui/sidebar';
      import { SidebarBottomRow } from '@/components/sidebar/SidebarBottomRow';
      import { MissionMarker } from '@/components/missions/MissionMarker';
      import { AppHeader } from '@/components/AppHeader';
      const client = new QueryClient();
      function App() {
        const [collapsed, setCollapsed] = useState(false);
        const [user, setUser] = useState('user-a');
        window.__setCollapsed = setCollapsed;
        window.__switchUser = id => { window.__testUserId = id; setUser(id); };
        window.__setUnread = async count => { window.__unreadCount = count; await client.invalidateQueries({queryKey:['sidebar','unread-messages']}); };
        return <MemoryRouter initialEntries={['/missions']}><QueryClientProvider client={client}>
          <TooltipProvider><SidebarProvider style={{display:'block'}}>
            <AppHeader />
            <main style={{padding:16}}>
              <h1 style={{fontSize:24,marginBottom:24}}>Missions</h1>
              <div data-testid="mission" onClick={() => { window.__rowClicks = (window.__rowClicks || 0) + 1; }}
                style={{display:'flex',alignItems:'center',gap:12,marginBottom:24}}>
                <MissionMarker missionId="mission-go" name="Développeur Go confirmé" size={40} logoUrl="data:image/png;base64,broken" editable />
                <span>Développeur Go confirmé</span>
              </div>
              <div data-testid="footer" style={{width:collapsed?48:272,maxWidth:'100%',padding:8,background:'hsl(var(--sidebar-background))',borderRadius:8}}>
                <SidebarBottomRow collapsed={collapsed} overdueCount={12}
                  onOpenShortcuts={() => {window.__shortcutsOpened=true}}
                  onOpenTutorial={() => {window.__tutorialOpened=true}} />
              </div>
            </main>
          </SidebarProvider></TooltipProvider>
        </QueryClientProvider></MemoryRouter>;
      }
      createRoot(document.getElementById('root')).render(<App />);
    ` },
    bundle: true, write: true, outfile: join(temp, 'app.js'), jsx: 'automatic',
    plugins: [{ name: 'local-data', setup(builder) {
      builder.onResolve({ filter: /^@\// }, args => args.path in mocks ? { path: args.path, namespace: 'mock' } : { path: resolve(root, 'src', args.path.slice(2) + (existsSync(resolve(root, 'src', args.path.slice(2) + '.tsx')) ? '.tsx' : '.ts')) });
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
    } }],
  });
  const css = await postcss([tailwindcss(loadConfig(resolve(root, 'tailwind.config.ts')))]).process(readFileSync('src/index.css', 'utf8'), { from: resolve(root, 'src/index.css') });
  writeFileSync(join(temp, 'app.css'), css.css);
  server = createServer((request, response) => {
    if (request.url === '/app.js' || request.url === '/app.css') {
      response.setHeader('Content-Type', request.url.endsWith('.js') ? 'text/javascript' : 'text/css');
      response.end(readFileSync(join(temp, request.url.slice(1))));
    } else response.end('<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 920, height: 764 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  const footer = page.getByTestId('footer');
  await expect(footer.getByRole('link', { name: 'Messagerie, 3 messages non lus' })).toBeVisible();
  await expect(footer.getByRole('button', { name: 'Plus, 12 tâches en retard' })).toBeVisible();
  await expect(footer.getByRole('link')).toHaveCount(1);
  await page.evaluate(() => window.__setUnread(21));
  await expect(footer.getByRole('link', { name: 'Messagerie, 21 messages non lus' })).toContainText('9+');
  await page.evaluate(() => window.__setUnread(0));
  await expect(footer.getByRole('link', { name: 'Messagerie', exact: true })).not.toContainText('9+');
  await page.evaluate(() => window.__setUnread(3));

  // Every optional tool is reachable with its name, without crowding the footer.
  await footer.getByRole('button', { name: 'Plus, 12 tâches en retard' }).click();
  for (const label of ['Tâches', 'Agenda', 'Séquences', 'Appels', 'Marketplace', 'Paramètres', 'Raccourcis clavier', 'Vidéo du tutoriel']) {
    await expect(page.getByRole('menuitem', { name: new RegExp(label) })).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(footer.getByRole('button')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Raccourcis clavier' }).click();
  await expect.poll(() => page.evaluate(() => window.__shortcutsOpened)).toBe(true);

  const marker = page.getByRole('button', { name: 'Personnaliser le repère de Développeur Go confirmé' });
  await expect(marker.locator('svg')).toBeVisible(); // Broken logos use the colored icon too.
  await marker.click();
  await expect(page.getByRole('dialog', { name: 'Repère de la mission' })).toBeVisible();
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await page.getByRole('button', { name: 'Violet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Code', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.__rowClicks || 0)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(marker).toBeFocused();
  await page.reload();
  await marker.click();
  await expect(page.getByRole('button', { name: 'Code', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Violet', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');

  // Preferences are personal; another account does not inherit the marker.
  await page.evaluate(() => window.__switchUser('user-b'));
  await marker.click();
  await expect(page.getByRole('button', { name: 'Code', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__switchUser('user-a'));

  // Same-browser tabs see a change immediately through the storage event.
  const second = await context.newPage();
  await second.goto(url);
  await second.getByRole('button', { name: 'Personnaliser le repère de Développeur Go confirmé' }).click();
  await second.getByRole('button', { name: 'Point de couleur' }).click();
  await marker.click();
  await expect(page.getByRole('button', { name: 'Point de couleur' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Rétablir le repère par défaut' }).click();
  await expect(page.getByRole('button', { name: 'Point de couleur' })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await second.close();

  await page.evaluate(() => window.__setCollapsed(true));
  await expect(footer.getByRole('link', { name: 'Messagerie, 3 messages non lus' })).toBeVisible();
  await expect(footer.getByRole('link')).not.toContainText('Messagerie');
  await page.evaluate(() => window.__setCollapsed(false));

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 667, height: 375 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('header').getByRole('link', { name: 'Messagerie, 3 messages non lus' })).toBeVisible();
    await footer.getByRole('button').click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    if (box.x < 0 || box.x + box.width > viewport.width || box.y < 0 || box.y + box.height > viewport.height + 1) throw new Error('The tools menu exceeds the mobile viewport');
    await page.getByRole('menuitem', { name: 'Vidéo du tutoriel' }).scrollIntoViewIfNeeded();
    await page.keyboard.press('Escape');
    await marker.click();
    const choice = page.getByRole('button', { name: 'Point de couleur' });
    await choice.scrollIntoViewIfNeeded();
    const target = await choice.boundingBox();
    if (target.width < 44 || target.height < 44) throw new Error('Marker controls must be at least 44px on mobile');
    await page.keyboard.press('Escape');
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('Horizontal overflow on mobile');
  }
  await page.setViewportSize({ width: 920, height: 764 });
  await page.evaluate(() => document.documentElement.classList.add('light'));
  await marker.click();
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await page.getByRole('button', { name: 'Turquoise', exact: true }).click();
  await page.keyboard.press('Escape');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('PASS: unread badges, compact navigation, keyboard, personal markers, persistence, tab synchronization, mobile sizes and light theme.');
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  rmSync(temp, { recursive: true, force: true });
}
