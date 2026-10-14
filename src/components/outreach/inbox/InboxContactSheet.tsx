/**
 * InboxContactSheet : « Inscrire dans une séquence » de la messagerie, interrupteur des séquences
 * allumé (refonte mission, lot 5f-2d).
 *
 * Une feuille latérale avec le choix de la mission au-dessus du flux d'inscription du panneau
 * Contacter (ContactFlowSheet). Elle remplace le dialogue « Choisir une séquence » et la fenêtre
 * SequenceEnrollModal, qui restent dans MessagesInbox pour l'interrupteur éteint.
 *
 * - Le candidat est celui de la conversation ouverte, construit sur des valeurs simples (identifiant,
 *   nom, titre, adresse, photo, distance) : un nouvel objet à chaque rendu ferait relire les aperçus.
 *   Son profil est celui que l'ancien parcours inscrivait, distance du participant comprise (relue en
 *   direct sur le compte de la conversation).
 * - Poste : « project:<uuid> » et le nom de la mission, comme au Pipeline et au Sourcing. Sans mission,
 *   aucun poste : le flux n'écrit rien dans le Pipeline.
 * - Compte d'envoi : celui de la page, comme avant (la conversation peut n'en porter aucun).
 * - Sans identifiant de profil ou sans compte, le flux n'est pas monté : une phrase et « Fermer ».
 * - Cette feuille n'écrit rien d'elle-même : l'inscription et la règle Retenu passent par le flux.
 */

import { useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ContactFlowSheet } from '@/components/sequences/contact/ContactFlowSheet';
import { profileToFlowCandidate } from '@/components/sequences/contact/flowCandidates';
import type { ActiveMissionLite, Chat } from '@/hooks/useMessagesInbox';
import { getChatAvatar, getCurrentCandidateProfile } from '@/hooks/useMessagesInboxHelpers';
import { normalizeNetworkDistance } from '@/lib/sequenceCompatibility';
import type { LinkedInProfile } from '../types';
import { unverifiedRelationNotice, type NoticeStep } from './unverifiedRelation';

/** Valeur de « Sans mission » dans le choix de mission (une option ne peut pas valoir ''). */
const NO_MISSION = '__none__';

const SHEET_TITLE = 'Inscrire dans une séquence';
const NO_PROFILE_SENTENCE =
  "Cette conversation ne permet pas d'identifier le profil LinkedIn du candidat : il ne peut pas être inscrit dans une séquence.";
const NO_ACCOUNT_SENTENCE =
  "Aucun compte LinkedIn n'est relié pour cette messagerie : reliez votre compte dans Paramètres, puis réessayez.";

interface InboxContactSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Conversation ouverte. */
  chat: Chat | null;
  /** Compte de la page (celui de l'ancien parcours), null s'il n'y en a pas. */
  accountId: string | null;
  /** Missions proposées dans le choix, les mêmes que l'ancien dialogue. */
  missions: readonly ActiveMissionLite[];
  /** Mission choisie, '' pour « Sans mission ». */
  missionId: string;
  onMissionChange: (missionId: string) => void;
  /** Après une inscription (la feuille se ferme ensuite d'elle-même) : relire les inscriptions. */
  onEnrolled: () => void;
}

export function InboxContactSheet({
  open,
  onOpenChange,
  chat,
  accountId,
  missions,
  missionId,
  onMissionChange,
  onEnrolled,
}: InboxContactSheetProps): JSX.Element {
  // Valeurs simples de la conversation : ce sont elles, et non l'objet de la conversation, qui
  // déterminent le candidat.
  const person = getCurrentCandidateProfile(chat);
  const linkedinId = person?.linkedinId ?? null;
  const name = person?.name ?? '';
  const headline = person?.headline;
  const profileUrl = person?.linkedinUrl;
  const picture = chat ? getChatAvatar(chat) || undefined : undefined;
  const attendee = chat?.attendees?.[0];
  // Distance du participant quand le fournisseur la donne ; sinon inconnue (pas de blocage, un
  // avertissement si la séquence invite).
  const rawDistance = attendee?.specifics?.network_distance ?? attendee?.network_distance ?? undefined;
  const distance = normalizeNetworkDistance(rawDistance);

  const candidates = useMemo(() => {
    if (!linkedinId) return [];
    const profile = {
      id: linkedinId,
      name,
      headline,
      profile_url: profileUrl,
      public_profile_url: profileUrl,
      profile_picture_url: picture,
      network_distance: rawDistance,
    } as unknown as LinkedInProfile;
    return [profileToFlowCandidate(profile, { hasLinkedIn: !!linkedinId })];
  }, [linkedinId, name, headline, profileUrl, picture, rawDistance]);

  // Calculé par le flux sur les étapes de la séquence qu'il a choisie.
  const notice = useCallback((steps: readonly NoticeStep[]) => unverifiedRelationNotice(steps, distance), [distance]);

  const mission = missionId ? missions.find((candidate) => candidate.id === missionId) ?? null : null;
  const missionKey = mission?.id ?? null;
  const missionName = mission?.name ?? null;
  const job = useMemo(
    () => (missionKey && missionName !== null ? { id: `project:${missionKey}`, title: missionName } : null),
    [missionKey, missionName],
  );

  if (candidates.length === 0 || !accountId) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" hideClose className="flex w-full max-w-none flex-col gap-4 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{SHEET_TITLE}</SheetTitle>
            <SheetDescription>{candidates.length === 0 ? NO_PROFILE_SENTENCE : NO_ACCOUNT_SENTENCE}</SheetDescription>
          </SheetHeader>
          <SheetFooter>
            <SheetClose asChild>
              <Button type="button" variant="outline">
                Fermer
              </Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <ContactFlowSheet
      open={open}
      onOpenChange={onOpenChange}
      title={SHEET_TITLE}
      above={({ busy }) => (
        // Mission de rattachement : contexte donné à l'IA et suivi dans le pipeline de la mission.
        // « Sans mission » ne bloque rien. Verrouillé pendant l'écriture : changer la mission en plein
        // envoi afficherait une autre mission que celle de l'inscription.
        <div className="space-y-1.5">
          <Label htmlFor="inbox-enroll-mission">Mission</Label>
          <Select
            value={missionId || NO_MISSION}
            onValueChange={(value) => onMissionChange(value === NO_MISSION ? '' : value)}
            disabled={busy}
          >
            <SelectTrigger id="inbox-enroll-mission" className="max-md:h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_MISSION}>Sans mission</SelectItem>
              {missions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      missionId={missionKey}
      job={job}
      candidates={candidates}
      accountId={accountId}
      notice={notice}
      onEnrolled={() => onEnrolled()}
    />
  );
}
