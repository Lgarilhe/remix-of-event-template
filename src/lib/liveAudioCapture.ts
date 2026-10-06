/**
 * Capture de la voix du candidat pour l'assistant d'entretien en direct.
 *
 * Le micro seul n'entend pas le candidat quand on porte un casque : sa voix ne
 * passe que dans les écouteurs. Le navigateur sait partager l'audio d'un onglet
 * (Meet ou Teams dans le navigateur) ou du système (application installée,
 * Windows seulement) par la fenêtre de partage d'écran. Chaque source a sa
 * propre transcription : le micro est le recruteur, l'audio partagé le candidat.
 * Aucune distinction des voix à deviner, et aucun mélange des deux flux.
 */

/** « meeting » : micro et audio partagé. « mic » : micro seul (sur place, haut-parleur). */
export type CaptureMode = 'meeting' | 'mic';

/** Origine d'un flux transcrit : le micro de la personne, ou l'audio partagé de la visio. */
export type SpeakerSource = 'mic' | 'meeting';

export type DisplayAudioFailure = 'unsupported' | 'cancelled' | 'no-audio' | 'failed';

/** Partage refusé ou sans son : la raison se dit telle quelle à l'écran. */
export class DisplayAudioError extends Error {
  reason: DisplayAudioFailure;

  constructor(reason: DisplayAudioFailure) {
    super(reason);
    this.reason = reason;
  }
}

interface SupportInput {
  userAgent: string;
  hasGetDisplayMedia: boolean;
  /** navigator.userAgentData.brands, quand le navigateur le fournit. */
  brands?: string[];
  /** navigator.userAgentData.mobile. */
  mobile?: boolean;
}

/**
 * Le partage d'audio n'existe que dans les navigateurs Chromium sur ordinateur
 * (Chrome, Edge, Opera, Brave) : Firefox et Safari ouvrent le partage d'écran
 * sans son, et les navigateurs mobiles ne partagent rien. Aucune détection par
 * fonctionnalité n'existe pour l'audio, d'où le test du navigateur.
 */
export function supportsDisplayAudio({ userAgent, hasGetDisplayMedia, brands, mobile }: SupportInput): boolean {
  if (!hasGetDisplayMedia) return false;
  if (mobile || /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return false;
  const chromium = (brands ?? []).some((brand) => /Chromium/i.test(brand)) || /\b(?:Chrome|Chromium|Edg|OPR)\//.test(userAgent);
  return chromium;
}

interface NavigatorWithUserAgentData extends Navigator {
  userAgentData?: { brands?: { brand: string }[]; mobile?: boolean };
}

export function displayAudioSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as NavigatorWithUserAgentData;
  return supportsDisplayAudio({
    userAgent: nav.userAgent,
    hasGetDisplayMedia: typeof nav.mediaDevices?.getDisplayMedia === 'function',
    brands: nav.userAgentData?.brands?.map((entry) => entry.brand),
    mobile: nav.userAgentData?.mobile,
  });
}

export interface DisplayAudioCapture {
  /** Piste audio seule : c'est elle qui est transcrite. */
  stream: MediaStream;
  /** Pistes du partage, audio et vidéo : leur fin signale que le partage s'est arrêté. */
  watched: MediaStreamTrack[];
  /** Arrête le partage (audio et vidéo). */
  release: () => void;
}

/**
 * Ouvre la fenêtre de partage et rend l'audio choisi. À appeler dans le geste de
 * la personne (clic) : le navigateur refuse sinon.
 *
 * La vidéo n'est pas utilisée : demandée au minimum (160 x 90, une image par
 * seconde), elle garde le partage ouvert et sert de témoin à son arrêt.
 * L'audio n'est ni débruité ni égalisé : c'est un son numérique, pas une prise
 * de son, et l'annulation d'écho y supprimerait la voix du candidat.
 */
export async function captureDisplayAudio(): Promise<DisplayAudioCapture> {
  if (!displayAudioSupported()) throw new DisplayAudioError('unsupported');

  let shared: MediaStream;
  try {
    shared = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 1, width: 160, height: 90 },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      // Konekt lui-même n'est pas proposé dans la fenêtre de partage.
      selfBrowserSurface: 'exclude',
      systemAudio: 'include',
    } as DisplayMediaStreamOptions);
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    // Fenêtre fermée ou partage refusé : la personne a renoncé, ce n'est pas une panne.
    throw new DisplayAudioError(name === 'NotAllowedError' ? 'cancelled' : 'failed');
  }

  const audioTracks = shared.getAudioTracks();
  if (audioTracks.length === 0) {
    shared.getTracks().forEach((track) => track.stop());
    throw new DisplayAudioError('no-audio');
  }

  return {
    stream: new MediaStream(audioTracks),
    watched: shared.getTracks(),
    release: () => shared.getTracks().forEach((track) => track.stop()),
  };
}

/** Adresse de la transcription en direct. Une seule piste mélangée : le service distingue les voix. */
export function transcriptionUrl(diarize: boolean): string {
  return (
    'wss://api.deepgram.com/v1/listen?' +
    new URLSearchParams({
      model: 'nova-3',
      language: 'fr',
      punctuate: 'true',
      smart_format: 'true',
      interim_results: 'true',
      utterance_end_ms: '1500',
      endpointing: '300',
      vad_events: 'true',
      diarize: String(diarize),
    }).toString()
  );
}

/** Format d'enregistrement du navigateur : webm opus quand il le sait, sinon son défaut. */
export function recorderOptions(): MediaRecorderOptions | undefined {
  const mimeType = 'audio/webm;codecs=opus';
  return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(mimeType) ? { mimeType } : undefined;
}

/**
 * Texte ajouté à la transcription pour une phrase finale. Avec deux sources, les
 * voix sont connues : chaque changement de locuteur ouvre une ligne « [Candidat] »
 * ou « [Recruteur] », pour que l'analyse sache qui parle. Avec une seule piste, la
 * distinction des voix peut se tromper : le texte reste continu, comme avant.
 */
export function turnPiece(
  lastSpeaker: number | null,
  speaker: number,
  text: string,
  labelled: boolean,
  label: (speaker: number) => string,
): string {
  if (!labelled) return ' ' + text;
  return lastSpeaker === speaker ? ' ' + text : `\n[${label(speaker)}] ${text}`;
}

const CAPTURE_MODE_KEY = 'konekt.live-capture-mode';

/** Dernier choix de la personne, « visio ou appel » à défaut. */
export function readCaptureMode(): CaptureMode {
  try {
    return localStorage.getItem(CAPTURE_MODE_KEY) === 'mic' ? 'mic' : 'meeting';
  } catch {
    return 'meeting';
  }
}

export function storeCaptureMode(mode: CaptureMode): void {
  try {
    localStorage.setItem(CAPTURE_MODE_KEY, mode);
  } catch {
    // Stockage indisponible (navigation privée) : le choix vaut pour cette séance seulement.
  }
}
