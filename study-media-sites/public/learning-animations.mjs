// Reusable device-rendered models: no generated video or AI call is needed.
export const simulations = {
  fractions: {title:'Equal parts, one whole',prompt:'Predict: what happens to each piece when the denominator increases?',labels:['Selected parts','Equal parts'],defaults:[3,4],min:[0,1],max:[12,12],step:[1,1]},
  forces: {title:'Push, mass and motion',prompt:'Predict: with the same force, does a heavier object accelerate more or less?',labels:['Net force (N)','Mass (kg)'],defaults:[6,2],min:[0,1],max:[20,10],step:[1,1]},
  mean: {title:'Find the balance point',prompt:'Predict: how does moving one value change the mean?',labels:['First value','Second value','Third value'],defaults:[2,4,6],min:[0,0,0],max:[10,10,10],step:[1,1,1]},
  cells: {title:'Explore an animal cell',prompt:'Predict: which structure forms the boundary controlling entry and exit?',labels:['Explore a structure'],defaults:[0],min:[0],max:[2],step:[1]}
};
export function modelState(kind,values,time=0){
  const spec=simulations[kind];if(!spec)throw Error('Unknown learning model');
  const v=spec.defaults.map((d,i)=>Math.min(spec.max[i],Math.max(spec.min[i],Number.isFinite(Number(values[i]))?Number(values[i]):d)));
  if(kind==='fractions'){v[0]=Math.min(v[0],v[1]);return {values:v,ratio:v[0]/v[1]};}
  if(kind==='forces'){const acceleration=v[0]/v[1];return {values:v,acceleration,distance:.5*acceleration*time*time};}
  if(kind==='mean')return {values:v,mean:v.reduce((s,n)=>s+n,0)/v.length};
  return {values:v,index:Math.round(v[0])};
}
const n=x=>Number(x.toFixed(2));
function picture(kind,s,t){
  const base=body=>`<svg viewBox="0 0 360 210" role="img" aria-label="${simulations[kind].title}">${body}</svg>`;
  if(kind==='fractions')return base(s.values[1]&&Array.from({length:s.values[1]},(_,i)=>`<rect x="${15+i*330/s.values[1]}" y="60" width="${330/s.values[1]-3}" height="95" rx="4" fill="${i<s.values[0]?'#698b46':'#e5ebdf'}" stroke="#526b3b"/>`).join(''));
  if(kind==='forces'){const x=25+Math.min(s.distance/20,1)*260;return base(`<path d="M15 155H345" stroke="#9cad92"/><rect x="${x}" y="105" width="45" height="48" rx="8" fill="#698b46"/><text x="${x+22}" y="134" text-anchor="middle" fill="white">${s.values[1]}kg</text><path d="M${x+48} 126h${s.values[0]*2}" stroke="#bf7046" stroke-width="4"/><text x="20" y="45" fill="#355139">Elapsed: ${n(t)} s · track: 20 m</text>`);}
  if(kind==='mean')return base(`<path d="M20 150H340" stroke="#91a27f"/>${Array.from({length:11},(_,i)=>`<text x="${20+i*32}" y="176" text-anchor="middle" font-size="12">${i}</text>`).join('')}${s.values.map((x,i)=>`<circle cx="${20+x*32}" cy="${65+i*26}" r="10" fill="${['#698b46','#bf7046','#658eaf'][i]}"/>`).join('')}<path d="M${20+s.mean*32} 45v110" stroke="#355139" stroke-width="3" stroke-dasharray="5 3"/><text x="180" y="25" text-anchor="middle">Mean: ${n(s.mean)}</text>`);
  const selected=s.index,colors=['#93b77a','#e2edc8','#a995c6'];return base(`<ellipse cx="180" cy="110" rx="145" ry="82" fill="${selected===1?'#c2d99e':'#edf2e6'}" stroke="${selected===0?'#bf7046':'#698b46'}" stroke-width="${selected===0?7:3}"/><ellipse cx="195" cy="108" rx="42" ry="35" fill="${selected===2?colors[2]:'#d9cde5'}"/><circle cx="195" cy="108" r="12" fill="#8f7caa"/>${Array.from({length:6},(_,i)=>`<circle cx="${75+i*38}" cy="${145+Math.sin(t*2+i)*7}" r="4" fill="#698b46"/>`).join('')}<text x="180" y="20" text-anchor="middle">Simplified animal cell</text>`);
}
function explanation(kind,s,t){
 if(kind==='fractions')return `${s.values[0]}/${s.values[1]} of the whole is shaded (${n(s.ratio*100)}%). Each piece is 1/${s.values[1]}.`;
 if(kind==='forces')return `a = F ÷ m = ${s.values[0]} ÷ ${s.values[1]} = ${n(s.acceleration)} m/s². From rest: distance = ½at² = ${n(s.distance)} m after ${n(t)} s. Ideal constant net force; stops at the end of this 20 m model.`;
 if(kind==='mean')return `(${s.values.join(' + ')}) ÷ 3 = ${n(s.mean)}. The dashed line is the mean; each dot has equal weight.`;
 return ['Cell membrane: the selectively permeable boundary controls what enters and leaves.','Cytoplasm: many chemical reactions happen in this material.','Nucleus: contains DNA and helps control cell activities.'][s.index];
}
export function mountAnimation(root,initial='fractions'){
 let kind=simulations[initial]?initial:'fractions',values=[],time=0,running=false,frame=0,previous=0,cleaned=false;
 root.innerHTML=`<div class="learning-animation"><span class="badge">INTERACTIVE LEARNING</span><label>Choose a model<select data-model>${Object.entries(simulations).map(([id,s])=>`<option value="${id}" ${id===kind?'selected':''}>${s.title}</option>`).join('')}</select></label><h3 data-predict></h3><div data-controls></div><div data-picture class="animation-picture"></div><p data-explanation></p><div class="button-row"><button data-play class="primary">Play</button><button data-step class="secondary">Step</button><button data-reset class="secondary">Reset</button></div><details><summary>Check your prediction</summary><p data-check></p></details><p class="notice">Change the controls and explain what you observe. Models are simplified. Motion starts only when you choose Play; Step works without continuous motion.</p></div>`;
 const q=s=>root.querySelector(s);
 function paint(){const s=modelState(kind,values,time);values=s.values;q('[data-picture]').innerHTML=picture(kind,s,time);q('[data-explanation]').textContent=explanation(kind,s,time);q('[data-check]').textContent=explanation(kind,s,time);q('[data-play]').textContent=running?'Pause':'Play';values.forEach((v,i)=>{const input=q(`[data-value="${i}"]`);input.value=v;input.nextElementSibling.value=kind==='cells'?['Membrane','Cytoplasm','Nucleus'][v]:v;});}
 function pause(){running=false;cancelAnimationFrame(frame);previous=0;if(root.isConnected)q('[data-play]').textContent='Play';}
 function tick(now){if(cleaned||!root.isConnected||document.hidden||!root.closest('dialog')?.open){pause();return;}if(previous)time+=Math.min((now-previous)/1000,.05);previous=now;if(kind==='forces'&&modelState(kind,values,time).distance>=20){time=Math.sqrt(40/(values[0]/values[1]));pause();}paint();if(running)frame=requestAnimationFrame(tick);}
 function setup(){pause();time=0;values=[...simulations[kind].defaults];const spec=simulations[kind];q('[data-predict]').textContent=spec.prompt;q('[data-controls]').innerHTML=spec.labels.map((label,i)=>`<label>${label}<input data-value="${i}" type="range" min="${spec.min[i]}" max="${spec.max[i]}" step="${spec.step[i]}" value="${values[i]}"><output>${values[i]}</output></label>`).join('');q('[data-play]').hidden=q('[data-step]').hidden=kind==='fractions'||kind==='mean';root.querySelectorAll('[data-value]').forEach(input=>input.oninput=()=>{pause();time=0;values[Number(input.dataset.value)]=Number(input.value);paint();});paint();}
 q('[data-model]').onchange=e=>{kind=e.target.value;setup();};q('[data-play]').onclick=()=>{if(running)pause();else{if(kind==='forces'&&modelState(kind,values,time).distance>=20)time=0;running=true;previous=0;frame=requestAnimationFrame(tick);}paint();};q('[data-step]').onclick=()=>{pause();time+=.25;if(kind==='forces'&&values[0]>0)time=Math.min(time,Math.sqrt(40/(values[0]/values[1])));paint();};q('[data-reset]').onclick=setup;
 const dialog=root.closest('dialog'),onHide=()=>{if(document.hidden)pause();};const cleanup=()=>{if(cleaned)return;cleaned=true;pause();document.removeEventListener('visibilitychange',onHide);dialog?.removeEventListener('close',cleanup);watch.disconnect();};const watch=new MutationObserver(()=>{if(!root.isConnected)cleanup();});watch.observe(root.parentNode,{childList:true});dialog?.addEventListener('close',cleanup);document.addEventListener('visibilitychange',onHide);setup();return cleanup;
}
