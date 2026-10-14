import {fail,text} from './social-core.mjs';
import {videoSettings,startVideo,pollVideo,downloadVideo} from './video-provider.mjs';
export async function videoAPI({path,method,b,url,u,env,q,one,run,fetcher=fetch}){
 if(!u)fail(401,'Sign in to continue.');if(!u.admin)fail(403,'Company reviewer access required for video generation.');
 const settings=videoSettings(env),safe=j=>({id:j.id,lessonId:j.lesson_id,prompt:j.prompt,model:j.model,status:j.status,asset:j.asset,error:j.error,created:j.created});
 if(path==='/api/videos'&&method==='GET'){const lid=url.searchParams.get('lessonId');return {enabled:settings.enabled,limit:settings.limit,model:settings.model,jobs:(await q('SELECT * FROM sm_video_jobs WHERE owner=? AND lesson_id=? ORDER BY created DESC LIMIT 30',u.id,lid||'')).map(safe)};}
 if(path==='/api/videos'&&method==='POST'){
  if(!settings.enabled)fail(503,'Video generation is not connected. Configure a funded video provider, model and daily limit.');
  if(b.confirmCost!==true)fail(400,'Confirm that this request uses the company video generation budget.');
  if(typeof b.requestId!=='string'||! /^[a-f0-9-]{36}$/.test(b.requestId))fail(400,'A generation request ID is required.');
  const existing=await one('SELECT * FROM sm_video_jobs WHERE id=?',b.requestId);if(existing){if(existing.owner!==u.id)fail(409,'Request ID already used.');return safe(existing);}
  const lesson=await one('SELECT * FROM sm_lessons WHERE id=?',b.lessonId);if(!lesson||lesson.status!=='draft')fail(400,'Save an unpublished lesson draft first.');
  const scene=text(b.scene,2500),l=JSON.parse(lesson.body),prompt=`Create one realistic educational animation with lifelike materials, lighting and physically plausible motion. Vertical phone composition. Depict only the supplied concept, with no invented labels, numerical results or extra scientific claims. No on-screen writing. No music or speech; the lesson provides its explanation. This is an educational visualisation, not documentary evidence.\nLESSON: ${l.title}\nOBJECTIVE: ${l.objective}\nSOURCE: ${l.source.slice(0,6000)}\nSCENE: ${scene}`;
  const created=Date.now(),day=Math.floor(created/86400000)*86400000;
  const inserted=await one("INSERT INTO sm_video_jobs(id,lesson_id,owner,prompt,snapshot,model,status,created) SELECT ?,?,?,?,?,?,'submitting',? WHERE (SELECT count(*) FROM sm_video_jobs WHERE created>=?)<? RETURNING id",b.requestId,lesson.id,u.id,prompt,lesson.body,settings.model,created,day,settings.limit);if(!inserted)fail(429,'Company daily video request limit reached. Failed or uncertain requests also count; try another day or check the provider account.');
  try{const operation=await startVideo(env,prompt,fetcher);await run("UPDATE sm_video_jobs SET status='generating',operation=? WHERE id=?",operation,b.requestId);}catch{await run("UPDATE sm_video_jobs SET status='uncertain',error=? WHERE id=?",'Submission was not confirmed. Check provider activity before creating another request; it may have incurred a charge.',b.requestId);}
  return safe(await one('SELECT * FROM sm_video_jobs WHERE id=?',b.requestId));
 }
 const m=path.match(/^\/api\/videos\/([a-f0-9-]+)\/(refresh|attach)$/);if(!m||method!=='POST')fail(404,'Video action not found.');
 const j=await one('SELECT * FROM sm_video_jobs WHERE id=? AND owner=?',m[1],u.id);if(!j)fail(404,'Video job not found.');
 if(m[2]==='refresh'){
  if(j.status!=='generating')return safe(j);if(!settings.enabled)fail(503,'Video provider settings unavailable.');
  const result=await pollVideo(env,j.operation,fetcher);if(!result.done)return safe(j);
  if(result.error){await run("UPDATE sm_video_jobs SET status='failed',error=? WHERE id=?",result.error,j.id);return safe(await one('SELECT * FROM sm_video_jobs WHERE id=?',j.id));}
  // A stable asset key and insert-ignore keep parallel refreshes idempotent.
  const aid=j.id,bytes=await downloadVideo(env,result.uri,fetcher);await env.BUCKET.put(aid,bytes,{httpMetadata:{contentType:'video/mp4'}});await run('INSERT OR IGNORE INTO sm_assets VALUES(?,?,?,?,?)',aid,u.id,'video/mp4','AI-generated educational animation',Date.now());await run("UPDATE sm_video_jobs SET status='ready',asset=?,error=NULL WHERE id=? AND status='generating'",'/api/assets/'+aid,j.id);return safe(await one('SELECT * FROM sm_video_jobs WHERE id=?',j.id));
 }
 if(b.reviewed!==true)fail(400,'Review the video for scientific accuracy before attaching.');if(!['ready','attached'].includes(j.status)||!j.asset)fail(409,'Wait for a completed video.');
 const l=await one('SELECT * FROM sm_lessons WHERE id=?',j.lesson_id);if(!l||l.status!=='draft')fail(409,'Only an unpublished draft can receive this video.');
 const body={...JSON.parse(l.body),asset:j.asset,assetType:'video'};
 if(j.status==='attached'&&JSON.parse(l.body).asset===j.asset)return safe(j);
 const changed=await one("UPDATE sm_lessons SET body=? WHERE id=? AND body=? AND status='draft' RETURNING id",JSON.stringify(body),l.id,j.snapshot);if(!changed)fail(409,'The lesson changed after generation. Review the current draft and create a video for that version.');
 await run("UPDATE sm_video_jobs SET status='attached' WHERE id=?",j.id);return safe({...j,status:'attached'});
}
