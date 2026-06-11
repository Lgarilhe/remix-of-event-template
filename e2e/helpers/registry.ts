/** Accès au registre des rôles produit par global.setup.ts. */
import fs from 'node:fs';
import path from 'node:path';

export interface RoleEntry {
  file: string;
  orgId: string;
  userId: string;
  email: string;
  password: string;
}

export type RoleName = 'agencyOwner' | 'enterpriseAdmin' | 'freelance' | 'orgBOwner';

const REGISTRY = path.join(__dirname, '..', '.auth', 'registry.json');

export function loadRegistry(): Record<RoleName, RoleEntry> {
  if (!fs.existsSync(REGISTRY)) {
    throw new Error('[e2e] registry.json absent — le projet `setup` a-t-il bien tourné ?');
  }
  return JSON.parse(fs.readFileSync(REGISTRY, 'utf-8'));
}

export function role(name: RoleName): RoleEntry {
  return loadRegistry()[name];
}

export function storageStateFor(name: RoleName): string {
  return path.join(__dirname, '..', '.auth', role(name).file);
}
