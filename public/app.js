'use strict';
/* ============ כלים ============ */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let toastT;function toast(m,ms=3400){const t=$('#toast');t.textContent=m;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,ms)}
function lsGet(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch{return d}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}
const dmy=s=>s?`${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}`:'';
function ilTime(iso){if(!iso)return '';const d=new Date(iso);return d.toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).replace(',','')}
function daysLeft(iso){if(!iso)return null;return Math.ceil((new Date(iso)-Date.now())/864e5)}
function dl(iso){
  if(!iso)return '<span class="dl muted">ללא מועד הגשה</span>';
  const d=daysLeft(iso);
  const cls=d<=3?'soon':d<=7?'week':'';
  const left=d<0?'נסגר':d===0?'היום':d===1?'מחר':`${d} ימים`;
  return `<span class="dl ${cls}">הגשה ${esc(ilTime(iso))} · ${left}</span>`;
}
const ENT={groshar:'גרושר',tzi:'צי',both:'גרושר + צי',none:''};
const MY={interesting:'מעניין',preparing:'בהכנה',submitted:'הוגש',won:'זכינו',lost:'לא זכינו',irrelevant:'לא רלוונטי'};
const REGIONS=['צפון','חיפה','מרכז','תל אביב','ירושלים','דרום','יהודה ושומרון'];

async function api(name,...args){
  let r;
  try{r=await fetch('/api/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,args}),credentials:'same-origin'})}
  catch(e){throw new Error('שגיאת תקשורת. בדוק חיבור לאינטרנט.')}
  let o;try{o=await r.json()}catch{throw new Error('תשובה לא תקינה מהשרת ('+r.status+')')}
  if(o.login){renderLogin();throw new Error('צריך להתחבר')}
  if(!o.ok)throw new Error(o.error||'שגיאה');
  return o.data;
}
async function busy(btn,fn){const t=btn?.innerHTML;if(btn){btn.disabled=true;btn.innerHTML='<span class="spin"></span>'}try{return await fn()}catch(e){toast(e.message,6000)}finally{if(btn){btn.disabled=false;btn.innerHTML=t}}}

function renderLogin(){
  $('#tabs').innerHTML='';$('#bnav').innerHTML='';$('#who').textContent='';
  const err=new URLSearchParams(location.search).get('e');
  $('#app').innerHTML=`<div class="card login stack"><img class="logo" src="/logo-mark.svg" alt=""><h2>איתור מכרזים</h2>
   <p class="muted">מכרזים ממנהל הרכש הממשלתי, מדורגים לגרושר ולצי הנדסה, עם התראות במייל ובוואטסאפ.</p>
   ${err?`<div class="banner bad">${esc(err)}</div>`:''}
   <div><a class="gbtn" href="/api/auth/login"><svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.2 44 33 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>כניסה עם Google</a></div>
   <p class="small muted">הכניסה פתוחה רק לחשבונות שבעל החשבון הוסיף.</p></div>`;
}

/* ============ מצב וניווט ============ */
const DEF_F={q:'',entity:'',min:40,kind:'',days:'',region:'',sort:'score',fresh:false,mine:''};
const S={boot:null,view:'list',f:{...DEF_F,...lsGet('tnd.f',{})},rows:[],total:0,limit:100,openF:false};
const ICON={
 list:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
 star:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
 lead:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 10h.01M15 10h.01"/></svg>',
 set:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>'
};
const VIEWS=[['list','מכרזים','list'],['tracked','במעקב','star'],['leads','לידים','lead'],['settings','הגדרות','set']];
function route(){
  const h=location.hash.slice(1)||'list';
  const m=h.match(/^t\/(\d+)/);
  if(m){openTender(+m[1]);if(!S.rendered)render();return}
  const wasOpen=!$('#modal').hidden;closeModal(true);
  const v=VIEWS.some(x=>x[0]===h)?h:'list';
  if(wasOpen&&S.rendered&&v===S.view)return;
  S.view=v;render();
}
window.addEventListener('hashchange',route);
function renderNav(){
  $('#tabs').innerHTML=VIEWS.map(([k,l])=>`<a href="#${k}" class="${S.view===k?'on':''}">${l}</a>`).join('');
  $('#bnav').innerHTML=VIEWS.map(([k,l,i])=>`<a href="#${k}" class="${S.view===k?'on':''}">${ICON[i]}<span>${l}</span></a>`).join('');
  const me=S.boot?.me;$('#who').innerHTML=me?`${esc(me.email)} · <a href="/api/auth/logout" style="color:inherit">יציאה</a>`:'';
}
async function render(){
  S.rendered=true;renderNav();
  try{
    if(S.view==='settings')return renderSettings();
    if(S.view==='leads')return renderLeads();
    return renderList();
  }catch(e){$('#app').innerHTML=`<div class="banner bad">${esc(e.message)}</div>`}
}

/* ============ רשימת מכרזים ============ */
function kpis(){
  const c=S.boot.counts||{};
  return `<div class="kpis k4">
   <div class="kpi" data-k="rel"><div class="v">${c.relevant??0}</div><div class="l">רלוונטיים פתוחים</div></div>
   <div class="kpi" data-k="today"><div class="v">${c.today??0}</div><div class="l">חדשים ב-24 שעות</div></div>
   <div class="kpi" data-k="tracked"><div class="v">${c.tracked??0}</div><div class="l">במעקב</div></div>
   <div class="kpi" data-k="all"><div class="v">${c.all??0}</div><div class="l">במאגר${c.pending?` · ${c.pending} ממתינים לדירוג`:''}</div></div></div>`;
}
function filterBar(tracked){
  const f=S.f,kinds=(S.boot.kinds||[]).map(k=>k.kind);
  const sel=(id,opts,v)=>`<select id="${id}">${opts.map(([val,l])=>`<option value="${esc(val)}" ${String(v)===String(val)?'selected':''}>${esc(l)}</option>`).join('')}</select>`;
  return `<div class="fbar ${S.openF?'open':''}">
   <input class="q" id="fq" type="search" placeholder="חיפוש: מילה, גוף מפרסם, מספר מכרז" value="${esc(f.q)}">
   ${sel('fent',[['','גרושר + צי'],['groshar','גרושר: ניהול ופיקוח'],['tzi','צי: ביצוע']],f.entity)}
   ${tracked?'':sel('fmin',[['70','התאמה גבוהה (70+)'],['40','רלוונטיים (40+)'],['20','כולל עקיפים (20+)'],['0','הכל']],f.min)}
   <span class="opt">${sel('fdays',[['','כל מועדי ההגשה'],['3','נסגר תוך 3 ימים'],['7','נסגר תוך שבוע'],['14','נסגר תוך שבועיים'],['30','נסגר תוך חודש']],f.days)}</span>
   <span class="opt">${sel('freg',[['','כל האזורים'],...REGIONS.map(r=>[r,r])],f.region)}</span>
   <span class="opt">${sel('fkind',[['','כל הסוגים'],...kinds.map(k=>[k,k])],f.kind)}</span>
   <span class="opt">${sel('fsort',[['score','מיון: התאמה'],['deadline','מיון: מועד הגשה'],['new','מיון: חדשים']],f.sort)}</span>
  </div>
  <div class="row" style="margin:-2px 0 10px">
   <button class="btn ghost fmore" id="fmore">${S.openF?'פחות סינון':'עוד סינון'}</button>
   ${tracked?'':`<label class="switch"><input type="checkbox" id="ffresh" ${f.fresh?'checked':''}> רק חדשים (3 ימים)</label>`}
   ${tracked?'':`<label class="switch"><input type="checkbox" id="fhid" ${f.mine==='hidden'?'checked':''}> הצג מוסתרים</label>`}
   <button class="btn ghost" id="freset">ניקוי</button>
  </div>`;
}
function card(t){
  const hot=(t.ai_score??0)>=(S.boot.settings.waMin||75);
  const tags=[...(t.ai_tags||[])].map(x=>`<span class="tag">${esc(x)}</span>`).join(' ');
  return `<div class="tc ${hot?'hot':''}" data-id="${t.id}">
   <div class="sc"><div class="v">${t.ai_score??'·'}</div><div class="e">${esc(ENT[t.ai_entity]||'')}</div></div>
   <div class="meta"><span>${esc(t.kind)}</span><span>${esc(t.publisher)}</span>${t.ai_region?`<span>${esc(t.ai_region)}</span>`:''}${t.my_status?`<span class="tag st">${esc(MY[t.my_status])}</span>`:''}</div>
   <div class="ttl">${esc(t.title)}</div>
   <div class="why">${esc(t.ai_reason||'')} ${tags}</div>
   <div class="meta">${dl(t.deadline)}${t.number?`<span>מס' ${esc(t.number)}</span>`:''}</div>
   <div class="acts">
    <button class="btn" data-st="interesting" title="סמן כמעניין">${t.my_status==='interesting'?'★ מעניין':'☆ מעניין'}</button>
    <button class="btn ghost" data-st="irrelevant">${t.my_status==='irrelevant'?'החזר':'לא רלוונטי'}</button>
    <a class="btn ghost" href="${esc(t.url)}" target="_blank" rel="noopener">לעמוד המכרז ↗</a>
   </div></div>`;
}
async function loadList(){
  const tracked=S.view==='tracked';
  const f={...S.f,limit:S.limit};
  if(tracked){f.mine='tracked';f.min=0;f.fresh=false;f.sort=S.f.sort==='score'?'deadline':S.f.sort}
  f.min=Number(f.min)||0;f.days=Number(f.days)||0;
  const r=await api('list',f);S.rows=r.rows;S.total=r.total;
}
async function renderList(){
  const tracked=S.view==='tracked';
  const b=S.boot;
  const warn=[];
  if(!b.ai)warn.push('חסר מפתח Gemini: הדירוג נעשה לפי מילות מפתח בלבד.');
  const errs=(b.sources||[]).filter(s=>s.enabled&&s.last_error);
  if(errs.length)warn.push('שגיאה באיסוף: '+errs.map(s=>`${s.name}: ${s.last_error}`).join(' · '));
  const back=(b.sources||[]).filter(s=>s.cursor?.backfill!==false);
  if(back.length&&b.counts.all)warn.push('המילוי הראשוני של המאגר עדיין רץ ברקע. עוד מכרזים ייכנסו בשעות הקרובות.');
  $('#app').innerHTML=`${warn.map(w=>`<div class="banner warn" style="margin-bottom:8px">${esc(w)}</div>`).join('')}
   ${tracked?'<h2>במעקב</h2><p class="muted small" style="margin-top:-6px">מכרזים שסימנת כמעניין, בהכנה או הוגש. תזכורת בוואטסאפ לפני מועד ההגשה.</p>':kpis()}
   ${filterBar(tracked)}<div id="lst"><div class="empty"><div class="spin"></div></div></div>`;
  bindFilters();
  await loadList();drawList();
}
function drawList(){
  const tracked=S.view==='tracked';
  const el=$('#lst');if(!el)return;
  if(!S.boot.counts.all){el.innerHTML=`<div class="card empty">המאגר עוד ריק. האיסוף הראשון רץ כל חצי שעה${S.boot.me.role==='owner'?', או מיד בלחיצה על "הרץ איסוף עכשיו" במסך ההגדרות':''}.</div>`;return}
  if(!S.rows.length){el.innerHTML=`<div class="card empty">${tracked?'עוד לא סימנת מכרזים. סמן ☆ מעניין ברשימת המכרזים.':'אין מכרזים שמתאימים לסינון.'}</div>`;return}
  el.innerHTML=`<div class="muted small" style="margin-bottom:6px">${S.total} מכרזים${S.total>S.rows.length?`, מוצגים ${S.rows.length}`:''}</div><div class="tl">${S.rows.map(card).join('')}</div>
   ${S.total>S.rows.length?'<div class="more-row"><button class="btn" id="more">הצג עוד</button></div>':''}`;
  el.querySelectorAll('.tc').forEach(c=>c.addEventListener('click',e=>{
    if(e.target.closest('a'))return;
    const st=e.target.closest('[data-st]');
    if(st){e.stopPropagation();quickStatus(+c.dataset.id,st.dataset.st,st);return}
    location.hash='t/'+c.dataset.id;
  }));
  $('#more')?.addEventListener('click',async e=>{S.limit+=100;await busy(e.target,loadList);drawList()});
}
async function quickStatus(id,st,btn){
  const t=S.rows.find(r=>r.id===id);const next=t?.my_status===st?'':st;
  await busy(btn,async()=>{const u=await api('setStatus',id,next);Object.assign(t,u);
    if(next==='irrelevant'&&S.f.mine!=='hidden'){S.rows=S.rows.filter(r=>r.id!==id);S.total--}
    toast(next?`סומן: ${MY[next]}`:'הסימון הוסר');});
  drawList();refreshCounts();
}
async function refreshCounts(){try{S.boot=await api('boot')}catch{}}
function bindFilters(){
  const save=()=>{lsSet('tnd.f',S.f);S.limit=100;loadList().then(drawList).catch(e=>toast(e.message))};
  $('#fq').addEventListener('input',e=>{clearTimeout(window.__qt);window.__qt=setTimeout(()=>{S.f.q=e.target.value;save()},350)});
  const on=(id,k,fn=v=>v)=>$(id)?.addEventListener('change',e=>{S.f[k]=fn(e.target.type==='checkbox'?e.target.checked:e.target.value);save()});
  on('#fent','entity');on('#fmin','min');on('#fdays','days');on('#freg','region');on('#fkind','kind');on('#fsort','sort');on('#ffresh','fresh');
  on('#fhid','mine',v=>v?'hidden':'');
  $('#freset').addEventListener('click',()=>{clearTimeout(window.__qt);S.f={...DEF_F};lsSet('tnd.f',S.f);render()});
  $('#fmore')?.addEventListener('click',()=>{S.openF=!S.openF;$('.fbar').classList.toggle('open',S.openF);$('#fmore').textContent=S.openF?'פחות סינון':'עוד סינון'});
  document.querySelectorAll('.kpi[data-k]').forEach(k=>k.addEventListener('click',()=>{
    const m=k.dataset.k;
    if(m==='tracked'){location.hash='tracked';return}
    S.f={...DEF_F,min:m==='all'?0:40,fresh:m==='today'};lsSet('tnd.f',S.f);render();
  }));
}

/* ============ פרטי מכרז ============ */
function closeModal(silent){$('#modal').hidden=true;document.body.style.overflow='';if(!silent&&/^#t\//.test(location.hash))history.back()}
$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#modal').hidden)closeModal()});
async function openTender(id){
  $('#sheet').innerHTML='<div class="empty"><div class="spin"></div></div>';$('#modal').hidden=false;document.body.style.overflow='hidden';
  try{drawTender(await api('get',id))}catch(e){$('#sheet').innerHTML=`<div class="bar"><h2>שגיאה</h2><button class="btn ghost" id="x">✕</button></div><div class="banner bad">${esc(e.message)}</div>`;$('#x').onclick=()=>closeModal()}
}
function verdict(v){const c=/^(עומד|מתאים)$/.test(v)?'v-ok':/^לא (עומד|מתאים)$/.test(v)?'v-no':'v-q';return `<span class="${c}">${esc(v||'לא ברור')}</span>`}
function eligHtml(t){
  const e=t.elig;if(!e)return '';
  return `<div class="elig stack" style="gap:8px">
   <div class="muted small">נבדק ${esc(ilTime(t.elig_at))} מתוך: ${esc((e.docs||[]).join(', '))}</div>
   <div class="row"><span>גרושר: ${verdict(e.overall?.groshar)}</span><span>צי: ${verdict(e.overall?.tzi)}</span></div>
   ${e.summary?`<p style="margin:0">${esc(e.summary)}</p>`:''}
   <dl class="kv">${e.scope?`<dt>היקף</dt><dd>${esc(e.scope)}</dd>`:''}${e.guarantee?`<dt>ערבות</dt><dd>${esc(e.guarantee)}</dd>`:''}${e.scoring?`<dt>שיטת בחירה</dt><dd>${esc(e.scoring)}</dd>`:''}
    ${(e.deadlines||[]).map(d=>`<dt>${esc(d.label)}</dt><dd>${esc(d.when)}</dd>`).join('')}</dl>
   ${(e.thresholds||[]).length?`<table><tr><th>תנאי סף</th><th>גרושר</th><th>צי</th></tr>${e.thresholds.map(x=>`<tr><td>${esc(x.text)}${x.why?`<div class="muted small">${esc(x.why)}</div>`:''}</td><td>${verdict(x.groshar)}</td><td>${verdict(x.tzi)}</td></tr>`).join('')}</table>`:''}
   ${(e.risks||[]).length?`<div><b>לתשומת לב</b><ul style="margin:4px 0">${e.risks.map(r=>`<li>${esc(r)}</li>`).join('')}</ul></div>`:''}
   ${(e.questions||[]).length?`<div><b>שאלות הבהרה מוצעות</b><ul style="margin:4px 0">${e.questions.map(r=>`<li>${esc(r)}</li>`).join('')}</ul></div>`:''}
   <div class="muted small">הבדיקה אוטומטית ומבוססת על הפרופיל במסך ההגדרות. התנאים המחייבים הם אלה שבמסמכי המכרז.</div></div>`;
}
function ics(t){
  const d=new Date(t.deadline);const f=x=>x.toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
  const start=new Date(d.getTime()-60*60e3);
  const body=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//groshar//tenders//HE','BEGIN:VEVENT',`UID:tender-${t.id}@groshar`,`DTSTAMP:${f(new Date())}`,`DTSTART:${f(start)}`,`DTEND:${f(d)}`,
    `SUMMARY:הגשת מכרז: ${t.title.replace(/[,;\\]/g,' ')}`,`DESCRIPTION:${(t.publisher+' · '+t.url).replace(/[,;\\]/g,' ')}`,'BEGIN:VALARM','TRIGGER:-P2D','ACTION:DISPLAY','DESCRIPTION:תזכורת הגשה','END:VALARM','END:VEVENT','END:VCALENDAR'].join('\r\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([body],{type:'text/calendar'}));a.download=`מכרז-${t.number||t.id}.ics`;a.click();
}
function drawTender(t){
  const docs=t.docs||[],c=t.contact||{};
  $('#sheet').innerHTML=`<div class="bar"><h2 style="font-size:18px">${esc(t.title)}</h2><button class="btn ghost" id="x" aria-label="סגירה">✕</button></div>
  <div class="det">
   <div class="row" style="margin-bottom:8px"><span class="tag ol">התאמה ${t.ai_score??'-'}${t.ai_entity&&t.ai_entity!=='none'?' · '+esc(ENT[t.ai_entity]):''}</span>${(t.ai_tags||[]).map(x=>`<span class="tag">${esc(x)}</span>`).join('')}${t.ai_region?`<span class="tag">${esc(t.ai_region)}</span>`:''}</div>
   ${t.ai_reason?`<p style="margin:0 0 8px">${esc(t.ai_reason)}</p>`:''}
   ${t.ai_error?`<div class="banner warn small">${esc(t.ai_error)}</div>`:''}
   <dl class="kv">
    <dt>סוג</dt><dd>${esc(t.kind)}</dd><dt>גוף מפרסם</dt><dd>${esc(t.publisher)}</dd>
    ${t.number?`<dt>מס' הליך</dt><dd>${esc(t.number)}</dd>`:''}<dt>סטטוס במקור</dt><dd>${esc(t.status)}</dd>
    <dt>מועד הגשה</dt><dd>${dl(t.deadline)}</dd>${t.submit_start?`<dt>תחילת הגשה</dt><dd>${esc(ilTime(t.submit_start))}</dd>`:''}
    <dt>פורסם</dt><dd>${esc(dmy(t.published_on))}${t.updated_on?` · עודכן ${esc(dmy(t.updated_on))}`:''}</dd>
    ${t.party?.supplier?`<dt>${/שכיר|דיור|נכס/.test(t.title)?'משכיר / ספק':'ספק'}</dt><dd><b>${esc(t.party.supplier)}</b>${t.party.supplierId?` · ח"פ ${esc(t.party.supplierId)}`:''}</dd>`:''}
    ${t.party?.amount?`<dt>היקף כספי</dt><dd>${money(t.party.amount)}${t.party.currency&&!/ש"?ח/.test(t.party.currency)?' '+esc(t.party.currency):''}</dd>`:''}
    ${t.party?.regulation?`<dt>בסיס הפטור</dt><dd>${esc(t.party.regulation)}</dd>`:''}
    ${t.winner?`<dt>זוכה</dt><dd><b>${esc(t.winner)}</b></dd>`:''}
    ${c.name||c.email?`<dt>איש קשר</dt><dd>${esc(c.name||'')} ${c.email?`<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`:''} ${c.phone?esc(c.phone):''}</dd>`:''}
    ${(t.topics||[]).length?`<dt>נושאים</dt><dd>${t.topics.map(x=>`<span class="tag">${esc(x)}</span>`).join(' ')}</dd>`:''}
   </dl>
   <div class="row" style="margin-top:10px"><a class="btn primary" href="${esc(t.url)}" target="_blank" rel="noopener">לעמוד המכרז במנהל הרכש ↗</a>${t.deadline?'<button class="btn" id="ics">הוסף ליומן</button>':''}<button class="btn ghost" id="share">שיתוף</button></div>
   <h3>המעקב שלי</h3>
   <div class="stbtns">${Object.entries(MY).map(([k,l])=>`<button class="btn ${t.my_status===k?'on':''}" data-st="${k}">${l}</button>`).join('')}</div>
   <label class="f" style="margin-top:8px">הערה<textarea id="note" rows="2" style="border:1px solid var(--line);padding:8px">${esc(t.my_note||'')}</textarea></label>
   <div class="row" style="margin-top:6px"><button class="btn" id="saveNote">שמור הערה</button>${t.my_at?`<span class="muted small">עודכן ${esc(ilTime(t.my_at))}${t.my_by?' · '+esc(t.my_by):''}</span>`:''}</div>
   <h3>בדיקת תנאי סף</h3>
   <div id="eligBox">${eligHtml(t)||'<p class="muted small" style="margin:0 0 6px">הכלי קורא את חוברת המכרז ומסכם תנאי סף, ערבויות, מועדים ושיטת בחירה, ומסמן מה מתאים לגרושר ולצי. לוקח כחצי דקה.</p>'}</div>
   <div class="row" style="margin-top:6px"><button class="btn ${t.elig?'':'primary'}" id="elig" ${docs.length?'':'disabled'}>${t.elig?'בדוק שוב':'בדוק תנאי סף'}</button>${docs.length?'':'<span class="muted small">אין מסמכים מצורפים</span>'}</div>
   ${docs.length?`<h3>מסמכים (${docs.length})</h3><div class="docs">${docs.map(d=>`<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.name)} <small>${esc(d.desc)} · ${esc(d.date)}</small></a>`).join('')}</div>`:''}
   <div class="row" style="margin-top:14px"><button class="btn ghost small" id="rescore">דרג מחדש</button>${t.wa_at?`<span class="muted small">נשלח בוואטסאפ ${esc(ilTime(t.wa_at))} (${esc(t.wa_reason)})</span>`:''}</div>
  </div>`;
  $('#x').onclick=()=>closeModal();
  $('#ics')?.addEventListener('click',()=>ics(t));
  $('#share').onclick=()=>{const txt=`${t.title}\n${t.publisher}\n${t.deadline?'הגשה עד '+ilTime(t.deadline)+'\n':''}${t.url}`;if(navigator.share)navigator.share({title:t.title,text:txt}).catch(()=>{});else navigator.clipboard.writeText(txt).then(()=>toast('הועתק'))};
  document.querySelectorAll('.stbtns [data-st]').forEach(b=>b.addEventListener('click',()=>busy(b,async()=>{
    const st=t.my_status===b.dataset.st?'':b.dataset.st;const u=await api('setStatus',t.id,st,$('#note').value);drawTender(u);syncRow(u);toast(st?`סומן: ${MY[st]}`:'הסימון הוסר');refreshCounts();
  })));
  $('#saveNote').onclick=e=>busy(e.target,async()=>{const u=await api('setStatus',t.id,t.my_status,$('#note').value);syncRow(u);toast('נשמר')});
  $('#elig').onclick=e=>busy(e.target,async()=>{$('#eligBox').innerHTML='<div class="muted small"><span class="spin"></span> קורא את מסמכי המכרז…</div>';try{const u=await api('eligibility',t.id);drawTender(u);syncRow(u)}catch(err){$('#eligBox').innerHTML=`<div class="banner bad">${esc(err.message)}</div>`}});
  $('#rescore').onclick=e=>busy(e.target,async()=>{const u=await api('rescore',t.id);drawTender(u);syncRow(u);toast('דורג מחדש')});
}
function syncRow(u){const i=S.rows.findIndex(r=>r.id===u.id);if(i>=0){Object.assign(S.rows[i],u);drawList()}}

/* ============ לידים מהשכרות ============ */
const money=n=>n?'₪'+Number(n).toLocaleString('he-IL'):'';
const gq=s=>'https://www.google.com/search?q='+encodeURIComponent(s);
function leadContact(c){c=c||{};return [c.name?esc(c.name):'',c.phone?`<a href="tel:${esc(c.phone.replace(/[^\d+]/g,''))}">${esc(c.phone)}</a>`:'',c.email?`<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`:''].filter(Boolean).join(' · ')}
function exemptCard(t){
  const p=t.party||{};
  return `<div class="tc lead" data-id="${t.id}">
   <div class="sc"><div class="v" style="font-size:20px">🏢</div><div class="e">פטור</div></div>
   <div class="meta"><span>${esc(t.publisher)}</span><span>פורסם ${esc(dmy(t.published_on))}</span>${t.my_status?`<span class="tag st">${esc(MY[t.my_status])}</span>`:''}</div>
   <div class="ttl">${esc(t.title)}</div>
   <div class="who">${p.supplier?`משכיר: <b>${esc(p.supplier)}</b>${p.supplierId?` · ח"פ ${esc(p.supplierId)}`:''}${p.amount?` · ${money(p.amount)}`:''}`:'<span class="muted">שם המשכיר עוד לא נקרא מהעמוד</span>'}</div>
   <div class="acts">
    ${p.supplier?`<a class="btn" href="${gq(p.supplier+(p.supplierId?' '+p.supplierId:''))}" target="_blank" rel="noopener">חפש את המשכיר ↗</a>`:''}
    <button class="btn ghost" data-st="interesting">${t.my_status==='interesting'?'★ מעניין':'☆ מעניין'}</button>
    <a class="btn ghost" href="${esc(t.url)}" target="_blank" rel="noopener">לעמוד הפטור ↗</a>
   </div></div>`;
}
function rentCard(t){
  const open=t.deadline&&daysLeft(t.deadline)>=0;
  return `<div class="tc lead" data-id="${t.id}">
   <div class="sc"><div class="v" style="font-size:20px">${t.winner?'✓':open?'⏳':'?'}</div><div class="e">${t.winner?'זוכה ידוע':open?'פתוח':'לברר'}</div></div>
   <div class="meta"><span>${esc(t.publisher)}</span>${t.number?`<span>מס' ${esc(t.number)}</span>`:''}${t.my_status?`<span class="tag st">${esc(MY[t.my_status])}</span>`:''}</div>
   <div class="ttl">${esc(t.title)}</div>
   <div class="meta">${dl(t.deadline)}</div>
   ${open?'':`<div class="who">${leadContact(t.contact)?`לברר מי זכה: ${leadContact(t.contact)}`:''}</div>
   <div class="win"><input type="text" placeholder="מי זכה? (שם המשכיר / החברה)" value="${esc(t.winner||'')}" data-win="${t.id}"><button class="btn" data-savewin="${t.id}">שמור</button>${t.winner_at?`<span class="muted small">${esc(t.winner_by||'')} · ${esc(ilTime(t.winner_at))}</span>`:''}</div>`}
   <div class="acts">
    ${t.winner?`<a class="btn" href="${gq(t.winner)}" target="_blank" rel="noopener">חפש את הזוכה ↗</a>`:''}
    <a class="btn ghost" href="${esc(t.url)}" target="_blank" rel="noopener">לעמוד המכרז ↗</a>
   </div></div>`;
}
async function renderLeads(){
  $('#app').innerHTML='<div class="empty"><div class="spin"></div></div>';
  const L=await api('leads');S.leads=L;
  const tab=S.leadTab||'exempt';
  const closed=L.tenders.filter(t=>!(t.deadline&&daysLeft(t.deadline)>=0));
  const toAsk=closed.filter(t=>!t.winner).length;
  $('#app').innerHTML=`<h2>לידים מהשכרות</h2>
   <p class="muted small" style="margin-top:-6px">משכירים שהממשלה שוכרת מהם נכס. בדרך כלל המשכיר מחויב לבצע התאמות לפי המפרט של מינהל הדיור הממשלתי, ואפשר להציע לו ניהול או ביצוע של העבודות.</p>
   <div class="seg" role="tablist">
    <button class="${tab==='exempt'?'on':''}" data-lt="exempt">השכרות בפטור (${L.exempt.length})</button>
    <button class="${tab==='tenders'?'on':''}" data-lt="tenders">מכרזי איתור דיור (${L.tenders.length}${toAsk?` · ${toAsk} לברר`:''})</button>
   </div>
   <p class="muted small">${tab==='exempt'?'בהודעת הפטור מופיע שם המשכיר, הח"פ וההיקף. הודעה חדשה מגיעה גם בוואטסאפ.':'במכרז רגיל הזוכה לא מתפרסם באתר. כשהמכרז נסגר תגיע הודעה בוואטסאפ עם איש הקשר, ואחרי שתברר מי זכה אפשר לרשום אותו כאן.'}</p>
   <div class="tl">${(tab==='exempt'?L.exempt.map(exemptCard):L.tenders.map(rentCard)).join('')||'<div class="card empty">אין עדיין רשומות. המילוי הראשוני של המאגר נמשך כמה שעות.</div>'}</div>`;
  document.querySelectorAll('[data-lt]').forEach(b=>b.onclick=()=>{S.leadTab=b.dataset.lt;renderLeads()});
  document.querySelectorAll('.tc.lead').forEach(el=>el.addEventListener('click',e=>{if(e.target.closest('a,button,input'))return;location.hash='t/'+el.dataset.id}));
  document.querySelectorAll('.tc.lead [data-st]').forEach(b=>b.addEventListener('click',()=>busy(b,async()=>{
    const id=+b.closest('.tc').dataset.id;const t=[...L.exempt,...L.tenders].find(x=>x.id===id);const st=t.my_status==='interesting'?'':'interesting';
    await api('setStatus',id,st);t.my_status=st;toast(st?'סומן: מעניין':'הסימון הוסר');renderLeads();
  })));
  document.querySelectorAll('[data-savewin]').forEach(b=>b.addEventListener('click',()=>busy(b,async()=>{
    const id=+b.dataset.savewin;const v=document.querySelector(`[data-win="${id}"]`).value;
    await api('setWinner',id,v);toast(v?'הזוכה נשמר':'נמחק');renderLeads();
  })));
}

/* ============ הגדרות ============ */
function renderSettings(){
  const b=S.boot,s=b.settings,own=b.me.role==='owner';
  const ro=own?'':'disabled';
  const kw=a=>esc((a||[]).join(', '));
  const prof=k=>`<div class="card stack"><h3>${esc(s.profiles[k].name)}</h3>
    <label class="f">שם<input id="p_${k}_name" value="${esc(s.profiles[k].name)}" ${ro}></label>
    <label class="f">תיאור החברה (משמש לדירוג ולבדיקת תנאי סף: ניסיון, סיווג, היקפים, לקוחות ציבוריים)<textarea class="kw" id="p_${k}_about" ${ro}>${esc(s.profiles[k].about)}</textarea></label>
    <label class="f">מילות מפתח (מופרדות בפסיק)<textarea class="kw" id="p_${k}_kw" ${ro}>${kw(s.profiles[k].keywords)}</textarea></label></div>`;
  const src=(b.sources||[]).map(x=>`<div class="src"><div><b>${esc(x.name)}</b><div class="muted">${x.cursor?.backfill!==false?`מילוי ראשוני: עמוד ${x.cursor?.page||0}`:'עדכונים שוטפים'} · ריצה אחרונה ${esc(ilTime(x.last_run_at))||'עוד לא'}${x.last_error?` · <span class="v-no">${esc(x.last_error)}</span>`:''}</div></div><div class="muted">${x.last_new} חדשים / ${x.last_updated} נבדקו</div></div>`).join('');
  const runs=(b.runs||[]).map(r=>`<div class="src"><div>${esc({collect:'איסוף',score:'דירוג',wa:'וואטסאפ',digest:'סיכום במייל'}[r.kind]||r.kind)} · ${esc(ilTime(r.started_at))}</div><div class="${r.ok===false?'v-no':'muted'}">${r.ok===false?esc(r.info?.error||'נכשל'):r.ok?'תקין':'רץ'}</div></div>`).join('');
  $('#app').innerHTML=`<div class="stack">
   ${own?'':'<div class="banner info">רק בעל החשבון יכול לשנות הגדרות.</div>'}
   <h2>התראות</h2>
   <div class="card stack">
    <h3>וואטסאפ (מה ששווה או דחוף)</h3>
    <div class="help">ההודעות נשלחות דרך השירות החינמי CallMeBot, למספר שלך בלבד. הפעלה חד-פעמית:
     <ol><li>פתח את <a href="https://www.callmebot.com/blog/free-api-whatsapp-messages/" target="_blank" rel="noopener">עמוד ההוראות של CallMeBot</a>, שמור את המספר שמופיע שם באנשי הקשר ושלח לו בוואטסאפ את ההודעה שמופיעה בעמוד.</li>
     <li>תקבל בחזרה הודעה עם apikey. הדבק אותו כאן יחד עם המספר שלך ולחץ "שמור" ואז "שלח בדיקה".</li></ol></div>
    <div class="form grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
     <label class="f">המספר שלך (972...)<input id="waPhone" inputmode="tel" value="${esc(s.waPhone)}" placeholder="9725XXXXXXXX" ${ro}></label>
     <label class="f">apikey ${s.waKeySet?'(שמור. השאר ריק כדי לא לשנות)':''}<input id="waKey" value="" placeholder="${s.waKeySet?'••••••':'apikey'}" ${ro}></label>
     <label class="f">"שווה": ציון מינימלי<input id="waMin" type="number" min="0" max="100" value="${s.waMin}" ${ro}></label>
     <label class="f">"דחוף": ציון מינימלי<input id="urgentMin" type="number" min="0" max="100" value="${s.urgentMin}" ${ro}></label>
     <label class="f">"דחוף": נסגר תוך (ימים)<input id="urgentDays" type="number" min="1" max="60" value="${s.urgentDays}" ${ro}></label>
     <label class="f">תזכורת למכרז במעקב (ימים לפני)<input id="remindDays" type="number" min="1" max="30" value="${s.remindDays}" ${ro}></label>
    </div>
    ${own?'<div class="row"><button class="btn" id="testWa">שלח בדיקה</button></div>':''}
   </div>
   <div class="card stack">
    <h3>סיכום יומי במייל</h3>
    <div class="form grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
     <label class="f">נמענים (מופרדים בפסיק)<input id="digestTo" value="${esc((s.digestTo||[]).join(', '))}" ${ro}></label>
     <label class="f">שעה<input id="digestTime" type="time" value="${esc(s.digestTime)}" ${ro}></label>
     <label class="f">ציון מינימלי לסיכום<input id="digestMin" type="number" min="0" max="100" value="${s.digestMin}" ${ro}></label>
    </div>
    <div class="row">${b.google?`<span class="small">נשלח מ: <b>${esc(b.google.email)}</b>${b.google.health!=='ok'?' <span class="v-no">(צריך לחבר מחדש)</span>':''}</span>`:'<span class="small v-q">עוד לא חובר חשבון לשליחת מיילים.</span>'}
     ${own?`<a class="btn" href="/api/google/connect">${b.google?'חבר חשבון אחר':'חבר Google לשליחה'}</a><button class="btn" id="testDigest">שלח סיכום עכשיו</button>`:''}</div>
   </div>
   ${own?'<div class="row"><button class="btn primary" id="saveAlerts">שמור הגדרות התראה</button></div>':''}
   <h2>פרופיל החברות והתאמה</h2>
   ${prof('groshar')}${prof('tzi')}
   <div class="card stack"><h3>תמיד לבדוק</h3>
    <label class="f">נושאים של מנהל הרכש (מופרדים בפסיק)<textarea class="kw" id="topics" ${ro}>${kw(s.topics)}</textarea></label>
    <label class="f">גופים מפרסמים (מופרדים בפסיק)<textarea class="kw" id="publishers" ${ro}>${kw(s.publishers)}</textarea></label>
    <label class="f">מילים שמוציאות מכרז מהבדיקה (מופרדות בפסיק)<textarea class="kw" id="negative" ${ro}>${kw(s.negative)}</textarea></label>
   </div>
   ${own?'<div class="row"><button class="btn primary" id="saveProf">שמור פרופיל</button><button class="btn" id="rescoreAll">דרג מחדש את כל הפתוחים</button></div>':''}
   <h2>מקורות</h2>
   <div class="card">${src}${own?'<div class="row" style="margin-top:10px"><button class="btn" id="runNow">הרץ איסוף עכשיו</button><span class="muted small">האיסוף רץ אוטומטית כל שעתיים.</span></div>':''}</div>
   <div class="card"><h3>ריצות אחרונות</h3>${runs||'<div class="muted small">עוד אין</div>'}</div>
   ${own?`<h2>מורשים</h2><div class="card stack">${(b.members||[]).map(m=>`<div class="src"><div>${esc(m.email)} ${m.role==='owner'?'<span class="tag">בעל החשבון</span>':''}</div><div>${m.role==='owner'?'':`<button class="btn ghost" data-rm="${esc(m.email)}">הסר</button>`}</div></div>`).join('')}
     <div class="row"><input id="newMember" type="email" placeholder="מייל של Google" style="flex:1;border:1px solid var(--line);padding:9px;min-height:42px"><button class="btn" id="addMember">הוסף</button></div></div>`:''}
  </div>`;
  if(!own)return;
  const v=id=>$('#'+id).value;
  const list=id=>v(id).split(/[,\n]+/).map(x=>x.trim()).filter(Boolean);
  $('#saveAlerts').onclick=e=>busy(e.target,async()=>{
    const p={waPhone:v('waPhone').replace(/[^\d]/g,''),waMin:+v('waMin'),urgentMin:+v('urgentMin'),urgentDays:+v('urgentDays'),remindDays:+v('remindDays'),digestTo:list('digestTo'),digestTime:v('digestTime'),digestMin:+v('digestMin')};
    if(v('waKey').trim())p.waKey=v('waKey').trim();
    S.boot.settings=await api('saveSettings',p);toast('נשמר');renderSettings();
  });
  $('#saveProf').onclick=e=>busy(e.target,async()=>{
    const profiles={};for(const k of ['groshar','tzi'])profiles[k]={name:v(`p_${k}_name`),about:v(`p_${k}_about`),keywords:list(`p_${k}_kw`)};
    S.boot.settings=await api('saveSettings',{profiles,topics:list('topics'),publishers:list('publishers'),negative:list('negative')});toast('נשמר. כדי להחיל על מכרזים קיימים: "דרג מחדש".');
  });
  $('#rescoreAll').onclick=e=>busy(e.target,async()=>{const r=await api('rescoreAll');toast(`דורגו ${r.scored}, ${r.skipped} בלי התאמה${r.failed?`, ${r.failed} נכשלו`:''}`,6000);S.boot=await api('boot')});
  $('#testWa').onclick=e=>busy(e.target,async()=>{await api('testWhatsApp');toast('נשלחה הודעת בדיקה לוואטסאפ')});
  $('#testDigest')&&($('#testDigest').onclick=e=>busy(e.target,async()=>{const r=await api('testDigest');toast(`נשלח: ${r.digest} חדשים, ${r.closing} נסגרים השבוע`)}));
  $('#runNow').onclick=e=>busy(e.target,async()=>{const r=await api('runNow');const c=r.collect?.feeds||[];toast(`איסוף: ${c.map(x=>x.error?'שגיאה':`${x.fresh} חדשים`).join(' · ')||'לא נדרש'} · דירוג: ${r.score?.scored??0}`,7000);S.boot=await api('boot');renderSettings()});
  $('#addMember').onclick=e=>busy(e.target,async()=>{S.boot.members=await api('members','add',v('newMember'));renderSettings()});
  document.querySelectorAll('[data-rm]').forEach(x=>x.onclick=()=>busy(x,async()=>{if(!confirm('להסיר את '+x.dataset.rm+'?'))return;S.boot.members=await api('members','remove',x.dataset.rm);renderSettings()}));
}

/* ============ התחלה ============ */
(async function(){
  const sp=new URLSearchParams(location.search);
  try{S.boot=await api('boot')}catch(e){if(!/להתחבר/.test(e.message))$('#app').innerHTML=`<div class="banner bad">${esc(e.message)}</div>`;return}
  if(sp.get('ok'))toast(sp.get('ok'),5000);
  if(sp.get('e'))toast(sp.get('e'),7000);
  if(sp.get('ok')||sp.get('e'))history.replaceState(null,'',location.pathname+location.hash);
  route();
})();
