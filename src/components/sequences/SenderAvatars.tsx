// Expéditeurs d'une séquence (lot 5c-2) : visages des membres dont le compte
// LinkedIn envoie, trois au plus puis « +N ». Initiales tant que les photos
// des membres ne sont pas lues (PersonAvatar).
import { AvatarStack } from '@/components/ui/person-avatar';

export function SenderAvatars({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return <AvatarStack people={names.map((name) => ({ name }))} size={24} max={3} />;
}
