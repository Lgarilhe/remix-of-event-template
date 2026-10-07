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
import { useId, useRef, useState } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { ChevronDown, Sparkles } from 'lucide-react';
import type { SequenceStep } from '@/types/sequence';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { WRITING_SETTINGS_TITLE, WritingSettingsEditor } from '@/components/ai/WritingSettingsLine';
import { useSequenceAI } from '@/hooks/useSequenceAI';
import { useAICredits } from '@/hooks/useAICredits';
import { useWritingPreferences } from '@/hooks/useWritingPreferences';
import {
  DEFAULT_AI_LEVEL,
  clampLevel,
  isAiLevel,
  levelLimitSentence,
  styleSummary,
  type AiLevel,
} from '@/lib/writingStyle';
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
  type AskAiWriting,
} from '@/lib/sequenceDraft';

/** Ce que le panneau d'étape sait pour demander une proposition. */
export interface AskAIContext {
  organizationId: string | null;
  /** Mission de la séquence ; sans elle, rien à rédiger à partir d'un poste. */
  missionId: string | null;
  /** Poste assez décrit pour rédiger (canScoreProfiles). */
  jobDescribed: boolean;
  /**
   * Style et niveau choisis pour l'éditeur ouvert (lot 5e-2), tenus par
   * StepsEditor : null tant que la personne garde ses réglages par défaut.
   */
  writing?: AskAiWriting | null;
  onWritingChange?: (next: AskAiWriting) => void;
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
  const { prefs, choices, refetch: refetchPrefs } = useWritingPreferences();
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** « Modifier » choisi : les réglages s'ouvrent une fois le menu refermé (sinon il reprendrait le focus et les fermerait). */
  const openSettingsRef = useRef(false);
  /** Bouton « Demander à l'IA » : les réglages, ouverts sans déclencheur propre, lui rendent le focus à la fermeture. */
  const triggerRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const settingsTitleId = `${uid}-reglages`;
  const levelLabelId = `${uid}-niveau`;
  // Réglages de cette rédaction : ceux de l'éditeur ouvert, sinon les défauts
  // de la personne et de l'organisation ; tant qu'ils ne sont pas lus, rien
  // n'est envoyé (le serveur applique les défauts).
  const writing: AskAiWriting | null = context.writing
    ? { style: context.writing.style, level: prefs ? clampLevel(context.writing.level, prefs) : context.writing.level }
    : prefs ? { style: prefs.style, level: prefs.defaultLevel } : null;
  const level: AiLevel = writing?.level ?? DEFAULT_AI_LEVEL;
  const rewriteChoices = choices('rewrite_text');
  const setWriting = (next: AskAiWriting) => context.onWritingChange?.(next);
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
      const outcome = await draft(briefDraftRequestBody(context.organizationId, context.missionId, slot, writing));
      if (outcome.status === 'error') {
        if (outcome.error.kind === 'credits') setCreditsNeeded(draftCostEstimate(level));
        // Niveau refusé (plafond abaissé entre-temps) : réglages relus, le niveau affiché redescend.
        if (outcome.error.kind === 'level') void refetchPrefs();
        const message = outcome.error.kind === 'credits' ? ASK_AI_NO_CREDITS
          : outcome.error.kind === 'thin' || outcome.error.kind === 'level' ? outcome.error.message
          : ASK_AI_UNAVAILABLE;
        settle({ versionId, label, status: 'error', message });
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
      writing,
    }));
    if (outcome.status === 'error') {
      if (outcome.kind === 'credits') setCreditsNeeded(askAiCostEstimate(level));
      if (outcome.kind === 'level') void refetchPrefs();
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

  const limit = prefs ? levelLimitSentence(prefs.maxLevel) : null;
  return (
    <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DropdownMenu>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <Button ref={triggerRef} type="button" variant="ghost" size="xs" disabled={busy || !context.organizationId || !slot} className="max-md:h-11">
              <Sparkles aria-hidden="true" />
              Demander à l’IA
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent
          align="end"
          collisionPadding={8}
          // Hauteur bornée à la place disponible : à 360 px, le menu défile au lieu de sortir de l'écran.
          className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-72 overflow-y-auto"
          onCloseAutoFocus={(event) => {
            if (!openSettingsRef.current) return;
            openSettingsRef.current = false;
            event.preventDefault();
            setSettingsOpen(true);
          }}
        >
          {/* Style de cette rédaction : « Modifier » ouvre les réglages, ancrés sur le bouton. */}
          <DropdownMenuItem disabled={!writing || !context.onWritingChange} onSelect={() => { openSettingsRef.current = true; }} className="items-start max-md:min-h-11">
            <span className="min-w-0 text-sm">
              Style : {writing ? `${styleSummary(writing.style)}.` : 'vos réglages par défaut.'}
              {writing && context.onWritingChange && <>{' '}<span className="text-muted-foreground underline underline-offset-2">Modifier</span></>}
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {ASK_AI_ACTIONS.filter((a) => a.id !== 'brief').map((a) => (
            <DropdownMenuItem key={a.id} disabled={!text.trim()} onSelect={() => { void run(a.id, a.label); }} className="max-md:min-h-11">
              {a.label}
            </DropdownMenuItem>
          ))}
          {!text.trim() && <p className="px-2 pb-1 text-xs text-muted-foreground">Écrivez d’abord un texte à retoucher.</p>}
          {/* Coût des seules retouches, juste sous elles, par niveau : la rédaction à partir du poste annonce le sien. */}
          <DropdownMenuSeparator />
          <DropdownMenuLabel id={levelLabelId} className="font-medium">Niveau de l’IA, coût d’une retouche</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            aria-labelledby={levelLabelId}
            value={level}
            onValueChange={(next) => { if (writing && isAiLevel(next)) setWriting({ ...writing, level: next }); }}
          >
            {rewriteChoices.filter((c) => c.allowed).map((c) => (
              <DropdownMenuRadioItem
                key={c.id}
                value={c.id}
                disabled={!writing || !context.onWritingChange}
                // Le menu reste ouvert : le choix du niveau précède la retouche.
                onSelect={(event) => event.preventDefault()}
                className="max-md:min-h-11"
              >
                {c.label}, {aboutCreditsLabel(c.credits)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {limit && <p className="px-2 py-1 text-xs text-muted-foreground">{limit}</p>}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!!briefReason} onSelect={() => { void run('brief', 'Rédiger à partir du poste'); }} className="items-start max-md:min-h-11">
            <span className="min-w-0">
              Rédiger à partir du poste
              <span className="block text-xs text-muted-foreground">{briefReason ?? aboutCreditsLabel(draftCostEstimate(level))}</span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {writing && prefs && (
        <PopoverContent
          align="end"
          collisionPadding={8}
          aria-labelledby={settingsTitleId}
          // Pas de déclencheur propre (fenêtre ancrée) : le focus revient au bouton « Demander à l'IA ».
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
          className="max-h-[min(var(--radix-popover-content-available-height),40rem)] w-[min(calc(100vw-2rem),27rem)] overflow-y-auto"
        >
          <p id={settingsTitleId} className="mb-3 text-sm font-semibold text-foreground">{WRITING_SETTINGS_TITLE}</p>
          <WritingSettingsEditor
            value={writing}
            onChange={setWriting}
            defaultStyle={prefs.style}
            choices={rewriteChoices}
            maxLevel={prefs.maxLevel}
            // Coûts d'une retouche : « Rédiger à partir du poste » annonce le sien dans le menu.
            levelCreditsSuffix="par retouche"
          />
        </PopoverContent>
      )}
    </Popover>
  );
}
