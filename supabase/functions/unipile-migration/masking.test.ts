// Libellés masqués : jamais d'adresse entière, de numéro ni de nom complet.
//
//   deno test --no-check --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/unipile-migration/masking.test.ts

import { ok, strictEqual } from 'node:assert';
import { idRef, maskLabel } from './masking.ts';

Deno.test('adresse e-mail : première lettre et domaine', () => {
  strictEqual(maskLabel('Jean.Dupont@Acme.fr'), 'j***@acme.fr');
  strictEqual(maskLabel('  a@b.co '), 'a***@b.co');
});

Deno.test('adresse mal formée : rien de lisible', () => {
  strictEqual(maskLabel('jean@'), '***');
  strictEqual(maskLabel('@acme.fr'), '***');
});

Deno.test('numéro de téléphone : aucun chiffre rendu', () => {
  for (const phone of ['+33 6 12 34 56 78', '0612345678', '+1 (415) 555-0100']) {
    const masked = maskLabel(phone) as string;
    strictEqual(masked, 'numéro masqué');
    ok(!/\d/.test(masked));
  }
});

Deno.test('nom : première lettre de chaque mot', () => {
  strictEqual(maskLabel('Jean Dupont'), 'J*** D***');
  strictEqual(maskLabel('Élodie'), 'É***');
  strictEqual(maskLabel('A B C D E F'), 'A*** B*** C*** D***');
});

Deno.test('valeurs vides ou non textuelles : null', () => {
  for (const value of [null, undefined, '', '   ', 42, {}, []]) strictEqual(maskLabel(value), null);
});

Deno.test('idRef : quatre derniers caractères seulement', () => {
  strictEqual(idRef('abcdef123456'), '…3456');
  strictEqual(idRef('ab'), '…ab');
  strictEqual(idRef(''), '…');
  strictEqual(idRef(null), '…');
});
