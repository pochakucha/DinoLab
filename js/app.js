const EXCLUSIVE = [["압축","매머드"]];
const DURATION = 3000;
const FIELD_DEFS = [
 ["nickname","닉네임","text","포차쿠차쓰리"],
 ["levelCap","레벨캡","number",1400],
 ["baseHp","기본체력","number",5210],
 ["baseAtk","기본공격력","number",729],
 ["moveSpeed","기본이동속도","number",150],
 ["constHp","별자리체력","number",1000],
 ["constAtk","별자리공격력","number",135],
 ["constMove","별자리이동속도","number",0],
 ["titanBonus","타이탄피해증가(고정)","number",40],
 ["titanReduction","타이탄피해감소(고정)","number",10],
 ["extraAtk","공격력증가%","number",3.7],
 ["extraHp","체력증가%","number",0.7],
 ["extraBoth","공체증가%","number",3],
 ["titanLevel","타이탄레벨","number",26],
 ["simulations","기본 시뮬횟수","number",3000],
 ["target","목표생존률%","number",90]
];
const $=s=>document.querySelector(s);
let worker=null;
let autoSaveTimer=null;

function displayGrade(raw){return ({"에픽/노랑":"에픽","초록":"레어","파랑":"일반"}[raw]||raw)}
function availableMaxLevel(d){
 const levels=Object.entries(d?.levels||{}).filter(([,v])=>String(v||"").trim()!=="").map(([k])=>Number(k)).filter(Number.isFinite);
 return levels.length?Math.max(...levels):0;
}

function init(){
 const form=$("#statsForm");
 FIELD_DEFS.forEach(([k,label,type,val])=>{
   const l=document.createElement("label"); l.textContent=label;
   const i=document.createElement("input"); i.id=k;i.type=type;i.value=val;i.step="any";
   form.append(l,i);
 });
 const box=$("#runeRows");
 const GRADE_ORDER=["전설","유니크","에픽","레어","일반"];
 const RUNE_ORDER=[
  "메테오","낙뢰",
  "흡혈","강타","방어벽","보스슬레이어",
  "압축","타이탄가드","매머드","공격력증가[3]","체력증가[3]",
  "단단한피부[2]","피해저항[2]","협동공격","공격력증가[2]","체력증가[2]",
  "단단한피부[1]","희생","힐"
 ];
 let lastGrade="";
 Object.entries(RUNE_DATA)
 .sort((a,b)=>{
   const ga=GRADE_ORDER.indexOf(displayGrade(a[1].grade)), gb=GRADE_ORDER.indexOf(displayGrade(b[1].grade));
   if(ga!==gb)return (ga<0?999:ga)-(gb<0?999:gb);
   const ia=RUNE_ORDER.indexOf(a[0]), ib=RUNE_ORDER.indexOf(b[0]);
   return (ia<0?999:ia)-(ib<0?999:ib)||a[0].localeCompare(b[0],"ko");
 })
 .forEach(([name,d])=>{
   const grade=displayGrade(d.grade);
   if(grade!==lastGrade){
     const h=document.createElement("div");h.className="rune-group "+grade;
     const icon={"전설":"🔴","유니크":"🟠","에픽":"🟡","레어":"🟢","일반":"🔵"}[grade]||"";
     h.textContent=icon+" "+grade;box.append(h);lastGrade=grade;
   }
   const row=document.createElement("div");row.className="rune-row grade-"+grade;row.dataset.name=name;
   row.innerHTML=`<div class="rune-toggles"><label><input class="owned" type="checkbox" aria-label="${name} 보유"><span>보유</span></label></div>
   <div class="rune-title"><span class="rune-name">${name}</span><span class="grade grade-${grade}">${grade}</span></div>
   <label class="rune-level"><span>Lv.</span><input class="level" type="number" min="0" max="${availableMaxLevel(d)}" value="0"></label>`;
   const owned=row.querySelector(".owned"), level=row.querySelector(".level");
   level.addEventListener("input",()=>{owned.checked=Number(level.value)>0;refreshManualCombo()});
   owned.addEventListener("change",()=>{if(owned.checked&&Number(level.value)<=0)level.value=availableMaxLevel(d);if(!owned.checked)level.value=0;refreshManualCombo()});
   box.append(row);
 });
 const manual=$("#manualCombo");
 for(let i=0;i<5;i++){const sel=document.createElement("select");sel.className="manual-rune";manual.append(sel)}
 refreshManualCombo();
 bind();
 refreshProfiles();
 const saved=localStorage.getItem("titanWeb:last");
 if(saved){try{applyProfile(JSON.parse(saved));}catch(e){console.warn("자동 복원 실패",e)}}
 enableAutoSave();
}
function bind(){
 $("#calcSelected").onclick=()=>run("selected");
 $("#optimize").onclick=()=>run("optimize");
 $("#maxLevel").onclick=()=>run("maxLevel");
 $("#stopBtn").onclick=stopWorker;
 $("#saveProfile").onclick=saveProfile;
 $("#loadProfile").onclick=()=>{const n=$("#profileSelect").value;if(n){applyProfile(JSON.parse(localStorage.getItem("titanWeb:profile:"+n)));}};
 $("#importJson").onclick=()=>$("#fileInput").click();
 $("#fileInput").onchange=importJson;
 $("#exportJson").onclick=exportJson;
 $("#deleteProfile").onclick=deleteProfile;
 $("#copyResult").onclick=()=>navigator.clipboard.writeText($("#result").innerText).then(()=>alert("결과를 복사했습니다."));
 $("#resetForm").onclick=()=>{if(confirm("입력값과 룬 선택을 초기화할까요?")){localStorage.removeItem("titanWeb:last");location.reload();}};
}
function stats(){
 const s={};FIELD_DEFS.forEach(([k,,type])=>s[k]=type==="number"?Number($("#"+k).value):$("#"+k).value);
 if(s.baseHp/10+s.baseAtk<=0)throw Error("기본체력/10 + 기본공격력은 0보다 커야 합니다.");
 if(s.levelCap<=s.moveSpeed+s.constMove)throw Error("레벨캡은 총 이동속도보다 커야 합니다.");
 return s;
}
function runes(){
 return [...document.querySelectorAll(".rune-row")].map(row=>{
  const name=row.dataset.name, level=Number(row.querySelector(".level").value), owned=row.querySelector(".owned").checked;
  const raw=RUNE_DATA[name]?.levels?.[String(level)];
  return {name,level,owned,validData:String(raw||"").trim()!==""};
 }).filter(x=>x.level>0&&x.owned);
}
function selectedRunes(){
 const all=Object.fromEntries(runes().map(x=>[x.name,x]));
 return [...document.querySelectorAll(".manual-rune")].map(x=>all[x.value]).filter(Boolean);
}
function refreshManualCombo(){
 const owned=runes();
 document.querySelectorAll(".manual-rune").forEach((sel,i)=>{
   const prev=sel.value; sel.innerHTML='<option value="">룬 '+(i+1)+'</option>'+owned.map(x=>`<option value="${x.name}">${x.name} Lv.${x.level}</option>`).join('');
   if(owned.some(x=>x.name===prev))sel.value=prev;
 });
}
function profile(){return {stats:stats(),runes:runes()}}
function applyProfile(p){
 if(!p)return;Object.entries(p.stats||{}).forEach(([k,v])=>{if($("#"+k))$("#"+k).value=v});
 const map=Object.fromEntries((p.runes||[]).map(x=>[x.name,x]));
 document.querySelectorAll(".rune-row").forEach(row=>{
   const x=map[row.dataset.name], lv=row.querySelector(".level");
   row.querySelector(".owned").checked=!!x?.owned;lv.value=x?.level||0;
 });
 refreshManualCombo();
}
function saveProfile(){
 const p=profile(), name=(p.stats.nickname||"프로필").trim();
 localStorage.setItem("titanWeb:profile:"+name,JSON.stringify(p));
 localStorage.setItem("titanWeb:last",JSON.stringify(p));refreshProfiles(name);setProfileHint(name+" 프로필 저장 완료");alert(name+" 프로필을 저장했습니다.");
}
function refreshProfiles(select){
 const names=Object.keys(localStorage).filter(k=>k.startsWith("titanWeb:profile:")).map(k=>k.slice(17)).sort();
 $("#profileSelect").innerHTML=names.map(n=>`<option ${n===select?"selected":""}>${n}</option>`).join("");
}
function makeProfileDocument(){
 const p=profile();
 return {
  profileVersion:3,
  appVersion:"0.10",
  gameVersion:"2026.07.23",
  savedAt:new Date().toISOString(),
  profileName:(p.stats.nickname||"프로필").trim(),
  stats:p.stats,
  runes:p.runes.map(({name,level})=>({name,level}))
 };
}
function normalizeProfileDocument(doc){
 if(!doc||typeof doc!=="object")throw Error("올바른 JSON 프로필이 아닙니다.");
 const stats=doc.stats||{};
 const runes=Array.isArray(doc.runes)?doc.runes:[];
 return {stats,runes:runes.map(x=>({name:x.name,level:Number(x.level||0),owned:Number(x.level||0)>0}))};
}
function importJson(e){
 const f=e.target.files[0];if(!f)return;const rd=new FileReader();
 rd.onload=()=>{try{const doc=JSON.parse(String(rd.result));const p=normalizeProfileDocument(doc);applyProfile(p);localStorage.setItem("titanWeb:last",JSON.stringify(p));setProfileHint(`${f.name} 불러오기 완료`);}catch(err){alert("JSON 불러오기 실패: "+err.message)}};
 rd.readAsText(f,"utf-8");e.target.value="";
}
function exportJson(){
 try{const doc=makeProfileDocument();const blob=new Blob([JSON.stringify(doc,null,2)],{type:"application/json;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=(doc.profileName||"타이탄프로필")+".json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);setProfileHint(a.download+" 저장 완료");}catch(err){alert(err.message)}
}
function deleteProfile(){
 const n=$("#profileSelect").value;if(!n){alert("삭제할 프로필이 없습니다.");return}
 if(!confirm(`${n} 프로필을 삭제할까요?`))return;
 localStorage.removeItem("titanWeb:profile:"+n);refreshProfiles();setProfileHint(n+" 프로필 삭제 완료");
}
function setProfileHint(text){const el=$("#profileHint");if(el)el.textContent=text}
function enableAutoSave(){
 document.addEventListener("input",scheduleAutoSave);
 document.addEventListener("change",scheduleAutoSave);
}
function scheduleAutoSave(){
 clearTimeout(autoSaveTimer);autoSaveTimer=setTimeout(()=>{
  try{const p=profile();localStorage.setItem("titanWeb:last",JSON.stringify(p));setProfileHint("자동 저장됨 · "+new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"}));}catch(e){}
 },350);
}
function setBusy(on){
 ["calcSelected","optimize","maxLevel"].forEach(id=>$("#"+id).disabled=on);$("#stopBtn").disabled=!on;
}
function stopWorker(){if(worker){worker.terminate();worker=null}setBusy(false);setStatus("계산을 중지했습니다.",0)}
function setStatus(text,pct){$("#statusText").textContent=text;$("#progressBar").style.width=(pct||0)+"%"}
function run(mode){
 try{
   const s=stats(), owned=runes(), selected=selectedRunes();
   const missing=owned.filter(x=>!x.validData);
   if(missing.length)throw Error("효과 데이터가 없는 룬 레벨입니다: "+missing.map(x=>x.name+" Lv."+x.level).join(", "));
   if(mode==="selected"||mode==="maxLevel"){if(selected.length!==5)throw Error("장착 룬을 정확히 5개 선택하세요.")}
   if(mode==="optimize"&&owned.length<5)throw Error("보유 룬을 5개 이상 입력하세요.");
   localStorage.setItem("titanWeb:last",JSON.stringify(profile()));
   setBusy(true);$("#result").textContent="계산 중...";setStatus("웹 워커를 시작합니다.",2);
   const blob=new Blob([WORKER_CODE],{type:"text/javascript"});worker=new Worker(URL.createObjectURL(blob));
   worker.onmessage=e=>{
     const m=e.data;if(m.type==="progress")setStatus(m.text,m.pct);
     if(m.type==="done"){setBusy(false);worker.terminate();worker=null;render(m.payload,mode,s.target)}
     if(m.type==="error"){setBusy(false);worker.terminate();worker=null;$("#result").textContent="오류: "+m.error;setStatus("오류가 발생했습니다.",0)}
   };
   worker.postMessage({mode,stats:s,owned,selected,runeData:RUNE_DATA});
 }catch(err){alert(err.message)}
}
function render(p,mode,target){
 setStatus("계산 완료",100);
 if(mode==="selected"){
   const r=p.result, cls=r.wilson*100>=target?"goodtxt":"warntxt";
   $("#result").innerHTML=`<div class="hero"><h2>선택한 5룬 정밀 결과</h2><div id="primaryRuneStrip" class="result-runes"></div><h3>${p.combo}</h3>
   <div class="cards"><div class="card"><span>생존률</span><b class="${cls}">${pct(r.survival)}</b></div><div class="card"><span>95% 신뢰구간</span><b class="${cls}">${pct(r.ciLow)} ~ ${pct(r.ciHigh)}</b></div><div class="card"><span>50분 총딜</span><b>${num(r.damage)}</b></div></div>
   <p>시뮬레이션 ${num(r.sims)}회 · 평균 생존시간 ${(r.time/60).toFixed(1)}분 · 최종체력 ${num(r.hp)} · 일반공격 ${num(r.atk)} · 보스공격 ${num(r.bossAtk)}</p></div>`;
 }else if(mode==="maxLevel"){
   $("#result").innerHTML=`<div class="hero"><h2>현재 5룬 최대 말뚝 레벨</h2><div id="primaryRuneStrip" class="result-runes"></div><h3>${p.combo}</h3>
   <div class="cards"><div class="card"><span>추천 최대</span><b class="goodtxt">${p.level}레벨</b></div><div class="card"><span>생존률</span><b>${pct(p.result.survival)}</b></div><div class="card"><span>95% 신뢰구간</span><b>${pct(p.result.ciLow)} ~ ${pct(p.result.ciHigh)}</b></div></div><p>${(p.checks||[]).map(x=>x.level+"레벨 "+pct(x.result.survival)+" (하한 "+pct(x.result.ciLow)+")").join(" · ")}</p></div>`;
 }else{
   const r=p.recommended.result,b=p.barrier?.result;
   let html=`<div class="hero"><h2>최종 추천 룬 조합</h2><div id="primaryRuneStrip" class="result-runes"></div><h3>${p.recommended.combo}</h3>
   <div class="cards"><div class="card"><span>생존률</span><b class="goodtxt">${pct(r.survival)}</b></div><div class="card"><span>95% 신뢰구간</span><b class="goodtxt">${pct(r.ciLow)} ~ ${pct(r.ciHigh)}</b></div><div class="card"><span>50분 총딜</span><b>${num(r.damage)}</b></div></div><p>최종 검증 ${num(r.sims)}회</p>`;
   if(p.barrier)html+=`<h2>방어벽 포함 최고 조합</h2><h3>${p.barrier.combo}</h3><p>생존 ${pct(b.survival)} · 하한 ${pct(b.ciLow)} · 총딜 ${num(b.damage)} · 추천 대비 ${num(b.damage-r.damage)}</p>`;
   html+=`</div>\n\n=== 정밀 검증 순위 ===\n`+p.ranking.map((x,i)=>`${String(i+1).padStart(2)}. ${x.result.wilson*100>=target?"[안정권]":"[목표미달]"} 생존 ${pct(x.result.survival)} (95% CI ${pct(x.result.ciLow)}~${pct(x.result.ciHigh)}, ${num(x.result.sims)}회) | 총딜 ${num(x.result.damage)} | ${x.combo}`).join("\n");
   $("#result").innerHTML=html;
 }
 const comboForStrip=mode==="optimize"?p.recommended.combo:p.combo;
 renderRuneIconStrip(comboForStrip,"primaryRuneStrip");
 if(window.matchMedia("(max-width:760px)").matches){setTimeout(()=>$(".result-panel").scrollIntoView({behavior:"smooth",block:"start"}),80)}
}
const pct=x=>(x*100).toFixed(2)+"%";const num=x=>Math.round(x).toLocaleString("ko-KR");

const WORKER_CODE = String.raw`
const post=(text,pct)=>self.postMessage({type:"progress",text,pct});
const clamp=x=>Number.isFinite(+x)?Math.min(1,Math.max(0,+x)):0;
function nums(raw){return String(raw||"").replaceAll(" ","").split(",").map(Number).filter(Number.isFinite)}
function effect(data,name,level){
 const n=nums(data[name]?.levels?.[String(level)]),e={flatAtk:0,flatHp:0,atkPct:0,hpPct:0,bossPct:0,drFlat:0,drChance:0,drProc:0,lsChance:0,lsPct:0,skillChance:0,skillPct:0,legendAtk:0,legendHp:0,healChance:0,healPct:0};
 if(name==="흡혈"&&n.length>=2){e.lsChance=n[0]/100;e.lsPct=n[1]/100}
 else if(name==="강타"&&n.length)e.atkPct=n[0]/100;
 else if(name==="방어벽"&&n.length)e.hpPct=n[0]/100;
 else if(name==="압축"&&n.length){e.atkPct=n[0]/100;e.hpPct=-.25}
 else if(name==="매머드"&&n.length){e.hpPct=n[0]/100;e.atkPct=-.25}
 else if(name==="보스슬레이어"&&n.length)e.bossPct=n[0]/100;
 else if(name==="타이탄가드"&&n.length)e.drFlat=n[0];
 else if((name==="공격력증가[3]"||name==="공격력증가[2]")&&n.length)e.flatAtk=n[0];
 else if((name==="체력증가[3]"||name==="체력증가[2]")&&n.length)e.flatHp=n[0];
 else if(name==="협동공격"&&n.length>=2){e.flatAtk=n[0];e.flatHp=n[1]}
 else if((name==="단단한피부[2]"||name==="단단한피부[1]")&&n.length)e.drFlat=n[0];
 else if(name==="피해저항[2]"&&n.length>=2){e.drChance=n[0]/100;e.drProc=n[1]}
 else if(name==="힐"&&n.length>=2){e.healChance=n[0]/100;e.healPct=n[1]/100}
 else if((name==="메테오"||name==="낙뢰")&&n.length>=4){e.skillChance=n[0]/100;e.skillPct=n[1]/100;e.legendAtk=n[2]/100;e.legendHp=n[3]/100}
 return e;
}
function combine(data,combo){
 const t={flatAtk:0,flatHp:0,atkPct:0,hpPct:0,bossPct:0,drFlat:0,drChance:0,drProc:0,lsChance:0,lsPct:0,legendAtk:0,legendHp:0,healChance:0,healPct:0};
 const skills=[];
 for(const r of combo){const e=effect(data,r.name,r.level);for(const k in t)t[k]+=e[k]||0;if(e.skillChance)skills.push({name:r.name,...e})}
 return {t,skills};
}
function finalStats(s,data,combo){
 const den=s.baseHp/10+s.baseAtk,f=(s.levelCap-s.moveSpeed-s.constMove)/den;
 const flatHp=s.baseHp*f+s.constHp,flatAtk=s.baseAtk*f+s.constAtk,{t,skills}=combine(data,combo);
 const hp=(flatHp+t.flatHp)*(1+t.hpPct+t.legendHp+(s.extraHp+s.extraBoth)/100);
 const atk=(flatAtk+t.flatAtk)*(1+t.atkPct+t.legendAtk+(s.extraAtk+s.extraBoth)/100);
 const bossAtk=atk*(1+t.bossPct)+s.titanBonus;
 return {flatHp,flatAtk,hp,atk,bossAtk,t,skills};
}
const titanDamage=l=>{
 const level=Math.max(1,Math.floor(Number(l)||1));
 return level<=6?level*5:30+(level-6)*15;
};
function wilsonInterval(k,n){
 if(!n)return {low:0,high:1};
 const z=1.96,p=k/n,d=1+z*z/n,c=p+z*z/(2*n),m=z*Math.sqrt((p*(1-p)+z*z/(4*n))/n);
 return {low:Math.max(0,(c-m)/d),high:Math.min(1,(c+m)/d)};
}
function percentile(sorted,q){if(!sorted.length)return 0;const i=(sorted.length-1)*q,lo=Math.floor(i),hi=Math.ceil(i);return sorted[lo]+(sorted[hi]-sorted[lo])*(i-lo)}
function simulateBatch(s,data,combo,sims){
 const st=finalStats(s,data,combo),{hp,atk,bossAtk,t,skills}=st;
 const incoming=Math.max(0,titanDamage(s.titanLevel)-s.titanReduction-t.drFlat);
 const lsP=clamp(t.lsChance),lsAmt=atk*Math.max(0,t.lsPct),healP=clamp(t.healChance),healAmt=hp*Math.max(0,t.healPct),drP=clamp(t.drChance),drAmt=t.drProc;
 let survive=0,damageSum=0,timeSum=0;const deathTimes=[];
 for(let n=0;n<sims;n++){
  let cur=hp,damage=0,aliveTime=3000;
  for(let sec=1;sec<=3000;sec++){
   damage+=bossAtk;
   if(Math.random()<lsP)cur=Math.min(hp,cur+lsAmt);
   if(Math.random()<healP)cur=Math.min(hp,cur+healAmt);
   for(const skill of skills)if(Math.random()<clamp(skill.skillChance))damage+=bossAtk*Math.max(0,skill.skillPct);
   if(sec%3===0){let hit=incoming;if(Math.random()<drP)hit=Math.max(0,hit-drAmt);cur-=hit;if(cur<=0){aliveTime=sec;break}}
  }
  if(cur>0)survive++;else deathTimes.push(aliveTime);
  damageSum+=damage;timeSum+=aliveTime;
 }
 deathTimes.sort((a,b)=>a-b);const ci=wilsonInterval(survive,sims);
 return {survive,sims,survival:survive/sims,wilson:ci.low,ciLow:ci.low,ciHigh:ci.high,damage:damageSum/sims,time:timeSum/sims,p10:percentile(deathTimes,.1)||3000,p50:percentile(deathTimes,.5)||3000,p90:percentile(deathTimes,.9)||3000,hp,atk,bossAtk};
}
function mergeResults(parts){
 const sims=parts.reduce((a,x)=>a+x.sims,0),survive=parts.reduce((a,x)=>a+x.survive,0),ci=wilsonInterval(survive,sims),last=parts[parts.length-1];
 return {...last,sims,survive,survival:survive/sims,wilson:ci.low,ciLow:ci.low,ciHigh:ci.high,damage:parts.reduce((a,x)=>a+x.damage*x.sims,0)/sims,time:parts.reduce((a,x)=>a+x.time*x.sims,0)/sims};
}
function adaptiveSimulate(s,data,combo,baseN,progressLabel="정밀 검증"){
 const target=s.target/100,parts=[];let total=0;
 const stages=[Math.max(500,baseN),10000,30000];
 for(let i=0;i<stages.length;i++){
  const desired=stages[i],add=desired-total;if(add<=0)continue;
  parts.push(simulateBatch(s,data,combo,add));total=desired;
  const r=mergeResults(parts);post(progressLabel+" · "+total.toLocaleString()+"회",Math.min(98,55+i*18));
  const near=(r.ciLow<=target&&r.ciHigh>=target)||Math.abs(r.survival-target)<=.03;
  if(!near||total>=30000)return r;
 }
 return mergeResults(parts);
}
function valid(c){const n=new Set(c.map(x=>x.name));return !(n.has("압축")&&n.has("매머드"))}
function combos5(a){const out=[];for(let i=0;i<a.length-4;i++)for(let j=i+1;j<a.length-3;j++)for(let k=j+1;k<a.length-2;k++)for(let l=k+1;l<a.length-1;l++)for(let m=l+1;m<a.length;m++){const c=[a[i],a[j],a[k],a[l],a[m]];if(valid(c))out.push(c)}return out}
const comboText=c=>c.map(x=>x.name+x.level).join(" / ");
function analytic(s,data,c){
 const st=finalStats(s,data,c),t=st.t;
 const incoming=Math.max(0,titanDamage(s.titanLevel)-s.titanReduction-t.drFlat),dr=t.drChance*Math.min(incoming,t.drProc);
 const heal=3*clamp(t.lsChance)*st.atk*Math.max(0,t.lsPct)+3*clamp(t.healChance)*st.hp*Math.max(0,t.healPct);
 let skill=0;for(const e of st.skills)skill+=clamp(e.skillChance)*Math.max(0,e.skillPct);
 return {survivalScore:heal-(incoming-dr)+st.hp/1000,damage:3000*st.bossAtk*(1+skill)};
}
function pickCandidates(s,data,all){
 const scored=all.map(c=>({c,...analytic(s,data,c)})),map=new Map(),add=a=>a.forEach(x=>map.set(comboText(x.c),x.c));
 add([...scored].sort((a,b)=>b.survivalScore-a.survivalScore).slice(0,120));
 const topSurv=[...scored].sort((a,b)=>b.survivalScore-a.survivalScore)[0]?.survivalScore??0;
 add(scored.filter(x=>x.survivalScore>=topSurv-Math.max(8,Math.abs(topSurv)*.75)).sort((a,b)=>b.damage-a.damage).slice(0,120));
 for(const rune of new Set(all.flat().map(x=>x.name))){const arr=scored.filter(x=>x.c.some(y=>y.name===rune)).sort((a,b)=>(b.survivalScore-a.survivalScore)||(b.damage-a.damage));if(arr[0])add([arr[0]])}
 return [...map.values()];
}
self.onmessage=e=>{
 try{
  const {mode,stats:s,owned,selected,runeData:data}=e.data;
  if(mode==="selected"){
   post("1초 단위 이벤트 시뮬레이션",12);const r=adaptiveSimulate(s,data,selected,Math.max(500,Math.floor(s.simulations)),"선택 조합");self.postMessage({type:"done",payload:{combo:comboText(selected),result:r}});return;
  }
  if(mode==="maxLevel"){
   let lo=1,hi=201;while(lo+1<hi){const mid=Math.floor((lo+hi)/2);s.titanLevel=mid;post("최대 말뚝 탐색: "+mid+"레벨",10+35*(1-Math.log2(hi-lo)/8));const r=simulateBatch(s,data,selected,Math.max(800,Math.min(2500,Math.floor(s.simulations))));if(r.ciLow>=s.target/100)lo=mid;else hi=mid}
   const checks=[];for(const level of [Math.max(1,lo-1),lo,lo+1]){s.titanLevel=level;checks.push({level,result:adaptiveSimulate(s,data,selected,Math.max(1000,Math.floor(s.simulations)),level+"레벨 재검증")})}
   const stable=checks.filter(x=>x.result.ciLow>=s.target/100),best=stable[stable.length-1]||checks[0];self.postMessage({type:"done",payload:{combo:comboText(selected),level:best.level,result:best.result,checks}});return;
  }
  post("모든 유효 5룬 조합 생성",5);const all=combos5(owned);post("전체 "+all.length.toLocaleString()+"개 조합 1차 평가",12);
  const candidates=pickCandidates(s,data,all);post("확장 후보 "+candidates.length+"개 고속 검증",25);
  const quickN=Math.max(200,Math.min(500,Math.floor(s.simulations/8)||200)),quick=[];
  candidates.forEach((c,i)=>{quick.push({combo:c,result:simulateBatch(s,data,c,quickN)});if(i%4===0)post("고속 검증 "+(i+1)+"/"+candidates.length,25+35*(i+1)/candidates.length)});
  const target=s.target/100,map=new Map(),add=x=>map.set(comboText(x.combo),x.combo);
  [...quick].sort((a,b)=>((b.result.ciHigh>=target)-(a.result.ciHigh>=target))||(b.result.damage-a.result.damage)).slice(0,40).forEach(add);
  [...quick].sort((a,b)=>b.result.survival-a.result.survival).slice(0,15).forEach(add);
  [...quick].filter(x=>Math.abs(x.result.survival-target)<=.08).sort((a,b)=>b.result.damage-a.result.damage).slice(0,20).forEach(add);
  for(const rune of new Set(owned.map(x=>x.name))){const arr=quick.filter(x=>x.combo.some(y=>y.name===rune)).sort((a,b)=>b.result.damage-a.result.damage);if(arr[0])add(arr[0])}
  const finalists=[...map.values()],precise=[];
  finalists.forEach((c,i)=>{post("정밀 검증 "+(i+1)+"/"+finalists.length,62+34*(i+1)/finalists.length);precise.push({combo:c,result:adaptiveSimulate(s,data,c,Math.max(500,Math.floor(s.simulations)),"후보 "+(i+1))})});
  precise.sort((a,b)=>((b.result.ciLow>=target)-(a.result.ciLow>=target))||(b.result.damage-a.result.damage));
  const stable=precise.filter(x=>x.result.ciLow>=target),recommended=stable[0]||precise[0];
  const barrierStable=precise.filter(x=>x.combo.some(y=>y.name==="방어벽")&&x.result.ciLow>=target);
  const barrier=barrierStable.sort((a,b)=>b.result.damage-a.result.damage)[0]||precise.filter(x=>x.combo.some(y=>y.name==="방어벽")).sort((a,b)=>b.result.ciLow-a.result.ciLow)[0]||null;
  self.postMessage({type:"done",payload:{recommended:{combo:comboText(recommended.combo),result:recommended.result},barrier:barrier?{combo:comboText(barrier.combo),result:barrier.result}:null,ranking:precise.slice(0,30).map(x=>({combo:comboText(x.combo),result:x.result})),total:all.length}});
 }catch(err){self.postMessage({type:"error",error:err.stack||err.message})}
};`

function renderRuneIconStrip(comboTextValue,targetId){
 const wrap=document.getElementById(targetId);if(!wrap)return;
 const items=String(comboTextValue||'').split('/').map(x=>x.trim()).filter(Boolean);
 wrap.innerHTML=items.map(item=>{
   const match=item.match(/^(.*?)(\d+)$/);
   const name=match?match[1]:item;
   const level=match?match[2]:'';
   return `<div class="result-rune"><span class="result-rune-name">${name}</span>${level?`<b>Lv.${level}</b>`:''}</div>`;
 }).join('');
}
window.addEventListener('DOMContentLoaded',()=>{
 document.querySelectorAll('[data-scroll]').forEach(btn=>btn.addEventListener('click',()=>document.querySelector(btn.dataset.scroll)?.scrollIntoView({behavior:'smooth'})));
});

init();

// DinoLab v0.1 rune encyclopedia
(function initEncyclopedia(){
  const grid=document.getElementById('encyclopediaGrid');
  const filters=document.getElementById('runeFilters');
  if(!grid||!filters||typeof RUNE_DATA==='undefined') return;
  const grades=['전체','전설','유니크','에픽','레어','일반'];
  let active='전체';
  function maxLevel(data){return Math.max(...Object.keys(data.levels||{}).map(Number).filter(Number.isFinite),0)}
  function render(){
    grid.innerHTML='';
    Object.entries(RUNE_DATA).filter(([,d])=>active==='전체'||displayGrade(d.grade)===active).forEach(([name,d])=>{
      const card=document.createElement('article');card.className='ency-card';
      const lvl=maxLevel(d);const sample=(d.levels&&d.levels[String(lvl)])||'';
      const grade=displayGrade(d.grade);
      card.innerHTML=`<span class="ency-grade grade-${grade}">${grade}</span><h3>${name}</h3><p>최대 Lv.${lvl}<br>최대 레벨 값: ${sample||'정보 없음'}</p><button type="button">보유 룬에 입력하기</button>`;
      card.querySelector('button').addEventListener('click',()=>{document.querySelector('[data-scroll="#runeRows"]')?.click();setTimeout(()=>{const row=[...document.querySelectorAll('.rune-row')].find(x=>x.querySelector('.rune-name')?.textContent===name);row?.scrollIntoView({behavior:'smooth',block:'center'});row?.classList.add('equipped');setTimeout(()=>row?.classList.remove('equipped'),1200)},350)});
      grid.appendChild(card);
    });
  }
  grades.forEach(g=>{const b=document.createElement('button');b.textContent=g;b.className=g===active?'active':'';b.addEventListener('click',()=>{active=g;[...filters.children].forEach(x=>x.classList.toggle('active',x===b));render()});filters.appendChild(b)});
  render();
})();
