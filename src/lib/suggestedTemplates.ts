/**
 * Modèles de messages suggérés — partagés entre Réglages (MessageTemplatesSettings)
 * et l'onboarding (SceneTemplates). Les placeholders sont automatiquement
 * remplacés à l'insertion (cf src/lib/templatePlaceholders.ts).
 */

import type { CreateTemplateInput } from '@/hooks/useMessageTemplates';

export const SUGGESTED_TEMPLATES: CreateTemplateInput[] = [
  {
    name: 'Intro générale',
    shortcut: '/intro',
    emoji: '👋',
    category: 'Intro',
    content: `Bonjour {{prenom}},

J'ai vu votre profil et votre parcours {{poste_actuel}} chez {{entreprise_actuelle}} m'a vraiment marqué.

Nous accompagnons actuellement {{client}} sur la recherche d'un {{poste_recherche}} et je pense que ça pourrait vous intéresser.

Seriez-vous ouvert(e) à 15 min d'échange cette semaine ?

Bonne journée,
{{mon_prenom}}`,
  },
  {
    name: 'Relance J+3',
    shortcut: '/relance',
    emoji: '⏰',
    category: 'Relance',
    content: `Bonjour {{prenom}},

Je me permets de revenir vers vous suite à mon précédent message.

Je sais que les inbox sont chargées — un simple "intéressé" / "pas pour moi" suffit !

Bonne journée,
{{mon_prenom}}`,
  },
  {
    name: 'Lien Calendly',
    shortcut: '/calendly',
    emoji: '📅',
    category: 'Calendly',
    content: `Parfait {{prenom}} ! Voici mon lien pour caler 15 min :

{{lien_calendly}}

Choisissez le créneau qui vous arrange. À très bientôt !

{{mon_prenom}}`,
  },
  {
    name: 'Remerciement',
    shortcut: '/merci',
    emoji: '🙏',
    category: 'Closing',
    content: `Merci beaucoup pour votre retour {{prenom}} !

Je vous tiens au courant des prochaines étapes très vite.

Excellente journée,
{{mon_prenom}}`,
  },
  {
    name: 'Présentation poste',
    shortcut: '/poste',
    emoji: '💼',
    category: 'Présentation',
    content: `Bonjour {{prenom}},

Pour résumer le poste : {{client}} recherche un {{poste_recherche}}.

Le contexte est intéressant et l'équipe vraiment top. Je peux vous envoyer la fiche complète si vous voulez en savoir plus !

{{mon_prenom}}`,
  },
  {
    name: 'Demande disponibilité',
    shortcut: '/dispo',
    emoji: '🗓',
    category: 'Coordination',
    content: `Bonjour {{prenom}},

Quelles seraient vos disponibilités cette semaine ou la semaine prochaine pour un échange de 15 min ?

Le matin entre 10h et 12h ou en fin d'après-midi entre 16h et 18h fonctionne en général bien de mon côté.

À votre écoute,
{{mon_prenom}}`,
  },
];
