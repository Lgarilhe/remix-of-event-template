/**
 * Assainit le HTML d'une signature e-mail avant de l'afficher dans l'application.
 *
 * Pourquoi : n'importe quel membre de l'organisation peut écrire une signature
 * (policy org_members_all en prod, email_signatures_* en base neuve) et les
 * autres l'ouvrent dans Paramètres › Rédaction. Injectée telle quelle, une
 * balise <img onerror> ou un lien javascript: s'exécutait dans la session de
 * celui qui l'ouvre (XSS stockée entre membres).
 *
 * On assainit à l'affichage seulement : le contenu stocké et l'e-mail envoyé
 * (sequence-send-email) ne changent pas.
 *
 * Liste blanche, appliquée par DOMPurify puis resserrée balise par balise :
 *  - balises : mise en forme simple, liens, images, listes, tableaux simples ;
 *  - attributs : ceux de SIGNATURE_ATTRS_BY_TAG, rien d'autre (ni on*, ni style,
 *    ni class, ni id, ni data-*) : aucun style en ligne n'est conservé ;
 *  - liens : http, https, mailto et tel seulement, ouverts dans un nouvel onglet
 *    avec rel="noopener noreferrer" ;
 *  - images : https ou image matricielle embarquée (png, jpeg, gif, webp) ;
 *    une autre source retire l'image.
 * Hors navigateur (pas de DOM), la fonction renvoie une chaîne vide : on ne
 * rend jamais du HTML non assaini.
 *
 * Ne pas élargir ces listes sans revue de sécurité.
 */
import DOMPurify from 'dompurify';

export const SIGNATURE_ALLOWED_TAGS: readonly string[] = [
  'a', 'b', 'strong', 'i', 'em', 'u', 'br', 'p', 'div', 'span', 'small', 'hr', 'font',
  'ul', 'ol', 'li', 'img', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
];

// Attributs permis, par balise. Une balise absente de cette table n'en garde aucun.
export const SIGNATURE_ATTRS_BY_TAG: Readonly<Record<string, readonly string[]>> = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'width', 'height'],
  font: ['color', 'size', 'face'],
  table: ['border', 'cellpadding', 'cellspacing', 'width'],
  td: ['colspan', 'rowspan', 'align', 'valign', 'width'],
  th: ['colspan', 'rowspan', 'align', 'valign', 'width'],
};

// Attributs qui ne portent pas d'URL : DOMPurify ne doit pas leur appliquer le
// filtre d'URL ci-dessous (sinon width="200" ou color="red" seraient retirés).
const NON_URL_ATTRS = ['title', 'alt', 'width', 'height', 'color', 'size', 'face',
  'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'align', 'valign'];

const SAFE_HREF = /^(?:https?:\/\/|mailto:|tel:)/i;
const SAFE_IMG_SRC = /^(?:https:\/\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i;

/** Lien conservé dans l'aperçu : web, e-mail ou téléphone. */
export const isSafeSignatureHref = (href: string): boolean => SAFE_HREF.test(href.trim());

/** Image conservée dans l'aperçu : https ou image matricielle embarquée. */
export const isSafeSignatureImageSrc = (src: string): boolean => SAFE_IMG_SRC.test(src.trim());

const CONFIG = {
  ALLOWED_TAGS: [...SIGNATURE_ALLOWED_TAGS],
  ALLOWED_ATTR: Array.from(new Set(Object.values(SIGNATURE_ATTRS_BY_TAG).flat())),
  ADD_URI_SAFE_ATTR: NON_URL_ATTRS,
  ALLOWED_URI_REGEXP: SAFE_HREF,
  FORBID_ATTR: ['style', 'class', 'id'],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
};

// Resserre ce que DOMPurify a gardé : attributs par balise, liens et images.
const restrictToSignature = (node: Element): void => {
  const tag = node.nodeName.toLowerCase();
  const allowed = SIGNATURE_ATTRS_BY_TAG[tag] ?? [];
  for (const attr of Array.from(node.attributes)) {
    if (!allowed.includes(attr.name)) node.removeAttribute(attr.name);
  }
  if (tag === 'a') {
    const href = node.getAttribute('href');
    if (href !== null && !isSafeSignatureHref(href)) node.removeAttribute('href');
    // Un clic dans l'aperçu ne quitte pas le formulaire.
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  if (tag === 'img' && !isSafeSignatureImageSrc(node.getAttribute('src') ?? '')) {
    node.remove();
  }
};

// Instance dédiée : le crochet ne s'applique pas aux autres usages de DOMPurify.
let purifier: ReturnType<typeof DOMPurify> | null = null;

export const sanitizeSignatureHtml = (html: string): string => {
  if (!html || typeof window === 'undefined') return '';
  if (!purifier) {
    const instance = DOMPurify(window);
    instance.addHook('afterSanitizeAttributes', restrictToSignature);
    purifier = instance;
  }
  // Sans DOM complet, DOMPurify rendrait l'entrée telle quelle : on n'affiche rien.
  if (!purifier.isSupported) return '';
  return purifier.sanitize(html, CONFIG);
};
