// « Proposition de l'IA » sous le texte d'une étape (lot 5e) : la proposition
// de « Demander à l'IA », ses formulations à relire, [Remplacer], [Garder ma
// version] et le coût. Le texte de l'étape ne change qu'au clic sur
// « Remplacer ».
import { AlertTriangle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { creditsLabel } from '@/lib/sequenceDraft';
import { templateSegments } from '@/lib/sequenceVariables';
import type { AskAIProposal } from './AskAIMenu';

interface AIProposalProps {
  proposal: AskAIProposal;
  onReplace: (next: { text: string; subject: string | null }) => void;
  onDismiss: () => void;
}

/** « À relire : … » du serveur : le titre le dit déjà. */
const reviewText = (message: string) => message.replace(/^À relire\s*:\s*/, '');

/** Variables affichées en puces françaises, comme dans le texte de l'étape. */
function WithChips({ text }: { text: string }) {
  return (
    <>
      {templateSegments(text).map((s, i) => (s.kind === 'text'
        ? <span key={i}>{s.text}</span>
        : <span key={i} className="rounded-sm bg-brand/15 px-0.5 font-medium">{s.variable.label ?? s.variable.raw}</span>))}
    </>
  );
}

export function AIProposal({ proposal, onReplace, onDismiss }: AIProposalProps) {
  return (
    <section aria-label="Proposition de l’IA" aria-busy={proposal.status === 'loading' || undefined} className="space-y-2.5 rounded-lg border border-border bg-muted/40 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        Proposition de l’IA
        <span className="font-normal text-muted-foreground">· {proposal.label}</span>
      </p>

      {proposal.status === 'loading' && (
        <div role="status" aria-label="Proposition en cours" className="space-y-1.5">
          <Skeleton className="h-3.5 w-full rounded-sm" />
          <Skeleton className="h-3.5 w-11/12 rounded-sm" />
          <Skeleton className="h-3.5 w-2/3 rounded-sm" />
        </div>
      )}

      {proposal.status === 'error' && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-foreground">{proposal.message}</p>
          <Button type="button" variant="ghost" size="xs" onClick={onDismiss} className="-ml-2 max-md:h-11">Fermer</Button>
        </div>
      )}

      {proposal.status === 'ready' && (
        <>
          {proposal.subject && <p className="text-sm text-muted-foreground">Objet : <WithChips text={proposal.subject} /></p>}
          <p className="whitespace-pre-wrap break-words text-sm text-foreground"><WithChips text={proposal.text} /></p>
          {proposal.warnings.length > 0 && (
            <ul aria-label="À relire" className="space-y-1">
              {proposal.warnings.map((w) => (
                <li key={w} className="flex items-start gap-1.5 text-xs text-warning">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  À relire : {reviewText(w)}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="xs" onClick={() => onReplace({ text: proposal.text, subject: proposal.subject })} className="max-md:h-11">
              Remplacer
            </Button>
            <Button type="button" variant="ghost" size="xs" onClick={onDismiss} className="max-md:h-11">
              Garder ma version
            </Button>
            {proposal.credits !== null && proposal.credits > 0 && (
              <span className="text-xs text-muted-foreground">{creditsLabel(proposal.credits)}</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
