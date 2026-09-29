// Faux prestataires (LinkedIn, IA, e-mail, Notion) pour la stack locale : chaque
// appel sortant des edge functions arrive ici, est journalisé et reçoit une
// réponse de succès. Personne n'est contacté.
//
//   GET    /__log                 journal complet
//   GET    /__log?account_id=X    appels d'un compte (isolation entre tests)
//   DELETE /__log                 vide le journal et les modes
//   POST   /__mode                { "<account_id>" | "*": { fail_send: 500, distance: "SECOND_DEGREE" } }
//
// Réponses scriptées, par compte (clé "*" : tous les comptes, à éviter entre
// tests parallèles) : la première route qui correspond gagne, `times` limite le
// nombre d'utilisations (absent = illimité), `delay_ms` simule un délai ou un
// timeout (le moteur coupe à 15 s).
//   POST /__mode { "<account_id>": { "routes": [
//     { "method": "POST", "path": "^/api/v1/chats$", "status": 500, "body": {...}, "delay_ms": 0, "times": 1 }
//   ] } }
// `url` à la place de `path` : expression sur le chemin et la chaîne de requête.
// Réponse de l'IA sans la clé "*" : { "<account_id>": { "ai_markers": { "<marqueur>": "<texte>" } } },
// rendue à tout appel à l'IA dont la requête contient le marqueur.
import http from 'node:http';

let log = [];
let modes = {};
let n = 0;
const PORT = Number(process.env.VENDOR_MOCK_PORT ?? 54340);

const send = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

// Champs texte d'un corps multipart (l'envoi de message LinkedIn est en form-data).
function multipartFields(raw, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? '');
  if (!m) return null;
  const boundary = `--${m[1] ?? m[2]}`;
  const fields = {};
  for (const part of raw.split(boundary)) {
    const name = /name="([^"]+)"/.exec(part)?.[1];
    if (!name || /filename=/.test(part)) continue;
    const value = part.split(/\r?\n\r?\n/).slice(1).join('\n\n').replace(/\r?\n--$/, '').replace(/\r?\n$/, '');
    fields[name] = fields[name] === undefined ? value : [].concat(fields[name], value);
  }
  return fields;
}

http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://mock');
    const p = url.pathname;
    if (p === '/__log') {
      if (req.method === 'DELETE') { log = []; modes = {}; return send(res, 200, { ok: true }); }
      const acc = url.searchParams.get('account_id');
      return send(res, 200, acc ? log.filter((e) => e.account_id === acc) : log);
    }
    if (p === '/__mode') { Object.assign(modes, raw ? JSON.parse(raw) : {}); return send(res, 200, modes); }

    let body = raw;
    try { body = JSON.parse(raw); } catch { body = multipartFields(raw, req.headers['content-type']) ?? raw; }
    const account_id = url.searchParams.get('account_id') ?? (body && typeof body === 'object' ? body.account_id : undefined) ?? null;
    log.push({ at: new Date().toISOString(), host: req.headers['x-original-host'] ?? null, method: req.method, path: p, query: Object.fromEntries(url.searchParams), account_id, body });
    const mode = { ...(modes['*'] ?? {}), ...(account_id ? modes[account_id] ?? {} : {}) };

    const routes = [...((account_id && modes[account_id]?.routes) || []), ...(modes['*']?.routes || [])];
    // `url` (au lieu de `path`) : expression appliquée au chemin suivi de la chaîne
    // de requête, pour distinguer les appels d'identifiants propres à une
    // organisation (unipile_dsn « unipile.mock?account_id=X&e2e= » : tout arrive sur « / »).
    const route = routes.find((r) => (!r.method || r.method === req.method)
      && (r.url !== undefined ? new RegExp(r.url).test(p + url.search) : new RegExp(r.path).test(p))
      && (r.times === undefined || r.times > 0));
    if (route) {
      if (route.times !== undefined) route.times -= 1;
      log[log.length - 1].scripted = true;
      const reply = () => send(res, route.status ?? 200, route.body ?? {});
      return route.delay_ms ? setTimeout(reply, route.delay_ms) : reply();
    }

    const isSend = req.method === 'POST'
      && (p === '/api/v1/chats' || /^\/api\/v1\/chats\/[^/]+\/messages$/.test(p) || p === '/api/v1/users/invite');
    if (isSend && mode.fail_send) {
      return send(res, mode.fail_send, { status: mode.fail_send, type: 'errors/mock_failure', title: 'Mock failure' });
    }
    n += 1;
    let m;
    // IA. Réponse par marqueur : un test pose { "<compte>": { "ai_markers": { "<marqueur>": "<texte>" } } }
    // et place le marqueur dans ce qu'il fait lire à l'IA (message, profil). Aucun
    // appel à l'IA ne porte de compte : sans marqueur, seule la clé '*' s'appliquerait.
    if (req.method === 'POST' && p === '/v1/messages') {
      const marked = Object.values(modes).flatMap((m) => Object.entries(m?.ai_markers ?? {}))
        .find(([marker]) => marker && raw.includes(marker));
      return send(res, 200, {
        id: `msg_ai_${n}`, type: 'message', role: 'assistant', model: body?.model ?? 'mock',
        content: [{ type: 'text', text: marked ? marked[1] : mode.ai_text ?? 'Bonjour, votre parcours m’intéresse. Seriez-vous ouvert à un échange ?' }],
        stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 },
      });
    }
    // LinkedIn
    const distance = mode.distance ?? 'FIRST_DEGREE';
    if (req.method === 'GET' && (m = p.match(/^\/api\/v1\/users\/([^/]+)$/)) && m[1] !== 'me') {
      const id = decodeURIComponent(m[1]);
      return send(res, 200, {
        object: 'UserProfile', provider: 'LINKEDIN',
        provider_id: id.startsWith('ACo') ? id : `ACoAAMOCK${id.replace(/[^a-zA-Z0-9]/g, '')}`,
        public_identifier: id, first_name: 'Test', last_name: 'Candidat', headline: 'Ingénieur',
        network_distance: distance, is_relationship: distance === 'FIRST_DEGREE', invitation: null,
      });
    }
    if (req.method === 'GET' && /^\/api\/v1\/chat_attendees\/[^/]+\/chats$/.test(p)) return send(res, 200, { object: 'ChatList', items: [], cursor: null });
    if (req.method === 'GET' && /^\/api\/v1\/chats\/[^/]+\/messages$/.test(p)) return send(res, 200, { object: 'MessageList', items: [], cursor: null });
    // Participants d'une conversation : le compte lui-même (is_self) et le candidat.
    if (req.method === 'GET' && /^\/api\/v1\/chats\/[^/]+\/attendees$/.test(p)) {
      return send(res, 200, { object: 'ChatAttendeeList', items: [
        { object: 'ChatAttendee', id: 'att_self', provider_id: 'ACoAAMOCKME', is_self: 1 },
        { object: 'ChatAttendee', id: 'att_candidate', provider_id: mode.candidate_provider_id ?? 'ACoAAMOCKCANDIDATE', is_self: 0 },
      ] });
    }
    if (req.method === 'POST' && p === '/api/v1/chats') return send(res, 201, { object: 'ChatStarted', chat_id: `chat_mock_${n}`, message_id: `msg_mock_${n}` });
    if (req.method === 'POST' && /^\/api\/v1\/chats\/[^/]+\/messages$/.test(p)) return send(res, 201, { object: 'MessageSent', message_id: `msg_mock_${n}` });
    if (req.method === 'POST' && p === '/api/v1/users/invite') return send(res, 201, { object: 'UserInvitationSent', invitation_id: `inv_mock_${n}` });
    if (p === '/api/v1/linkedin/inmail_balance') return send(res, 200, { object: 'InMailBalance', premium: 10, recruiter: 10, sales_navigator: 10 });
    if ((m = p.match(/^\/api\/v1\/accounts\/([^/]+)$/))) {
      return send(res, 200, {
        object: 'Account', id: m[1], type: 'LINKEDIN', name: 'Compte test',
        sources: [{ id: `${m[1]}_MESSAGING`, status: 'OK' }],
        connection_params: { im: { id: 'ACoAAMOCKME', premiumFeatures: ['recruiter'] } },
      });
    }
    return send(res, 200, { object: 'Mock', items: [] });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`vendor mock on ${PORT}`));
