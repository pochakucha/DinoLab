const EXCLUSIVE = [["압축","매머드"]];
const DURATION = 3000;
const FIELD_DEFS = [
 ["nickname","닉네임","text",""],
 ["levelCap","레벨캡","number",1400],
 ["baseHp","기본체력","number",""],
 ["baseAtk","기본공격력","number",""],
 ["moveSpeed","기본이동속도","number",""],
 ["constHp","별자리체력","number",""],
 ["constAtk","별자리공격력","number",""],
 ["constMove","별자리이동속도","number",""],
 ["titanBonus","타이탄피해증가(고정)","number",""],
 ["titanReduction","타이탄피해감소(고정)","number",""],
 ["extraAtk","공격력증가%","number",""],
 ["extraHp","체력증가%","number",""],
 ["extraBoth","공체증가%","number",""],
 ["titanLevel","타이탄레벨","number",""],
 ["simulations","기본 시뮬횟수","number",3000],
 ["target","목표생존률%","number",90]
];
const $=s=>document.querySelector(s);
let worker=null;
let autoSaveTimer=null;
let lastRenderedResult=null;
let deferredInstallPrompt=null;
let runStartedAt=0;
let statusTimer=null;
let qrCameraStream=null;
let qrScanLoop=0;

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
   <label class="rune-level"><span>Lv.</span><input class="level" type="number" min="1" max="${availableMaxLevel(d)}" value="" placeholder="레벨" inputmode="numeric"></label>`;
   const owned=row.querySelector(".owned"), level=row.querySelector(".level");
   level.addEventListener("focus",()=>{if(level.value==="0")level.value=""});
   level.addEventListener("input",()=>{owned.checked=Number(level.value)>0;refreshManualCombo()});
   owned.addEventListener("change",()=>{if(owned.checked&&Number(level.value)<=0)level.value=availableMaxLevel(d);if(!owned.checked)level.value="";refreshManualCombo()});
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
 document.querySelectorAll("[data-scroll]").forEach(btn=>{
   btn.addEventListener("click",event=>{
     event.preventDefault();
     scrollToCalculatorTarget(btn.dataset.scroll,btn.id==="heroStart");
   });
 });
 const heroStart=$("#heroStart");
 if(heroStart){
   heroStart.addEventListener("click",()=>{
     const panel=document.querySelector("#calculator .panel");
     panel?.classList.remove("attention-flash");
     void panel?.offsetWidth;
     panel?.classList.add("attention-flash");
     showPwaToast("아래에서 스펙과 보유 룬을 입력한 뒤 계산 버튼을 눌러주세요.");
     setTimeout(()=>document.querySelector("#nickname")?.focus({preventScroll:true}),120);
   });
 }
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
 $("#makeQr").onclick=()=>openQrModal("create");
 $("#scanQr").onclick=()=>openQrModal("scan");
 $("#closeQr").onclick=closeQrModal;
 document.querySelectorAll("[data-close-qr]").forEach(x=>x.onclick=closeQrModal);
 $("#downloadQr").onclick=downloadProfileQr;
 $("#copyQrCode").onclick=copyProfileQrCode;
 $("#startQrCamera").onclick=startQrCamera;
 $("#stopQrCamera").onclick=stopQrCamera;
 $("#qrImageInput").onchange=scanQrImageFile;
 $("#importQrText").onclick=()=>importProfileCode($("#qrImportText").value);
 $("#copyResult").onclick=()=>navigator.clipboard.writeText($("#result").innerText).then(()=>alert("결과를 복사했습니다."));
 $("#saveResultImage").onclick=saveResultImage;
 $("#shareResult").onclick=shareResult;
 $("#resetForm").onclick=()=>{if(confirm("입력값과 룬 선택을 초기화할까요?")){localStorage.removeItem("titanWeb:last");location.reload();}};
 const installBtn=$("#installApp");if(installBtn)installBtn.onclick=installPwa;
}

function scrollToCalculatorTarget(selector,focusFirst=false){
 const target=document.querySelector(selector||"#calculator");
 if(!target)return;
 const top=target.getBoundingClientRect().top+window.scrollY-72;
 window.scrollTo({top:Math.max(0,top),behavior:focusFirst?"auto":"smooth"});
 if(focusFirst)setTimeout(()=>document.querySelector("#nickname")?.focus({preventScroll:true}),120);
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
   row.querySelector(".owned").checked=!!x?.owned;lv.value=x?.level||"";
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
  appVersion:"0.15",
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
 ["calcSelected","optimize","maxLevel"].forEach(id=>$("#"+id).disabled=on);const verifyBtn=$("#verifyResult");if(verifyBtn)verifyBtn.disabled=on;$("#stopBtn").disabled=!on;
 if(on){runStartedAt=performance.now();clearInterval(statusTimer);statusTimer=setInterval(updateStatusMeta,500)}
 else{clearInterval(statusTimer);statusTimer=null;updateStatusMeta(true)}
}
function stopWorker(){if(worker){worker.terminate();worker=null}setBusy(false);setStatus("계산을 중지했습니다.",0)}
function updateStatusMeta(done=false){
 const meta=$("#statusMeta");if(!meta)return;const elapsed=Math.max(0,(performance.now()-runStartedAt)/1000);
 const pct=Number($("#progressBar")?.dataset.pct||0);let text=`경과 ${elapsed.toFixed(1)}초`;
 if(!done&&pct>2&&pct<100){const remain=elapsed*(100-pct)/pct;if(Number.isFinite(remain))text+=` · 예상 ${Math.max(1,Math.round(remain))}초 남음`}
 if(done&&pct>=100)text+=` · 완료`;meta.textContent=text;
}
function setStatus(text,pct){
 const value=Math.max(0,Math.min(100,Number(pct)||0));$("#statusText").textContent=text;$("#progressBar").style.width=value+"%";$("#progressBar").dataset.pct=value;const p=$("#statusPct");if(p)p.textContent=Math.round(value)+"%";updateStatusMeta(value>=100)
}
function run(mode, overrideSelected=null){
 try{
   const s=stats(), owned=runes(), selected=Array.isArray(overrideSelected)?overrideSelected:selectedRunes();
   const missing=owned.filter(x=>!x.validData);
   if(missing.length)throw Error("효과 데이터가 없는 룬 레벨입니다: "+missing.map(x=>x.name+" Lv."+x.level).join(", "));
   if(mode==="selected"||mode==="maxLevel"||mode==="verify"){if(selected.length!==5)throw Error("장착 룬을 정확히 5개 선택하세요.")}
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
function currentResultRunes(){
 if(!lastRenderedResult)return null;
 const {payload:p,mode}=lastRenderedResult;
 if(mode==="optimize")return p.recommended?.runes||null;
 return p.runes||null;
}
function verifyCurrentResult(){
 const combo=currentResultRunes();
 if(!combo||combo.length!==5){alert("검증할 룬 조합 정보가 없습니다.");return}
 run("verify",combo);
}
function resultSummaryText(){
 if(!lastRenderedResult)return "";
 const {payload:p,mode,stats:s}=lastRenderedResult;
 let combo="",r=null,title="DinoLab 결과";
 if(mode==="optimize"){title="DinoLab 추천 조합";combo=p.recommended.combo;r=p.recommended.result}
 else if(mode==="maxLevel"){title=`DinoLab 최대 말뚝 Lv.${p.level}`;combo=p.combo;r=p.result}
 else{title=mode==="verify"?"DinoLab 30,000회 검증":"DinoLab 선택 조합";combo=p.combo;r=p.result}
 return `${title}\n${s.nickname||"프로필"} · 타이탄 Lv.${s.titanLevel}\n${combo}\n생존률 ${pct(r.survival)} · 95% 신뢰구간 ${pct(r.ciLow)} ~ ${pct(r.ciHigh)}\n50분 총딜 ${num(r.damage)}\nhttps://pochakucha.github.io/DinoLab/`;
}
async function shareResult(){
 const text=resultSummaryText();if(!text){alert("먼저 계산을 실행하세요.");return}
 try{if(navigator.share)await navigator.share({title:"DinoLab 타이탄 계산 결과",text});else{await navigator.clipboard.writeText(text);alert("공유용 결과를 복사했습니다.")}}catch(err){if(err?.name!=="AbortError")alert("공유하지 못했습니다: "+err.message)}
}
function interpretation(r,target){
 const goal=target/100;
 if(r.ciLow>=goal&&r.survival>=.98)return "생존 여유가 큰 안정형 조합입니다. 더 높은 타이탄이나 공격형 룬 교체를 시험해볼 수 있습니다.";
 if(r.ciLow>=goal)return "목표 생존률의 95% 신뢰구간 하한까지 통과한 안정권 조합입니다.";
 if(r.ciHigh>=goal)return "목표선 부근의 경계 조합입니다. 30,000회 재검증 후 사용하는 편이 안전합니다.";
 return "현재 목표 생존률에 미달합니다. 방어 룬 강화 또는 타이탄 레벨 하향이 필요합니다.";
}
function render(p,mode,target){
 setStatus("계산 완료",100);
 lastRenderedResult={payload:p,mode,target,stats:stats()};
 if(mode==="selected"||mode==="verify"){
   const r=p.result, cls=r.wilson*100>=target?"goodtxt":"warntxt";
   const verified=mode==="verify";
   $("#result").innerHTML=`<div class="hero"><h2>${verified?"30,000회 재검증 결과":"선택한 5룬 정밀 결과"}</h2><div id="primaryRuneStrip" class="result-runes"></div><h3>${p.combo}</h3>
   <div class="cards"><div class="card"><span>생존률</span><b class="${cls}">${pct(r.survival)}</b></div><div class="card"><span>95% 신뢰구간</span><b class="${cls}">${pct(r.ciLow)} ~ ${pct(r.ciHigh)}</b></div><div class="card"><span>50분 총딜</span><b>${num(r.damage)}</b></div></div>
   <p>시뮬레이션 ${num(r.sims)}회 · 평균 생존시간 ${(r.time/60).toFixed(1)}분 · 최종체력 ${num(r.hp)} · 일반공격 ${num(r.atk)} · 보스공격 ${num(r.bossAtk)}</p><div class="analysis-note"><b>결과 해석</b><span>${interpretation(r,target)}</span></div><div class="result-actions"><button class="btn good" id="verifyResult">30,000회 재검증</button></div></div>`;
 }else if(mode==="maxLevel"){
   $("#result").innerHTML=`<div class="hero"><h2>현재 5룬 최대 말뚝 레벨</h2><div id="primaryRuneStrip" class="result-runes"></div><h3>${p.combo}</h3>
   <div class="cards"><div class="card"><span>추천 최대</span><b class="goodtxt">${p.level}레벨</b></div><div class="card"><span>생존률</span><b>${pct(p.result.survival)}</b></div><div class="card"><span>95% 신뢰구간</span><b>${pct(p.result.ciLow)} ~ ${pct(p.result.ciHigh)}</b></div></div><p>${(p.checks||[]).map(x=>x.level+"레벨 "+pct(x.result.survival)+" (하한 "+pct(x.result.ciLow)+")").join(" · ")}</p><div class="analysis-note"><b>결과 해석</b><span>${interpretation(p.result,target)}</span></div><div class="result-actions"><button class="btn good" id="verifyResult">현재 레벨 30,000회 재검증</button></div></div>`;
 }else{
   const r=p.recommended.result,b=p.barrier?.result;
   let html=`<div class="hero"><h2>최종 추천 룬 조합</h2><div id="primaryRuneStrip" class="result-runes"></div><h3>${p.recommended.combo}</h3>
   <div class="cards"><div class="card"><span>생존률</span><b class="goodtxt">${pct(r.survival)}</b></div><div class="card"><span>95% 신뢰구간</span><b class="goodtxt">${pct(r.ciLow)} ~ ${pct(r.ciHigh)}</b></div><div class="card"><span>50분 총딜</span><b>${num(r.damage)}</b></div></div><p>최종 검증 ${num(r.sims)}회</p>
   <div class="analysis-note"><b>결과 해석</b><span>${interpretation(r,target)}</span></div><div class="result-actions"><button class="btn warn" id="useRecommendedMax">이 룬 조합으로 최대 말뚝레벨 구하기</button><button class="btn good" id="verifyResult">추천 조합 30,000회 재검증</button></div>`;
   if(p.barrier)html+=`<h2>방어벽 포함 최고 조합</h2><h3>${p.barrier.combo}</h3><p>생존 ${pct(b.survival)} · 하한 ${pct(b.ciLow)} · 총딜 ${num(b.damage)} · 추천 대비 ${num(b.damage-r.damage)}</p>`;
   html+=`<h2>상위 조합 비교</h2><div class="ranking-wrap"><table class="ranking-table"><thead><tr><th>순위</th><th>판정</th><th>생존률</th><th>95% 하한</th><th>총딜</th><th>조합</th><th></th></tr></thead><tbody>${p.ranking.slice(0,10).map((x,i)=>`<tr><td>${i+1}</td><td>${x.result.wilson*100>=target?'<span class="stable-pill">안정권</span>':'<span class="fail-pill">미달</span>'}</td><td>${pct(x.result.survival)}</td><td>${pct(x.result.ciLow)}</td><td>${num(x.result.damage)}</td><td class="combo-cell">${x.combo}</td><td><button class="btn mini apply-ranked" data-combo="${encodeURIComponent(x.combo)}">적용</button></td></tr>`).join("")}</tbody></table></div>`;
   html+=`</div>`;
   $("#result").innerHTML=html;
 }
 const comboForStrip=mode==="optimize"?p.recommended.combo:p.combo;
 renderRuneIconStrip(comboForStrip,"primaryRuneStrip");
 const verifyButton=document.getElementById("verifyResult");if(verifyButton)verifyButton.onclick=verifyCurrentResult;
 if(mode==="optimize"){
  const b=document.getElementById("useRecommendedMax");if(b)b.onclick=()=>applyRecommendedAndRun(p.recommended.runes);
  document.querySelectorAll(".apply-ranked").forEach(btn=>btn.onclick=()=>{const text=decodeURIComponent(btn.dataset.combo||"");applyComboText(text);});
 }
 if(window.matchMedia("(max-width:760px)").matches){setTimeout(()=>$(".result-panel").scrollIntoView({behavior:"smooth",block:"start"}),80)}
}

function applyComboText(text){
 const parts=String(text).split(" / ").map(x=>x.trim()).filter(Boolean);if(parts.length!==5){alert("조합 정보를 읽지 못했습니다.");return}
 const selects=[...document.querySelectorAll(".manual-rune")];
 parts.forEach((part,i)=>{const m=part.match(/^(.*?)(\d+)$/);if(selects[i]&&m)selects[i].value=m[1]});
 localStorage.setItem("titanWeb:last",JSON.stringify(profile()));setStatus("상위 조합을 직접 조합에 적용했습니다.",100);
 document.querySelector("#manualCombo")?.scrollIntoView({behavior:"smooth",block:"center"});
}

function applyRecommendedAndRun(combo){
 if(!Array.isArray(combo)||combo.length!==5){alert("추천 조합 정보를 불러오지 못했습니다.");return}
 const selects=[...document.querySelectorAll(".manual-rune")];
 combo.forEach((r,i)=>{if(selects[i])selects[i].value=r.name});
 localStorage.setItem("titanWeb:last",JSON.stringify(profile()));
 setStatus("추천 조합을 직접 조합에 적용했습니다. 최대 말뚝 레벨을 계산합니다.",1);
 setTimeout(()=>run("maxLevel"),50);
}

function saveResultImage(){
 if(!lastRenderedResult){alert("먼저 계산을 실행하세요.");return}
 const {payload:p,mode,stats:s}=lastRenderedResult;
 let title="DinoLab 타이탄 계산 결과",combo="",lines=[];
 if(mode==="optimize"){const r=p.recommended.result;title="DinoLab 최적 룬 조합";combo=p.recommended.combo;lines=[`타이탄 Lv.${s.titanLevel}`,`생존률 ${pct(r.survival)}`,`95% 신뢰구간 ${pct(r.ciLow)} ~ ${pct(r.ciHigh)}`,`50분 총딜 ${num(r.damage)}`]}
 else if(mode==="maxLevel"){title="DinoLab 최대 말뚝 레벨";combo=p.combo;lines=[`최대 안정 타이탄 Lv.${p.level}`,`생존률 ${pct(p.result.survival)}`,`95% 신뢰구간 ${pct(p.result.ciLow)} ~ ${pct(p.result.ciHigh)}`]}
 else{const r=p.result;title="DinoLab 선택 조합 결과";combo=p.combo;lines=[`타이탄 Lv.${s.titanLevel}`,`생존률 ${pct(r.survival)}`,`95% 신뢰구간 ${pct(r.ciLow)} ~ ${pct(r.ciHigh)}`,`50분 총딜 ${num(r.damage)}`]}
 const canvas=document.createElement("canvas");canvas.width=1080;canvas.height=1080;const c=canvas.getContext("2d");
 c.fillStyle="#07101e";c.fillRect(0,0,1080,1080);c.fillStyle="#15c8a4";c.fillRect(0,0,1080,18);
 c.fillStyle="#ffffff";c.font="700 56px sans-serif";c.fillText(title,70,110);c.font="400 30px sans-serif";c.fillStyle="#a9b6c9";c.fillText(s.nickname||"프로필",70,160);
 c.fillStyle="#101b2d";c.fillRect(60,210,960,620);c.fillStyle="#ffffff";c.font="700 38px sans-serif";wrapCanvasText(c,combo,90,285,900,52);
 c.font="700 46px sans-serif";let y=470;for(const line of lines){c.fillText(line,90,y);y+=92}
 c.font="400 25px sans-serif";c.fillStyle="#a9b6c9";c.fillText("pochakucha.github.io/DinoLab",70,1000);
 const a=document.createElement("a");a.download=`DinoLab_${s.nickname||"result"}.png`;a.href=canvas.toDataURL("image/png");a.click();
}
function wrapCanvasText(ctx,text,x,y,maxWidth,lineHeight){
 const parts=String(text).split(" / ");let line="";for(const part of parts){const test=line?line+" / "+part:part;if(ctx.measureText(test).width>maxWidth&&line){ctx.fillText(line,x,y);line=part;y+=lineHeight}else line=test}if(line)ctx.fillText(line,x,y)
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
  if(mode==="verify"){
   const total=30000,chunk=5000,parts=[];
   for(let done=0;done<total;done+=chunk){parts.push(simulateBatch(s,data,selected,Math.min(chunk,total-done)));post("고정 30,000회 재검증 · "+Math.min(total,done+chunk).toLocaleString()+"회",8+88*Math.min(total,done+chunk)/total)}
   const r=mergeResults(parts);self.postMessage({type:"done",payload:{combo:comboText(selected),runes:selected,result:r}});return;
  }
  if(mode==="selected"){
   post("1초 단위 이벤트 시뮬레이션",12);const r=adaptiveSimulate(s,data,selected,Math.max(500,Math.floor(s.simulations)),"선택 조합");self.postMessage({type:"done",payload:{combo:comboText(selected),runes:selected,result:r}});return;
  }
  if(mode==="maxLevel"){
   let lo=1,hi=201;while(lo+1<hi){const mid=Math.floor((lo+hi)/2);s.titanLevel=mid;post("최대 말뚝 탐색: "+mid+"레벨",10+35*(1-Math.log2(hi-lo)/8));const r=simulateBatch(s,data,selected,Math.max(800,Math.min(2500,Math.floor(s.simulations))));if(r.ciLow>=s.target/100)lo=mid;else hi=mid}
   const checks=[];for(const level of [Math.max(1,lo-1),lo,lo+1]){s.titanLevel=level;checks.push({level,result:adaptiveSimulate(s,data,selected,Math.max(1000,Math.floor(s.simulations)),level+"레벨 재검증")})}
   const stable=checks.filter(x=>x.result.ciLow>=s.target/100),best=stable[stable.length-1]||checks[0];self.postMessage({type:"done",payload:{combo:comboText(selected),runes:selected,level:best.level,result:best.result,checks}});return;
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
  self.postMessage({type:"done",payload:{recommended:{combo:comboText(recommended.combo),runes:recommended.combo,result:recommended.result},barrier:barrier?{combo:comboText(barrier.combo),runes:barrier.combo,result:barrier.result}:null,ranking:precise.slice(0,30).map(x=>({combo:comboText(x.combo),result:x.result})),total:all.length}});
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

const QR_PREFIX="DINOLAB1:";
function compactProfileDocument(){
 const p=profile();
 const statKeys=FIELD_DEFS.map(x=>x[0]);
 return {v:1,n:String(p.stats.nickname||"프로필").trim(),s:statKeys.map(k=>p.stats[k]),r:p.runes.map(x=>[x.name,x.level])};
}
function encodeUtf8Base64(text){
 const bytes=new TextEncoder().encode(text);let bin="";for(const b of bytes)bin+=String.fromCharCode(b);return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function decodeUtf8Base64(text){
 let b64=text.replace(/-/g,"+").replace(/_/g,"/");while(b64.length%4)b64+="=";const bin=atob(b64),bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));return new TextDecoder().decode(bytes);
}
function makeProfileCode(){return QR_PREFIX+encodeUtf8Base64(JSON.stringify(compactProfileDocument()))}
function parseProfileCode(raw){
 const text=String(raw||"").trim();if(!text.startsWith(QR_PREFIX))throw Error("DinoLab 프로필 코드가 아닙니다.");
 const doc=JSON.parse(decodeUtf8Base64(text.slice(QR_PREFIX.length)));if(doc.v!==1||!Array.isArray(doc.s)||!Array.isArray(doc.r))throw Error("지원하지 않는 프로필 코드입니다.");
 const statKeys=FIELD_DEFS.map(x=>x[0]),stats={};statKeys.forEach((k,i)=>stats[k]=doc.s[i]);if(doc.n)stats.nickname=doc.n;
 return {stats,runes:doc.r.map(x=>({name:String(x[0]),level:Number(x[1]||0),owned:Number(x[1]||0)>0}))};
}
function openQrModal(mode){
 try{
  const modal=$("#qrModal"),create=$("#qrCreatePane"),scan=$("#qrScanPane");modal.hidden=false;modal.setAttribute("aria-hidden","false");
  create.hidden=mode!=="create";scan.hidden=mode!=="scan";$("#qrTitle").textContent=mode==="create"?"프로필 QR 공유":"프로필 QR 가져오기";
  if(mode==="create")renderProfileQr();else{$("#qrStatus").textContent="대기 중";$("#qrImportText").value=""}
 }catch(err){alert("QR 준비 실패: "+err.message)}
}
function closeQrModal(){stopQrCamera();const modal=$("#qrModal");modal.hidden=true;modal.setAttribute("aria-hidden","true")}
function renderProfileQr(){
 const code=makeProfileCode(),box=$("#qrCanvas");box.innerHTML="";$("#qrCodeText").value=code;
 if(typeof QRCode==="undefined")throw Error("QR 생성 라이브러리를 불러오지 못했습니다.");
 new QRCode(box,{text:code,width:256,height:256,colorDark:"#000000",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.L});
}
function qrImageElement(){const box=$("#qrCanvas");return box.querySelector("canvas")||box.querySelector("img")}
function downloadProfileQr(){
 const el=qrImageElement();if(!el){alert("먼저 QR을 생성해주세요.");return}
 let url;if(el.tagName==="CANVAS")url=el.toDataURL("image/png");else url=el.src;
 const a=document.createElement("a");a.href=url;a.download=((stats().nickname||"DinoLab_프로필")+"_QR.png").replace(/[\\/:*?\"<>|]/g,"_");a.click();
}
async function copyProfileQrCode(){try{await navigator.clipboard.writeText(makeProfileCode());setProfileHint("프로필 코드 복사 완료");alert("프로필 코드를 복사했습니다.")}catch(e){$("#qrCodeText").focus();$("#qrCodeText").select();alert("자동 복사가 안 되어 코드를 선택했습니다.")}}
function importProfileCode(raw){
 try{const p=parseProfileCode(raw);applyProfile(p);localStorage.setItem("titanWeb:last",JSON.stringify(p));const name=(p.stats.nickname||"받은 프로필").trim();localStorage.setItem("titanWeb:profile:"+name,JSON.stringify(p));refreshProfiles(name);setProfileHint(name+" QR 프로필 불러오기 완료");stopQrCamera();closeQrModal();alert(name+" 프로필을 불러왔습니다.")}catch(err){$("#qrStatus").textContent="실패: "+err.message;alert("QR 불러오기 실패: "+err.message)}
}
async function startQrCamera(){
 const status=$("#qrStatus");if(!window.BarcodeDetector){status.textContent="이 브라우저는 카메라 QR 판독을 지원하지 않습니다. QR 이미지 선택 또는 코드 붙여넣기를 이용하세요.";return}
 try{
  stopQrCamera();const supported=await BarcodeDetector.getSupportedFormats();if(!supported.includes("qr_code"))throw Error("QR 형식을 지원하지 않는 브라우저입니다.");
  qrCameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});const video=$("#qrVideo");video.srcObject=qrCameraStream;await video.play();status.textContent="카메라에서 QR을 찾는 중…";
  const detector=new BarcodeDetector({formats:["qr_code"]});const token=++qrScanLoop;
  const loop=async()=>{if(token!==qrScanLoop||!qrCameraStream)return;try{const codes=await detector.detect(video);if(codes[0]?.rawValue){importProfileCode(codes[0].rawValue);return}}catch(e){}requestAnimationFrame(loop)};loop();
 }catch(err){status.textContent="카메라 시작 실패: "+err.message}
}
function stopQrCamera(){qrScanLoop++;if(qrCameraStream){qrCameraStream.getTracks().forEach(t=>t.stop());qrCameraStream=null}const video=$("#qrVideo");if(video)video.srcObject=null}
async function scanQrImageFile(e){
 const file=e.target.files?.[0];if(!file)return;const status=$("#qrStatus");
 status.textContent="선택한 QR 이미지를 읽는 중…";
 try{if(!window.BarcodeDetector)throw Error("이 브라우저는 이미지 QR 판독을 지원하지 않습니다. 프로필 코드를 직접 붙여넣어 주세요.");const bitmap=await createImageBitmap(file);const detector=new BarcodeDetector({formats:["qr_code"]});const codes=await detector.detect(bitmap);bitmap.close?.();if(!codes.length)throw Error("이미지에서 QR을 찾지 못했습니다.");importProfileCode(codes[0].rawValue)}catch(err){status.textContent="이미지 판독 실패: "+err.message;alert(status.textContent)}finally{e.target.value=""}
}
window.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("#qrModal")?.hidden)closeQrModal()});

window.addEventListener("hashchange",()=>{if(location.hash==="#calculator")scrollToCalculatorTarget("#calculator",false)});
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

function showPwaToast(message, actionText="확인", action=()=>hidePwaToast()){
 const toast=$("#pwaToast"),text=$("#pwaToastText"),btn=$("#pwaToastAction");if(!toast||!text||!btn)return;
 text.textContent=message;btn.textContent=actionText;btn.onclick=action;toast.hidden=false;
}
function hidePwaToast(){const toast=$("#pwaToast");if(toast)toast.hidden=true;}
async function installPwa(){
 if(!deferredInstallPrompt){showPwaToast("브라우저 메뉴에서 ‘홈 화면에 추가’를 선택해주세요.");return;}
 deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;
 const btn=$("#installApp");if(btn)btn.hidden=true;
}
window.addEventListener("beforeinstallprompt",event=>{
 event.preventDefault();deferredInstallPrompt=event;
 const btn=$("#installApp");if(btn)btn.hidden=false;
 showPwaToast("DinoLab을 홈 화면에 설치하면 앱처럼 빠르게 실행할 수 있어요.","설치",installPwa);
});
window.addEventListener("appinstalled",()=>{deferredInstallPrompt=null;const btn=$("#installApp");if(btn)btn.hidden=true;showPwaToast("DinoLab 설치가 완료되었습니다.");});
if("serviceWorker" in navigator){
 window.addEventListener("load",async()=>{
  try{
   const reg=await navigator.serviceWorker.register("sw.js");
   if(reg.waiting)showPwaToast("새 버전이 준비되었습니다.","업데이트",()=>{reg.waiting.postMessage("SKIP_WAITING");location.reload();});
   reg.addEventListener("updatefound",()=>{
    const installing=reg.installing;if(!installing)return;
    installing.addEventListener("statechange",()=>{
     if(installing.state==="installed"&&navigator.serviceWorker.controller){showPwaToast("DinoLab 새 버전이 준비되었습니다.","업데이트",()=>{installing.postMessage("SKIP_WAITING");});}
    });
   });
   navigator.serviceWorker.addEventListener("controllerchange",()=>location.reload());
  }catch(e){console.warn("서비스 워커 등록 실패",e)}
 });
}
