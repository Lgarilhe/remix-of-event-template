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
  '@/lib/quotaEvents': 'export const emitQuotaAction = () => {};',
};
const profiles = await load('src/hooks/useInboxCandidateProfile.ts', { ...scopeStubs, '@/integrations/supabase/client': 'export const supabase = {from: table => globalThis.profileQuery(table)};' });
const messages = await load('src/hooks/useCandidateMessages.ts', scopeStubs);

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
  assert.equal(profile.profilePeriod({year:2020},null,true),"2020 – Aujourd'hui");
  assert.equal(profile.profileDate('2020'),'2020');
  assert.equal(profile.profilePeriod(null,null),'');
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
