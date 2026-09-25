/**
 * CtaReplyButton — « Proposer une suite », dans la barre d'outils du composeur.
 *
 * 1. Le menu propose la suite à donner à l'échange (rendez-vous, appel, CV…),
 *    ou laisse l'IA choisir.
 * 2. L'IA rédige une réponse qui amène cette suite ; elle s'affiche dans un
 *    dialogue : « Régénérer » ou « Insérer dans le message ».
 * 3. Le texte inséré se relit et se modifie dans le composeur avant l'envoi.
 */

import React, { useState } from 'react';
import {
  Briefcase, Calendar, Check, DoorOpen, FileText, HelpCircle, MessageSquareReply,
  Phone, RefreshCw, Users, Wand2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTextActions, type CtaType, type CtaChatMessage, type CtaReplyResult } from '@/hooks/useTextActions';

interface CtaOption {
  value: CtaType;
  label: string;
  description: string;
  icon: React.ElementType;
}

const CTA_OPTIONS: CtaOption[] = [
  { value: 'auto', label: 'Choix automatique', description: "L'IA choisit la suite la plus adaptée à l'échange", icon: Wand2 },
  { value: 'rdv', label: 'Proposer un rendez-vous', description: 'Insère le lien de prise de rendez-vous de la mission', icon: Calendar },
  { value: 'call', label: 'Proposer un appel', description: 'Demande quinze minutes au téléphone et propose des créneaux', icon: Phone },
  { value: 'cv', label: 'Demander le CV', description: 'Demande le CV ou le portfolio pour qualifier le profil', icon: FileText },
  { value: 'job_details', label: 'Détailler le poste', description: "Propose d'envoyer la fiche détaillée de la mission", icon: Briefcase },
  { value: 'check_interest', label: "Vérifier l'intérêt", description: 'Relance sans insister, utile après un silence', icon: HelpCircle },
  { value: 'referral', label: 'Demander une recommandation', description: "Si le candidat décline, demande s'il connaît quelqu'un", icon: Users },
  { value: 'close', label: 'Clore poliment', description: 'Garde la porte ouverte pour plus tard', icon: DoorOpen },
];

const CTA_LABELS = Object.fromEntries(CTA_OPTIONS.map((o) => [o.value, o.label])) as Record<CtaType, string>;

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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [result, setResult] = useState<CtaReplyResult | null>(null);
  const [lastCta, setLastCta] = useState<CtaType>('auto');

  const isDisabled = disabled || chatHistory.length === 0;

  const generate = (ctaType: CtaType) =>
    ctaReply({
      cta_type: ctaType,
      chat_history: chatHistory,
      candidate_name: candidateName,
      recruiter_name: recruiterName,
      job_title: jobTitle,
      job_brief: jobBrief,
      calendly_link: calendlyLink,
      tone,
    });

  const handlePick = async (ctaType: CtaType) => {
    setLastCta(ctaType);
    const res = await generate(ctaType);
    if (res) {
      setResult(res);
      setDialogOpen(true);
    }
  };

  const handleRegenerate = async () => {
    const res = await generate(lastCta);
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
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                disabled={isDisabled}
                loading={ctaReplyLoading}
                aria-label="Proposer une suite"
                className="h-11 w-11 px-0 text-muted-foreground hover:text-foreground sm:h-7 sm:w-auto sm:px-2"
              >
                {!ctaReplyLoading && <MessageSquareReply aria-hidden="true" />}
                <span className="hidden sm:inline">Proposer une suite</span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">Rédiger une réponse qui propose la suite de l'échange</TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="top" align="start" className="w-80">
          <DropdownMenuLabel>Choisissez la suite à proposer</DropdownMenuLabel>
          {CTA_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <DropdownMenuItem
                key={opt.value}
                onSelect={() => void handlePick(opt.value)}
                className="min-h-11 items-start gap-2 md:min-h-0"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-foreground">{opt.label}</span>
                  <span className="block text-xs text-muted-foreground">{opt.description}</span>
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Suggestion de réponse</DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                {result?.cta_used ? (
                  <>
                    <Badge variant="muted">{CTA_LABELS[result.cta_used] || 'Suite proposée'}</Badge>
                    {result.reason && <span>{result.reason}</span>}
                  </>
                ) : (
                  <span>Relisez la réponse avant de l'insérer dans votre message.</span>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>

          {result && (
            <div className="rounded-lg border border-border bg-muted p-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground" style={{ overflowWrap: 'anywhere' }}>
                {result.message}
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleRegenerate} loading={ctaReplyLoading}>
              {!ctaReplyLoading && <RefreshCw aria-hidden="true" />}
              Régénérer
            </Button>
            <Button type="button" variant="primary" size="sm" onClick={handleInsert} disabled={!result || ctaReplyLoading}>
              <Check aria-hidden="true" />
              Insérer dans le message
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
