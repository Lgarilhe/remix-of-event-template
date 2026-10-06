/**
 * Suite d'un entretien, sous le compte rendu : une action proposée d'après la
 * recommandation (entretien suivant, précisions, refus), un message au candidat
 * rédigé puis envoyé depuis la boîte e-mail reliée de la personne connectée, et,
 * pour un cabinet ou un freelance, la présentation du candidat au manager.
 *
 * Rien ne part sans relecture : la rédaction (generate-interview-followup) ne
 * persiste ni n'envoie rien, l'envoi (send-candidate-email) demande une
 * confirmation. La présentation au manager exige que le recruteur confirme l'accord
 * du candidat ; le serveur le revérifie, avec le type d'organisation.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, Check, Copy, Pencil, Send } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction, isInsufficientCreditsError } from '@/lib/invokeEdgeFunction';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import {
  FOLLOW_UP_ACTIONS, clientNameOf, hiringManagerOf, isValidEmail, offersManagerPresentation, suggestedAction,
  type FollowUpAction, type FollowUpKind,
} from '@/lib/interviewFollowUp';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useEmailConnectorStatus } from '@/hooks/useEmailConnectorStatus';
import { CreditCostBadge } from '@/components/ai/CreditCostBadge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { CallReport } from './LiveCoachingPanel';

// Constante typée string : une chaîne littérale ferait descendre le compilateur dans tout le schéma (TS2589).
const BRIEF_CLIENT_COLUMNS: string = 'client:job_details->client';

interface InterviewFollowUpProps {
  report: CallReport;
  candidateId: string;
  candidateName: string;
  candidateEmail?: string | null;
  candidateLinkedinUrl?: string | null;
  /** Mission du candidat (uuid) : le brief donne le client et le manager. */
  projectId?: string | null;
  jobTitle: string;
  onScheduleNext: () => void;
}

interface Mailbox {
  loading: boolean;
  address: string | null;
  connected: boolean;
}

interface ComposerProps {
  kind: FollowUpKind;
  heading: string;
  action: FollowUpAction;
  report: CallReport;
  candidateId: string;
  candidateName: string;
  candidateLinkedinUrl: string | null;
  jobTitle: string;
  clientName: string;
  managerName: string;
  recipientLabel: string;
  recipientName: string;
  defaultEmail: string;
  emailHint?: string;
  consentLabel?: string;
  consentHint?: string;
  mailbox: Mailbox;
}

function copyBody(text: string) {
  if (!navigator.clipboard) {
    toast.error('Copie impossible', { description: 'Sélectionnez le texte, puis copiez-le.' });
    return;
  }
  navigator.clipboard.writeText(text).then(
    () => toast.success('Message copié'),
    () => toast.error('Copie impossible', { description: 'Sélectionnez le texte, puis copiez-le.' }),
  );
}

function MessageComposer({
  kind, heading, action, report, candidateId, candidateName, candidateLinkedinUrl, jobTitle, clientName, managerName,
  recipientLabel, recipientName, defaultEmail, emailHint, consentLabel, consentHint, mailbox,
}: ComposerProps) {
  const baseId = useId();
  const [toEmail, setToEmail] = useState(defaultEmail);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [consent, setConsent] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ to: string; from: string | null; noted: boolean } | null>(null);
  const emailTouchedRef = useRef(false);

  // L'adresse du manager arrive après la lecture du brief : on la reprend tant qu'elle n'a pas été saisie à la main.
  useEffect(() => {
    if (!emailTouchedRef.current) setToEmail(defaultEmail);
  }, [defaultEmail]);

  const requiresConsent = kind === 'manager_presentation';
  const drafted = subject.trim().length > 0 || body.trim().length > 0;
  const emailOk = isValidEmail(toEmail);
  const canSend = drafted && subject.trim().length > 0 && body.trim().length > 0 && emailOk
    && mailbox.connected && (!requiresConsent || consent);

  const draft = async () => {
    setDrafting(true);
    setError(null);
    const { data, error: err } = await invokeWithCredits<{ subject?: string; body?: string }>(
      'generate-interview-followup',
      'interview_followup',
      {
        kind,
        action,
        candidate_name: candidateName,
        job_title: jobTitle,
        client_name: clientName,
        manager_name: managerName,
        report,
      },
      { description: kind === 'follow_up' ? 'Message de suivi après un entretien' : 'Présentation du candidat au manager' },
    );
    setDrafting(false);
    if (err || !data?.subject || !data?.body) {
      // Le refus de crédits a déjà son toast, avec le lien vers les crédits.
      if (!isInsufficientCreditsError(err)) setError(err?.message || data?.error || "Le message n'a pas pu être rédigé. Réessayez.");
      return;
    }
    setSubject(data.subject);
    setBody(data.body);
    setSent(null);
  };

  const send = async () => {
    setSending(true);
    setError(null);
    const { data, error: err } = await invokeEdgeFunction<{ sent_at?: string; from_email?: string | null; noted?: boolean }>(
      'send-candidate-email',
      {
        kind,
        to_email: toEmail.trim(),
        to_name: recipientName,
        subject: subject.trim(),
        body: body.trim(),
        candidate_id: candidateId,
        linkedin_url: candidateLinkedinUrl,
        candidate_consent_confirmed: requiresConsent ? consent : undefined,
      },
    );
    setSending(false);
    setConfirmOpen(false);
    if (err || data?.success === false) {
      setError(err?.message || data?.error || "L'envoi n'a pas pu aboutir. Réessayez dans un instant.");
      return;
    }
    setSent({ to: toEmail.trim(), from: data?.from_email ?? mailbox.address, noted: data?.noted !== false });
    toast.success(kind === 'follow_up' ? 'Message envoyé' : 'Présentation envoyée');
  };

  const emailId = `${baseId}-email`;
  const subjectId = `${baseId}-objet`;
  const bodyId = `${baseId}-message`;
  const consentId = `${baseId}-accord`;

  return (
    <div className="space-y-2.5">
      <h5 className="text-sm font-semibold text-foreground">{heading}</h5>

      <div className="space-y-1">
        <Label htmlFor={emailId} className="text-xs">{recipientLabel}</Label>
        <Input
          id={emailId}
          type="email"
          inputMode="email"
          autoComplete="off"
          value={toEmail}
          error={toEmail.trim().length > 0 && !emailOk}
          onChange={(e) => {
            emailTouchedRef.current = true;
            setToEmail(e.target.value);
          }}
          placeholder="prenom.nom@exemple.fr"
          className="max-md:h-11"
        />
        {emailHint && <p className="text-xs text-muted-foreground">{emailHint}</p>}
      </div>

      {requiresConsent && (
        <div className="flex items-start gap-2">
          <Checkbox
            id={consentId}
            checked={consent}
            onCheckedChange={(value) => setConsent(value === true)}
            className="mt-0.5"
          />
          <div className="min-w-0">
            <Label htmlFor={consentId} className="text-xs font-medium leading-snug">{consentLabel}</Label>
            {consentHint && <p className="mt-0.5 text-xs text-muted-foreground">{consentHint}</p>}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void draft()} loading={drafting} className="max-md:min-h-11">
          {!drafting && <Pencil aria-hidden="true" />}
          {drafting ? 'Rédaction…' : drafted ? 'Rédiger à nouveau' : 'Rédiger le message'}
        </Button>
        {!drafting && <CreditCostBadge actionId="interview_followup" />}
      </div>

      {drafted && (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor={subjectId} className="text-xs">Objet</Label>
            <Input id={subjectId} value={subject} onChange={(e) => setSubject(e.target.value)} className="max-md:h-11" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={bodyId} className="text-xs">Message</Label>
            <Textarea
              id={bodyId}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={9}
              className="text-xs leading-relaxed md:text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={!canSend || mailbox.loading}
              onClick={() => setConfirmOpen(true)}
              className="max-md:min-h-11"
            >
              <Send aria-hidden="true" />
              {sent ? 'Envoyer de nouveau' : 'Envoyer depuis ma boîte'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => copyBody(`${subject.trim()}\n\n${body.trim()}`)} className="max-md:min-h-11">
              <Copy aria-hidden="true" />
              Copier
            </Button>
          </div>

          {!mailbox.loading && !mailbox.connected && (
            <p className="text-xs text-foreground-secondary">
              Aucune boîte e-mail n'est reliée à votre compte.{' '}
              <Link to="/settings/account/connections" className="font-medium text-foreground underline underline-offset-2">
                Relier ma boîte
              </Link>
              , ou copiez le message.
            </p>
          )}
          {mailbox.connected && mailbox.address && !sent && (
            <p className="text-xs text-muted-foreground">Le message part de {mailbox.address}.</p>
          )}
        </div>
      )}

      {sent && (
        <p role="status" className="flex items-start gap-1.5 text-xs text-foreground">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
          <span>
            Envoyé à {sent.to}{sent.from ? ` depuis ${sent.from}` : ''}.
            {sent.noted ? ' Une note est ajoutée à la fiche du candidat.' : " La note sur la fiche du candidat n'a pas pu être ajoutée."}
          </span>
        </p>
      )}

      {error && <p role="alert" className="text-xs text-danger">{error}</p>}

      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!sending) setConfirmOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Envoyer ce message&nbsp;?</AlertDialogTitle>
            <AlertDialogDescription>
              {`Le message part à ${toEmail.trim()}${mailbox.address ? ` depuis ${mailbox.address}` : ''}. Un e-mail envoyé ne peut pas être rappelé.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={sending}
              onClick={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              {sending ? 'Envoi…' : 'Envoyer'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function InterviewFollowUp({
  report, candidateId, candidateName, candidateEmail, candidateLinkedinUrl, projectId, jobTitle, onScheduleNext,
}: InterviewFollowUpProps) {
  const baseId = useId();
  const { organizationId, orgType } = useOrganization();
  const { user } = useAuthReady();
  const mailboxQuery = useEmailConnectorStatus(organizationId, user?.id);
  const connection = mailboxQuery.data?.connection ?? null;
  const mailbox: Mailbox = {
    loading: mailboxQuery.isLoading,
    address: connection?.emailAddress ?? null,
    connected: Boolean(connection?.connected),
  };

  const suggested = suggestedAction(report.recommendation);
  const [action, setAction] = useState<FollowUpAction>(suggested);
  const selected = FOLLOW_UP_ACTIONS.find((a) => a.value === action) ?? FOLLOW_UP_ACTIONS[0];

  const offersManager = offersManagerPresentation(report.recommendation, orgType) && action !== 'decline';
  const briefQuery = useQuery({
    queryKey: ['interview-followup-client', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sourcing_projects')
        .select(BRIEF_CLIENT_COLUMNS)
        .eq('id', projectId!)
        .maybeSingle();
      if (error) throw error;
      return { client: (data as { client?: unknown } | null)?.client ?? null };
    },
    enabled: Boolean(projectId) && offersManager,
    staleTime: 60_000,
  });
  const manager = hiringManagerOf(briefQuery.data);
  const clientName = clientNameOf(briefQuery.data);

  const actionLabelId = `${baseId}-suite`;

  return (
    <section className="space-y-4 border-t border-border pt-3">
      <h4 className="eyebrow">Suite de l'entretien</h4>

      <div className="space-y-1.5">
        <p id={actionLabelId} className="text-xs text-foreground-secondary">Suite à donner à ce candidat</p>
        <ToggleGroup
          type="single"
          role="radiogroup"
          aria-labelledby={actionLabelId}
          variant="outline"
          value={action}
          onValueChange={(value) => { if (value) setAction(value as FollowUpAction); }}
          className="grid grid-cols-3 gap-1"
        >
          {FOLLOW_UP_ACTIONS.map((a) => (
            <ToggleGroupItem
              key={a.value}
              value={a.value}
              className="h-auto whitespace-normal px-2 py-1.5 text-xs font-medium data-[state=on]:border-foreground data-[state=on]:bg-accent max-md:min-h-11"
            >
              {a.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          {selected.hint}.{action === suggested ? " Proposé d'après la recommandation." : ''}
        </p>
      </div>

      <Button variant="outline" size="sm" onClick={onScheduleNext} className="w-full max-md:min-h-11">
        <CalendarPlus aria-hidden="true" />
        Programmer l'entretien suivant
      </Button>

      <MessageComposer
        key={action}
        kind="follow_up"
        heading="Message au candidat"
        action={action}
        report={report}
        candidateId={candidateId}
        candidateName={candidateName}
        candidateLinkedinUrl={candidateLinkedinUrl ?? null}
        jobTitle={jobTitle}
        clientName=""
        managerName=""
        recipientLabel="Adresse du candidat"
        recipientName={candidateName}
        defaultEmail={candidateEmail?.trim() ?? ''}
        emailHint={candidateEmail?.trim() ? undefined : "Aucune adresse n'est enregistrée pour ce candidat : saisissez-la."}
        mailbox={mailbox}
      />

      {offersManager && (
        <div className="border-t border-border pt-3">
          <MessageComposer
            kind="manager_presentation"
            heading="Présentation au manager"
            action={action}
            report={report}
            candidateId={candidateId}
            candidateName={candidateName}
            candidateLinkedinUrl={candidateLinkedinUrl ?? null}
            jobTitle={jobTitle}
            clientName={clientName}
            managerName={manager.name}
            recipientLabel={manager.name ? `Adresse de ${manager.name}` : 'Adresse du manager'}
            recipientName={manager.name}
            defaultEmail={manager.email}
            emailHint={manager.email ? undefined : "Aucun manager n'est renseigné dans le brief (« Qui recrute ») : saisissez son adresse."}
            consentLabel={`Le candidat a accepté d'être présenté${clientName ? ` à ${clientName}` : ' au client'}.`}
            consentHint="La présentation reprend le résumé, les points forts et les notes par critère. Les points d'alerte et les citations du candidat restent en interne."
            mailbox={mailbox}
          />
        </div>
      )}
    </section>
  );
}
