import type { ActivityEvent } from '@/hooks/useProfileActivity';
import type { MessagingService } from '@/lib/messagingServices';
import type { LinkedInProfile } from '@/components/outreach/types';

export interface DemoConversation {
  id: string;
  name: string;
  headline: string;
  mission: string;
  sequence: string;
  preview: string;
  emailService: 'gmail' | 'outlook';
  events: ActivityEvent[];
  profile: LinkedInProfile;
}

/** Exemples en mémoire : aucune identité réelle, aucun identifiant de compte ou de session. */
export function createInboxDemo(now = new Date()): DemoConversation[] {
  const at = (day: number, hour: number, minute = 0) => {
    const date = new Date(now);
    date.setDate(date.getDate() + day);
    date.setHours(hour, minute, 0, 0);
    return date.toISOString();
  };
  const message = (id: string, service: MessagingService, direction: 'inbound' | 'outbound', timestamp: string, text: string, subject?: string): ActivityEvent => ({
    id, type: 'message', actionType: service === 'whatsapp' ? 'whatsapp_message' : service === 'linkedin' ? 'message' : 'email',
    channel: service === 'gmail' || service === 'outlook' ? 'email' : service,
    service, direction, timestamp, finalMessage: text, finalSubject: subject, stepOrder: 0, status: 'sent',
  });
  const invitation = (id: string, text: string, sequence: string): ActivityEvent => ({ id, type: 'sequence_step', actionType: 'connection_request', channel: 'linkedin', service: 'linkedin', timestamp: at(-2, 9), stepOrder: 0, status: 'sent', finalMessage: text, sequenceName: sequence });
  const booking = (id: string, title: string): ActivityEvent => ({ id, type: 'booking', actionType: 'calendly_booking', service: 'calendly', timestamp: at(2, 11, 30), eventEndAt: at(2, 12), eventName: title, eventLocation: 'Visioconférence Google Meet', stepOrder: 0, status: 'scheduled' });
  const gmail = message('camille-email', 'gmail', 'outbound', at(-1, 10), 'Bonjour Camille,\n\nComme convenu, voici quelques précisions sur le poste de développeuse React senior : une équipe produit de huit personnes, trois jours de télétravail par semaine et une rémunération de 65 à 75 k€.\n\nVous aurez de l’autonomie sur les choix techniques et travaillerez avec le design et le produit.\n\nJe vous propose un premier échange de trente minutes pour découvrir vos envies et répondre à vos questions.\n\nÀ bientôt,\nLaurent', 'Quelques précisions sur le poste React');
  return [
    {
      id: 'demo-camille', name: 'Camille Durand', headline: 'Développeuse React · Paris', mission: 'Développeuse React senior', sequence: 'Approche développeurs React', preview: 'Parfait, à bientôt !', emailService: 'gmail',
      profile: {
        id: 'demo-camille', name: 'Camille Durand', headline: 'Développeuse React senior', location: 'Paris', summary: 'Développeuse frontend depuis huit ans, j’aime construire des produits accessibles et accompagner les équipes sur la qualité du code. Je cherche une équipe produit où contribuer aux choix techniques et au mentorat.',
        work_experience: [
          { company: 'Lumen Produit (fictif)', role: 'Développeuse frontend senior', start: { year: 2022, month: 3 }, current: true, description: 'Refonte React et TypeScript d’une plateforme B2B. Design system, accessibilité, tests et accompagnement de trois développeurs.' },
          { company: 'Atelier Nova (fictif)', role: 'Développeuse React', start: { year: 2018, month: 9 }, end: { year: 2022, month: 2 }, description: 'Applications web pour des équipes métier, intégration d’API et amélioration des performances.' },
          { company: 'Studio Boréal (fictif)', role: 'Développeuse web', start: '2016', end: '2018', description: 'Premiers projets JavaScript et interfaces responsives.' },
        ],
        education: [{ school: 'Université Paris-Saclay', degree: 'Master informatique', field_of_study: 'Génie logiciel', start: '2014', end: '2016' }, { school: 'Université de Nantes', degree: 'Licence informatique', start: '2011', end: '2014' }],
        skills: ['React', 'TypeScript', 'JavaScript', 'Accessibilité', 'Design system', 'Tests', 'API REST', 'Git', 'Mentorat', 'Performance web'].map(name => ({ name })),
        languages: [{ name: 'Français', proficiency: 'Langue maternelle' }, { name: 'Anglais', proficiency: 'Professionnel' }],
        certifications: [{ name: 'Accessibilité numérique', organization: 'Parcours de formation fictif' }],
        projects: [{ name: 'Bibliothèque de composants accessible', description: 'Composants partagés, documentation et tests visuels pour l’équipe produit.' }],
      },
      events: [
        invitation('camille-invitation', 'Bonjour Camille, votre parcours React m’intéresse. Ravi de rejoindre votre réseau !', 'Approche développeurs React'),
        { ...message('camille-linkedin-out', 'linkedin', 'outbound', at(-2, 14), 'Bonjour Camille, nous recrutons une développeuse React senior pour une équipe produit à Paris. Seriez-vous disponible pour en discuter ?'), sequenceName: 'Approche développeurs React', stepOrder: 1 },
        message('camille-linkedin-in', 'linkedin', 'inbound', at(-2, 15, 12), 'Bonjour Laurent ! Le poste peut m’intéresser. Pouvez-vous m’en dire plus sur le télétravail et la rémunération ?'),
        { ...gmail, type: 'sequence_step', sequenceName: 'Approche développeurs React', stepOrder: 2, status: 'opened', recipient: 'camille.durand@example.test' },
        { ...message('camille-email-in', 'gmail', 'inbound', at(-1, 11, 20), 'Merci pour les précisions ! Le cadre me correspond. Je suis disponible pour un premier échange cette semaine.', 'Re : Quelques précisions sur le poste React'), recipient: 'camille.durand@example.test' },
        { ...message('camille-wa-out', 'whatsapp', 'outbound', at(0, 9, 15), 'Bonjour Camille ! Je vous propose un échange après-demain à 11h30. Est-ce que ce créneau vous convient ?'), sequenceName: 'Approche développeurs React', stepOrder: 3, recipient: '06 XX XX XX XX' },
        message('camille-wa-in', 'whatsapp', 'inbound', at(0, 9, 18), 'Oui, 11h30 c’est parfait pour moi !'),
        message('camille-wa-confirm', 'whatsapp', 'outbound', at(0, 9, 20), 'C’est réservé, vous allez recevoir l’invitation Google Meet par email. À bientôt !'),
        message('camille-wa-thanks', 'whatsapp', 'inbound', at(0, 9, 22), 'Parfait, à bientôt !'),
        booking('camille-booking', 'Premier échange · Développeuse React'),
      ],
    },
    {
      id: 'demo-alex', name: 'Alex Martin', headline: 'Account Executive · Lyon', mission: 'Account Executive SaaS', sequence: 'Approche commerciale SaaS', preview: 'Je suis disponible mardi ou jeudi matin.', emailService: 'outlook',
      profile: { id: 'demo-alex', name: 'Alex Martin', headline: 'Account Executive SaaS', location: 'Lyon', summary: 'Six ans dans la vente de logiciels B2B. Je couvre le cycle commercial complet et apprécie les échanges avec les équipes produit.', work_experience: [{ company: 'Horizon Logiciels (fictif)', role: 'Account Executive', start: '2021', current: true, description: 'Comptes PME et ETI, démonstrations, négociation et suivi des partenaires.' }, { company: 'Passerelle SaaS (fictif)', role: 'Business Developer', start: '2018', end: '2021', description: 'Prospection et qualification des opportunités.' }], education: [{ school: 'Université Lyon 3', degree: 'Master commerce et marketing', start: '2016', end: '2018' }], skills: ['Vente SaaS', 'Négociation', 'CRM', 'Prospection', 'Démonstrations produit'].map(name => ({ name })), languages: [{ name: 'Français', proficiency: 'Langue maternelle' }, { name: 'Anglais', proficiency: 'Courant' }] },
      events: [
        invitation('alex-invitation', 'Bonjour Alex, j’aimerais échanger avec vous sur une opportunité commerciale.', 'Approche commerciale SaaS'),
        { ...message('alex-email-out', 'outlook', 'outbound', at(-1, 9, 30), 'Bonjour Alex,\n\nVotre expérience dans la vente SaaS a retenu mon attention. Nous accompagnons une équipe qui recrute un Account Executive à Lyon, avec deux jours de télétravail.\n\nLe package se situe entre 55 et 65 k€ de fixe, plus un variable déplafonné. Seriez-vous ouvert à un premier échange ?\n\nBonne journée,\nLaurent', 'Une opportunité Account Executive à Lyon'), type: 'sequence_step', sequenceName: 'Approche commerciale SaaS', stepOrder: 1, recipient: 'alex.martin@example.test', status: 'replied' },
        { ...message('alex-email-in', 'outlook', 'inbound', at(0, 8, 45), 'Bonjour Laurent,\nMerci pour votre message. Je suis disponible mardi ou jeudi matin. Pourriez-vous préciser la taille de l’équipe et le cycle de vente moyen ?\nAlex', 'Re : Une opportunité Account Executive à Lyon'), recipient: 'alex.martin@example.test' },
        message('alex-li-out', 'linkedin', 'outbound', at(0, 9), 'Merci Alex ! Je vous réponds par email avec les détails sur l’équipe et le cycle de vente.'),
      ],
    },
    {
      id: 'demo-maya', name: 'Maya Bernard', headline: 'Product Designer · Nantes', mission: 'Product Designer senior', sequence: 'Approche design produit', preview: 'Merci ! Je regarde et je reviens vers vous.', emailService: 'gmail',
      profile: { id: 'demo-maya', name: 'Maya Bernard', headline: 'Product Designer senior', location: 'Nantes', summary: 'Product designer orientée recherche utilisateur. Je travaille sur la découverte, les parcours et la conception d’interfaces avec le produit et la technique.', work_experience: [{ company: 'Orbite Mobilité (fictif)', role: 'Product Designer senior', start: '2022', current: true, description: 'Recherche terrain, parcours de réservation et design system mobile.' }, { company: 'Collectif Quartz (fictif)', role: 'UX/UI Designer', start: '2018', end: '2022', description: 'Entretiens utilisateurs, prototypes et tests d’utilisabilité.' }], education: [{ school: 'École de design de Nantes', degree: 'Diplôme de design', field_of_study: 'Design d’interaction', start: '2013', end: '2018' }], skills: ['Recherche utilisateur', 'Figma', 'Prototypage', 'Design system', 'Tests utilisateurs'].map(name => ({ name })), languages: [{ name: 'Français' }, { name: 'Anglais', proficiency: 'Professionnel' }], volunteering_experience: [{ company: 'Association fictive Les Ateliers', role: 'Mentore design', description: 'Accompagnement de personnes en reconversion.' }], projects: [{ name: 'Application de mobilité', description: 'Simplification du parcours de réservation à partir de tests utilisateurs.' }] },
      events: [
        invitation('maya-invitation', 'Bonjour Maya, votre portfolio m’a beaucoup intéressé. Ravi d’échanger avec vous !', 'Approche design produit'),
        message('maya-wa-out', 'whatsapp', 'outbound', at(-1, 14), 'Bonjour Maya, c’est Laurent. Comme convenu sur LinkedIn, je vous contacte ici pour organiser un premier échange.'),
        message('maya-wa-in', 'whatsapp', 'inbound', at(-1, 14, 5), 'Bonjour ! Je peux vous appeler dans 10 minutes si vous êtes disponible.'),
        { id: 'maya-call', type: 'aircall', actionType: 'call', service: 'aircall', channel: 'call', timestamp: at(-1, 14, 15), callDirection: 'inbound', callDuration: 480, callUserName: 'Laurent', stepOrder: 0, status: 'completed' },
        { ...message('maya-email', 'gmail', 'outbound', at(-1, 15), 'Bonjour Maya,\n\nMerci pour notre échange ! Je vous envoie la présentation de l’équipe produit et les points clés du poste. Le rôle couvre la recherche utilisateur, les parcours et le design system.\n\nN’hésitez pas à me partager les deux projets de votre portfolio dont vous aimeriez parler.\n\nÀ bientôt,\nLaurent', 'Suite à notre échange · Product Designer'), recipient: 'maya.bernard@example.test' },
        message('maya-wa-thanks', 'whatsapp', 'inbound', at(0, 9), 'Merci ! Je regarde et je reviens vers vous.'),
      ],
    },
  ];
}
