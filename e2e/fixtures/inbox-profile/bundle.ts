import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
/** Actual profile UI and query hook; only identity and network are simulated. */
export async function profileHarnessHtml(sourceOverrides: Record<string, string> = {}) {
  const root = process.cwd();
  const fixtures = path.join(root, 'e2e/fixtures/inbox-profile');
  const mocks = ['integrations/supabase/client', 'hooks/useAuthReady', 'hooks/useOrganization', 'contexts/LinkedInAccountsContext', 'hooks/useMemberLinkedInAccounts'];
  const result = await build({
    entryPoints: [path.join(fixtures, 'main.tsx')], bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
    loader: { '.svg': 'dataurl', '.webp': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl' },
    alias: { ...Object.fromEntries(mocks.map(name => ['@/' + name, path.join(fixtures, 'mocks.tsx')])), '@': path.join(root, 'src') },
    plugins: [{ name: 'baseline-source', setup(builder) {
      builder.onLoad({ filter: /\.(ts|tsx)$/ }, async args => sourceOverrides[args.path] ? { contents: await readFile(sourceOverrides[args.path], 'utf8'), loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: path.dirname(args.path) } : undefined);
    } }],
  });
  const css = await postcss([tailwindcss({ config: path.join(root, 'tailwind.config.ts') })]).process(await readFile(path.join(root, 'src/index.css'), 'utf8'), { from: path.join(root, 'src/index.css') });
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Profil candidat QA</title><style>${css.css}</style></head><body><div id="root"></div><script>${result.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
}
