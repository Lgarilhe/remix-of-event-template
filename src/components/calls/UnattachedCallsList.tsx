import { PhoneIncoming, PhoneMissed, PhoneOutgoing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RecruiterTag } from '@/components/calls/RecruiterTag';
import type { RecruiterRef } from '@/lib/callRecruiter';
import type { PhoneCall } from '@/lib/phoneCalls';
import type { UnattachedCallGroup } from '@/lib/phoneCallGroups';
import { plural } from '@/lib/plural';

const formatWhen = (iso: string | null): string => {
  if (!iso) return 'date inconnue';
  const d = new Date(iso);
  const day = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${day} à ${time}`;
};

const CallIcon = ({ call }: { call: PhoneCall }) => {
  const Icon = call.outcome === 'missed' ? PhoneMissed : call.direction === 'outbound' ? PhoneOutgoing : PhoneIncoming;
  return <Icon className="h-4 w-4" aria-hidden="true" />;
};

/** Les recruteurs distincts d'un groupe d'appels, et si certains appels n'ont été pris par personne. */
function recruitersOf(
  calls: PhoneCall[],
  resolve: (email: string | null | undefined, name: string | null | undefined) => RecruiterRef | null,
): { recruiters: RecruiterRef[]; unanswered: boolean } {
  const seen = new Map<string, RecruiterRef>();
  let unanswered = false;
  for (const call of calls) {
    const recruiter = resolve(call.agentEmail, call.agentName);
    if (!recruiter) {
      unanswered = true;
      continue;
    }
    seen.set(recruiter.userId ?? `aircall:${recruiter.name}`, recruiter);
  }
  return { recruiters: Array.from(seen.values()), unanswered };
}

/** Liste sans cadre : une ligne par numéro inconnu, avec qui l'a appelé ou rappelé. */
export const UnattachedCallsList = ({
  groups,
  resolveRecruiter,
  onAttach,
}: {
  groups: UnattachedCallGroup[];
  resolveRecruiter: (email: string | null | undefined, name: string | null | undefined) => RecruiterRef | null;
  onAttach: (group: UnattachedCallGroup) => void;
}) => (
  <ul className="divide-y divide-border">
    {groups.map((group) => {
      const { recruiters, unanswered } = recruitersOf(group.calls, resolveRecruiter);
      const title = group.contactName ?? group.displayNumber;
      return (
        <li key={group.numberE164} className="flex items-center gap-3 py-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-foreground">
            <CallIcon call={group.calls[0]} />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate text-sm font-medium text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">
              {group.contactName ? `${group.displayNumber} · ` : ''}
              {plural(group.calls.length, 'appel')}, le dernier le {formatWhen(group.lastStartedAt)}
            </p>
            {(recruiters.length > 0 || unanswered) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {recruiters.map((r) => (
                  <RecruiterTag key={r.userId ?? `aircall:${r.name}`} recruiter={r} />
                ))}
                {unanswered && <span className="text-xs text-muted-foreground">Personne n'a décroché</span>}
              </div>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 min-h-11 md:min-h-0"
            onClick={() => onAttach(group)}
            aria-label={`Rattacher ${title} à un candidat`}
          >
            Rattacher
          </Button>
        </li>
      );
    })}
  </ul>
);
