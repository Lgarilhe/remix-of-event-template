import { PersonAvatar } from '@/components/ui/person-avatar';
import type { RecruiterRef } from '@/lib/callRecruiter';

/**
 * Le recruteur d'un appel : ses initiales et son nom. Un agent de l'opérateur
 * qui n'est pas reconnu comme membre de l'équipe s'affiche sous son nom
 * d'opérateur, avec une infobulle qui le dit.
 */
export const RecruiterTag = ({ recruiter, size = 20 }: { recruiter: RecruiterRef; size?: number }) => (
  <span
    className="inline-flex min-w-0 items-center gap-1.5 text-xs text-foreground-secondary"
    title={recruiter.isMember ? undefined : "Utilisateur du compte Aircall, non reconnu comme membre de l'équipe Konekt"}
  >
    <PersonAvatar name={recruiter.name} size={size} />
    <span className="truncate">{recruiter.name}</span>
  </span>
);
