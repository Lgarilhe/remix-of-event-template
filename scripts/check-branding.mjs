#!/usr/bin/env node
/**
 * check-branding.mjs — garde-fou de la règle CLAUDE.md « vendor names NEVER user-facing ».
 *
 * Heuristique (pas un analyseur sémantique) : signale les noms de fournisseurs
 * qui apparaissent dans des STRINGS ou du TEXTE JSX, càd les endroits qu'un
 * utilisateur final peut lire. Pour rester à faible taux de faux positifs, on
 * ne matche que la forme CAPITALISÉE (le branding user-facing capitalise la
 * marque — « Unipile », « Anthropic Claude ») ; les usages internes autorisés
 * par CLAUDE.md sont en minuscule et donc ignorés :
 *   - identifiants (invokeUnipile, apolloData), unions de type ('apollo' | 'pdl')
 *   - noms d'edge functions kebab ('unipile-search'), slugs de provider
 *   - imports / `from '...'`, commentaires (`//`, `*`), `console.*`
 *   - URLs / domaines (logo.clearbit.com…)
 *
 * Exit 1 s'il reste des occurrences à revoir. Destiné au security-reviewer et à la CI.
 * Usage: node scripts/check-branding.mjs [chemins...]   (défaut: src)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const VENDORS = ["Unipile", "Apollo", "People Data Labs", "PDL", "Brandfetch", "Clearbit", "Logo.dev", "Resend", "Anthropic"];
// Fichiers où la mention est légalement obligatoire (RGPD art. 28).
const ALLOW_FILES = [/\/privacy/i, /\/privacy-extension/i];
const EXTS = new Set([".ts", ".tsx"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (EXTS.has(extname(p))) out.push(p);
  }
  return out;
}

// Extrait les segments "lisibles par l'utilisateur" d'une ligne : contenu des
// littéraux de chaîne ('..', "..", `..`) et texte JSX entre > et <.
function readableSegments(line) {
  const segs = [];
  const strRe = /(['"`])((?:\\.|(?!\1).)*)\1/g;
  let m;
  while ((m = strRe.exec(line))) segs.push(m[2]);
  const jsxRe = />([^<>{}]*[A-Za-zÀ-ÿ]{2,}[^<>{}]*)</g;
  while ((m = jsxRe.exec(line))) segs.push(m[1]);
  return segs;
}

const findings = [];
const roots = process.argv.slice(2).length ? process.argv.slice(2) : ["src"];
const files = roots.flatMap((r) => (statSync(r).isDirectory() ? walk(r) : [r]));

for (const file of files) {
  if (ALLOW_FILES.some((re) => re.test(file))) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith("import ") || line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) return;
    if (/console\.(log|warn|error|info|debug)/.test(line)) return;
    for (const seg of readableSegments(line)) {
      if (/https?:\/\//.test(seg)) continue; // URL → interne (fetch de logo, endpoint…)
      for (const vendor of VENDORS) {
        // Case-sensitive : on ne veut que la forme capitalisée (marque user-facing),
        // pas les slugs/enums/identifiants en minuscule (usages internes autorisés).
        const re = new RegExp(`\\b${vendor.replace(/[.]/g, "\\.")}\\b`);
        const hit = re.exec(seg);
        if (!hit) continue;
        const after = seg[hit.index + hit[0].length] || "";
        const before = seg[hit.index - 1] || "";
        if (/[-_A-Za-z0-9]/.test(after) || /[-_A-Za-z0-9.]/.test(before)) continue; // identifiant/kebab/domaine interne
        findings.push({ file, line: i + 1, vendor, text: seg.trim().slice(0, 80) });
      }
    }
  });
}

if (findings.length === 0) {
  console.log("✓ Branding OK — aucun nom de fournisseur dans du texte user-facing.");
  process.exit(0);
}
console.error(`✗ Branding — ${findings.length} occurrence(s) à revoir (règle CLAUDE.md) :\n`);
for (const f of findings) console.error(`  ${f.file}:${f.line}  [${f.vendor}]  « ${f.text} »`);
console.error("\nRemplace par un libellé Konekt (LinkedIn / Base Konekt / IA Konekt) ou, si c'est un usage interne (identifiant, nom de fonction), ignore-le. Exceptions légales: /privacy.");
process.exit(1);
