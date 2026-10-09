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
const timeline = await load('src/lib/inboxTimeline.ts');
const activity = await load('src/hooks/useProfileActivity.ts', {
  '@tanstack/react-query': 'export const useQuery = options => { globalThis.activityOptions = options; return {}; };',
  '@/hooks/useOrganization': 'export const useOrganization = () => ({organizationId: globalThis.activeOrg});',
  '@/hooks/useAuthReady': 'export const useAuthReady = () => ({user: {id:globalThis.activeUser},isReady:true});',
  '@/integrations/supabase/client': 'export const supabase = {from: table => globalThis.activityQuery(table)};',
  '@/lib/phoneCalls': 'export const rowToPhoneCall = row => row;',
});
const timestamp = '2026-10-07T09:00:00Z';
const event = (values = {}) => ({ id: 'execution', type: 'sequence_step', timestamp, actionType: 'message', channel: 'linkedin', status: 'sent', stepOrder: 0, finalMessage: 'Bonjour Camille', sequenceName: 'Développeurs React', ...values });
const message = (values = {}) => ({ id: 'message', timestamp, text: 'Bonjour Camille', is_sender: true, ...values });

test('Un envoi LinkedIn reconnu conserve sa provenance sans doubler le texte', () => {
  const rows = timeline.conversationTimeline([message()], [event()]);
  assert.equal(rows.filter(row => row.kind !== 'date').length, 1);
  assert.equal(rows.find(row => row.kind === 'message').sequenceEvent.sequenceName, 'Développeurs React');
});
test('Une réponse entrante, un autre canal et deux envois ambigus ne sont jamais fusionnés', () => {
  assert.equal(timeline.conversationTimeline([message({is_sender:false})], [event()]).filter(row => row.kind !== 'date').length, 2);
  assert.equal(timeline.conversationTimeline([message()], [event({channel:'email'})]).filter(row => row.kind !== 'date').length, 2);
  const rows = timeline.conversationTimeline([message()], [event(), event({id:'execution-2'})]);
  assert.equal(rows.filter(row => row.kind !== 'date').length, 3);
  assert.equal(timeline.conversationTimeline([message({timestamp:'2026-10-07T09:10:00Z'})], [event()]).filter(row => row.kind !== 'date').length, 2);
});
test('Le canal réellement utilisé détermine le libellé, sans changer les invitations', () => {
  assert.equal(timeline.activityActionType(event({channel:'email'})), 'email');
  assert.equal(timeline.activityActionType(event({channel:'whatsapp'})), 'whatsapp_message');
  assert.equal(timeline.activityActionType(event({actionType:'connection_request'})), 'connection_request');
});
test('Emails HTML et texte LinkedIn restent du texte lisible, sans balises actives', () => {
  assert.equal(timeline.activityMessageText('<p>Bonjour &amp; merci</p><script>alert(1)</script><img src=x onerror="alert(1)"><p>À bientôt</p>'), 'Bonjour & merci\nÀ bientôt');
  assert.equal(timeline.activityMessageText('Le budget est < 50 > 10'), 'Le budget est < 50 > 10');
});
test('Dates avec fuseaux différents triées par instant, événements internes masqués', () => {
  const rows = timeline.conversationTimeline([message({timestamp:'2026-10-07T10:00:00+02:00'})], [event({timestamp:'2026-10-07T08:30:00Z',channel:'email'}), event({id:'internal', actionType:'wait_reply'})]);
  assert.deepEqual(rows.filter(row => row.kind !== 'date').map(row => row.data.id), ['message','execution']);
});

let requests;
function fixture(overrides = {}, failedTable) {
  requests = [];
  const tables = {
    sequence_enrollments: [{id:'enrollment',organization_id:'org-a',sequence_id:'sequence',profile_id:'AE-recruiter',provider_id:'ACo-candidate',resolved_profile_id:null,profile_url:'https://www.linkedin.com/in/camille-durand/',profile_name:'Camille Durand',email_used:'camille@example.test',phone_used:'+33612345678'}],
    outreach_sequences: [{id:'sequence',organization_id:'org-a',name:'Développeurs React'}],
    sequence_steps: [{id:'step',organization_id:'org-a',action_type:'message',step_channel:'email'}],
    sequence_step_executions: [{id:'execution',organization_id:'org-a',enrollment_id:'enrollment',step_id:'step',step_order:0,status:'sent',executed_at:timestamp,channel:'whatsapp',final_message:'Bonjour Camille',final_subject:null}],
    qualification_sessions: [{id:'interview',organization_id:'org-a',candidate_profile_id:'ACo-candidate',candidate_linkedin_url:'https://linkedin.com/in/camille-durand',event_start_at:'2026-10-09T10:00:00Z',event_end_at:'2026-10-09T10:30:00Z',status:'scheduled',event_location:'Visio',event_name:'Entretien technique'}, {id:'similar-url',organization_id:'org-a',candidate_profile_id:'other',candidate_linkedin_url:'https://linkedin.com/in/camille-durand-junior',event_start_at:timestamp}],
    candidate_contacts: [], phone_calls: [], ...overrides,
  };
  globalThis.activityQuery = table => {
    const operations = [];
    const q = { then(resolve, reject) {
      requests.push({table,operations});
      if (table === failedTable) return Promise.resolve({data:null,error:new Error('Source indisponible')}).then(resolve,reject);
      let rows = [...(tables[table] ?? [])];
      for (const [op,args] of operations) {
        if (op === 'eq') rows = rows.filter(row => row[args[0]] === args[1]);
        if (op === 'in') rows = rows.filter(row => args[1].includes(row[args[0]]));
        if (op === 'not') rows = rows.filter(row => row[args[0]] != null);
        if (op === 'ilike') rows = rows.filter(row => String(row[args[0]]).includes(args[1].replace(/%/g,'')));
        if (op === 'or') { const matches = [...args[0].matchAll(/(\w+)\.eq\."([^"]*)"/g)]; rows = rows.filter(row => matches.some(([,key,value]) => row[key] === value)); }
      }
      const range = operations.find(([op]) => op === 'range')?.[1];
      if (range) rows = rows.slice(range[0],range[1]+1);
      return Promise.resolve({data:rows,error:null}).then(resolve,reject);
    }};
    for (const method of ['select','eq','or','in','ilike','not','order','range']) q[method] = (...args) => { operations.push([method,args]); return q; };
    return q;
  };
}
test('Alias Recruiter, canal figé et rendez-vous exact : toutes les sources sont bornées à l’organisation', async () => {
  fixture();
  const result = await activity.fetchProfileActivity('org-a',['ACo-candidate'],'https://linkedin.com/in/camille-durand','Camille Durand');
  assert.equal(result.incomplete,false);
  assert.equal(result.events.length,2);
  assert.equal(result.events[0].channel,'whatsapp');
  assert.equal(result.events[0].recipient,'+33612345678');
  assert.equal(result.events[0].finalMessage,'Bonjour Camille');
  assert.equal(result.events[1].eventEndAt,'2026-10-09T10:30:00Z');
  for (const {table,operations} of requests) assert.ok(operations.some(([op,args]) => op === 'eq' && args[0] === 'organization_id' && args[1] === 'org-a'), `${table} sans périmètre org`);
  const other = await activity.fetchProfileActivity('org-b',['ACo-candidate'],'https://linkedin.com/in/camille-durand','Camille Durand');
  assert.deepEqual(other.events,[]);
});
test('Un historique de plus de 500 envois est complet', async () => {
  fixture({sequence_step_executions:Array.from({length:501},(_,i)=>({id:'exec-'+i,organization_id:'org-a',enrollment_id:'enrollment',step_id:'step',step_order:0,status:'sent',executed_at:timestamp,channel:'email',final_message:'Email '+i}))});
  const result = await activity.fetchProfileActivity('org-a',['ACo-candidate']);
  assert.equal(result.events.filter(row => row.type === "sequence_step").length,501);
  assert.equal(requests.filter(request => request.table === 'sequence_step_executions').length,2);
});
test('Une source indisponible ne cache pas les rendez-vous disponibles', async () => {
  fixture({},'sequence_enrollments');
  const result = await activity.fetchProfileActivity('org-a',['ACo-candidate']);
  assert.equal(result.incomplete,true);
  assert.deepEqual(result.events.map(row=>row.id),['booking-interview']);
});
test('Aucun rapprochement d’un candidat connu par un autre homonyme', async () => {
  fixture();
  const result = await activity.fetchProfileActivity('org-a',['unknown-id'],null,'Camille Durand');
  assert.deepEqual(result.events,[]);
});
test('Sans identifiant ni URL, un nom partagé ne rapproche personne', async () => {
  fixture({sequence_enrollments:[{id:'a',organization_id:'org-a',profile_name:'Camille Durand',profile_id:'person-a'}, {id:'b',organization_id:'org-a',profile_name:'Camille Durand',profile_id:'person-b'}]});
  const result = await activity.fetchProfileActivity('org-a',[],null,'Camille Durand');
  assert.deepEqual(result.events,[]);
});
test('La clé de cache change avec le candidat, l’organisation et l’utilisateur', () => {
  globalThis.activeOrg='org-a'; globalThis.activeUser='user-a';
  activity.useProfileActivity('candidate-a'); const a = globalThis.activityOptions.queryKey;
  activity.useProfileActivity('candidate-b'); assert.notDeepEqual(globalThis.activityOptions.queryKey,a);
  globalThis.activeOrg='org-b'; activity.useProfileActivity('candidate-a'); assert.notDeepEqual(globalThis.activityOptions.queryKey,a);
  globalThis.activeOrg='org-a'; globalThis.activeUser='user-b'; activity.useProfileActivity('candidate-a'); assert.notDeepEqual(globalThis.activityOptions.queryKey,a);
});
