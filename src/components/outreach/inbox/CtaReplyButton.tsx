/**
 * CtaReplyButton — Bouton "Réponse + CTA" du composer.
 *
 * Flow UX :
 *   1. Click → Popover avec liste de CTA (Auto + 7 prédéfinis)
 *   2. Click sur un CTA → spinner inline → Dialog avec preview
 *   3. Dans le dialog : Régénérer (même CTA) ou Insérer dans le composer
 *
 * L'IA reçoit l'historique du chat + le CTA voulu (ou "auto") et génère
 * une réponse naturelle qui intègre le CTA. Pas un template figé.
 */

import React, { useState } from 'react';
import {
  Sparkles, Loader2, Calendar, Phone, FileText, Briefcase,
  HelpCircle, Users, DoorOpen, Wand2, RefreshCw, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useTextActions, type CtaType, type CtaChatMessage, type CtaReplyResult } from '@/hooks/useTextActions';

interface CtaOption {
  value: CtaType;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const CTA_OPTIONS: CtaOption[] = [
  {
    value: 'auto',
    label: 'Suggestion auto',
    description: 'L\'IA choisit le CTA le plus pertinent selon le contexte',
    icon: <Wand2 className="w-3.5 h-3.5" />,
  },
  {
    value: 'rdv',
    label: 'Proposer un RDV',
    description: 'Insère le lien Calendly de la mission',
    icon: <Calendar className="w-3.5 h-3.5" />,
  },
  {
    value: 'call',
    label: 'Appel rapide',
    description: 'Demande 15 min au téléphone, propose des créneaux',
    icon: <Phone className="w-3.5 h-3.5" />,
  },
  {
    value: 'cv',
    label: 'Demander le CV',
    description: 'Demande à recevoir CV / portfolio pour qualifier',
    icon: <FileText className="w-3.5 h-3.5" />,
  },
  {
    value: 'job_details',
    label: 'Détailler le poste',
    description: 'Propose d\'envoyer la fiche détaillée de la mission',
    icon: <Briefcase className="w-3.5 h-3.5" />,
  },
  {
    value: 'check_interest',
    label: 'Vérifier l\'intérêt',
    description: 'Relance soft sans pression — utile après silence',
    icon: <HelpCircle className="w-3.5 h-3.5" />,
  },
  {
    value: 'referral',
    label: 'Demander une reco',
    description: 'Si décline, demande s\'il connaît quelqu\'un',
    icon: <Users className="w-3.5 h-3.5" />,
  },
  {
    value: 'close',
    label: 'Clôturer poliment',
    description: 'Garde la porte ouverte pour plus tard',
    icon: <DoorOpen className="w-3.5 h-3.5" />,
  },
];

const CTA_LABEL_MAP: Record<CtaType, string> = {
  auto: 'Auto',
  rdv: 'Proposer un RDV',
  call: 'Appel rapide',
  cv: 'Demander le CV',
  job_details: 'Détailler le poste',
  check_interest: 'Vérifier l\'intérêt',
  referral: 'Demander une reco',
  close: 'Clôturer poliment',
};

export interface CtaReplyButtonProps {
  /** Historique de la conversation (passé tel quel à l'edge function). */
  chatHistory: CtaChatMessage[];
  /** Nom du candidat (display name). */
  candidateName?: string;
  /** Nom du recruteur (toi). */
  recruiterName?: string;
  /** Titre de la mission liée. */
  jobTitle?: string;
  /** Brief structuré du poste (extrait via buildJobBriefForCta). Utile
      surtout pour le CTA "Détailler le poste" qui inclut TOUTES les
      infos directement dans le message. */
  jobBrief?: Record<string, unknown>;
  /** Lien Calendly de la mission (pour CTA rdv). */
  calendlyLink?: string;
  /** Ton sélectionné dans le composer. */
  tone?: string;
  /** Callback quand l'utilisateur clique "Insérer" — reçoit le message. */
  onInsert: (message: string) => void;
  /** Désactive le bouton (typiquement quand pas de chat sélectionné). */
  disabled?: boolean;
}

export const CtaReplyButton: React.FC<CtaReplyButtonProps> = ({
  chatHistory,
  candidateName,
  recruiterName,
  jobTitle,
  jobBrief,
  calendlyLink,
  tone,
  onInsert,
  disabled = false,
}) => {
  const { ctaReply, ctaReplyLoading } = useTextActions();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [result, setResult] = useState<CtaReplyResult | null>(null);
  const [lastCta, setLastCta] = useState<CtaType>('auto');

  const isDisabled = disabled || chatHistory.length === 0;

  const handlePick = async (ctaType: CtaType) => {
    setPopoverOpen(false);
    setLastCta(ctaType);
    const res = await ctaReply({
      cta_type: ctaType,
      chat_history: chatHistory,
      candidate_name: candidateName,
      recruiter_name: recruiterName,
      job_title: jobTitle,
      job_brief: jobBrief,
      calendly_link: calendlyLink,
      tone,
    });
    if (res) {
      setResult(res);
      setDialogOpen(true);
    }
  };

  const handleRegenerate = async () => {
    const res = await ctaReply({
      cta_type: lastCta,
      chat_history: chatHistory,
      candidate_name: candidateName,
      recruiter_name: recruiterName,
      job_title: jobTitle,
      job_brief: jobBrief,
      calendly_link: calendlyLink,
      tone,
    });
    if (res) setResult(res);
  };

  const handleInsert = () => {
    if (result) {
      onInsert(result.message);
      setDialogOpen(false);
    }
  };

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isDisabled || ctaReplyLoading}
            className={cn(
              'h-7 px-2 inline-flex items-center gap-1 rounded-md text-[11px] font-medium transition-colors',
              ctaReplyLoading
                ? 'text-muted-foreground cursor-wait'
                : isDisabled
                ? 'text-muted-foreground/40 cursor-not-allowed'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
            title="Générer une réponse avec un CTA"
          >
            {ctaReplyLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            <span>Réponse + CTA</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-1" side="top" align="start">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5">
            Choisis un CTA
          </p>
          <div className="flex flex-col gap-0.5">
            {CTA_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handlePick(opt.value)}
                disabled={ctaReplyLoading}
                className="text-left flex items-start gap-2 px-2 py-1.5 rounded hover:bg-accent transition-colors disabled:opacity-50"
              >
                <span className="mt-0.5 text-muted-foreground shrink-0">{opt.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-medium text-foreground">
                    {opt.label}
                  </span>
                  <span className="block text-[10px] text-muted-foreground leading-tight mt-0.5">
                    {opt.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-foreground" />
              Suggestion de réponse
            </DialogTitle>
            <DialogDescription>
              {result?.cta_used && (
                <span className="inline-flex items-center gap-1.5 text-xs">
                  <span className="px-1.5 py-0.5 rounded bg-accent text-foreground font-medium">
                    {CTA_LABEL_MAP[result.cta_used] || result.cta_used}
                  </span>
                  {result?.reason && (
                    <span className="text-muted-foreground">— {result.reason}</span>
                  )}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {result && (
            <div className="rounded-md bg-muted/50 border border-border p-3 my-2">
              <p
                className="text-sm whitespace-pre-wrap text-foreground leading-relaxed"
                style={{ overflowWrap: 'anywhere' }}
              >
                {result.message}
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRegenerate}
              disabled={ctaReplyLoading}
            >
              {ctaReplyLoading ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              )}
              Régénérer
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleInsert}
              disabled={!result || ctaReplyLoading}
            >
              <Check className="w-3.5 h-3.5 mr-1.5" />
              Insérer dans le message
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
