/**
 * Textes de la connexion des comptes (LinkedIn, WhatsApp, messagerie), au même
 * endroit pour tous les écrans : cartes de Connexions, assistant de connexion,
 * page de retour, intégration à l'accueil. Source : docs de refonte de la
 * connexion, écrans C0 à C10, et contrat de connexion (§ 4).
 *
 * Règles de rédaction (docs/design/01-direction.md) : français, vouvoiement,
 * phrases courtes, pas de tiret cadratin, pas de mot de remplissage, jamais le
 * nom d'un prestataire technique. Les noms de canaux (LinkedIn, WhatsApp, Gmail,
 * Outlook) sont des marques que la personne connaît. Un message d'erreur du
 * serveur n'est jamais affiché tel quel : `connectionErrorMessage` choisit le
 * texte d'après le code, `safeServerMessage` ne laisse passer qu'une phrase
 * sans nom de prestataire.
 *
 * Module pur, sans import : testé par tests/ux/connexion-copie.test.mjs.
 */

// ---------------------------------------------------------------------------
// Canaux et fournisseurs
// ---------------------------------------------------------------------------

/** Fournisseurs que le serveur sait connecter (contrat § 2, champ `provider`). */
export type ConnectionProviderId = 'linkedin' | 'whatsapp' | 'google' | 'outlook' | 'imap';
/** Canal de la carte : la messagerie réunit Gmail, Outlook et les autres boîtes. */
export type ConnectionChannel = 'linkedin' | 'email' | 'whatsapp';

export const PROVIDER_CHANNEL: Record<ConnectionProviderId, ConnectionChannel> = {
  linkedin: 'linkedin',
  whatsapp: 'whatsapp',
  google: 'email',
  outlook: 'email',
  imap: 'email',
};

export const PROVIDER_NAME: Record<ConnectionProviderId, string> = {
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp',
  google: 'Gmail',
  outlook: 'Outlook',
  imap: 'Messagerie',
};

/** Nom du compte à afficher quand le serveur n'en donne pas de lisible. */
export const DEFAULT_ACCOUNT_NAME: Record<ConnectionProviderId, string> = {
  linkedin: 'Compte LinkedIn',
  whatsapp: 'Compte WhatsApp',
  google: 'Messagerie Gmail',
  outlook: 'Messagerie Outlook',
  imap: 'Messagerie',
};

export function providerName(provider: ConnectionProviderId): string {
  return PROVIDER_NAME[provider];
}

export function isConnectionProvider(value: unknown): value is ConnectionProviderId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROVIDER_CHANNEL, value);
}

/** « de LinkedIn », « d'Outlook », « de WhatsApp » : l'élision selon la première lettre. */
export function ofProvider(provider: ConnectionProviderId): string {
  const name = PROVIDER_NAME[provider];
  return /^[AEIOUH]/i.test(name) ? `d'${name}` : `de ${name}`;
}

// ---------------------------------------------------------------------------
// Garde contre les noms de prestataires dans un texte venu d'ailleurs
// ---------------------------------------------------------------------------

// Les noms sont assemblés par morceaux : le test statique interdit leur forme
// entière dans ce fichier, qui ne doit jamais en contenir.
const VENDOR_FRAGMENTS: ReadonlyArray<readonly string[]> = [
  ['uni', 'pile'],
  ['apo', 'llo'],
  ['people', ' data ', 'labs'],
  ['pd', 'l'],
  ['brand', 'fetch'],
  ['clear', 'bit'],
  ['logo', '.dev'],
  ['re', 'send'],
  ['anthro', 'pic'],
  // Le produit d'IA seul, jamais le prénom du même nom : un compte à ce prénom doit rester lisible.
  ['clau', 'de', ' ai'],
];
// Bornes de lettres plutôt que \b : un identifiant à tiret bas (« NOM_API_KEY ») ne protège pas le nom qu'il contient.
const VENDOR_PATTERN = new RegExp(`(?<![A-Za-z])(?:${VENDOR_FRAGMENTS.map((f) => f.join('').replace('.', '\\.')).join('|')})(?![A-Za-z])`, 'i');

/** Vrai si le texte nomme un prestataire technique. */
export function mentionsVendor(text: string): boolean {
  return VENDOR_PATTERN.test(text);
}

/**
 * Phrase d'un serveur de Konekt montrable telle quelle : non vide, courte, sans
 * nom de prestataire. Sinon `null` : l'appelant prend son texte de repli.
 */
export function safeServerMessage(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.length > 300 || mentionsVendor(trimmed)) return null;
  return trimmed;
}

/**
 * Nom de compte à montrer. Un compte créé par l'ancien formulaire portait l'état
 * de la connexion dans son nom (« user:…|org:… ») : il ne s'affiche jamais, pas
 * plus qu'un nom qui cite un prestataire.
 */
export function readableConnectionName(name: unknown, provider: ConnectionProviderId): string {
  if (typeof name !== 'string') return DEFAULT_ACCOUNT_NAME[provider];
  const trimmed = name.trim();
  if (trimmed === '' || /^user:.*\|org:/.test(trimmed) || mentionsVendor(trimmed)) return DEFAULT_ACCOUNT_NAME[provider];
  return trimmed;
}

// ---------------------------------------------------------------------------
// État d'un compte (ligne d'une carte de Connexions)
// ---------------------------------------------------------------------------

/** Mêmes valeurs que ConnectionHealth de src/lib/linkedinStatus.ts. */
export type HealthKey =
  | 'connected'
  | 'syncing'
  | 'connecting'
  | 'limited'
  | 'locked'
  | 'needs_reconnect'
  | 'not_connected'
  | 'unknown';

export type HealthAction = 'connect' | 'reconnect' | 'refresh';
/** Teinte d'un badge d'état : les variantes de Badge (docs/design/01-direction.md, § 6). */
export type HealthTone = 'success' | 'info' | 'warning' | 'danger' | 'muted';

export const HEALTH_LABEL: Record<HealthKey, string> = {
  connected: 'Actif',
  syncing: 'Synchronisation en cours',
  connecting: 'Connexion en cours',
  limited: 'Connexion limitée',
  locked: 'Compte restreint',
  needs_reconnect: 'À reconnecter',
  not_connected: 'Non connecté',
  unknown: 'État à vérifier',
};

export const HEALTH_TONE: Record<HealthKey, HealthTone> = {
  connected: 'success',
  syncing: 'info',
  connecting: 'info',
  limited: 'warning',
  locked: 'danger',
  needs_reconnect: 'danger',
  not_connected: 'muted',
  unknown: 'warning',
};

/** Seuls ces états proposent un geste : se reconnecter ne règle ni une limite ni une restriction. */
const HEALTH_ACTION: Record<HealthKey, HealthAction | null> = {
  connected: null,
  syncing: null,
  connecting: null,
  limited: null,
  locked: null,
  needs_reconnect: 'reconnect',
  not_connected: 'connect',
  unknown: 'refresh',
};

export function healthAction(health: HealthKey): HealthAction | null {
  return HEALTH_ACTION[health];
}

const REASON_NOT_CONNECTED: Record<ConnectionChannel, string> = {
  linkedin: "Konekt n'utilise aucun compte LinkedIn pour l'instant.",
  email: "Aucune messagerie n'est reliée à Konekt pour l'instant.",
  whatsapp: "Aucun compte WhatsApp n'est relié à Konekt pour l'instant.",
};

const REASON_NEEDS_RECONNECT: Record<ConnectionChannel, string> = {
  linkedin: 'Votre session LinkedIn a expiré. Les envois sont en pause.',
  email: 'La connexion à votre messagerie a expiré.',
  whatsapp: 'WhatsApp a fermé la session.',
};

/**
 * Compte restreint par le service : mêmes mots que le bandeau du tableau de bord, la ligne d'« À traiter »
 * et la notification (restreint, envois en pause, se reconnecter n'y change rien, patienter ou vérifier chez le
 * service). Aucun bouton ni adresse à écrire : il n'y a rien à faire dans Konekt.
 */
const REASON_LOCKED: Record<ConnectionChannel, string> = {
  linkedin: "Ce compte est restreint par LinkedIn : les envois qui en partent sont en pause. Se reconnecter n'y change rien. Patientez, ou vérifiez l'état du compte directement sur LinkedIn : les envois reprendront d'eux-mêmes une fois la restriction levée.",
  email: "Cette messagerie est restreinte par son fournisseur : les envois qui en partent sont en pause. Se reconnecter n'y change rien. Patientez, ou vérifiez l'état de la boîte directement auprès de ce fournisseur : les envois reprendront d'eux-mêmes une fois la restriction levée.",
  whatsapp: "Ce compte est restreint par WhatsApp : les envois qui en partent sont en pause. Se reconnecter n'y change rien. Patientez, ou vérifiez l'état du compte directement dans WhatsApp : les envois reprendront d'eux-mêmes une fois la restriction levée.",
};

const REASON_LIMITED: Record<ConnectionChannel, string> = {
  linkedin: "Nouvelle tentative automatique, rien à faire de votre côté. Les envois reprennent dès le retour à la normale.",
  email: 'Nouvelle tentative automatique, rien à faire de votre côté.',
  whatsapp: 'Nouvelle tentative automatique, rien à faire de votre côté.',
};

/** Ligne d'explication sous l'état. Vide quand l'état se suffit (actif, connexion en cours). */
export function healthReason(health: HealthKey, channel: ConnectionChannel): string {
  switch (health) {
    case 'not_connected': return REASON_NOT_CONNECTED[channel];
    case 'needs_reconnect': return REASON_NEEDS_RECONNECT[channel];
    case 'limited': return REASON_LIMITED[channel];
    case 'locked': return REASON_LOCKED[channel];
    case 'syncing': return 'Vos conversations arrivent. Vous pouvez continuer à travailler.';
    case 'unknown': return "Konekt n'a pas pu lire l'état de ce compte.";
    default: return '';
  }
}

/**
 * Cause précise d'un compte à reconnecter, ou d'un état qui n'a pas pu être lu. La
 * classe de santé dit quoi faire, la cause dit pourquoi : une phrase par cause, jamais
 * celle d'une autre (une session expirée n'est ni une panne du service, ni un
 * identifiant à refaire, ni un compte retiré).
 */
export type AccountCause =
  | 'session_expired'
  | 'connection_error'
  | 'authentication_partial'
  | 'outdated_identifier'
  | 'removed'
  | 'unreadable';

const REASON_BY_CAUSE: Record<AccountCause, Record<ConnectionChannel, string>> = {
  session_expired: REASON_NEEDS_RECONNECT,
  connection_error: {
    linkedin: 'La connexion à LinkedIn rencontre un problème. Reconnectez le compte pour reprendre les envois.',
    email: 'La connexion à votre messagerie rencontre un problème. Reconnectez-la pour la rétablir.',
    whatsapp: 'La connexion à WhatsApp rencontre un problème. Reconnectez le compte pour la rétablir.',
  },
  authentication_partial: {
    linkedin: 'Une partie de la connexion LinkedIn demande une nouvelle authentification. Reconnectez le compte pour reprendre les envois.',
    email: 'Une partie de la connexion à votre messagerie demande une nouvelle authentification. Reconnectez-la pour la rétablir.',
    whatsapp: 'Une partie de la connexion à WhatsApp demande une nouvelle authentification. Reconnectez le compte pour la rétablir.',
  },
  // Identifiant d'un ancien format : la session peut être saine, seule la liaison est à refaire.
  outdated_identifier: {
    linkedin: 'Cette connexion doit être refaite. Reconnectez votre compte LinkedIn pour la renouveler.',
    email: 'Cette connexion doit être refaite. Reconnectez votre messagerie pour la renouveler.',
    whatsapp: 'Cette connexion doit être refaite. Reconnectez votre compte WhatsApp pour la renouveler.',
  },
  // Compte retiré chez le prestataire : même phrase et même geste sur les trois canaux.
  removed: {
    linkedin: "Ce compte LinkedIn n'est plus disponible. Reconnectez-le : la nouvelle connexion remplacera celle-ci.",
    email: "Cette messagerie n'est plus disponible. Reconnectez-la : la nouvelle connexion remplacera celle-ci.",
    whatsapp: "Ce compte WhatsApp n'est plus disponible. Reconnectez-le : la nouvelle connexion remplacera celle-ci.",
  },
  unreadable: {
    linkedin: "Konekt n'a pas pu lire l'état de ce compte pour le moment. Réessayez dans un instant.",
    email: "Konekt n'a pas pu lire l'état de ce compte pour le moment. Réessayez dans un instant.",
    whatsapp: "Konekt n'a pas pu lire l'état de ce compte pour le moment. Réessayez dans un instant.",
  },
};

/** Phrase d'explication d'une cause, pour un canal. */
export function causeReason(cause: AccountCause, channel: ConnectionChannel): string {
  return REASON_BY_CAUSE[cause][channel];
}

export const ACTION_LABEL = {
  reconnect: 'Reconnecter',
  refresh: 'Actualiser',
} as const;

/** « Connecter LinkedIn », « Connecter Gmail », « Connecter une messagerie »... */
export function connectLabel(provider: ConnectionProviderId): string {
  return provider === 'imap' ? 'Connecter une messagerie' : `Connecter ${PROVIDER_NAME[provider]}`;
}

export function healthActionLabel(action: HealthAction, provider: ConnectionProviderId): string {
  return action === 'connect' ? connectLabel(provider) : ACTION_LABEL[action];
}

// ---------------------------------------------------------------------------
// Alertes de déconnexion (toasts de l'application)
// ---------------------------------------------------------------------------

export const ALERT = {
  linkedinDisconnectedTitle: (name: string | null | undefined) => `${name?.trim() || 'Compte LinkedIn'} déconnecté`,
  linkedinCredentials: 'Votre session LinkedIn a expiré. Reconnectez le compte.',
  linkedinStopped: 'Le compte ne répond plus. Reconnectez-le pour reprendre les envois.',
  /** Une partie de la connexion demande une nouvelle authentification : même titre que le bandeau, même phrase que la carte. */
  linkedinPartialTitle: 'Connexion LinkedIn partielle',
  linkedinPartial: REASON_BY_CAUSE.authentication_partial.linkedin,
  /** Compte restreint : même titre que le bandeau et la notification, même phrase que la carte, sans « Reconnecter ». */
  linkedinLockedTitle: 'Compte LinkedIn restreint',
  linkedinLocked: REASON_LOCKED.linkedin,
  reconnectAction: 'Reconnecter',
  seeAction: 'Voir',
} as const;

// ---------------------------------------------------------------------------
// Assistant de connexion : départ
// ---------------------------------------------------------------------------

export const FLOW = {
  cancel: 'Annuler',
  back: 'Retour',
  continue: 'Continuer',
  close: 'Fermer',
  finish: 'Terminer',
  retry: 'Réessayer',
  restart: 'Recommencer',
  /** Parole d'attente d'une zone `role="status"`. */
  working: 'Connexion en cours…',
} as const;

const START_TITLE: Record<ConnectionProviderId, string> = {
  linkedin: 'Connecter votre compte LinkedIn',
  whatsapp: 'Connecter votre compte WhatsApp',
  google: 'Connecter Gmail',
  outlook: 'Connecter Outlook',
  imap: 'Connecter votre messagerie',
};

const RECONNECT_TITLE: Record<ConnectionProviderId, string> = {
  linkedin: 'Reconnecter votre compte LinkedIn',
  whatsapp: 'Reconnecter votre compte WhatsApp',
  google: 'Reconnecter Gmail',
  outlook: 'Reconnecter Outlook',
  imap: 'Reconnecter votre messagerie',
};

const START_BODY: Record<ConnectionChannel, string> = {
  linkedin:
    "Konekt cherche des candidats et écrit en votre nom depuis ce compte. Aucun message ne part tant que vous n'avez pas lancé de séquence.",
  whatsapp:
    "Les conversations de ce compte transitent par le service de connexion de Konekt. Seuls les échanges rattachés à vos candidats sont enregistrés.",
  email: "Konekt envoie vos messages de suivi d'entretien et lit les réponses depuis cette boîte.",
};

export function startTitle(provider: ConnectionProviderId, reconnect: boolean): string {
  return reconnect ? RECONNECT_TITLE[provider] : START_TITLE[provider];
}

export function startBody(provider: ConnectionProviderId): string {
  return START_BODY[PROVIDER_CHANNEL[provider]];
}

/** Reconnexion : le compte concerné est nommé, aucun autre ne convient. */
export function reconnectAccountLine(name: string): string {
  return `Compte concerné : ${name}. Seul ce compte peut être reconnecté ici.`;
}

/** Connexion standard (par défaut) : une page de connexion sécurisée, puis le retour dans Konekt. */
export const HOSTED = {
  linkedin: {
    body: 'Vous allez passer par une page de connexion sécurisée pour autoriser Konekt à utiliser votre compte LinkedIn. Vous reviendrez ensuite ici.',
    action: 'Continuer vers LinkedIn',
  },
  whatsapp: {
    body: "Vous allez passer par une page de connexion sécurisée pour associer WhatsApp. Un QR code ou un code d'association vous y sera proposé. Vous reviendrez ensuite ici.",
    action: 'Continuer vers WhatsApp',
  },
  google: {
    body: 'Vous allez passer par Google pour autoriser Konekt à lire et envoyer vos e-mails. Vous reviendrez ensuite ici.',
    action: 'Continuer vers Google',
  },
  outlook: {
    body: 'Vous allez passer par Microsoft pour autoriser Konekt à lire et envoyer vos e-mails. Vous reviendrez ensuite ici.',
    action: 'Continuer vers Microsoft',
  },
  imap: {
    body: 'Vous allez passer par une page de connexion sécurisée pour renseigner votre messagerie. Vous reviendrez ensuite ici.',
    action: 'Continuer',
  },
} as const satisfies Record<ConnectionProviderId, { body: string; action: string }>;

/** Ligne d'attente affichée pendant la redirection vers la page de connexion (même onglet). */
export const REDIRECTING = 'Redirection en cours…';

// ---------------------------------------------------------------------------
// LinkedIn : méthodes (écrans de connexion directe)
// ---------------------------------------------------------------------------

export const LINKEDIN_METHODS = {
  credentials: {
    title: 'Avec mon identifiant LinkedIn',
    badge: 'Recommandé',
    body: "Saisissez votre adresse e-mail ou téléphone et votre mot de passe. Konekt n'enregistre pas votre mot de passe.",
  },
  extension: {
    title: "Avec l'extension Chrome",
    body: 'Reconnectez-vous en un clic depuis un onglet LinkedIn déjà ouvert.',
  },
  cookie: {
    title: 'Avec un cookie (avancé)',
    body: 'À utiliser si la connexion par identifiant échoue.',
  },
} as const;

export const LINKEDIN_CREDENTIALS = {
  username: 'Adresse e-mail ou téléphone',
  password: 'Mot de passe',
  submit: 'Se connecter',
  submitting: 'Connexion à LinkedIn en cours…',
  advanced: 'Options avancées',
  country: 'Pays de connexion',
  countryHelp: "Les actions partent d'une adresse située dans ce pays, comme votre navigateur. LinkedIn ne voit ainsi qu'un seul pays.",
} as const;

export const LINKEDIN_COOKIE = {
  title: 'Connexion avancée avec un cookie',
  warning:
    "LinkedIn n'autorise qu'une session active par cookie. Si vous récupérez le cookie dans votre session principale, LinkedIn peut vous y déconnecter. Utilisez une fenêtre de navigation privée.",
  access: 'Cookie li_at',
  premium: 'Cookie li_a (Recruiter ou Sales Navigator, facultatif)',
  premiumHelp: "Évite que LinkedIn voie une deuxième session sur la licence.",
  guideTitle: 'Où trouver ce cookie ?',
  guideSteps: [
    'Ouvrez une fenêtre de navigation privée (Ctrl+Maj+N ou Cmd+Maj+N), puis connectez-vous à LinkedIn.',
    "Ouvrez les outils du navigateur (F12 ou Cmd+Option+I), onglet Application.",
    'Dans Cookies, choisissez le site linkedin.com.',
    'Copiez la valeur du cookie li_at, puis celle du cookie li_a si vous avez Recruiter ou Sales Navigator.',
    'Collez-les ici, puis fermez la fenêtre privée sans vous déconnecter.',
  ],
  submit: 'Connecter',
} as const;

// ---------------------------------------------------------------------------
// Vérifications demandées pendant la connexion (étape « checkpoint »)
// ---------------------------------------------------------------------------

export interface CheckpointInput {
  type: string;
  channel?: string | null;
  platform?: string | null;
}

export type CheckpointControl =
  | 'code'
  | 'wait'
  | 'phone'
  | 'challenge'
  | 'contract'
  | 'consent'
  | 'captcha'
  | 'pairing'
  | 'loading';

export interface CheckpointCopy {
  heading: string;
  body: string;
  control: CheckpointControl;
  /** Libellé du bouton principal, vide quand l'étape avance toute seule. */
  primary: string;
  /** La personne peut demander un nouvel envoi du code ou de la notification. */
  canResend: boolean;
}

export const CHECKPOINT_EYEBROW = (provider: ConnectionProviderId) => `Vérification demandée par ${PROVIDER_NAME[provider]}`;

const CODE_FIELD = 'Code de vérification';

function viaChannel(channel: string | null | undefined): { phrase: string; heading: string } {
  switch ((channel ?? '').toUpperCase()) {
    case 'EMAIL': return { phrase: 'par e-mail', heading: 'Saisissez le code reçu par e-mail' };
    case 'SMS': return { phrase: 'par SMS', heading: 'Saisissez le code reçu par SMS' };
    case 'WHATSAPP': return { phrase: 'sur WhatsApp', heading: 'Saisissez le code reçu sur WhatsApp' };
    default: return { phrase: '', heading: 'Saisissez le code de vérification' };
  }
}

/** Texte d'une étape de vérification, d'après son type (valeur du serveur, en majuscules). */
export function checkpointCopy(cp: CheckpointInput, provider: ConnectionProviderId = 'linkedin'): CheckpointCopy {
  const name = PROVIDER_NAME[provider];
  const type = cp.type.toUpperCase();
  switch (type) {
    case 'OTP': {
      const via = viaChannel(cp.channel);
      const body = cp.channel
        ? `${name} vous a envoyé un code ${via.phrase}. Il peut mettre une minute à arriver.${(cp.channel ?? '').toUpperCase() === 'EMAIL' ? ' Pensez à vérifier vos courriers indésirables.' : ''}`
        : `${name} vous a envoyé un code.`;
      return { heading: via.heading, body, control: 'code', primary: 'Vérifier', canResend: true };
    }
    case '2FA': {
      const platform = (cp.platform ?? '').toUpperCase();
      if (platform === 'APP') {
        return {
          heading: "Saisissez le code de votre application d'authentification",
          body: `Ouvrez l'application liée à votre compte ${name} et recopiez le code affiché.`,
          control: 'code',
          primary: 'Vérifier',
          canResend: false,
        };
      }
      const via = platform === 'WHATSAPP' ? 'sur WhatsApp' : 'par SMS';
      return {
        heading: `Saisissez le code d'authentification reçu ${via}`,
        body: `${name} vous a envoyé un code ${via}. Il peut mettre une minute à arriver.`,
        control: 'code',
        primary: 'Vérifier',
        canResend: true,
      };
    }
    case 'IN_APP_VALIDATION':
      return {
        heading: 'Validez la connexion sur votre téléphone',
        body: `${name} vous a envoyé une notification. Ouvrez l'application ${name} et confirmez que c'est bien vous.`,
        control: 'wait',
        primary: '',
        canResend: true,
      };
    case 'OTP_OR_IN_APP_VALIDATION':
      return {
        heading: 'Validez sur votre téléphone ou saisissez le code',
        body: `Confirmez la notification dans l'application ${name}, ou saisissez le code reçu.`,
        control: 'code',
        primary: 'Vérifier',
        canResend: true,
      };
    case 'PHONE_REGISTER':
      return {
        heading: `${name} demande un numéro de téléphone`,
        body: `${name} y enverra un code pour confirmer votre identité. Indiquez le numéro avec l'indicatif du pays, par exemple +33 6 12 34 56 78.`,
        control: 'phone',
        primary: 'Envoyer le code',
        canResend: false,
      };
    case 'CHALLENGE_SELECTION':
      return {
        heading: 'Choisissez comment vous vérifier',
        body: `${name} propose plusieurs méthodes.`,
        control: 'challenge',
        primary: FLOW.continue,
        canResend: false,
      };
    case 'CONTRACT_SELECTION':
      return {
        heading: 'Choisissez votre contrat LinkedIn',
        body: 'Votre compte donne accès à plusieurs contrats. Konekt utilisera celui que vous choisissez pour la recherche. Vous pourrez en changer plus tard dans Connexions.',
        control: 'contract',
        primary: FLOW.continue,
        canResend: false,
      };
    case 'CONSENT_SCREEN':
      return {
        heading: 'Choisissez ce que Konekt peut utiliser',
        body: "Konekt n'active que ce que vous cochez.",
        control: 'consent',
        primary: FLOW.continue,
        canResend: false,
      };
    case 'CAPTCHA':
      return {
        heading: 'Une vérification de sécurité est demandée',
        body: `${name} veut s'assurer que vous n'êtes pas un robot. Poursuivez sur la page de vérification, vous reviendrez ici ensuite.`,
        control: 'captcha',
        primary: 'Poursuivre la vérification',
        canResend: false,
      };
    case 'PAIRING_CODE':
      return {
        heading: 'Saisissez ce code dans WhatsApp',
        body: "Dans WhatsApp, ouvrez Appareils connectés, touchez Connecter un appareil, puis Associer avec le numéro de téléphone à la place.",
        control: 'pairing',
        primary: '',
        canResend: false,
      };
    case 'LOADING':
      return {
        heading: 'Finalisation en cours',
        body: 'Quelques secondes. Cette fenêtre se met à jour toute seule.',
        control: 'loading',
        primary: '',
        canResend: false,
      };
    default:
      return {
        heading: 'Une vérification est demandée',
        body: `${name} demande une étape de plus pour confirmer votre identité. Suivez les indications, puis réessayez.`,
        control: 'code',
        primary: 'Vérifier',
        canResend: false,
      };
  }
}

export const CHECKPOINT = {
  codeField: CODE_FIELD,
  phoneField: 'Numéro de téléphone',
  waiting: 'En attente de votre validation…',
  or: 'ou',
  resend: 'Renvoyer le code',
  resendNotification: 'Renvoyer la notification',
  resendIn: (seconds: number) => `Renvoyer le code dans ${seconds} s`,
  /** Validation sur le téléphone : il n'y a pas de code à renvoyer, seulement la notification. */
  resendNotificationIn: (seconds: number) => `Renvoyer la notification dans ${seconds} s`,
  resent: 'Code renvoyé.',
  anotherMethod: 'Essayer une autre méthode',
  noProduct: 'Choisissez au moins une option.',
  oneProduct: 'Recruiter et Sales Navigator ne fonctionnent pas en même temps. Choisissez-en un.',
  copyCode: 'Copier le code',
  codeCopied: 'Code copié.',
} as const;

/** Méthode de vérification proposée (CHALLENGE_SELECTION) : le mot de Konekt si l'identifiant est connu, sinon le libellé du serveur s'il est montrable. */
export function challengeLabel(id: string, serverLabel?: string | null): string {
  switch (id.toUpperCase()) {
    case 'EMAIL': return 'Par e-mail';
    case 'SMS': return 'Par SMS';
    case 'WHATSAPP': return 'Sur WhatsApp';
    default: return safeServerMessage(serverLabel) ?? 'Autre méthode';
  }
}

/** Contrat LinkedIn proposé (CONTRACT_SELECTION) : le nom du serveur s'il est montrable. */
export function contractLabel(name?: string | null): string {
  return safeServerMessage(name) ?? 'Contrat LinkedIn';
}

/** Les offres LinkedIn proposées pendant la connexion, dans les mots de Konekt. */
const PRODUCT_LABEL: Record<string, string> = {
  classic: 'Recherche et messages LinkedIn',
  recruiter: 'LinkedIn Recruiter',
  sales_navigator: 'Sales Navigator',
};

/** Libellé d'une offre : le mot de Konekt si l'identifiant est connu, sinon le nom du serveur s'il est montrable. */
export function productLabel(id: string, displayName?: string | null): string {
  const known = PRODUCT_LABEL[id.toLowerCase()];
  if (known) return known;
  return safeServerMessage(displayName) ?? 'Autre offre LinkedIn';
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

export const WHATSAPP = {
  qrTile: { title: 'Scanner un QR code', body: 'Depuis un ordinateur : scannez le code avec votre téléphone.' },
  pairingTile: { title: "Utiliser un code d'association", body: 'Depuis un téléphone : saisissez un code dans WhatsApp.' },
  qrHeading: 'Scannez ce code avec WhatsApp',
  qrSteps: [
    'Ouvrez WhatsApp sur votre téléphone.',
    'Allez dans Réglages, puis Appareils connectés.',
    'Touchez Connecter un appareil, puis scannez ce code.',
  ],
  qrGenerating: 'Création du code…',
  qrExpired: 'Ce code a expiré.',
  qrNew: 'Générer un nouveau code',
  qrAlt: 'QR code à scanner avec WhatsApp',
  scanned: 'Connexion en cours…',
  syncing: 'Synchronisation de vos conversations. Vous pouvez fermer cette fenêtre, elle continue en arrière-plan.',
  failed: "La connexion n'a pas abouti. Générez un nouveau code.",
  phoneField: 'Numéro WhatsApp',
  phoneHelp: 'Avec l\'indicatif du pays, par exemple +33 6 12 34 56 78.',
  phoneInvalid: "Ce numéro ne semble pas valide. Saisissez-le avec l'indicatif du pays, par exemple +33 6 12 34 56 78.",
  phoneNational: "Ajoutez l'indicatif du pays, par exemple +33 à la place du 0 de départ.",
  getCode: 'Obtenir le code',
  done: 'WhatsApp est connecté.',
  qrWaiting: 'En attente de votre scan…',
  pairingWaiting: 'En attente de la saisie du code dans WhatsApp…',
  pairingExpired: 'Ce code a expiré.',
  pairingAria: 'Code d\'association à saisir dans WhatsApp',
  otherMethod: 'Choisir une autre méthode',
} as const;

// ---------------------------------------------------------------------------
// Messagerie
// ---------------------------------------------------------------------------

export const EMAIL = {
  tiles: {
    google: { title: 'Gmail', body: 'Compte Google ou Google Workspace.' },
    outlook: { title: 'Outlook', body: 'Compte Microsoft ou Microsoft 365.' },
    imap: { title: 'Autre messagerie', body: 'Toute boîte qui accepte IMAP et SMTP.' },
  },
  address: 'Adresse e-mail',
  password: 'Mot de passe',
  serverSettings: 'Paramètres du serveur',
  incoming: 'Serveur de réception (IMAP)',
  outgoing: "Serveur d'envoi (SMTP)",
  host: 'Serveur',
  port: 'Port',
  encryption: 'Chiffrement',
  imapHelp: "Pour Gmail ou Outlook, utilisez plutôt le bouton dédié. Pour d'autres messageries, un mot de passe d'application est souvent nécessaire.",
  submit: 'Connecter',
  syncing: 'Synchronisation de votre boîte en cours.',
  settingsNotFound: "Konekt n'a pas trouvé les paramètres de votre messagerie. Renseignez-les ci-dessous.",
  refused: "Cette adresse ou ce mot de passe n'est pas accepté par votre messagerie.",
  consentRefused: "Autorisation refusée. Konekt a besoin de lire et d'envoyer des e-mails pour fonctionner.",
  chooserHint: 'Choisissez votre messagerie.',
  settingsHint: "Si votre messagerie n'est pas reconnue, renseignez les paramètres du serveur ci-dessous.",
  hostMissing: 'Indiquez le nom du serveur.',
  portInvalid: 'Le port est un nombre entre 1 et 65535.',
  serverPair: "Renseignez le serveur de réception et le serveur d'envoi, ou aucun des deux.",
  encryptionOptions: { default: 'Automatique', ssl: 'SSL', tls: 'TLS', starttls: 'STARTTLS' },
} as const;

// ---------------------------------------------------------------------------
// Succès
// ---------------------------------------------------------------------------

export function successTitle(provider: ConnectionProviderId, reconnect = false): string {
  if (provider === 'imap') return reconnect ? 'Votre messagerie est reconnectée.' : 'Votre messagerie est connectée.';
  const name = PROVIDER_NAME[provider];
  return reconnect ? `Votre compte ${name} est reconnecté.` : `Votre compte ${name} est connecté.`;
}

export const SUCCESS = {
  accountLine: (name: string) => `Compte : ${name}`,
  linkedinResumed: 'Les envois reprennent.',
  toast: (provider: ConnectionProviderId) => (provider === 'imap' ? 'Messagerie connectée.' : `Compte ${PROVIDER_NAME[provider]} connecté.`),
} as const;

// ---------------------------------------------------------------------------
// Erreurs (un seul décodeur pour tous les écrans)
// ---------------------------------------------------------------------------

export type ConnectionPhase = 'start' | 'checkpoint' | 'status';

export const GENERIC_FAILURE = "La connexion n'a pas abouti. Réessayez. Si le problème continue, écrivez-nous.";

/** Code posé par le navigateur quand l'appel n'a pas abouti (aucune réponse du serveur). */
export const NETWORK_LOST_CODE = 'network_lost';

/**
 * Texte d'un échec de connexion, choisi d'après le code du serveur (`error_code`)
 * et jamais d'après un texte de prestataire. Les codes `claim_*` sont ceux d'un
 * compte connecté mais refusé au rattachement.
 */
export function connectionErrorMessage(
  code: string | null | undefined,
  provider: ConnectionProviderId = 'linkedin',
  phase: ConnectionPhase = 'start',
): string {
  const name = PROVIDER_NAME[provider];
  switch (code) {
    case 'feature_disabled':
      return "La connexion directe n'est pas disponible. Utilisez la connexion standard.";
    case 'attempt_not_found':
      return 'Cette connexion est introuvable. Recommencez la connexion.';
    case 'attempt_expired':
      return 'Ce lien de connexion a expiré. Recommencez.';
    case 'attempt_closed':
      return 'Cette connexion est déjà terminée.';
    case 'already_linked_org':
    case 'claim_cross_tenant':
      return `Ce compte ${name} est déjà rattaché à un autre espace de travail.`;
    case 'already_linked_member':
    case 'claim_other_member':
      return `Ce compte ${name} est déjà rattaché à un autre membre de votre organisation.`;
    case 'revoked':
    case 'claim_revoked':
      return `Ce compte ${name} a été retiré de Konekt. Connectez-le de nouveau pour le rattacher.`;
    case 'wrong_account':
      return "Ce compte n'est pas celui que Konekt avait relié. Connectez le bon compte, ou dissociez-le d'abord.";
    case 'claim_expired':
    case 'claim_cancelled':
      return "Le compte s'est connecté après l'expiration du lien. Recommencez la connexion.";
    case 'rate_limited':
    case 'provider_limit':
      return 'Trop de tentatives. Patientez quelques minutes avant de réessayer.';
    case 'validation':
      return phase === 'checkpoint'
        ? "Ce code n'est pas valide. Vérifiez-le, puis réessayez."
        : "La connexion n'a pas abouti. Vérifiez vos informations, puis réessayez. Si le problème continue, écrivez-nous.";
    case 'auth':
      return phase === 'checkpoint'
        ? GENERIC_FAILURE
        : "La connexion n'a pas abouti. Vérifiez vos informations, puis réessayez. Si le problème continue, écrivez-nous.";
    case 'not_found':
      return phase === 'checkpoint' ? 'La vérification a expiré. Recommencez la connexion.' : GENERIC_FAILURE;
    case 'forbidden':
      return "Cette connexion n'est pas autorisée pour ce compte.";
    case 'account_disconnected':
    case 'account_degraded':
      return `${name} ne répond pas pour le moment. Réessayez dans quelques minutes.`;
    case 'server':
    case 'network':
    case 'uncertain':
      return `${name} ne répond pas pour le moment. Réessayez dans quelques minutes.`;
    case 'config':
      return "La connexion n'est pas configurée. Contactez le support Konekt.";
    case NETWORK_LOST_CODE:
      return 'Connexion interrompue. Réessayez.';
    default:
      if (typeof code === 'string' && code.startsWith('claim_')) {
        return `Le compte ${name} est connecté mais n'a pas pu être rattaché. Réessayez depuis Paramètres, Connexions.`;
      }
      return GENERIC_FAILURE;
  }
}

/**
 * Message d'un échec : le texte du code s'il est connu, sinon la phrase du
 * serveur si elle est montrable, sinon le texte général.
 */
export function failureMessage(
  code: string | null | undefined,
  serverText: unknown,
  provider: ConnectionProviderId = 'linkedin',
  phase: ConnectionPhase = 'start',
): string {
  const byCode = connectionErrorMessage(code, provider, phase);
  if (byCode !== GENERIC_FAILURE) return byCode;
  return safeServerMessage(serverText) ?? GENERIC_FAILURE;
}

/**
 * Message d'un geste sur un compte déjà relié (rattacher, dissocier) : la phrase
 * du serveur si elle est montrable, sinon celle de l'appel (déjà en français),
 * sinon le texte de repli du geste. Jamais un texte de prestataire.
 */
export function actionFailureMessage(serverText: unknown, callText: unknown, fallback: string): string {
  return safeServerMessage(serverText) ?? safeServerMessage(callText) ?? fallback;
}

// ---------------------------------------------------------------------------
// Page de retour (/settings/account/connections/retour)
// ---------------------------------------------------------------------------

export const RETURN_PAGE = {
  documentTitle: 'Retour de connexion',
  documentDescription: 'Résultat de la connexion de votre compte.',
  back: 'Retour aux connexions',
  recheck: 'Revérifier',
  recheckBusy: 'Vérification…',
  reading: 'Vérification de la connexion…',
  waiting: 'Quelques secondes. Cette page se met à jour toute seule.',
  slowTitle: 'La connexion met plus de temps que prévu.',
  slowBody: "Le compte n'est pas encore rattaché. Revérifiez dans un instant, ou retournez aux connexions : si le compte apparaît, c'est terminé.",
  failedTitle: "La connexion n'a pas abouti.",
  /** Remplace « Réessayez. » : la page de retour n'a pas de bouton pour relancer. */
  retryFromConnections: 'Recommencez depuis la page Connexions.',
  expiredTitle: 'Ce lien de connexion a expiré.',
  expiredBody: 'Recommencez la connexion depuis la page Connexions.',
  cancelledTitle: 'Cette connexion a été annulée.',
  cancelledBody: 'Rien n\'a été relié. Vous pouvez recommencer depuis la page Connexions.',
  invalidTitle: "Ce lien de connexion n'est pas valable.",
  invalidBody: 'Recommencez la connexion depuis la page Connexions.',
  notFoundTitle: 'Cette connexion est introuvable.',
  notFoundBody: 'Elle appartient peut-être à un autre compte, ou elle a déjà été supprimée. Recommencez la connexion depuis la page Connexions.',
  loadErrorTitle: 'Impossible de vérifier la connexion.',
  loadErrorBody: 'Vérifiez votre connexion internet, puis réessayez.',
  /** Connexion lancée depuis l'installation : la page ramène à l'installation, pas aux Paramètres. */
  backToOnboarding: "Reprendre l'installation",
} as const;

// ---------------------------------------------------------------------------
// Dissociation et retrait
// ---------------------------------------------------------------------------

export const UNLINK = {
  title: 'Dissocier ce compte ?',
  body: "Konekt n'enverra plus rien depuis ce compte. Les messages déjà enregistrés dans les fiches candidat sont conservés. Vous pourrez le reconnecter.",
  confirm: 'Dissocier',
  cancel: 'Annuler',
} as const;

export const REMOVE_ACCOUNT = {
  title: 'Retirer ce compte de Konekt ?',
  body: 'La suppression est définitive : pour reprendre, il faudra connecter à nouveau le compte. Les messages déjà enregistrés dans les fiches candidat sont conservés.',
  confirm: 'Retirer le compte',
  cancel: 'Annuler',
} as const;

export const DISCONNECT_WHATSAPP = {
  title: 'Déconnecter ce compte WhatsApp ?',
  body: 'Konekt ne pourra plus envoyer ni recevoir de messages avec ce compte. Les échanges déjà enregistrés dans les fiches candidat seront conservés. Vous pourrez le connecter de nouveau avec un nouveau code.',
  confirm: 'Déconnecter',
  cancel: 'Annuler',
} as const;

// ---------------------------------------------------------------------------
// Cartes de Connexions (Paramètres, Connexions), mode standard
// ---------------------------------------------------------------------------

/** Bouton qui part vers la page de connexion : libellés d'attente et mot du départ. */
export const HOSTED_BUTTON = {
  starting: 'Préparation…',
  redirecting: REDIRECTING,
  /** Sous le bouton : la personne sait qu'elle quitte Konekt quelques instants. */
  help: (provider: ConnectionProviderId) => (
    provider === 'imap' || provider === 'google' || provider === 'outlook'
      ? 'Vous passez par la page de connexion de votre messagerie, puis vous revenez ici.'
      : `Vous passez par ${PROVIDER_NAME[provider]} quelques instants, puis vous revenez ici.`
  ),
} as const;

export const CARD_COMMON = {
  retry: 'Réessayer',
  refresh: 'Actualiser',
  refreshing: 'Actualisation…',
  refreshAccounts: 'Rafraîchir les comptes',
  unlink: 'Dissocier',
  /** Relevé quand la liste n'a pas pu être relue : les derniers comptes reçus restent affichés. */
  staleList: 'Actualisation impossible. Les derniers comptes reçus restent affichés.',
  since: (date: string) => `Relié depuis le ${date}.`,
  offer: (label: string) => `Offre : ${label}`,
  checkedAgo: (when: string) => `Vérifié ${when}`,
} as const;

/** Offre LinkedIn du compte, dans les mots de Konekt. */
export const OFFER_LABEL = {
  recruiter: 'LinkedIn Recruiter',
  sales_navigator: 'Sales Navigator',
  classic: 'LinkedIn Classic',
} as const;

export const LINKEDIN_CARD = {
  title: 'Mon compte LinkedIn',
  loading: 'Chargement de votre compte LinkedIn…',
  loadErrorTitle: 'Impossible de charger votre compte LinkedIn pour le moment.',
  loadErrorKept: (name: string) => `Le compte ${name} reste relié à votre profil.`,
  loadErrorBody: 'Réessayez dans un instant.',
  notLinked: 'Connectez votre compte LinkedIn pour pouvoir effectuer des recherches et envoyer des messages.',
  availableOne: 'Compte disponible',
  availableMany: 'Comptes disponibles',
  availableHelp: "Ce compte est connecté dans votre organisation mais n'est relié à personne. S'il est le vôtre, rattachez-le. Sinon, connectez votre compte avec le bouton ci-dessus.",
  claim: "C'est mon compte",
  claimFailed: "Le compte LinkedIn n'a pas été associé.",
  connectedToast: 'Compte LinkedIn connecté.',
  connectedToastBody: 'Vous pouvez lancer votre première recherche dans une mission.',
  quotaErrorTitle: 'Impossible de charger vos plafonds du jour.',
  quotaErrorBody: 'Une pause en cours peut expliquer pourquoi rien ne part. Réessayez dans un instant.',
  unlinkTitle: 'Dissocier ce compte LinkedIn ?',
  unlinkBody:
    "Les relances qui partent de ce compte sont mises en pause et ses InMails programmés sont annulés. Votre compte LinkedIn et les messages déjà envoyés ne sont pas touchés. Si vous reliez de nouveau ce compte, vous reprendrez les relances depuis la liste des inscrits.",
  unlinkMissingBody:
    "La liaison vers ce compte est retirée. Les relances qui en partent sont mises en pause et ses InMails programmés sont annulés.",
} as const;

export const EMAIL_CARD = {
  title: 'Mon compte e-mail',
  loading: 'Chargement de votre compte e-mail…',
  mappingErrorTitle: "Impossible de lire l'association de votre compte e-mail.",
  listErrorTitle: 'Impossible de charger vos comptes e-mail.',
  errorBody: 'Vérifiez votre connexion, puis réessayez.',
  refreshAria: 'Actualiser la liste des comptes e-mail',
  /** La boîte visée est nommée : une personne qui en a plusieurs sait laquelle elle dissocie. */
  unlinkTitle: (address: string) => `Dissocier la boîte ${address} ?`,
  unlinkBody: "L'adresse ne sera plus rattachée à votre profil Konekt. Votre boîte e-mail et ses messages ne sont pas touchés, et vous pourrez la relier de nouveau.",
  unlinkedToast: (address: string) => `Boîte ${address} dissociée`,
  /** Noms accessibles des gestes d'une ligne : identiques d'une boîte à l'autre sans l'adresse. */
  unlinkAria: (address: string) => `Dissocier la boîte ${address}`,
  reconnectAria: (address: string) => `Reconnecter la boîte ${address}`,
  retryAria: (address: string) => `Réessayer de lire la boîte ${address}`,
  connectedToast: 'Votre compte e-mail est connecté.',
} as const;

export const WHATSAPP_CARD = {
  title: 'Mon compte WhatsApp',
  loading: 'Chargement de votre compte WhatsApp…',
  loadFailedTitle: 'Impossible de lire votre compte WhatsApp.',
  errorBody: 'Vérifiez votre connexion, puis réessayez.',
  intro: 'Reliez votre compte WhatsApp pour envoyer et retrouver vos échanges avec les candidats dans leur fiche.',
  privacy: "Konekt n'enregistre que les échanges avec vos candidats.",
  hostedHelp: "Vous passez par une page de connexion sécurisée : scannez un QR code ou saisissez un code d'association dans WhatsApp, puis vous revenez ici.",
  refreshAccounts: 'Actualiser les comptes',
  disconnectedToast: 'Compte WhatsApp déconnecté.',
  disconnectFailed: "Le compte WhatsApp n'a pas pu être déconnecté. Réessayez dans un instant.",
} as const;

/** Carte « Comptes LinkedIn de l'organisation » (Paramètres, Organisation). */
export const ORG_LINKEDIN_CARD = {
  description: "Voir quels membres sont connectés et qui doit se reconnecter. Chacun connecte son propre compte dans Connexions.",
  empty: 'Aucun compte LinkedIn connecté.',
  loading: 'Chargement des comptes LinkedIn…',
  loadErrorTitle: 'Impossible de charger les comptes LinkedIn.',
  goToConnections: 'Connecter mon compte',
  refreshAria: 'Actualiser la liste des comptes',
  ownedBy: (name: string) => `Membre : ${name}`,
  removeAria: (name: string) => `Retirer le compte ${name} de Konekt`,
  removeTooltip: 'Retirer de Konekt',
  removedToast: 'Compte LinkedIn retiré de Konekt.',
  removeFailed: "Le compte n'a pas pu être retiré. Réessayez dans un instant.",
  statusChecking: 'Vérification…',
  statusUnavailable: 'État indisponible',
  statusNone: 'Non connecté',
} as const;

/** Étape LinkedIn de l'installation (onboarding). */
export const ONBOARDING_LINKEDIN = {
  headingDone: "C'est branché.",
  headingTodo: 'Branchez votre compte LinkedIn.',
  bodyDone: "Konekt peut chercher et écrire depuis ce compte. Aucun message ne part tant que vous n'avez pas lancé de séquence.",
  bodyTodo: "Konekt cherche les candidats et écrit depuis votre compte. Aucun message ne part tant que vous n'avez pas lancé de séquence.",
  waitingTitle: 'LinkedIn confirme la connexion…',
  waitingBody: 'Quelques secondes. Cette page se met à jour toute seule.',
  refused: "LinkedIn n'a pas validé la connexion. Vous pouvez réessayer, ou continuer sans compte pour l'instant.",
  slow: 'La connexion met plus de temps que prévu à apparaître.',
  recheck: 'Revérifier',
  later: 'Plus tard',
  back: 'Retour',
  next: 'Voir mes premiers candidats',
  connected: 'Connecté',
} as const;

// ---------------------------------------------------------------------------
// Assistant de connexion directe (identifiants, cookie, QR code, code d'association)
// ---------------------------------------------------------------------------

/** Libellé du bouton discret qui ouvre l'assistant, à côté de la connexion standard. */
export function nativeTriggerLabel(provider: ConnectionProviderId, reconnect: boolean): string {
  switch (provider) {
    case 'linkedin': return reconnect ? 'Reconnecter avec mon identifiant' : 'Saisir mon identifiant LinkedIn';
    case 'whatsapp': return reconnect ? 'Reconnecter avec un QR code ou un code' : 'Scanner un QR code ou saisir un code';
    case 'imap': return reconnect ? 'Reconnecter avec mon mot de passe' : 'Connecter une autre messagerie';
    default: return reconnect ? ACTION_LABEL.reconnect : 'Connecter une autre messagerie';
  }
}

export const NATIVE = {
  reconnectOnly: 'Seul le compte déjà relié à Konekt peut être reconnecté ici.',
  passwordNotStored: "Konekt n'enregistre pas votre mot de passe.",
  showPassword: 'Afficher le mot de passe',
  hidePassword: 'Masquer le mot de passe',
  usernameMissing: 'Saisissez votre adresse e-mail ou votre numéro de téléphone.',
  passwordMissing: 'Saisissez votre mot de passe.',
  codeMissing: 'Saisissez le code reçu.',
  cookieMissing: 'Collez la valeur du cookie li_at.',
  browserMissing: "Ce navigateur ne permet pas la connexion avec un cookie. Utilisez votre identifiant, ou la connexion standard.",
  addressMissing: 'Saisissez votre adresse e-mail.',
  /** Phrase sous le bouton « Annuler » d'une vérification en cours : la personne sait ce que devient la tentative. */
  cancelling: 'Annulation…',
  copyFailed: 'Copie impossible. Recopiez le code à la main.',
  expiredStep: 'Ce code a expiré.',
  waitingTooLong: "La vérification n'a pas abouti à temps.",
  cookieSwitch: 'Revenir à la connexion par identifiant',
} as const;

/** Étape qui doit se terminer sur la page de connexion sécurisée (vérification de sécurité ou étape que l'écran ne sait pas afficher). */
export type FallbackCause = 'captcha' | 'unsupported';

export const FALLBACK = {
  heading: {
    captcha: 'Une vérification de sécurité est demandée',
    unsupported: 'Une étape de plus est demandée',
  },
  body: (provider: ConnectionProviderId, cause: FallbackCause): string => {
    const name = PROVIDER_NAME[provider];
    return cause === 'captcha'
      ? `${name} veut s'assurer que vous n'êtes pas un robot. Vous allez terminer cette vérification sur la page de connexion sécurisée, puis vous reviendrez ici.`
      : `${name} demande une vérification que Konekt ne peut pas afficher ici. Vous allez la terminer sur la page de connexion sécurisée, puis vous reviendrez ici.`;
  },
  starting: 'Préparation de la page de connexion…',
  redirecting: REDIRECTING,
} as const;
