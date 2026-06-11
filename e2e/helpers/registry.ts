/** Accès au registre des rôles produit par global.setup.ts. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface RoleEntry {
  file: string;
  orgId: string;
  userId: string;
  email: string;
  password: string;
}

export type RoleName = 'agencyOwner' | 'enterpriseAdmin' | 'freelance' | 'orgBOwner';

const REGISTRY = path.join(__dirname, '..', '.auth', 'registry.json');

/**
 * Mapping rôle → fichier storageState. STATIQUE et dupliqué sciemment depuis
 * global.setup.ts : `storageStateFor()` est appelé dans `test.use(...)`, donc
 * au CHARGEMENT des specs — avant que le projet `setup` n'ait écrit
 * registry.json. Le chemin doit être calculable sans I/O ; Playwright ne lit
 * le fichier qu'à la création du contexte (après setup).
 */
const ROLE_FILES: Record<RoleName, string> = {
  agencyOwner: 'agency-owner.json',
  enterpriseAdmin: 'enterprise-admin.json',
  freelance: 'freelance.json',
  orgBOwner: 'org-b-owner.json',
};

export function loadRegistry(): Record<RoleName, RoleEntry> {
  if (!fs.existsSync(REGISTRY)) {
    throw new Error('[e2e] registry.json absent — le projet `setup` a-t-il bien tourné ?');
  }
  return JSON.parse(fs.readFileSync(REGISTRY, 'utf-8'));
}

/** Données du rôle (orgId/userId/email…) — à appeler DANS un test, jamais au top-level. */
export function role(name: RoleName): RoleEntry {
  return loadRegistry()[name];
}

/** Chemin du storageState — safe au chargement des specs (aucune lecture du registre). */
export function storageStateFor(name: RoleName): string {
  return path.join(__dirname, '..', '.auth', ROLE_FILES[name]);
}
