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
 ["simulations","정밀 시뮬횟수","number",3000],
 ["target","목표생존률%","number",90]
];
const $=s=>document.querySelector(s);
let worker=null;

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
   const ga=GRADE_ORDER.indexOf(a[1].grade), gb=GRADE_ORDER.indexOf(b[1].grade);
   if(ga!==gb)return (ga<0?999:ga)-(gb<0?999:gb);
   const ia=RUNE_ORDER.indexOf(a[0]), ib=RUNE_ORDER.indexOf(b[0]);
   return (ia<0?999:ia)-(ib<0?999:ib)||a[0].localeCompare(b[0],"ko");
 })
 .forEach(([name,d])=>{
   if(d.grade!==lastGrade){
     const h=document.createElement("div");h.className="rune-group "+d.grade;
     const icon={"전설":"🔴","유니크":"🟠","에픽":"🟡","레어":"🟢","일반":"🔵"}[d.grade]||"";
     h.textContent=icon+" "+d.grade;box.append(h);lastGrade=d.grade;
   }
   const row=document.createElement("div");row.className="rune-row grade-"+d.grade;row.dataset.name=name;
   row.innerHTML=`<img class="rune-icon" src="${RUNE_ICONS[name]||''}" alt="${name}" onerror="this.style.visibility='hidden'">
   <span class="rune-name">${name}</span>
   <span class="grade grade-${d.grade}">${d.grade}</span>
   <div class="rune-toggles">
     <label><input class="owned" type="checkbox" aria-label="${name} 보유"><span>보유</span></label>
     <label><input class="equip" type="checkbox" aria-label="${name} 장착"><span>장착</span></label>
   </div>
   <label class="rune-level"><span>Lv.</span><input class="level" type="number" min="0" max="${d.maxLevel}" value="0"></label>`;
   const owned=row.querySelector(".owned"), level=row.querySelector(".level");
   level.addEventListener("input",()=>{owned.checked=Number(level.value)>0});
   owned.addEventListener("change",()=>{if(owned.checked&&Number(level.value)<=0)level.value=d.maxLevel});
   row.querySelector(".equip").addEventListener("change",e=>{
     if(e.target.checked){owned.checked=true;if(Number(level.value)<=0)level.value=d.maxLevel}
     const count=document.querySelectorAll(".equip:checked").length;
     if(count>5){e.target.checked=false;alert("장착 룬은 5개까지만 선택할 수 있습니다.")} row.classList.toggle("equipped",e.target.checked);updateEquippedCounter();
   });
   box.append(row);
 });
 bind();
 refreshProfiles();
 const saved=localStorage.getItem("titanWeb:last");
 if(saved) applyProfile(JSON.parse(saved));
}
function bind(){
 $("#calcSelected").onclick=()=>run("selected");
 $("#optimize").onclick=()=>run("optimize");
 $("#maxLevel").onclick=()=>run("maxLevel");
 $("#stopBtn").onclick=stopWorker;
 $("#saveProfile").onclick=saveProfile;
 $("#loadProfile").onclick=()=>{const n=$("#profileSelect").value;if(n){applyProfile(JSON.parse(localStorage.getItem("titanWeb:profile:"+n)));}};
 $("#importTxt").onclick=()=>$("#fileInput").click();
 $("#fileInput").onchange=importTxt;
 $("#exportTxt").onclick=exportTxt;
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
 return [...document.querySelectorAll(".rune-row")].map(row=>({
  name:row.dataset.name,level:Number(row.querySelector(".level").value),
  owned:row.querySelector(".owned").checked,equip:row.querySelector(".equip").checked
 })).filter(x=>x.level>0);
}
function profile(){return {stats:stats(),runes:runes()}}
function applyProfile(p){
 if(!p)return;Object.entries(p.stats||{}).forEach(([k,v])=>{if($("#"+k))$("#"+k).value=v});
 const map=Object.fromEntries((p.runes||[]).map(x=>[x.name,x]));
 document.querySelectorAll(".rune-row").forEach(row=>{
   const x=map[row.dataset.name], lv=row.querySelector(".level");
   row.querySelector(".owned").checked=!!x?.owned;row.querySelector(".equip").checked=!!x?.equip;row.classList.toggle("equipped",!!x?.equip);lv.value=x?.level||0;
 });
 updateEquippedCounter();
}
function saveProfile(){
 const p=profile(), name=(p.stats.nickname||"프로필").trim();
 localStorage.setItem("titanWeb:profile:"+name,JSON.stringify(p));
 localStorage.setItem("titanWeb:last",JSON.stringify(p));refreshProfiles(name);alert(name+" 프로필을 저장했습니다.");
}
function refreshProfiles(select){
 const names=Object.keys(localStorage).filter(k=>k.startsWith("titanWeb:profile:")).map(k=>k.slice(17)).sort();
 $("#profileSelect").innerHTML=names.map(n=>`<option ${n===select?"selected":""}>${n}</option>`).join("");
}
const KEYMAP={"닉네임":"nickname","레벨캡":"levelCap","기본체력":"baseHp","기본공격력":"baseAtk","기본이동속도":"moveSpeed","기본이속":"moveSpeed","별자리체력":"constHp","별자리공격력":"constAtk","별자리이동속도":"constMove","별자리이속":"constMove","타이탄피해증가":"titanBonus","보스피해증가":"titanBonus","타이탄피해감소":"titanReduction","보스피해감소":"titanReduction","공격력증가":"extraAtk","체력증가":"extraHp","공체증가":"extraBoth","타이탄레벨":"titanLevel","시뮬횟수":"simulations","목표생존률":"target"};
function importTxt(e){
 const f=e.target.files[0];if(!f)return;const rd=new FileReader();
 rd.onload=()=>{const p={stats:stats(),runes:[]};String(rd.result).split(/\r?\n/).forEach(line=>{
   line=line.trim();if(!line||!line.includes("="))return;let [k,...rest]=line.split("=");let v=rest.join("=").trim();k=k.trim().replace(/%$/,"");
   if(KEYMAP[k])p.stats[KEYMAP[k]]=KEYMAP[k]==="nickname"?v:Number(v||0);
   else if(RUNE_DATA[k])p.runes.push({name:k,level:Number(v||0),owned:Number(v)>0,equip:false});
 });applyProfile(p);};rd.readAsText(f,"utf-8");e.target.value="";
}
function exportTxt(){
 const p=profile(), reverse={nickname:"닉네임",levelCap:"레벨캡",baseHp:"기본체력",baseAtk:"기본공격력",moveSpeed:"기본이속",constHp:"별자리체력",constAtk:"별자리공격력",constMove:"별자리이속",titanBonus:"보스피해증가",titanReduction:"보스피해감소",extraAtk:"공격력증가",extraHp:"체력증가",extraBoth:"공체증가",titanLevel:"타이탄레벨",simulations:"시뮬횟수",target:"목표생존률"};
 let txt=Object.entries(reverse).map(([k,n])=>`${n}=${p.stats[k]}`).join("\n")+"\n\n보유룬\n\n";
 txt+=p.runes.map(x=>`${x.name}=${x.level}`).join("\n");
 const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([txt],{type:"text/plain;charset=utf-8"}));a.download=(p.stats.nickname||"타이탄프로필")+".txt";a.click();URL.revokeObjectURL(a.href);
}
function setBusy(on){
 ["calcSelected","optimize","maxLevel"].forEach(id=>$("#"+id).disabled=on);$("#stopBtn").disabled=!on;
}
function stopWorker(){if(worker){worker.terminate();worker=null}setBusy(false);setStatus("계산을 중지했습니다.",0)}
function setStatus(text,pct){$("#statusText").textContent=text;$("#progressBar").style.width=(pct||0)+"%"}
function run(mode){
 try{
   const s=stats(), all=runes(), owned=all.filter(x=>x.owned), selected=all.filter(x=>x.equip);
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
   <div class="cards"><div class="card"><span>생존률</span><b class="${cls}">${pct(r.survival)}</b></div><div class="card"><span>95% 하한</span><b class="${cls}">${pct(r.wilson)}</b></div><div class="card"><span>50분 총딜</span><b>${num(r.damage)}</b></div></div>
   <p>최종체력 ${num(r.hp)} · 일반공격 ${num(r.atk)} · 보스공격 ${num(r.bossAtk)}</p></div>`;
 }else if(mode==="maxLevel"){
   $("#result").innerHTML=`<div class="hero"><h2>현재 5룬 최대 말뚝 레벨</h2><div id="primaryRuneStrip" class="result-runes"></div><h3>${p.combo}</h3>
   <div class="cards"><div class="card"><span>추천 최대</span><b class="goodtxt">${p.level}레벨</b></div><div class="card"><span>생존률</span><b>${pct(p.result.survival)}</b></div><div class="card"><span>95% 하한</span><b>${pct(p.result.wilson)}</b></div></div></div>`;
 }else{
   const r=p.recommended.result,b=p.barrier?.result;
   let html=`<div class="hero"><h2>최종 추천 룬 조합</h2><div id="primaryRuneStrip" class="result-runes"></div><h3>${p.recommended.combo}</h3>
   <div class="cards"><div class="card"><span>생존률</span><b class="goodtxt">${pct(r.survival)}</b></div><div class="card"><span>95% 하한</span><b class="goodtxt">${pct(r.wilson)}</b></div><div class="card"><span>50분 총딜</span><b>${num(r.damage)}</b></div></div>`;
   if(p.barrier)html+=`<h2>방어벽 포함 최고 조합</h2><h3>${p.barrier.combo}</h3><p>생존 ${pct(b.survival)} · 하한 ${pct(b.wilson)} · 총딜 ${num(b.damage)} · 추천 대비 ${num(b.damage-r.damage)}</p>`;
   html+=`</div>\n\n=== 정밀 검증 순위 ===\n`+p.ranking.map((x,i)=>`${String(i+1).padStart(2)}. ${x.result.wilson*100>=target?"[안정권]":"[목표미달]"} 생존 ${pct(x.result.survival)} (하한 ${pct(x.result.wilson)}) | 총딜 ${num(x.result.damage)} | ${x.combo}`).join("\n");
   $("#result").innerHTML=html;
 }
 const comboForStrip=mode==="optimize"?p.recommended.combo:p.combo;
 renderRuneIconStrip(comboForStrip,"primaryRuneStrip");
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
 for(const r of combo){const e=effect(data,r.name,r.level);for(const k in t)t[k]+=e[k]||0;if(e.skillChance)skills.push(e)}
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
const titanDamage=l=>Math.max(0,(l-6)*15+30);
function wilson(k,n){const z=1.96,p=k/n,d=1+z*z/n,c=p+z*z/(2*n),m=z*Math.sqrt((p*(1-p)+z*z/(4*n))/n);return Math.max(0,(c-m)/d)}
function binomial3(p){return (Math.random()<p)+(Math.random()<p)+(Math.random()<p)}
function simulate(s,data,combo,sims){
 const st=finalStats(s,data,combo),{hp,atk,bossAtk,t,skills}=st;
 const incoming=Math.max(0,titanDamage(s.titanLevel)-s.titanReduction-t.drFlat),blocks=1000;
 const lsP=clamp(t.lsChance),lsAmt=atk*Math.max(0,t.lsPct),healP=clamp(t.healChance),healAmt=hp*Math.max(0,t.healPct),drP=clamp(t.drChance),drAmt=t.drProc;
 let survive=0,damageSum=0,timeSum=0;
 let expectedSkill=0;for(const e of skills)expectedSkill+=clamp(e.skillChance)*Math.max(0,e.skillPct);
 const dmgPerBlock=3*bossAtk*(1+expectedSkill);
 for(let n=0;n<sims;n++){
  let cur=hp,damage=0,aliveTime=3000;
  for(let b=1;b<=blocks;b++){
   damage+=dmgPerBlock;
   let heal=binomial3(lsP)*lsAmt+(Math.random()<healP?healAmt:0);
   let hit=incoming;if(Math.random()<drP)hit=Math.max(0,hit-drAmt);
   cur=Math.min(hp,cur+heal)-hit;
   if(cur<=0){aliveTime=b*3;break}
  }
  if(cur>0)survive++;damageSum+=damage;timeSum+=aliveTime;
 }
 return {survival:survive/sims,wilson:wilson(survive,sims),damage:damageSum/sims,time:timeSum/sims,hp,atk,bossAtk};
}
function valid(c){const n=new Set(c.map(x=>x.name));return !(n.has("압축")&&n.has("매머드"))}
function combos5(a){const out=[];for(let i=0;i<a.length-4;i++)for(let j=i+1;j<a.length-3;j++)for(let k=j+1;k<a.length-2;k++)for(let l=k+1;l<a.length-1;l++)for(let m=l+1;m<a.length;m++){const c=[a[i],a[j],a[k],a[l],a[m]];if(valid(c))out.push(c)}return out}
const comboText=c=>c.map(x=>x.name+x.level).join(" / ");
function analytic(s,data,c){
 const st=finalStats(s,data,c),t=st.t;
 const incoming=Math.max(0,titanDamage(s.titanLevel)-s.titanReduction-t.drFlat),dr=t.drChance*Math.min(incoming,t.drProc);
 const heal=3*clamp(t.lsChance)*st.atk*Math.max(0,t.lsPct)+clamp(t.healChance)*st.hp*Math.max(0,t.healPct);
 let skill=0;for(const e of st.skills)skill+=clamp(e.skillChance)*Math.max(0,e.skillPct);
 return {survivalScore:heal-(incoming-dr)+st.hp/1000,damage:3000*st.bossAtk*(1+skill)}
}
function pickCandidates(s,data,all){
 const scored=all.map(c=>({c,...analytic(s,data,c)})),map=new Map();
 const add=a=>a.forEach(x=>map.set(comboText(x.c),x.c));
 add([...scored].sort((a,b)=>b.survivalScore-a.survivalScore).slice(0,70));
 const topSurv=scored[0]?.survivalScore??0;
 add(scored.filter(x=>x.survivalScore>=topSurv-Math.max(5,Math.abs(topSurv)*.5)).sort((a,b)=>b.damage-a.damage).slice(0,70));
 for(const rune of new Set(all.flat().map(x=>x.name))){
  const arr=scored.filter(x=>x.c.some(y=>y.name===rune)).sort((a,b)=>(b.survivalScore-a.survivalScore)||(b.damage-a.damage));
  if(arr[0])add([arr[0]]);
 }
 return [...map.values()];
}
self.onmessage=e=>{
 try{
  const {mode,stats:s,owned,selected,runeData:data}=e.data;
  if(mode==="selected"){post("선택 조합 정밀 시뮬레이션",20);const r=simulate(s,data,selected,Math.max(100,Math.floor(s.simulations)));self.postMessage({type:"done",payload:{combo:comboText(selected),result:r}});return}
  if(mode==="maxLevel"){
   let lo=1,hi=201,best=null;while(lo+1<hi){const mid=Math.floor((lo+hi)/2);s.titanLevel=mid;post("최대 말뚝 탐색: "+mid+"레벨",20+mid/3);const r=simulate(s,data,selected,Math.max(300,Math.min(1200,Math.floor(s.simulations/3))));if(r.wilson>=s.target/100){lo=mid;best=r}else hi=mid}
   s.titanLevel=lo;best=simulate(s,data,selected,Math.max(500,Math.floor(s.simulations)));self.postMessage({type:"done",payload:{combo:comboText(selected),level:lo,result:best}});return;
  }
  post("모든 유효 5룬 조합 생성",5);const all=combos5(owned);post("전체 "+all.length.toLocaleString()+"개 조합 수식 평가",15);
  const candidates=pickCandidates(s,data,all);post("고속 후보 검증 "+candidates.length+"개",30);
  const quickN=Math.max(80,Math.min(180,Math.floor(s.simulations/20)||80)),quick=[];
  candidates.forEach((c,i)=>{quick.push({combo:c,result:simulate(s,data,c,quickN)});if(i%5===0)post("고속 후보 검증 "+(i+1)+"/"+candidates.length,30+35*(i+1)/candidates.length)});
  const target=s.target/100;
  const map=new Map(),add=x=>map.set(comboText(x.combo),x.combo);
  quick.sort((a,b)=>((b.result.survival>=target-.06)-(a.result.survival>=target-.06))||(b.result.damage-a.result.damage));
  quick.slice(0,24).forEach(add);
  [...quick].sort((a,b)=>b.result.survival-a.result.survival).slice(0,8).forEach(add);
  for(const rune of new Set(owned.map(x=>x.name))){const arr=quick.filter(x=>x.combo.some(y=>y.name===rune)).sort((a,b)=>b.result.damage-a.result.damage);if(arr[0])add(arr[0])}
  const finalists=[...map.values()],precise=[];
  finalists.forEach((c,i)=>{post("정밀 검증 "+(i+1)+"/"+finalists.length,68+30*(i+1)/finalists.length);precise.push({combo:c,result:simulate(s,data,c,Math.max(300,Math.floor(s.simulations)))})});
  precise.sort((a,b)=>((b.result.wilson>=target)-(a.result.wilson>=target))||(b.result.damage-a.result.damage));
  const stable=precise.filter(x=>x.result.wilson>=target),recommended=stable[0]||precise[0];
  const barrierStable=precise.filter(x=>x.combo.some(y=>y.name==="방어벽")&&x.result.wilson>=target);
  const barrier=barrierStable.sort((a,b)=>b.result.damage-a.result.damage)[0]||precise.filter(x=>x.combo.some(y=>y.name==="방어벽")).sort((a,b)=>b.result.wilson-a.result.wilson)[0]||null;
  self.postMessage({type:"done",payload:{recommended:{combo:comboText(recommended.combo),result:recommended.result},barrier:barrier?{combo:comboText(barrier.combo),result:barrier.result}:null,ranking:precise.slice(0,30).map(x=>({combo:comboText(x.combo),result:x.result})),total:all.length}});
 }catch(err){self.postMessage({type:"error",error:err.stack||err.message})}
};`;
function updateEquippedCounter(){
 const count=document.querySelectorAll('.equip:checked').length;
 const el=document.getElementById('equippedCount');
 if(el){el.textContent=count+' / 5';el.classList.toggle('complete',count===5)}
}
function renderRuneIconStrip(comboTextValue,targetId){
 const wrap=document.getElementById(targetId);if(!wrap)return;
 const names=String(comboTextValue||'').split('/').map(x=>x.trim().replace(/\d+$/,'')).filter(Boolean);
 wrap.innerHTML=names.map(name=>`<div class="result-rune"><img src="${RUNE_ICONS[name]||''}" alt="${name}"><span>${name}</span></div>`).join('');
}
window.addEventListener('DOMContentLoaded',()=>{
 document.addEventListener('change',e=>{if(e.target?.classList?.contains('equip'))updateEquippedCounter()});
 setTimeout(updateEquippedCounter,0);
 document.querySelectorAll('[data-scroll]').forEach(btn=>btn.addEventListener('click',()=>document.querySelector(btn.dataset.scroll)?.scrollIntoView({behavior:'smooth'})));
});

init();

// DinoLab v0.1 rune encyclopedia
(function initEncyclopedia(){
  const grid=document.getElementById('encyclopediaGrid');
  const filters=document.getElementById('runeFilters');
  if(!grid||!filters||typeof RUNE_DATA==='undefined') return;
  const grades=['전체','전설','유니크','에픽','레어','일반'];
  const iconMap={
    '메테오':'meteor.png','낙뢰':'lightning.png','흡혈':'lifesteal.png','강타':'smash.png','방어벽':'barrier.png','보스슬레이어':'boss_slayer.png','압축':'compression.png','타이탄가드':'titan_guard.png','매머드':'mammoth.png','공격력증가[3]':'attack_3.png','체력증가[3]':'health_3.png','단단한피부[2]':'tough_skin_2.png','피해저항[2]':'damage_resist_2.png','협동공격':'coop_attack.png','공격력증가[2]':'attack_2.png','체력증가[2]':'health_2.png','힐':'heal.png','희생':'sacrifice.png','단단한피부[1]':'tough_skin_1.png'
  };
  let active='전체';
  function maxLevel(data){return Math.max(...Object.keys(data.levels||{}).map(Number).filter(Number.isFinite),0)}
  function render(){
    grid.innerHTML='';
    Object.entries(RUNE_DATA).filter(([,d])=>active==='전체'||d.grade===active).forEach(([name,d])=>{
      const card=document.createElement('article');card.className='ency-card';
      const lvl=maxLevel(d);const sample=(d.levels&&d.levels[String(lvl)])||'';
      card.innerHTML=`<span class="ency-grade grade-${d.grade}">${d.grade}</span><img src="assets/rune_icons/${iconMap[name]||'meteor.png'}" alt="${name}"><h3>${name}</h3><p>최대 Lv.${lvl}<br>최대 레벨 값: ${sample||'정보 없음'}</p><button type="button">보유 룬에 입력하기</button>`;
      card.querySelector('button').addEventListener('click',()=>{document.querySelector('[data-scroll="#runeRows"]')?.click();setTimeout(()=>{const row=[...document.querySelectorAll('.rune-row')].find(x=>x.querySelector('.rune-name')?.textContent===name);row?.scrollIntoView({behavior:'smooth',block:'center'});row?.classList.add('equipped');setTimeout(()=>row?.classList.remove('equipped'),1200)},350)});
      grid.appendChild(card);
    });
  }
  grades.forEach(g=>{const b=document.createElement('button');b.textContent=g;b.className=g===active?'active':'';b.addEventListener('click',()=>{active=g;[...filters.children].forEach(x=>x.classList.toggle('active',x===b));render()});filters.appendChild(b)});
  render();
})();
