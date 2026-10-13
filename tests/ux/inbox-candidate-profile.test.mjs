import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
async function load(file, stubs = {}) {
  const { outputFiles } = await build({ entryPoints: [path.join(root, file)], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', plugins: [{ name: 'test-sources', setup(b) {
    b.onResolve({ filter: /.*/ }, ({ path: name }) => {
      if (name in stubs) return { path: name, namespace: 'stub' };
      if (name.startsWith('@/')) {
        const base = path.join(root, 'src', name.slice(2));
        return { path: [base + '.ts', base + '.tsx'].find(existsSync) };
      }
    });
    b.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path: name }) => ({ contents: stubs[name], loader: 'js' }));
  } }] });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}
const profile = await load('src/lib/candidateProfile.ts');
const scopeStubs = {
  '@tanstack/react-query': 'export const useQuery = options => { globalThis.profileOptions = options; return {}; }; export const useMutation = options => options; export const useQueryClient = () => ({setQueryData(key,data){globalThis.profileCacheWrite={key,data};}});',
  '@/hooks/useOrganization': 'export const useOrganization = () => ({organizationId:globalThis.profileOrg});',
  '@/hooks/useAuthReady': 'export const useAuthReady = () => ({user:globalThis.profileUser ? {id:globalThis.profileUser} : null,isReady:true});',
  '@/hooks/useMyLinkedInAccountId': 'export const useMyLinkedInAccountId = () => globalThis.profileAccount;',
  '@/lib/invokeUnipile': 'export const invokeUnipile = options => globalThis.profileInvoke(options.body);',
  '@/lib/quotaEvents': 'export const emitQuotaAction = (...args) => { if (globalThis.profileQuotaEvents) globalThis.profileQuotaEvents.push(args); };',
};
const profiles = await load('src/hooks/useInboxCandidateProfile.ts', { ...scopeStubs, '@/integrations/supabase/client': 'export const supabase = {from: table => globalThis.profileQuery(table)};' });
const messages = await load('src/hooks/useCandidateMessages.ts', scopeStubs);

function storedRead(result = { data: [], error: null }) {
  globalThis.profileQuery = () => {
    const query = { then: resolve => Promise.resolve(result).then(resolve) };
    for (const method of ['select', 'eq', 'in', 'not', 'order', 'limit', 'ilike']) query[method] = () => query;
    return query;
  };
}

test('Le profil conserve tous les postes, formations et compétences des formats historiques', () => {
  const result = profile.normalizeCandidateProfile({ about:'Présentation', positions:Array.from({length:8}, (_,i) => ({title:`Poste ${i}`,company:{name:`Entreprise ${i}`},start_date:{year:2010+i},end_date:{year:2011+i}})), educations:Array.from({length:5}, (_,i) => ({school_name:`École ${i}`,degree_name:'Master'})), skills:Array.from({length:12}, (_,i) => `Compétence ${i}`), languages:['Français'], certifications:[{name:'Certificat',authority:{name:'École'}}] }, 'candidate');
  assert.equal(result.summary,'Présentation');
  assert.equal(result.work_experience.length,8);
  assert.equal(result.work_experience[7].role,'Poste 7');
  assert.equal(result.work_experience[7].company,'Entreprise 7');
  assert.equal(result.education.length,5);
  assert.equal(result.skills.length,12);
  assert.equal(result.languages[0].name,'Français');
  assert.equal(result.certifications[0].organization,'École');
  const logos = profile.normalizeCandidateProfile({ work_experience:[{company:'Entreprise',company_logo:'company.svg'}], education:[{school_details:{name:'École',logo:'school.svg'}}] }, 'candidate');
  assert.equal(logos.work_experience[0].company_picture_url,'company.svg');
  assert.equal(logos.education[0].school,'École');
  assert.equal(logos.education[0].school_picture_url,'school.svg');
  assert.equal(profile.normalizeCandidateProfile(logos,'candidate').education[0].school_picture_url,'school.svg');
});
test('Un slug public doit provenir exactement de LinkedIn, sans rapprocher des candidats homonymes', () => {
  assert.equal(profile.candidateLinkedInSlug('https://fr.linkedin.com/in/Camille/?trk=test'),'camille');
  assert.equal(profile.candidateLinkedInSlug('https://evil-linkedin.com/in/camille'),null);
  assert.equal(profile.candidateLinkedInSlug('https://example.test/linkedin.com/in/camille'),null);
});
test('Le profil enregistré est isolé par organisation et conserve le snapshot le plus complet', async () => {
  const requests=[];
  globalThis.profileInvoke=()=>{throw new Error('Le cache complet doit suffire');};
  globalThis.profileQuery=table=>{
    const ops=[]; const q={then(resolve){requests.push({table,ops});return Promise.resolve({data:[{candidate_id:'other',linkedin_profile_url:'https://linkedin.com/in/camille-autre',linkedin_profile_data:{summary:'Autre candidat'}},{candidate_id:'candidate',linkedin_profile_url:'https://linkedin.com/in/camille',linkedin_profile_data:{headline:'Snapshot récent'}},{candidate_id:'candidate',linkedin_profile_url:'https://linkedin.com/in/camille',linkedin_profile_data:{summary:'Profil complet',work_experience:[{role:'Ingénieure'}]}}],error:null}).then(resolve);}};
    for(const method of ['select','eq','in','not','order','limit','ilike']) q[method]=(...args)=>{ops.push([method,args]);return q;};return q;
  };
  const result=await profiles.fetchInboxCandidateProfile('org-a',['candidate'],'https://linkedin.com/in/camille','Camille',null);
  assert.equal(result.summary,'Profil complet');
  assert.equal(result.work_experience.length,1);
  assert.ok(requests.every(r=>r.ops.some(([method,args])=>method==='eq'&&args[0]==='organization_id'&&args[1]==='org-a')));
  const byUrl=await profiles.fetchInboxCandidateProfile('org-a',[],'https://linkedin.com/in/camille','Camille',null);
  assert.equal(byUrl.summary,'Profil complet');
});
test('Changer de personne, organisation, compte ou utilisateur change les caches des deux vues', () => {
  globalThis.profileUser='user-a';globalThis.profileOrg='org-a';globalThis.profileAccount='my-account';
  for(const hook of [profiles.useInboxCandidateProfile,messages.useCandidateMessages]){
    hook({profileId:'a'});const original=JSON.stringify(globalThis.profileOptions.queryKey);
    hook({profileId:'b'});assert.notEqual(JSON.stringify(globalThis.profileOptions.queryKey),original);
    globalThis.profileOrg='org-b';hook({profileId:'a'});assert.notEqual(JSON.stringify(globalThis.profileOptions.queryKey),original);
    globalThis.profileOrg='org-a';globalThis.profileUser='user-b';hook({profileId:'a'});assert.notEqual(JSON.stringify(globalThis.profileOptions.queryKey),original);
    globalThis.profileUser='user-a';globalThis.profileAccount='other-account';hook({profileId:'a'});assert.notEqual(JSON.stringify(globalThis.profileOptions.queryKey),original);
    globalThis.profileAccount='my-account';
  }
  globalThis.profileAccount=null;messages.useCandidateMessages({profileId:'a'});assert.equal(globalThis.profileOptions.enabled,false);
  globalThis.profileUser=null;profiles.useInboxCandidateProfile({profileId:'a'});assert.equal(globalThis.profileOptions.enabled,false);
});
test('Les conversations et messages parcourent les curseurs et plusieurs chats, sans dupliquer les pages', async () => {
  const requests=[];
  globalThis.profileInvoke=async body=>{
    requests.push(body);
    if(body.action==='get_chats') return {data:{success:true,chats:body.cursor ? [{id:'chat-2',timestamp:'2026-10-07'}] : [{id:'chat-1',timestamp:'2026-10-06'}],cursor:body.cursor ? null : 'next-chat'}};
    if(body.chat_id==='chat-1') return {data:{success:true,messages:body.cursor ? [{id:'message-1'},{id:'older',text:'Message ancien'}] : [{id:'message-1'}],cursor:body.cursor ? null : 'next-message'}};
    return {data:{success:true,messages:[{id:'message-2',text:'Autre conversation'}]}};
  };
  const result=await messages.fetchCandidateMessages('org-a','my-account',['provider','alias']);
  assert.equal(result.chats.length,2);assert.equal(result.messages.length,3);
  assert.ok(result.messages.some(m=>m.id==='older'));
  assert.ok(requests.every(r=>r.organization_id==='org-a'&&r.account_id==='my-account'));
});
test('Une panne des messages ne devient pas une conversation vide et un curseur répété arrête la pagination', async () => {
  globalThis.profileInvoke=async body=>({data:body.action==='get_chats'?{success:true,chats:[{id:'chat'}]}:{success:false}});
  await assert.rejects(()=>messages.fetchCandidateMessages('org','mine',['candidate']),/indisponibles/);
  globalThis.profileInvoke=async()=>({data:{success:true,chats:[{id:'chat'}],cursor:'same'}});
  await assert.rejects(()=>messages.fetchCandidateMessages('org','mine',['candidate']),/incomplet/);
});
test('Une fiche importée retrouve le véritable identifiant LinkedIn à partir de son URL', async () => {
  const requests=[];
  globalThis.profileInvoke=async body=>{
    requests.push(body);
    return {data:body.action==='get_profile'?{success:true,profile:{provider_id:'resolved'}}:body.attendee_provider_id==='resolved'?{success:true,chats:[{id:'chat'}]}:body.action==='get_messages'?{success:true,messages:[{id:'message'}]}:{success:true,chats:[]}};
  };
  const result=await messages.fetchCandidateMessages('org','mine',['internal-id'],'https://linkedin.com/in/camille');
  assert.equal(result.messages.length,1);
  assert.ok(requests.some(r=>r.attendee_provider_id==='resolved'));
});
test('Une actualisation tardive du profil reste dans son organisation de départ', async () => {
  globalThis.profileUser='user-a';globalThis.profileOrg='org-a';globalThis.profileAccount='mine';
  let resolve;
  globalThis.profileInvoke=()=>new Promise(r=>{resolve=r;});
  const original=profiles.useInboxCandidateProfile({profileId:'a',profileUrl:'https://linkedin.com/in/a'});
  const pending=original.refresh.mutationFn();
  globalThis.profileOrg='org-b';const latest=profiles.useInboxCandidateProfile({profileId:'a',profileUrl:'https://linkedin.com/in/a'});
  resolve({data:{success:true,profile:{summary:'Organisation A'}}});
  latest.refresh.onSuccess(await pending);
  assert.equal(globalThis.profileCacheWrite.key[2],'org-a');
  assert.equal(globalThis.profileCacheWrite.data.summary,'Organisation A');
});

test('La messagerie consulte le véritable identifiant LinkedIn avant le slug public, sans trier les alias', async () => {
  storedRead();
  globalThis.profileUser = 'user-a';
  globalThis.profileOrg = 'org-a';
  globalThis.profileAccount = 'mine';
  globalThis.profileQuotaEvents = [];
  const requests = [];
  globalThis.profileInvoke = async body => {
    requests.push(body);
    return { data: { success: true, profile: { summary: 'Profil complet', provider_id: 'ACoZZZ-provider' } }, httpStatus: 200 };
  };
  profiles.useInboxCandidateProfile({ profileId: 'ACoZZZ-provider', aliases: ['AEMAAA-recruiter', 'ACoZZZ-provider'], profileUrl: 'https://linkedin.com/in/camille' });
  const options = globalThis.profileOptions;
  const result = await options.queryFn();
  assert.equal(result.summary, 'Profil complet');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].profile_id, 'ACoZZZ-provider');
  assert.equal(requests[0].organization_id, 'org-a');
  assert.equal(requests[0].account_id, 'mine');
  assert.deepEqual(globalThis.profileQuotaEvents, [['profileVisits', 1, 'mine']]);
  profiles.useInboxCandidateProfile({ profileId: 'AEMAAA-recruiter', aliases: ['ACoZZZ-provider'], profileUrl: 'https://linkedin.com/in/camille' });
  assert.notDeepEqual(globalThis.profileOptions.queryKey, options.queryKey, 'La priorité du profil appartient au contexte du cache');
  await globalThis.profileOptions.queryFn();
  assert.equal(requests[1].profile_id, 'AEMAAA-recruiter');
  globalThis.profileQuotaEvents = null;
});

for (const failure of [
  { label: '404 profil absent sans message', httpStatus: 404, data: { success: false, errorType: 'PROFILE_NOT_FOUND' } },
  { label: '404 profil absent', httpStatus: 404, data: { success: false, errorType: 'PROFILE_NOT_FOUND', error: 'Unipile internal error' } },
]) {
  test(`${failure.label} : une seule reprise par URL publique après un identifiant absent`, async () => {
    storedRead();
    const requests = [];
    globalThis.profileQuotaEvents = [];
    globalThis.profileInvoke = async body => {
      requests.push(body);
      return requests.length === 1 ? failure : { httpStatus: 200, data: { success: true, profile: { summary: 'Profil retrouvé', provider_id: 'ACo-resolved' } } };
    };
    const result = await profiles.fetchInboxCandidateProfile('org', ['ACo-missing', 'AEM-alias'], 'https://fr.linkedin.com/in/Camille/?trk=inbox', 'Camille', 'mine');
    assert.equal(result.summary, 'Profil retrouvé');
    assert.deepEqual(requests.map(body => body.profile_id), ['ACo-missing', 'camille']);
    assert.ok(requests.every(body => body.organization_id === 'org' && body.account_id === 'mine'));
    assert.deepEqual(globalThis.profileQuotaEvents, [['profileVisits', 1, 'mine']]);
    globalThis.profileQuotaEvents = null;
  });
}

test('Une reprise par URL qui échoue ne parcourt ni les autres alias ni de nouvelles tentatives', async () => {
  storedRead();
  const requests = [];
  globalThis.profileInvoke = async body => {
    requests.push(body);
    return { httpStatus: 404, data: { success: false, errorType: 'PROFILE_NOT_FOUND', error: 'Profil non trouvé' } };
  };
  await assert.rejects(() => profiles.fetchInboxCandidateProfile('org', ['ACo-missing', 'AEM-alias', 'other-alias'], 'https://linkedin.com/in/camille', 'Camille', 'mine'), error => {
    assert.equal(error.kind, 'not-found');
    assert.equal(error.httpStatus, 404);
    return true;
  });
  assert.deepEqual(requests.map(body => body.profile_id), ['ACo-missing', 'camille']);
});

for (const failure of [
  { label: 'session expirée', httpStatus: 401, kind: 'session' },
  { label: 'accès refusé', httpStatus: 403, kind: 'access', errorType: 'ACCOUNT_NOT_LINKED' },
  { label: 'quota quotidien', httpStatus: 429, kind: 'quota', errorType: 'QUOTA' },
  { label: 'limitation temporaire', httpStatus: 429, kind: 'quota', errorType: 'RATE_LIMIT' },
  { label: '404 non qualifié', httpStatus: 404, kind: 'unavailable' },
  { label: '404 NOT_FOUND générique', httpStatus: 404, kind: 'unavailable', errorType: 'NOT_FOUND' },
  { label: 'panne serveur', httpStatus: 500, kind: 'unavailable' },
  { label: 'passerelle indisponible', httpStatus: 502, kind: 'unavailable' },
  { label: 'ancien 502 ambigu nommé profil absent', httpStatus: 502, kind: 'unavailable', error: 'Profil non trouvé' },
  { label: 'service indisponible', httpStatus: 503, kind: 'unavailable' },
  { label: 'délai dépassé', httpStatus: 504, kind: 'unavailable' },
]) {
  test(`${failure.label} : une explication sûre et aucune reprise sur un autre identifiant`, async () => {
    storedRead();
    const requests = [];
    globalThis.profileQuotaEvents = [];
    globalThis.profileInvoke = async body => {
      requests.push(body);
      return { httpStatus: failure.httpStatus, data: { success: false, errorType: failure.errorType, error: failure.error ?? 'Unipile internal failure: secret diagnostic' } };
    };
    await assert.rejects(() => profiles.fetchInboxCandidateProfile('org', ['ACo-primary', 'AEM-alias'], 'https://linkedin.com/in/camille', 'Camille', 'mine'), error => {
      assert.equal(error.kind, failure.kind);
      assert.equal(error.httpStatus, failure.httpStatus);
      assert.doesNotMatch(error.message, /Unipile|internal failure|secret diagnostic/);
      assert.match(error.message, /LinkedIn|session|profil|connexion|connect|accès/i);
      return true;
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].profile_id, 'ACo-primary');
    assert.deepEqual(globalThis.profileQuotaEvents, []);
    globalThis.profileQuotaEvents = null;
  });
}

test('Une panne 500 nommée profil absent ne devient pas une reprise consommant une autre consultation', async () => {
  storedRead();
  const requests = [];
  globalThis.profileInvoke = async body => {
    requests.push(body);
    return { httpStatus: 500, data: { success: false, error: 'Profil non trouvé' } };
  };
  await assert.rejects(() => profiles.fetchInboxCandidateProfile('org', ['ACo-primary'], 'https://linkedin.com/in/camille', 'Camille', 'mine'), error => {
    assert.equal(error.kind, 'unavailable');
    assert.equal(error.httpStatus, 500);
    return true;
  });
  assert.equal(requests.length, 1);
});

test('Une URL publique seule utilise son slug une fois et un slug déjà principal ne se répète pas', async () => {
  storedRead();
  const requests = [];
  globalThis.profileInvoke = async body => {
    requests.push(body);
    return { httpStatus: 200, data: { success: true, profile: { summary: 'Par URL' } } };
  };
  const result = await profiles.fetchInboxCandidateProfile('org', [], 'https://linkedin.com/in/camille', 'Camille', 'mine');
  assert.equal(result.summary, 'Par URL');
  assert.deepEqual(requests.map(body => body.profile_id), ['camille']);
  globalThis.profileInvoke = async body => {
    requests.push(body);
    return { httpStatus: 404, data: { success: false, errorType: 'PROFILE_NOT_FOUND' } };
  };
  await assert.rejects(() => profiles.fetchInboxCandidateProfile('org', ['camille'], 'https://linkedin.com/in/camille', 'Camille', 'mine'), error => error.kind === 'not-found');
  assert.equal(requests.length, 2);
});

test('Sans compte personnel ou identité utilisable, aucune consultation externe ne part', async () => {
  storedRead();
  globalThis.profileInvoke = () => { throw new Error('Aucune consultation autorisée'); };
  assert.equal(await profiles.fetchInboxCandidateProfile('org', ['ACo-primary'], 'https://linkedin.com/in/camille', 'Camille', null), null);
  assert.equal(await profiles.fetchInboxCandidateProfile('org', [], 'https://evil-linkedin.com/in/camille', 'Camille', 'mine'), null);
  assert.equal(await profiles.fetchInboxCandidateProfile('org', [], null, 'Camille', 'mine'), null);
});

test('Une erreur de lecture du profil enregistré sans compte garde sa cause, sans détail technique', async () => {
  storedRead({ data: null, error: { message: 'PostgREST internal secret diagnostic' } });
  globalThis.profileInvoke = () => { throw new Error('Aucune consultation externe sans compte'); };
  await assert.rejects(() => profiles.fetchInboxCandidateProfile('org', ['candidate'], null, 'Camille', null), error => {
    assert.equal(error.kind, 'stored');
    assert.doesNotMatch(error.message, /PostgREST|internal|secret diagnostic/);
    assert.match(error.message, /profil enregistré/i);
    return true;
  });
});
