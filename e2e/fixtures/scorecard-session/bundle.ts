import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

/** Vraie ScorecardTab : seules les frontières base, IA et audio sont simulées. */
export async function scorecardSessionHarnessHtml() {
  const root = process.cwd();
  const fixture = path.join(root, 'e2e/fixtures/scorecard-session');
  const mocked = new Set([
    'integrations/supabase/client', 'hooks/useOrganization', 'hooks/useEnrollmentPreview',
    'lib/invokeEdgeFunction', 'lib/invokeWithCredits', 'components/ai/ModelPicker',
    'components/ats/LiveCoachingPanel',
  ].map(p => path.join(root, 'src', p)));
  const bundle = await build({
    entryPoints: [path.join(fixture, 'main.tsx')], bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
    loader: { '.svg': 'dataurl', '.webp': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl' },
    plugins: [{ name: 'scorecard-boundaries', setup(buildApi) {
      buildApi.onResolve({ filter: /^(@\/|\.)/ }, args => {
        const full = args.path.startsWith('@/') ? path.join(root, 'src', args.path.slice(2)) : path.resolve(args.resolveDir, args.path);
        if (mocked.has(full)) return { path: path.join(fixture, 'mocks.tsx') };
        return undefined;
      });
    } }],
    alias: { '@': path.join(root, 'src') },
  });
  const css = await postcss([tailwindcss({ config: path.join(root, 'tailwind.config.ts') })])
    .process(await readFile(path.join(root, 'src/index.css'), 'utf8'), { from: path.join(root, 'src/index.css') });
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Préparation de grille QA</title><style>${css.css}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
}
