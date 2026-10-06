// « Demander à l'IA » dans le panneau d'une étape (lot 5e), derrière
// l'interrupteur konekt.sequences-v2 : Raccourcir, Plus direct, Plus
// chaleureux, Ajouter une accroche sur le parcours, Corriger l'orthographe
// (text-action, contexte séquence : vouvoiement imposé, proposition contrôlée
// par le serveur), et Rédiger à partir du poste (draft-sequence, le texte de
// l'emplacement de l'étape). La proposition s'affiche dans « Proposition de
// l'IA » (AIProposal) ; le texte de l'étape ne change qu'au clic sur
// « Remplacer ». Après un refus faute de crédits, « Crédits insuffisants »
// reste affiché tant que le solde relu ne couvre pas la demande : une recharge
// le lève, sur toutes les étapes.
import { useRef, useState } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { ChevronDown, Sparkles } from 'lucide-react';
import type { SequenceStep } from '@/types/sequence';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSequenceAI } from '@/hooks/useSequenceAI';
import { useAICredits } from '@/hooks/useAICredits';
import {
  AI_DRAFT_NOT_DESCRIBED,
  ASK_AI_ACTIONS,
  ASK_AI_NO_CREDITS,
  ASK_AI_UNAVAILABLE,
  aboutCreditsLabel,
  askAiCostEstimate,
  briefDraftRequestBody,
  briefRefusalMessage,
  draftCostEstimate,
  draftTextForSlot,
  stepSlot,
  textActionBody,
  type AskAiAction,
} from '@/lib/sequenceDraft';

/** Ce que le panneau d'étape sait pour demander une proposition. */
export interface AskAIContext {
  organizationId: string | null;
  /** Mission de la séquence ; sans elle, rien à rédiger à partir d'un poste. */
  missionId: string | null;
  /** Poste assez décrit pour rédiger (canScoreProfiles). */
  jobDescribed: boolean;
}

/** État de « Proposition de l'IA », rattaché à une version d'étape. */
export type AskAIProposal =
  | { versionId: string; label: string; status: 'loading' }
  | { versionId: string; label: string; status: 'error'; message: string }
  | { versionId: string; label: string; status: 'ready'; text: string; subject: string | null; warnings: string[]; credits: number | null };

interface AskAIMenuProps {
  context: AskAIContext;
  steps: readonly SequenceStep[];
  /** Version dont le texte est retouché. */
  version: SequenceStep;
  onProposal: (proposal: AskAIProposal) => void;
  busy: boolean;
}

export function AskAIMenu({ context, steps, version, onProposal, busy }: AskAIMenuProps) {
  const { draft, propose } = useSequenceAI(context.organizationId);
  const { creditsRemaining, hasBalance } = useAICredits();
  const creditsFetching = useIsFetching({ queryKey: ['ai-credits', context.organizationId] }) > 0;
  /** Crédits de la demande refusée faute de solde ; null tant qu'aucun refus. */
  const [creditsNeeded, setCreditsNeeded] = useState<number | null>(null);
  // Solde relu (useSequenceAI l'invalide après chaque appel) : le refus tient tant qu'il ne couvre pas la demande.
  const noCredits = creditsNeeded !== null && (creditsFetching || !hasBalance || creditsRemaining < creditsNeeded);
  const requestRef = useRef(0);
  const text = version.messageTemplate ?? '';
  const slot = stepSlot(steps, version.id);
  const briefReason = !context.missionId
    ? 'Rattachez la séquence à une mission pour rédiger à partir de son poste.'
    : !context.jobDescribed ? AI_DRAFT_NOT_DESCRIBED : null;

  const run = async (action: AskAiAction, label: string) => {
    if (!context.organizationId || !slot) return;
    const request = ++requestRef.current;
    const versionId = version.id;
    onProposal({ versionId, label, status: 'loading' });
    const settle = (proposal: AskAIProposal) => {
      if (request === requestRef.current) onProposal(proposal);
    };
    if (action === 'brief') {
      if (!context.missionId) return;
      const outcome = await draft(briefDraftRequestBody(context.organizationId, context.missionId, slot));
      if (outcome.status === 'error') {
        if (outcome.error.kind === 'credits') setCreditsNeeded(draftCostEstimate());
        settle({ versionId, label, status: 'error', message: outcome.error.kind === 'credits' ? ASK_AI_NO_CREDITS : outcome.error.kind === 'thin' ? outcome.error.message : ASK_AI_UNAVAILABLE });
        return;
      }
      const picked = draftTextForSlot(outcome.result, slot.slot);
      if (!picked || !picked.body.trim()) {
        settle({ versionId, label, status: 'error', message: briefRefusalMessage(picked?.toWrite ?? []) });
        return;
      }
      settle({
        versionId,
        label,
        status: 'ready',
        text: picked.body,
        subject: version.actionType === 'inmail' && picked.subject.trim() ? picked.subject : null,
        warnings: picked.toReview,
        credits: outcome.result.creditsUsed,
      });
      return;
    }
    const outcome = await propose(textActionBody(action, {
      organizationId: context.organizationId,
      missionId: context.missionId,
      text,
      actionType: version.actionType,
      isFirstMessage: slot.isFirstMessage,
    }));
    if (outcome.status === 'error') {
      if (outcome.kind === 'credits') setCreditsNeeded(askAiCostEstimate());
      settle({ versionId, label, status: 'error', message: outcome.message });
      return;
    }
    settle({ versionId, label, status: 'ready', text: outcome.text, subject: null, warnings: outcome.warnings, credits: outcome.creditsUsed });
  };

  if (noCredits) {
    return (
      <Button type="button" variant="ghost" size="xs" disabled className="max-md:h-11">
        <Sparkles aria-hidden="true" />
        {ASK_AI_NO_CREDITS}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="xs" disabled={busy || !context.organizationId || !slot} className="max-md:h-11">
          <Sparkles aria-hidden="true" />
          Demander à l’IA
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {ASK_AI_ACTIONS.filter((a) => a.id !== 'brief').map((a) => (
          <DropdownMenuItem key={a.id} disabled={!text.trim()} onSelect={() => { void run(a.id, a.label); }} className="max-md:min-h-11">
            {a.label}
          </DropdownMenuItem>
        ))}
        {!text.trim() && <p className="px-2 pb-1 text-xs text-muted-foreground">Écrivez d’abord un texte à retoucher.</p>}
        {/* Coût des seules retouches, juste sous elles : la rédaction à partir du poste annonce le sien. */}
        <p className="px-2 py-1 text-xs text-muted-foreground">Retouches : {aboutCreditsLabel(askAiCostEstimate())} par proposition.</p>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!!briefReason} onSelect={() => { void run('brief', 'Rédiger à partir du poste'); }} className="items-start max-md:min-h-11">
          <span className="min-w-0">
            Rédiger à partir du poste
            <span className="block text-xs text-muted-foreground">{briefReason ?? aboutCreditsLabel(draftCostEstimate())}</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
