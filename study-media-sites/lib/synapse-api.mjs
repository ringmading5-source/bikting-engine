import {fail,text} from './social-core.mjs';
import {contentRevision} from './guidance-core.mjs';
import {validateAssessment,gradeNumeric,reviewEvidence,rankPeers} from './synapse-core.mjs';
export async function synapseAPI({path,method,b,url,u,env,q,one,run}){
 if(!u)fail(401,'Sign in to use your learning workspace.');
 if(!['GET','POST'].includes(method))fail(405,'Method not allowed.');
 const now=()=>Date.now(),id=()=>crypto.randomUUID(),post=()=>{if(method!=='POST')fail(405,'Use POST for this action.');},admin=()=>{if(!u.admin)fail(403,'Reviewer access required.');};
 async function concept(cid){const c=await one("SELECT c.* FROM sm_concepts c JOIN sm_lessons l ON l.id=c.lesson_id WHERE c.id=? AND l.status='published'",text(cid,60));if(!c)fail(404,'Published concept not found.');return c;}
 async function assessment(aid){const a=await one('SELECT a.* FROM sm_assessments a JOIN sm_lessons l ON l.id=a.lesson_id WHERE a.id=? AND l.status=\'published\'',text(aid,60));if(!a)fail(404,'Assessment not found.');return a;}
 async function current(a){const l=await one("SELECT body FROM sm_lessons WHERE id=? AND status='published'",a.lesson_id);return !!l&&await contentRevision(l.body)===a.revision;}
 async function roomAccess(rid){const r=await one('SELECT * FROM sm_rooms WHERE id=?',text(rid,60));if(!r)fail(404,'Study circle not found.');if(await one('SELECT 1 FROM sm_tut_sessions WHERE room_id=?',rid))fail(403,'Use the paid classroom workspace.');if(await one('SELECT 1 FROM sm_bans WHERE room_id=? AND user_id=?',rid,u.id))fail(403,'Circle access was removed.');const pairing=await one('SELECT requester,target FROM sm_peer_requests WHERE room_id=?',rid);if(pairing&&![pairing.requester,pairing.target].includes(u.id)&&!u.admin)fail(403,'This matched circle is private.');if(!await one('SELECT 1 FROM sm_members WHERE room_id=? AND user_id=? AND expires>?',rid,u.id,now()))fail(403,'Join the circle first.');return r;}
 if(path==='/api/synapse/overview'){
  const proofs=await q('SELECT p.*,a.concept_id,c.label concept FROM sm_proofs p JOIN sm_assessments a ON a.id=p.assessment_id JOIN sm_concepts c ON c.id=a.concept_id WHERE p.user_id=? ORDER BY p.created DESC LIMIT 100',u.id);
  return {proofs:proofs.map(p=>({...p,scores:p.scores?JSON.parse(p.scores):null})),credits:(await one("SELECT count(DISTINCT assessment_id)*10 n FROM sm_proofs WHERE user_id=? AND status='approved'",u.id)).n,progress:await q('SELECT lesson_id,count(*) attempts,sum(correct) correct FROM sm_attempts WHERE user_id=? GROUP BY lesson_id',u.id),availability:await one('SELECT * FROM sm_peer_profiles WHERE user_id=?',u.id),requests:await q("SELECT r.*,c.label concept,CASE WHEN r.requester=? THEN COALESCE(tp.alias,'Study partner') ELSE COALESCE(rp.alias,'Study partner') END peer_name FROM sm_peer_requests r JOIN sm_concepts c ON c.id=r.concept_id JOIN sm_users requester ON requester.id=r.requester JOIN sm_users target ON target.id=r.target LEFT JOIN sm_peer_profiles rp ON rp.user_id=r.requester LEFT JOIN sm_peer_profiles tp ON tp.user_id=r.target WHERE (r.requester=? OR r.target=?) AND ((r.status='pending' AND r.expires>?) OR r.status='accepted') ORDER BY r.created DESC LIMIT 30",u.id,u.id,u.id,now())};
 }
 if(path==='/api/synapse/availability'){
  post();if(b.active===false){await run('DELETE FROM sm_peer_profiles WHERE user_id=?',u.id);await run("UPDATE sm_peer_requests SET status='cancelled' WHERE status='pending' AND (requester=? OR target=?)",u.id,u.id);return {active:false};}
  if(b.active!==true||b.consent!==true)fail(400,'Choose to share your study alias and concept for matching.');
  const c=await concept(b.conceptId);if(!['learn','help','together'].includes(b.mode))fail(400,'Choose a study role.');
  await run('INSERT INTO sm_peer_profiles VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET concept_id=excluded.concept_id,alias=excluded.alias,mode=excluded.mode,expires=excluded.expires,updated=excluded.updated',u.id,c.id,text(b.alias,40),b.mode,now()+1800000,now());return {active:true,expires:now()+1800000};
 }
 if(path==='/api/synapse/peers'){
  const c=await concept(url.searchParams.get('conceptId'));const mine=await one('SELECT * FROM sm_peer_profiles WHERE user_id=? AND expires>?',u.id,now());if(!mine||mine.concept_id!==c.id) return {peers:[],needsOptIn:true};
  return {peers:rankPeers(await q('SELECT user_id,alias,mode,updated FROM sm_peer_profiles WHERE concept_id=? AND expires>? AND user_id<>? ORDER BY updated DESC LIMIT 50',c.id,now(),u.id),mine.mode)};
 }
 if(path==='/api/synapse/requests'){
  post();if(b.target===u.id)fail(400,'Choose another learner.');const c=await concept(b.conceptId),mine=await one('SELECT * FROM sm_peer_profiles WHERE user_id=? AND concept_id=? AND expires>?',u.id,c.id,now()),peer=await one('SELECT * FROM sm_peer_profiles WHERE user_id=? AND concept_id=? AND expires>?',text(b.target,100),c.id,now());if(!mine||!peer)fail(409,'Both learners must be available for this concept.');
  const prior=await one("SELECT id FROM sm_peer_requests WHERE concept_id=? AND expires>? AND status='pending' AND ((requester=? AND target=?) OR (requester=? AND target=?))",c.id,now(),u.id,b.target,b.target,u.id);if(prior)return prior;
  const rid=id();await run("INSERT INTO sm_peer_requests(id,requester,target,concept_id,status,expires,created) VALUES(?,?,?,?,'pending',?,?)",rid,u.id,b.target,c.id,now()+600000,now());return {id:rid};
 }
 const request=path.match(/^\/api\/synapse\/requests\/([^/]+)$/);
 if(request){post();const r=await one('SELECT * FROM sm_peer_requests WHERE id=?',request[1]);if(!r||![r.requester,r.target].includes(u.id))fail(404,'Request not found.');if(r.status!=='pending'||r.expires<=now())fail(409,'This invitation has ended.');if(b.action==='cancel'&&r.requester===u.id||b.action==='decline'&&r.target===u.id){await run("UPDATE sm_peer_requests SET status=? WHERE id=? AND status='pending'",b.action==='cancel'?'cancelled':'declined',r.id);return {ok:true};}if(b.action!=='accept'||u.id!==r.target)fail(403,'Only the invited learner can accept.');
  const c=await concept(r.concept_id),roomId=id();
  // A single D1 batch claims the invitation once and creates its private circle.
  await env.DB.batch([
   env.DB.prepare("INSERT INTO sm_rooms SELECT ?,?,'Socratic Co-op',?,? WHERE EXISTS(SELECT 1 FROM sm_peer_requests WHERE id=? AND status='pending' AND expires>?)").bind(roomId,('Co-op: '+c.label).slice(0,100),r.requester,now(),r.id,now()),
   env.DB.prepare("UPDATE sm_peer_requests SET status='accepted',room_id=? WHERE id=? AND status='pending' AND expires>? AND EXISTS(SELECT 1 FROM sm_rooms WHERE id=?)").bind(roomId,r.id,now(),roomId),
   env.DB.prepare("INSERT INTO sm_coop(room_id,concept_id,stage,updated) SELECT ?,?,'question',? WHERE EXISTS(SELECT 1 FROM sm_peer_requests WHERE id=? AND room_id=?)").bind(roomId,c.id,now(),r.id,roomId)
  ]);const accepted=await one('SELECT room_id FROM sm_peer_requests WHERE id=?',r.id);if(accepted.room_id!==roomId)fail(409,'This invitation was already handled.');return {roomId};
 }
 const coop=path.match(/^\/api\/synapse\/coop\/([^/]+)$/);
 if(coop){const rid=coop[1],r=await roomAccess(rid);let s=await one('SELECT * FROM sm_coop WHERE room_id=?',rid);
  if(method==='POST'){
   if(!s){if(r.host!==u.id&&!u.admin)fail(403,'The host chooses the first concept.');const c=await concept(b.conceptId);await run("INSERT OR IGNORE INTO sm_coop(room_id,concept_id,stage,updated) VALUES(?,?,'question',?)",rid,c.id,now());s=await one('SELECT * FROM sm_coop WHERE room_id=?',rid);}
   else if(b.action==='contribute'){if(s.stage==='complete')fail(409,'This discussion is complete.');await run('INSERT INTO sm_coop_notes VALUES(?,?,?,?,?)',id(),rid,u.id,text(b.body,4000),now());}
   else if(b.action==='advance'){if(r.host!==u.id&&!u.admin)fail(403,'The host advances the discussion.');const stages=['question','explain','challenge','synthesis','complete'],next=stages[stages.indexOf(s.stage)+1];if(!next)fail(409,'Discussion already complete.');if(!await one('SELECT 1 FROM sm_coop_notes WHERE room_id=?',rid))fail(400,'Record the group reasoning before moving forward.');await run('UPDATE sm_coop SET stage=?,updated=? WHERE room_id=?',next,now(),rid);}
   else fail(400,'Choose a supported discussion action.');s=await one('SELECT * FROM sm_coop WHERE room_id=?',rid);
  }
  if(!s)return {session:null};const c=await concept(s.concept_id),l=JSON.parse((await one('SELECT body FROM sm_lessons WHERE id=?',c.lesson_id)).body);
  const prompts={question:l.question,explain:'Explain your reasoning. Which relationship makes this work?',challenge:'Try a different example. What changes, and what stays the same?',synthesis:'Agree on an explanation, a worked example, and one unresolved question.',complete:'Save your individual explanation in the Proof Engine.'};
  return {session:s,concept:c,prompt:prompts[s.stage],example:s.stage==='question'?null:l.example,notes:await q('SELECT n.*,u.name FROM sm_coop_notes n JOIN sm_users u ON u.id=n.user_id WHERE room_id=? ORDER BY created LIMIT 100',rid)};
 }
 if(path==='/api/synapse/assessments'){
  if(method==='POST'){admin();const c=await concept(b.conceptId),a=validateAssessment(b),row=await one('SELECT body FROM sm_lessons WHERE id=?',c.lesson_id),aid=id();await run('INSERT INTO sm_assessments VALUES(?,?,?,?,?,?,?)',aid,c.id,c.lesson_id,u.id,JSON.stringify(a),await contentRevision(row.body),now());return {id:aid};}
  const c=await concept(url.searchParams.get('conceptId')),rows=await q('SELECT * FROM sm_assessments WHERE concept_id=? ORDER BY created DESC LIMIT 50',c.id);const result=[];
  for(const a of rows){const body=JSON.parse(a.body);result.push({id:a.id,conceptId:a.concept_id,title:body.title,prompt:body.prompt,rubric:body.rubric,kind:body.kind,current:await current(a),created:a.created});}return result;
 }
 const proofs=path.match(/^\/api\/synapse\/assessments\/([^/]+)\/submit$/);
 if(proofs){post();const a=await assessment(proofs[1]);if(!await current(a))fail(409,'The lesson changed. A reviewer must create an updated assessment.');const body=JSON.parse(a.body),explanation=text(b.explanation,12000),pid=id();if(explanation.length<40)fail(400,'Explain your method in at least 40 characters.');let passed=null;if(body.kind==='numeric')passed=Number(gradeNumeric(b.answer,body));const prior=await one("SELECT 1 FROM sm_proofs WHERE user_id=? AND assessment_id=? AND status='pending'",u.id,a.id);if(prior)fail(409,'Your submission is already awaiting review.');
  await run("INSERT INTO sm_proofs(id,user_id,assessment_id,title,explanation,answer,auto_pass,status,created) VALUES(?,?,?,?,?,?,?,'pending',?)",pid,u.id,a.id,body.title,explanation,body.kind==='numeric'?b.answer:null,passed,now());return {id:pid,autoPass:passed===null?null:!!passed,status:'pending',message:'Your work is saved. Reviewer assessment is required.'};
 }
 if(path==='/api/synapse/review'){admin();return await q("SELECT p.*,a.body assessment,a.creator,a.revision,c.label concept,u.name student FROM sm_proofs p JOIN sm_assessments a ON a.id=p.assessment_id JOIN sm_concepts c ON c.id=a.concept_id JOIN sm_users u ON u.id=p.user_id WHERE p.status='pending' ORDER BY p.created LIMIT 100");}
 const proof=path.match(/^\/api\/synapse\/proofs\/([^/]+)(?:\/(review|share|withdraw))?$/);
 if(proof){const[,pid,action]=proof,p=await one('SELECT * FROM sm_proofs WHERE id=?',pid);if(!p||p.user_id!==u.id&&!u.admin)fail(404,'Portfolio item not found.');
  if(action==='review'){post();admin();if(p.user_id===u.id)fail(403,'You cannot review your own work.');if(p.status!=='pending')fail(409,'This item has already been reviewed.');const a=await assessment(p.assessment_id);if(!await current(a))fail(409,'Lesson changed. Request a fresh submission on an updated assessment.');const review=reviewEvidence(b);if(review.status==='approved'&&p.auto_pass===0)fail(400,'A failed numeric check needs revision.');const updated=await one("UPDATE sm_proofs SET status=?,scores=?,feedback=?,reviewer=?,reviewed=? WHERE id=? AND status='pending' RETURNING id",review.status,JSON.stringify(review.scores),review.feedback,u.id,now(),pid);if(!updated)fail(409,'Another reviewer already handled this item.');return {ok:true};}
  if(action==='share'){post();if(p.user_id!==u.id)fail(403,'Only the learner controls portfolio sharing.');if(typeof b.active!=='boolean')fail(400,'Choose share or private.');if(b.active&&p.status!=='approved')fail(400,'Only reviewed work can be shared.');const token=b.active?(p.share_token||id()):null;await run('UPDATE sm_proofs SET share_token=? WHERE id=?',token,pid);return {token};}
  if(action==='withdraw'){post();if(p.user_id!==u.id)fail(403,'Only the learner can withdraw work.');await run("UPDATE sm_proofs SET status='withdrawn',share_token=NULL WHERE id=?",pid);return {ok:true};}
  return {...p,scores:p.scores?JSON.parse(p.scores):null};
 }
 const shared=path.match(/^\/api\/synapse\/shared\/([^/]+)$/);
 if(shared){const p=await one("SELECT p.title,p.explanation,p.scores,p.feedback,p.reviewed,a.concept_id,c.label concept FROM sm_proofs p JOIN sm_assessments a ON a.id=p.assessment_id JOIN sm_concepts c ON c.id=a.concept_id WHERE p.share_token=? AND p.status='approved'",shared[1]);if(!p)fail(404,'This portfolio link is unavailable.');return {...p,scores:JSON.parse(p.scores),label:'Reviewed work · scoped to this assessment; not an accredited qualification'};}
 if(path==='/api/synapse/opportunities'){
  if(method==='POST'){admin();const c=await concept(b.conceptId);if(!Number.isInteger(b.deadline)||b.deadline<=now()||b.deadline>now()+365*86400000)fail(400,'Choose a future deadline within one year.');const oid=id();await run("INSERT INTO sm_opportunities VALUES(?,?,?,?,?,?,?,'open',?)",oid,c.id,text(b.title,120),text(b.organisation,120),text(b.description,3000),b.deadline,u.id,now());return {id:oid};}
  return await q("SELECT o.*,c.label concept,(SELECT count(*) FROM sm_applications WHERE opportunity_id=o.id AND user_id=?) applied FROM sm_opportunities o JOIN sm_concepts c ON c.id=o.concept_id WHERE o.status='open' AND o.deadline>? ORDER BY o.created DESC LIMIT 100",u.id,now());
 }
 const opportunity=path.match(/^\/api\/synapse\/opportunities\/([^/]+)\/(apply|close|applications)$/);
 if(opportunity){const[,oid,action]=opportunity,o=await one('SELECT * FROM sm_opportunities WHERE id=?',oid);if(!o)fail(404,'Opportunity not found.');if(action==='close'){post();admin();await run("UPDATE sm_opportunities SET status='closed' WHERE id=?",oid);return {ok:true};}if(action==='applications'){admin();return await q('SELECT a.*,u.name,p.title,p.explanation,p.scores,p.feedback FROM sm_applications a JOIN sm_users u ON u.id=a.user_id JOIN sm_proofs p ON p.id=a.proof_id WHERE a.opportunity_id=? AND p.status=\'approved\' ORDER BY a.created',oid);}
  post();if(b.consent!==true)fail(400,'Agree to share this work and your profile name with the reviewer.');if(o.status!=='open'||o.deadline<=now())fail(409,'This opportunity has closed.');const p=await one("SELECT p.id FROM sm_proofs p JOIN sm_assessments a ON a.id=p.assessment_id WHERE p.id=? AND p.user_id=? AND p.status='approved' AND a.concept_id=?",text(b.proofId,60),u.id,o.concept_id);if(!p)fail(400,'Choose your reviewed work for the required concept.');await run('INSERT INTO sm_applications VALUES(?,?,?,?,?) ON CONFLICT(opportunity_id,user_id) DO UPDATE SET proof_id=excluded.proof_id,note=excluded.note,created=excluded.created',oid,u.id,p.id,text(b.note,2000),now());return {ok:true};
 }
 fail(404,'Learning action not found.');
}
