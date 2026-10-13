/**
 * Verrou des tests autour de rgpd-purge, contre la stack locale.
 *
 * Un passage réel ({"dry_run": false}) supprime dans toute la base ce qui
 * dépasse ses fenêtres (24 mois, 12 mois après un écart, 6 mois pour une
 * transcription), quelle que soit l'organisation. Un test qui lance un passage
 * réel, ou qui vieillit des données au-delà de ces fenêtres puis les vérifie,
 * fait ce passage ou ce contrôle sous ce verrou : sinon un autre worker peut
 * supprimer ses données entre la mise en place et la vérification
 * (fullyParallel et plusieurs workers en local).
 *
 * Les workers de Playwright sont des processus de la même machine : le verrou
 * est un dossier du répertoire temporaire, créé de façon atomique. Un dossier
 * plus vieux que STALE_MS est celui d'un worker arrêté en cours de route.
 */
import { mkdir, rm, stat } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOCK_DIR = join(tmpdir(), 'konekt-e2e-rgpd-purge.lock');
// Bien au-delà d'un passage de la fonction (quelques secondes, 60 s au plus).
const STALE_MS = 90_000;

let held = false;
process.once('exit', () => {
  if (held) rmSync(LOCK_DIR, { recursive: true, force: true });
});

export async function withRgpdPurgeLock<T>(fn: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      await mkdir(LOCK_DIR);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const since = await stat(LOCK_DIR).then((s) => Date.now() - s.mtimeMs, () => 0);
      if (since > STALE_MS) await rm(LOCK_DIR, { recursive: true, force: true });
      else await new Promise((r) => setTimeout(r, 200));
    }
  }
  held = true;
  try {
    return await fn();
  } finally {
    held = false;
    await rm(LOCK_DIR, { recursive: true, force: true });
  }
}
