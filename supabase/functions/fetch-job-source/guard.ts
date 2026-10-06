// Garde-fous SSRF de fetch-job-source. Fonctions pures, sans API Deno : elles
// sont testées sous Node (tests/ux/lecture-offres.test.mjs).
//
// La fonction lit des adresses saisies par les utilisateurs. Sans garde, elle
// servirait à interroger le réseau interne de l'hébergeur (adresses privées,
// service de métadonnées, localhost). Règles : https seulement, port 443, un
// nom de domaine public (jamais une adresse IP), et, côté serveur, chaque adresse
// IP obtenue par la résolution DNS doit être publique (isPrivateIp).

/** Quatre octets d'une adresse IPv4 écrite en décimal pointé, sinon null. */
export function parseIpv4(value: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

/** Vrai pour une adresse hors d'Internet public : privée, loopback, lien local, réservée, multicast. */
export function isPrivateIp(ip: string): boolean {
  const v4 = parseIpv4(ip);
  if (v4) {
    const [a, b] = v4;
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||   // partage d'adresses des opérateurs (CGNAT)
      (a === 169 && b === 254) ||              // lien local, dont le service de métadonnées cloud
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||                // réservées IETF
      (a === 198 && (b === 18 || b === 19)) || // bancs d'essai
      a >= 224                                 // multicast et réservées
    );
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v6 === "::" || v6 === "::1") return true;
  if (/^f[cd]/.test(v6)) return true;           // fc00::/7, adresses locales uniques
  if (/^fe[89ab]/.test(v6)) return true;        // fe80::/10, lien local
  if (/^ff/.test(v6)) return true;              // multicast
  // IPv4 inscrite dans une IPv6 : ::ffff:10.0.0.1 ou ::ffff:0a00:0001
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (dotted) return isPrivateIp(dotted[1]);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return false;
}

const INTERNAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".private"];
export const MAX_URL_LENGTH = 2048;

export type UrlCheck =
  | { ok: true; url: URL }
  | { ok: false; reason: "invalid" | "not_https" | "credentials" | "port" | "private_host" };

/**
 * Valide une adresse avant toute lecture. `new URL` ramène déjà les écritures
 * décimales, octales et hexadécimales d'une IPv4 (2130706433, 0x7f.1) à la forme
 * pointée, ce que le test d'adresse IP ci-dessous attrape.
 */
export function checkPublicHttpsUrl(raw: string): UrlCheck {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL_LENGTH) {
    return { ok: false, reason: "invalid" };
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  if (url.port && url.port !== "443") return { ok: false, reason: "port" };

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".")) return { ok: false, reason: "private_host" }; // « localhost », « intranet »
  if (host.startsWith("[") || host.includes(":")) return { ok: false, reason: "private_host" }; // IPv6
  if (parseIpv4(host)) return { ok: false, reason: "private_host" };     // aucune adresse IP, publique ou non
  if (INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return { ok: false, reason: "private_host" };
  // new URL a déjà converti un nom international en ASCII (xn--…).
  if (!/^[a-z0-9.-]+$/.test(host)) return { ok: false, reason: "invalid" };
  return { ok: true, url };
}
