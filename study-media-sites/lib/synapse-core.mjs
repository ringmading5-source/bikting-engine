import {fail,text} from './social-core.mjs';
export const rubric=['reasoning','application','clarity'];
export function validateAssessment(b){
 const kind=b.kind;if(!['project','numeric'].includes(kind))fail(400,'Choose project or numeric assessment.');
 const a={title:text(b.title,120),prompt:text(b.prompt,4000),rubric:text(b.rubric,2000),kind};
 if(kind==='numeric'){if(typeof b.expected!=='number'||!Number.isFinite(b.expected)||Math.abs(b.expected)>1e12||typeof b.tolerance!=='number'||!Number.isFinite(b.tolerance)||b.tolerance<0||b.tolerance>1)fail(400,'Provide a finite numeric answer and tolerance from 0 to 1.');a.expected=b.expected;a.tolerance=b.tolerance;}
 return a;
}
export function gradeNumeric(answer,assessment){if(typeof answer!=='number'||!Number.isFinite(answer))fail(400,'Enter a finite numeric answer.');return Math.abs(answer-assessment.expected)<=assessment.tolerance;}
export function reviewEvidence(b){if(!['approved','revise'].includes(b.status)||!b.scores||rubric.some(k=>!Number.isInteger(b.scores[k])||b.scores[k]<0||b.scores[k]>4))fail(400,'Score reasoning, application and clarity from 0 to 4.');if(b.status==='approved'&&rubric.some(k=>b.scores[k]<3))fail(400,'Approval needs at least 3/4 in every rubric area.');return {status:b.status,scores:Object.fromEntries(rubric.map(k=>[k,b.scores[k]])),feedback:text(b.feedback,2000)};}
export function rankPeers(rows,mode){return rows.map(r=>({...r,reason:r.mode===mode?'Working on the same concept':'Complementary study role',score:r.mode===mode?2:1})).sort((a,b)=>b.score-a.score||b.updated-a.updated).slice(0,12);}
