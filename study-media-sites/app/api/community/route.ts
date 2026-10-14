import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
export const dynamic='force-dynamic';
const json=(x:unknown,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(req:Request){
 const user=await getChatGPTUser(); if(!user)return json({error:'Please sign in to save your activity.'},401);
 if(!env.DB)return json({error:'Database unavailable'},503);
 const channel=new URL(req.url).searchParams.get('channel')||'lesson:cells';
 const [messages,reactions,plan]=await Promise.all([
 env.DB.prepare('SELECT id,name,body,created FROM messages WHERE channel=? ORDER BY created DESC LIMIT 100').bind(channel).all(),
 env.DB.prepare('SELECT lesson,kind FROM reactions WHERE user=?').bind(user.userId).all(),
 env.DB.prepare('SELECT body FROM plans WHERE user=?').bind(user.userId).first<{body:string}>()]);
 return json({messages:messages.results.reverse(),reactions:reactions.results,plan:plan?JSON.parse(plan.body):null,name:user.fullName||'Learner'});
}
export async function POST(req:Request){
 const user=await getChatGPTUser();if(!user)return json({error:'Please sign in first.'},401);
 if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'Invalid origin'},403);
 if(!env.DB)return json({error:'Database unavailable'},503);
 let b:Record<string,unknown>;try{const raw=await req.json();if(!raw||typeof raw!=='object'||Array.isArray(raw))return json({error:'Invalid request'},400);b=raw as Record<string,unknown>}catch{return json({error:'Invalid request'},400)}
 if(b.action==='message'){
 if(typeof b.body!=='string'||!b.body.trim()||b.body.length>2000||typeof b.channel!=='string'||!(/^(lesson|room):[a-z0-9-]{1,60}$/).test(b.channel))return json({error:'Use a message of 1–2000 characters.'},400);
 await env.DB.prepare('INSERT INTO messages(id,channel,user,name,body,created) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),b.channel,user.userId,user.fullName||'Learner',b.body.trim(),Date.now()).run();
 }else if(b.action==='reaction'){
 if(typeof b.lesson!=='string'||b.lesson.length>60||typeof b.kind!=='string'||!['like','save','complete'].includes(b.kind)||typeof b.active!=='boolean')return json({error:'Invalid reaction'},400);
 await env.DB.prepare(b.active?'INSERT OR IGNORE INTO reactions(user,lesson,kind) VALUES(?,?,?)':'DELETE FROM reactions WHERE user=? AND lesson=? AND kind=?').bind(user.userId,b.lesson,b.kind).run();
 }else if(b.action==='plan'){
 if(!b.plan||typeof b.plan!=='object')return json({error:'Invalid plan'},400);const p=b.plan as Record<string,unknown>;if(typeof p.subject!=='string'||!['Biology','Mathematics','Physics','Business','English'].includes(p.subject)||typeof p.minutes!=='number'||!Number.isInteger(p.minutes)||p.minutes<5||p.minutes>180||typeof p.days!=='number'||!Number.isInteger(p.days)||p.days<1||p.days>30)return json({error:'Invalid plan'},400);
 await env.DB.prepare('INSERT INTO plans(user,body) VALUES(?,?) ON CONFLICT(user) DO UPDATE SET body=excluded.body').bind(user.userId,JSON.stringify(b.plan)).run();
 }else return json({error:'Unknown action'},400);
 return json({ok:true});
}
