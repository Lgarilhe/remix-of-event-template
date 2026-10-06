import { Mic, Tag } from 'lucide-react';
import { CallInsightSection } from '@/components/calls/CallInsightSection';
import { RecruiterTag } from '@/components/calls/RecruiterTag';
import { Button } from '@/components/ui/button';
import { PersonAvatar } from '@/components/ui/person-avatar';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { RecruiterRef } from '@/lib/callRecruiter';
import { callStatusLabel } from '@/lib/phoneCallFilters';
import { formatPhoneNumber } from '@/lib/phoneCallGroups';
import { formatTalkTime } from '@/lib/phoneCallStats';
import type { AttachedCandidate, PhoneCall } from '@/lib/phoneCalls';

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="text-sm text-foreground">{children}</dd>
  </div>
);

/**
 * Le détail d'un appel : qui, quand, combien de temps, ce que le recruteur en
 * a noté, l'enregistrement, puis l'analyse de la transcription (lot A5). Un
 * numéro qui n'est pas rattaché propose de le faire.
 */
export const CallDetailSheet = ({
  call,
  attached,
  recruiter,
  title,
  onOpenChange,
  onAttach,
}: {
  call: PhoneCall | null;
  attached: AttachedCandidate | undefined;
  recruiter: RecruiterRef | null;
  title: string;
  onOpenChange: (open: boolean) => void;
  /** Absent : le numéro est masqué, rien à rattacher. */
  onAttach?: () => void;
}) => {
  const number = call?.numberE164 ? formatPhoneNumber(call.numberE164) : null;
  const when = call?.startedAt
    ? new Date(call.startedAt).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    : 'Date inconnue';

  return (
    <Sheet open={call !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {call && (
          <>
            <SheetHeader className="space-y-1 text-left">
              <div className="flex items-center gap-3">
                {attached && <PersonAvatar name={attached.name ?? title} src={attached.avatarUrl} candidateId={attached.candidateId} size={40} />}
                <SheetTitle className="min-w-0 truncate text-lg">{title}</SheetTitle>
              </div>
              <SheetDescription>{when}</SheetDescription>
            </SheetHeader>

            <dl className="mt-6 space-y-5">
              <Row label="Appel">
                {callStatusLabel(call)}
                {call.talkSeconds > 0 ? ` · ${formatTalkTime(call.talkSeconds)} de conversation` : ''}
              </Row>
              {number && <Row label="Numéro">{number}</Row>}
              {recruiter && (
                <Row label="Recruteur">
                  <RecruiterTag recruiter={recruiter} size={22} />
                </Row>
              )}
              <Row label="Candidat">
                {attached ? (
                  <span>{attached.name ?? 'Candidat rattaché'}</span>
                ) : (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">Numéro non rattaché</span>
                    {onAttach && (
                      <Button type="button" variant="secondary" size="sm" onClick={onAttach}>
                        Rattacher
                      </Button>
                    )}
                  </span>
                )}
              </Row>
              {call.notes && (
                <Row label="Notes">
                  <span className="whitespace-pre-wrap">{call.notes}</span>
                </Row>
              )}
              {call.tags.length > 0 && (
                <Row label="Étiquettes">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    {call.tags.map((t) => (
                      <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-xs">{t}</span>
                    ))}
                  </span>
                </Row>
              )}
              {(call.recordingUrl || call.voicemailUrl) && (
                <Row label="Écoute">
                  <span className="flex flex-wrap gap-2">
                    {call.recordingUrl && (
                      <Button type="button" variant="outline" size="sm" asChild>
                        <a href={call.recordingUrl} target="_blank" rel="noopener noreferrer"><Mic aria-hidden="true" />Enregistrement</a>
                      </Button>
                    )}
                    {call.voicemailUrl && (
                      <Button type="button" variant="outline" size="sm" asChild>
                        <a href={call.voicemailUrl} target="_blank" rel="noopener noreferrer"><Mic aria-hidden="true" />Message vocal</a>
                      </Button>
                    )}
                  </span>
                </Row>
              )}
            </dl>

            <CallInsightSection key={call.id} call={call} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};
