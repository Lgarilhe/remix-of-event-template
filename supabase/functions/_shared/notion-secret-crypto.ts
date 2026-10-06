const KEY_VERSION = 1;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

let cachedKey: Promise<CryptoKey> | null = null;

function getEncryptionKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  cachedKey = (async () => {
    // A dedicated 32-byte secret can be supplied without a code change. The
    // server-only service key is a safe fallback and still keeps plaintext out
    // of database dumps, backups, SQL consoles and read-only replicas.
    const rootSecret = Deno.env.get('NOTION_TOKEN_ENCRYPTION_KEY')
      || Deno.env.get('SB_SECRET_KEY')
      || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!rootSecret) throw new Error('Notion encryption key is unavailable');
    const keyBytes = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`konekt:notion-secrets:v${KEY_VERSION}:${rootSecret}`),
    );
    return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  })();
  return cachedKey;
}

export interface EncryptedSecret {
  ciphertext: string;
  nonce: string;
  keyVersion: number;
}

export async function encryptNotionSecret(plaintext: string, context: string): Promise<EncryptedSecret> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: new TextEncoder().encode(context),
      tagLength: 128,
    },
    await getEncryptionKey(),
    new TextEncoder().encode(plaintext),
  );
  return {
    ciphertext: base64UrlEncode(new Uint8Array(encrypted)),
    nonce: base64UrlEncode(nonce),
    keyVersion: KEY_VERSION,
  };
}

export async function decryptNotionSecret(
  ciphertext: string,
  nonce: string,
  keyVersion: number,
  context: string,
): Promise<string> {
  if (keyVersion !== KEY_VERSION) throw new Error('Unsupported Notion secret key version');
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64UrlDecode(nonce),
      additionalData: new TextEncoder().encode(context),
      tagLength: 128,
    },
    await getEncryptionKey(),
    base64UrlDecode(ciphertext),
  );
  return new TextDecoder().decode(decrypted);
}

export async function encryptNotionTokens(
  accessToken: string,
  refreshToken: string,
  context: string,
): Promise<EncryptedSecret> {
  return encryptNotionSecret(JSON.stringify({ accessToken, refreshToken }), context);
}

export async function decryptNotionTokens(
  ciphertext: string,
  nonce: string,
  keyVersion: number,
  context: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const raw = await decryptNotionSecret(ciphertext, nonce, keyVersion, context);
  const parsed = JSON.parse(raw) as { accessToken?: unknown; refreshToken?: unknown };
  if (typeof parsed.accessToken !== 'string' || typeof parsed.refreshToken !== 'string') {
    throw new Error('Invalid encrypted Notion token payload');
  }
  return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
}
