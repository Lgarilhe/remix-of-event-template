/**
 * Passe texte (lot 10) : repère le tutoiement et le franglais dans les textes
 * visibles de src/, fichier par fichier (patron visibleStrings des tests UX).
 * Des faux positifs restent possibles (« ton » pour le ton d'un message) :
 * la liste guide la relecture, elle ne la remplace pas.
 *
 *   node scripts/design/texts.mjs [nombre de fichiers affichés]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const walk = (dir) => readdirSync(join(ROOT, dir)).flatMap((n) => {
  const rel = `${dir}/${n}`;
  if (n === 'node_modules' || n.startsWith('__')) return [];
  return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : /\.(tsx|ts)$/.test(n) && !/\.d\.ts$/.test(n) ? [rel] : [];
});
const visible = (src) => {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
    .replace(/\bfrom\s+(['"])[^'"\n]*\1/g, '').replace(/^\s*import\s+(['"])[^'"\n]*\1/gm, '');
  return [
    ...[...code.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]),
    ...[...code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]),
    ...[...code.matchAll(/`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1]),
    ...[...code.matchAll(/>([^<>{}=;]*[A-Za-zÀ-ÿ][^<>{}=;]*)(?=[<{])/g)].map((m) => m[1].trim()),
  ].filter((t) => /[a-zà-ÿ]{3}/i.test(t) && /\s/.test(t));
};
const TU = /\b(tu|ton|ta|tes|toi|t'as|tu as)\b|\b(Clique|Sélectionne|Crée|Vérifie|Réessaie|Relance-le|Ajoute|Choisis|Saisis|Lance|Reconnecte-toi|Recharge|Active|Désactive|Écris|Pose|Décris|Dépose|Glisse|Lâche|Renseigne|Connecte)\b(?!-vous)/;
const FR = /\b(step|steps|preview|previews|enrollment|enrollments|enrolled|template|templates|trigger|triggers|sender|senders|timeout|analytics|funnel|workflow|batch|skipp|Strong Yes|No Go|Go\b|CTA|red flags?|deal-breakers?|Must-have|Nice-to-have|Should-have)\b/i;
const files = walk('src');
const out = {};
for (const f of files) {
  const texts = visible(readFileSync(join(ROOT, f), 'utf8'));
  const tu = texts.filter((t) => TU.test(t) && !/^[a-z_]+$/.test(t));
  const fr = texts.filter((t) => FR.test(t) && !/^[a-z_.-]+$/.test(t) && !/className|https?:/.test(t));
  if (tu.length || fr.length) out[f] = { tu: tu.length, fr: fr.length, ex: [...tu, ...fr].slice(0, 3) };
}
const rows = Object.entries(out).sort((a, b) => (b[1].tu + b[1].fr) - (a[1].tu + a[1].fr));
let T = 0, F = 0;
for (const [f, v] of rows) { T += v.tu; F += v.fr; }
console.log(`fichiers ${rows.length}, tutoiement ${T}, franglais ${F}`);
for (const [f, v] of rows.slice(0, Number(process.argv[2] || 60))) console.log(`${String(v.tu).padStart(3)} ${String(v.fr).padStart(3)}  ${f}  | ${v.ex.map((e) => e.slice(0, 60)).join(' | ')}`);
