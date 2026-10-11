import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

/** Same production-component bundle pattern and identity/transport fixtures
 * as inbox-loading. Every request is intercepted in the Playwright spec. */
export async function sourcingFiltersHarnessHtml() {
  const root = process.cwd();
  const fixture = path.join(root, 'e2e/fixtures/sourcing-filters');
  const mocks = path.join(root, 'e2e/fixtures/inbox-loading/mocks.tsx');
  const result = await build({
    entryPoints: [path.join(fixture, 'main.tsx')], bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic',
    define: {
      'process.env.NODE_ENV': '"production"',
      'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: '/qa-api', VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture-only' }),
    },
    loader: { '.svg': 'dataurl', '.webp': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl' },
    alias: {
      '@/integrations/supabase/client': mocks,
      '@/hooks/useOrganization': mocks,
      '@': path.join(root, 'src'),
    },
  });
  const css = await postcss([tailwindcss({ config: path.join(root, 'tailwind.config.ts') })])
    .process(await readFile(path.join(root, 'src/index.css'), 'utf8'), { from: path.join(root, 'src/index.css') });
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sourcing QA</title><style>${css.css}</style></head><body><div id="root"></div><script>${result.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
}
