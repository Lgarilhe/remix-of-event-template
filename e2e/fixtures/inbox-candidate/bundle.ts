import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
/** Real Inbox and shared candidate sheet, including its business readers. */
export async function inboxCandidateHarnessHtml() {
  const root = process.cwd();
  const fixture = path.join(root, 'e2e/fixtures/inbox-candidate');
  const mocks = new Set(['integrations/supabase/client', 'hooks/useAuthReady', 'hooks/useOrganization', 'contexts/LinkedInAccountsContext', 'hooks/useMemberLinkedInAccounts'].map(name => path.join(root, 'src', name)));
  const bundle = await build({ entryPoints: [path.join(fixture, 'main.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: '/qa-candidate-api', VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture-only' }) },
    loader: { '.svg': 'dataurl', '.webp': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl' },
    plugins: [{ name: 'candidate-transport', setup(builder) {
      builder.onResolve({ filter: /^(@\/|\.)/ }, args => {
        const full = args.path.startsWith('@/') ? path.join(root, 'src', args.path.slice(2)) : path.resolve(args.resolveDir, args.path);
        return mocks.has(full) ? { path: path.join(fixture, 'mocks.tsx') } : undefined;
      });
    } }],
    alias: { '@/components/SEOHead': path.join(fixture, 'seo.tsx'), '@': path.join(root, 'src') },
  });
  const css = await postcss([tailwindcss({ config: path.join(root, 'tailwind.config.ts') })]).process(await readFile(path.join(root, 'src/index.css'), 'utf8'), { from: path.join(root, 'src/index.css') });
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fiche candidat et messagerie QA</title><style>${css.css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
}
