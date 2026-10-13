// Aides communes des tests de la connexion des comptes (tests/ux/connexion-*.test.mjs).
// Ce fichier n'est pas un test : node --test ne lit que *.test.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Charge un module TypeScript du front (avec ses imports « @/ » résolus par le
 * tsconfig) en mémoire, sans fichier intermédiaire ni navigateur.
 */
export async function loadTs(rel) {
  const { outputFiles } = await build({
    stdin: { contents: `export * from './${rel}';`, resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    tsconfig: join(ROOT, 'tsconfig.app.json'),
    external: ['react', 'react-dom', '@tanstack/react-query', 'react-router-dom'],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}

/** Retire les commentaires d'un fichier source (pour juger le code, pas la prose). */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}
