/* Vacation extension: separate data source, no writes to events/tasks/push/auth. */
(function(){
 'use strict';
 const C=window.VacationCore,$=id=>document.getElementById(id),root=$('familyVacation');
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=n=>Number(n).toLocaleString('de-DE',{maximumFractionDigits:1});
 const date=d=>d.split('-').reverse().join('.');
 const labels={planned:'Geplant',taken:'Genommen',cancelled:'Storniert'};
 let people=[],accounts=[],entries=[],active=null,activeRole=null,request=0,channel=null,loading=false,reloadQueued=false,ready=false,edit=null,accountEdit=null,saving=false;
 let year=Number(new Intl.DateTimeFormat('en',{timeZone:'Europe/Berlin',year:'numeric'}).format(new Date()));
 const uid=()=>window.sessionUser?.id||null,adult=()=>['admin','adult'].includes(window.userRole);
 const person=id=>people.find(p=>p.user_id===id),name=id=>person(id)?.display_name||'Familienmitglied';
 const color=id=>person(id)?.role==='admin'?'#3b82f6':'#22a06b';
 const account=(id,y)=>accounts.find(a=>a.user_id===id&&Number(a.year)===Number(y));
 function message(s){$('vacationMessage').textContent=s||'';}
 function error(e){if(e.code==='23P01')return 'Dieser Zeitraum überschneidet sich mit einem bestehenden Urlaub. Bitte den vorhandenen Eintrag bearbeiten.';if(e.code==='23505')return 'Für dieses Jahr existiert bereits ein Konto. Bitte neu laden.';return e.message||String(e);}
 root.innerHTML=`<div class="sectionHead"><span aria-hidden="true">🌴</span><div><p class="sectionEyebrow">ZEIT FÜR EINE PAUSE</p><h2>Urlaub</h2></div></div>
 <div class="vacationToolbar"><label>Kalenderjahr <select id="vacationYear"></select></label><button id="vacationReload" class="btn sec" type="button">Aktualisieren</button></div>
 <p id="vacationMessage" role="status" aria-live="polite"></p><div id="vacationAccounts" class="vacationAccounts"></div>
 <details id="vacationAccountEditor" class="vacationEditor"><summary>Mein Urlaubskonto einstellen</summary>
 <form id="vacationAccountForm" class="vacationForm"><p id="vacationAccountHeading"></p><div class="vacationColumns">
 <label>Jahresanspruch (Tage)<input id="vacationEntitlement" type="number" min="0" max="366" step="0.5" required></label>
 <label>Übertrag aus dem Vorjahr<input id="vacationCarryover" type="number" min="0" max="366" step="0.5" required></label></div>
 <fieldset><legend>Regelmäßige Arbeitstage</legend><div id="vacationWorkweek" class="vacationWeek"></div></fieldset>
 <label>Bundesland am Arbeitsort<select id="vacationState" required><option value="">Bitte auswählen</option></select></label>
 <label class="chk" id="vacationAssumptionRow"><input id="vacationAssumption" type="checkbox">Mariä Himmelfahrt ist am Arbeitsort gesetzlicher Feiertag</label>
 <label class="chk" id="vacationAugsburgRow"><input id="vacationAugsburg" type="checkbox">Arbeitsort liegt in der Stadt Augsburg</label>
 <label class="chk" id="vacationCorpusRow"><input id="vacationCorpus" type="checkbox">Fronleichnam gilt in meiner Gemeinde (Sachsen/Thüringen)</label>
 <label>Zusätzliche freie Tage im Kontojahr (optional)<textarea id="vacationExtraHolidays" rows="2" placeholder="JJJJ-MM-TT, ein Datum pro Zeile"></textarea></label>
 <p class="empty">Arbeitsort statt Wohnort auswählen. Regionale Feiertage bitte prüfen. Heiligabend und Silvester sind ohne zusätzliche Vereinbarung normale Arbeitstage. Ein Übertrag wird bewusst eingetragen, nicht automatisch fortgeschrieben.</p>
 <div class="vacationButtons"><button class="btn" type="submit">Konto speichern</button><button class="btn sec" id="vacationAccountCancel" type="button">Schließen</button></div></form></details>
 <details id="vacationEntryEditor" class="vacationEditor"><summary>Urlaub eintragen</summary><form id="vacationEntryForm" class="vacationForm">
 <label>Person<select id="vacationPerson" required></select></label><p class="empty">Du kannst deinen eigenen Urlaub verwalten. Der Urlaub der anderen Person ist für die Familie sichtbar.</p>
 <div class="vacationColumns"><label>Startdatum<input id="vacationStart" type="date" min="2025-01-01" max="2100-12-31" required></label><label>Enddatum<input id="vacationEnd" type="date" min="2025-01-01" max="2100-12-31" required></label></div>
 <label>Status<select id="vacationStatus"><option value="planned">Geplant</option><option value="taken">Genommen</option><option value="cancelled">Storniert</option></select></label>
 <label>Halbe Urlaubstage (optional)<textarea id="vacationHalves" rows="2" placeholder="JJJJ-MM-TT, ein Datum pro Zeile"></textarea></label>
 <p class="empty">Jedes angegebene Datum zählt als ½ Tag, sofern es ein Arbeitstag und kein Feiertag ist. Ein einzelner halber Tag: Start- und Enddatum gleich setzen.</p>
 <label>Titel (optional)<input id="vacationTitle" maxlength="120" placeholder="Zum Beispiel: Sommerurlaub"></label><label>Notiz (optional, für die Familie sichtbar)<textarea id="vacationNote" maxlength="2000" rows="3"></textarea></label>
 <p id="vacationPreview" class="vacationPreview" aria-live="polite"></p><div class="vacationButtons"><button class="btn" id="vacationSave" type="submit">Urlaub speichern</button><button class="btn sec" id="vacationEntryCancel" type="button">Abbrechen</button></div>
 </form></details><div class="vacationListHeader"><h3>Urlaubsliste</h3><label><input id="vacationShowCancelled" type="checkbox"> Stornierte zeigen</label></div><div id="vacationList"></div>`;
 for(let y=Math.max(2025,year-2);y<=Math.min(2100,year+10);y++)$('vacationYear').add(new Option(String(y),String(y)));
 $('vacationYear').value=String(year);
 Object.entries(C.STATES).forEach(([v,n])=>$('vacationState').add(new Option(n,v)));
 ['Mo','Di','Mi','Do','Fr','Sa','So'].forEach((n,i)=>{const label=document.createElement('label');label.innerHTML=`<input type="checkbox" value="${i+1}"><span>${n}</span>`;$('vacationWorkweek').append(label);});
 function dates(value){const ds=value.trim()?value.trim().split(/[\s,;]+/):[];if(ds.some(d=>!C.valid(d)))throw Error('Bitte Datumsangaben als JJJJ-MM-TT eintragen.');return [...new Set(ds)];}
 function locationFields(){const s=$('vacationState').value;$('vacationAssumptionRow').hidden=s!=='BY';$('vacationAugsburgRow').hidden=s!=='BY';$('vacationCorpusRow').hidden=!['SN','TH'].includes(s);}
 $('vacationState').onchange=locationFields;locationFields();
 function populateAccount(){
  const a=account(uid(),year);accountEdit=a||null;
  $('vacationAccountHeading').textContent=name(uid())+' · '+year+' · '+(a?'Konto bearbeiten':'Konto anlegen');
  $('vacationEntitlement').value=a?.annual_entitlement??'';$('vacationCarryover').value=a?.carryover_days??'0';
  $('vacationWorkweek').querySelectorAll('input').forEach(e=>e.checked=(a?.workweek||[1,2,3,4,5]).includes(Number(e.value)));
  const l=a?.work_location||{};$('vacationState').value=l.state||'';
  $('vacationAssumption').checked=!!l.assumption;$('vacationAugsburg').checked=!!l.augsburg;$('vacationCorpus').checked=!!l.corpus_christi;
  $('vacationExtraHolidays').value=(l.additional_holidays||[]).join('\n');locationFields();
 }
 function resetEntry(){edit=null;$('vacationEntryForm').reset();$('vacationPerson').value=uid()||'';$('vacationSave').textContent='Urlaub speichern';preview();}
 function payload(){
  const start=$('vacationStart').value,end=$('vacationEnd').value||start;C.days(start,end);
  const halves=dates($('vacationHalves').value);if(halves.some(d=>d<start||d>end))throw Error('Halbe Tage müssen im Urlaubszeitraum liegen.');
  return {family_id:window.familyId,user_id:$('vacationPerson').value,start_date:start,end_date:end,status:$('vacationStatus').value,title:$('vacationTitle').value.trim(),note:$('vacationNote').value.trim(),half_day_information:Object.fromEntries(halves.map(d=>[d,0.5]))};
 }
 function preview(){
  try{const e=payload(),years=[...new Set(C.days(e.start_date,e.end_date).map(d=>Number(d.slice(0,4))))];
   $('vacationPreview').textContent=e.status==='cancelled'?'Storniert · keine Abbuchung':years.map(y=>y+': '+fmt(C.entryDays(e,y,account(e.user_id,y)))+' Urlaubstage').join(' · ');
  }catch(e){$('vacationPreview').textContent=$('vacationStart').value?error(e):'Zeitraum auswählen, um die Urlaubstage zu berechnen.';}
 }
 $('vacationEntryForm').addEventListener('input',preview);
 function draw(){
  $('vacationAccountEditor').hidden=!adult()||!ready;$('vacationEntryEditor').hidden=!adult()||!ready;
  const container=$('vacationAccounts');container.replaceChildren();
  if(adult())for(const p of people){
   const a=account(p.user_id,year),t=a?C.totals(a,entries):null,card=document.createElement('article');card.className='vacationAccount';card.style.setProperty('--vacation-person',color(p.user_id));
   card.innerHTML=`<div class="vacationPerson"><span>${esc(p.display_name.slice(0,1))}</span><h3>${esc(p.display_name)}</h3><small>${year}</small></div>`;
   if(t){card.innerHTML+=`<p class="vacationBalance"><strong>${fmt(t.available)}</strong> Tage verfügbar</p><dl><div><dt>Jahresanspruch</dt><dd>${fmt(a.annual_entitlement)}</dd></div><div><dt>Übertrag</dt><dd>${fmt(a.carryover_days)}</dd></div><div><dt>Genommen</dt><dd>${fmt(t.taken)}</dd></div><div><dt>Geplant</dt><dd>${fmt(t.planned)}</dd></div></dl><progress value="${t.progress}" max="100" aria-label="${esc(p.display_name)}: ${fmt(t.taken+t.planned)} von ${fmt(t.budget)} Tagen verplant"></progress><p class="empty">${fmt(t.taken+t.planned)} von ${fmt(t.budget)} Tagen genutzt oder geplant${t.available<0?' · Anspruch überschritten':''}</p>`;}
   else {const p=document.createElement('p');p.className='empty';p.textContent='Für dieses Jahr ist noch kein Urlaubskonto eingerichtet.';card.append(p);}
   if(p.user_id===uid()){const b=document.createElement('button');b.className='btn sec';b.type='button';b.textContent=a?'Konto bearbeiten':'Mein Konto einrichten';b.onclick=()=>{populateAccount();$('vacationAccountEditor').open=true;$('vacationAccountEditor').scrollIntoView({behavior:'smooth',block:'start'});};card.append(b);}
   container.append(card);
  }
  const list=$('vacationList');list.replaceChildren();
  const visible=entries.filter(e=>e.start_date<=year+'-12-31'&&e.end_date>=year+'-01-01'&&(e.status!=='cancelled'||$('vacationShowCancelled').checked));
  for(const e of visible.sort((a,b)=>a.start_date.localeCompare(b.start_date)||a.user_id.localeCompare(b.user_id))){
   const row=document.createElement('article');row.className='vacationListItem';row.style.setProperty('--vacation-person',color(e.user_id));
   row.innerHTML=`<div><strong>${esc(name(e.user_id))} · ${esc(e.title||'Urlaub')}</strong><p>${date(e.start_date)} – ${date(e.end_date)} <span class="vacationStatus">${labels[e.status]}</span></p></div>`;
   if(adult()){const text=document.createElement('p');text.className='empty';const a=account(e.user_id,year);text.textContent=e.status==='cancelled'?'Keine Abbuchung':a?fmt(C.entryDays(e,year,a))+' Tage in '+year:'Tageszahl offen · Konto '+year+' fehlt';row.append(text);}
   if(e.note){const note=document.createElement('p');note.className='vacationNote';note.textContent=e.note;row.append(note);}
   if(e.user_id===uid()&&adult()){const b=document.createElement('button');b.className='btn sec';b.type='button';b.textContent='Bearbeiten';b.onclick=()=>openEntry(e);row.append(b);}
   list.append(row);
  }
  if(!visible.length){const p=document.createElement('p');p.className='empty';p.textContent='Noch keine Urlaubszeiträume in '+year+'.';list.append(p);}
  preview();
 }
 function openEntry(e){edit=e;$('vacationEntryEditor').open=true;$('vacationPerson').value=e.user_id;$('vacationStart').value=e.start_date;$('vacationEnd').value=e.end_date;$('vacationStatus').value=e.status;$('vacationTitle').value=e.title||'';$('vacationNote').value=e.note||'';$('vacationHalves').value=Object.keys(e.half_day_information||{}).join('\n');$('vacationSave').textContent='Änderungen speichern';preview();$('vacationEntryEditor').scrollIntoView({behavior:'smooth',block:'start'});}
 async function read(table){const all=[];for(let from=0;from<10000;from+=1000){const r=await window.sb.from(table).select('*').eq('family_id',window.familyId).order('id').range(from,from+999);if(r.error)throw r.error;all.push(...r.data);if(r.data.length<1000)return all;}throw Error('Zu viele Urlaubsdaten. Bitte Support kontaktieren.');}
 async function load(){
  if(!active)return;if(loading){reloadQueued=true;return;}loading=true;const token=++request,who=active;
  try{
   const r=await window.sb.rpc('vacation_family_people',{p_family_id:window.familyId});if(r.error)throw r.error;
   const [a,e]=await Promise.all([adult()?read('vacation_accounts'):[],read('vacation_entries')]);
   if(token!==request||active!==who||uid()!==who)return;
   people=r.data||[];accounts=a;entries=e;ready=true;
   const select=$('vacationPerson'),selected=select.value;select.replaceChildren();for(const p of people){const o=new Option(p.display_name,p.user_id);o.disabled=p.user_id!==uid();select.add(o);}select.value=selected&&people.some(p=>p.user_id===selected)?selected:uid();
   draw();window.render();if(window.familyPage==='home')window.homeRender();message('');
  }catch(e){if(token===request){ready=false;message('Urlaubsplaner noch nicht verfügbar: '+error(e));draw();}}
  finally{loading=false;if(reloadQueued){reloadQueued=false;load();}}
 }
 async function write(table,data,previous){
  let q=previous?window.sb.from(table).update(data).eq('id',previous.id).eq('updated_at',previous.updated_at):window.sb.from(table).insert(data);
  const r=await q.select('id');if(r.error)throw r.error;if(!r.data?.length)throw Error('Der Eintrag wurde inzwischen geändert oder du hast keine Berechtigung. Bitte aktualisieren und erneut öffnen.');
 }
 function busy(value){saving=value;root.querySelectorAll('button').forEach(b=>b.disabled=value);$('vacationYear').disabled=value;}
 $('vacationEntryForm').onsubmit=async event=>{
  event.preventDefault();if(saving||!ready)return;const who=uid();
  try{
   const data=payload();if(data.user_id!==who||!adult())throw Error('Du kannst nur deinen eigenen Urlaub bearbeiten.');
   if(C.overlap({...data,id:edit?.id},entries))throw Error('Der Zeitraum überschneidet sich mit deinem bestehenden Urlaub. Bitte diesen bearbeiten.');
   if(data.status!=='cancelled')for(const y of new Set(C.days(data.start_date,data.end_date).map(d=>Number(d.slice(0,4)))))C.entryDays(data,y,account(who,y));
   busy(true);await write('vacation_entries',data,edit);if(uid()!==who)return;resetEntry();$('vacationEntryEditor').open=false;await load();message('Urlaub gespeichert.');
  }catch(e){message('Speichern fehlgeschlagen: '+error(e));}finally{busy(false);}
 };
 $('vacationAccountForm').onsubmit=async event=>{
  event.preventDefault();if(saving||!ready)return;const who=uid();
  try{
   if(!adult())throw Error('Keine Berechtigung.');
   const workweek=[...$('vacationWorkweek').querySelectorAll('input:checked')].map(e=>Number(e.value));if(!workweek.length)throw Error('Bitte mindestens einen Arbeitstag wählen.');
   const s=$('vacationState').value;if(!C.STATES[s])throw Error('Bitte ein Bundesland wählen.');
   const extra=dates($('vacationExtraHolidays').value);if(extra.some(d=>Number(d.slice(0,4))!==year))throw Error('Zusätzliche freie Tage müssen im ausgewählten Jahr liegen.');
   const data={family_id:window.familyId,user_id:who,year,annual_entitlement:Number($('vacationEntitlement').value),carryover_days:Number($('vacationCarryover').value),workweek,work_location:{state:s,assumption:s==='BY'&&$('vacationAssumption').checked,augsburg:s==='BY'&&$('vacationAugsburg').checked,corpus_christi:['SN','TH'].includes(s)&&$('vacationCorpus').checked,additional_holidays:extra}};
   busy(true);await write('vacation_accounts',data,accountEdit);if(uid()!==who)return;$('vacationAccountEditor').open=false;await load();message('Urlaubskonto gespeichert. Alle Tageszahlen wurden neu berechnet.');
  }catch(e){message('Speichern fehlgeschlagen: '+error(e));}finally{busy(false);}
 };
 $('vacationAccountEditor').addEventListener('toggle',()=>{if($('vacationAccountEditor').open&&!saving)populateAccount();});
 $('vacationAccountCancel').onclick=()=>$('vacationAccountEditor').open=false;
 $('vacationEntryCancel').onclick=()=>{resetEntry();$('vacationEntryEditor').open=false;};
 $('vacationYear').onchange=()=>{year=Number($('vacationYear').value);$('vacationAccountEditor').open=false;accountEdit=null;draw();};
 $('vacationShowCancelled').onchange=draw;$('vacationReload').onclick=load;
 const originalSwitch=window.familySwitch;
 window.familySwitch=function(page){originalSwitch(page);root.classList.toggle('active',page==='vacation');if(page==='vacation')load();};
 const originalEvents=window.evs;
 window.evs=function(day){
  const result=originalEvents(day);if(!active)return result;
  return result.concat(entries.filter(e=>e.status!=='cancelled'&&e.start_date<=day&&e.end_date>=day&&window.eventScope!=='private'&&window.filter[person(e.user_id)?.role==='admin'?'daniel':'caro']!==false).map(e=>({id:'vacation-'+e.id,title:'🌴 '+name(e.user_id)+' · '+(e.title||'Urlaub'),start:e.start_date,end:e.end_date,allDay:true,st:'',et:'',ms:[person(e.user_id)?.role==='admin'?'daniel':'caro'],rep:'none',note:e.note||'',calendarReadOnly:true,vacationSource:e.id,vacationUser:e.user_id})));
 };
 const originalRow=window.evRow;
 window.evRow=function(e){const row=originalRow(e);if(e.vacationSource){const bar=row.querySelector('.bar2');if(bar)bar.style.background=color(e.vacationUser);row.classList.add('vacationCalendarRow');row.onclick=()=>{window.familySwitch('vacation');const current=entries.find(x=>x.id===e.vacationSource);if(current?.user_id===uid()&&adult())openEntry(current);};row.setAttribute('aria-label',e.title+' · '+date(e.start)+' bis '+date(e.end));}return row;};
 function checkSession(){
  const next=window.store&&uid()?uid():null;if(next===active&&window.userRole===activeRole)return;
  request++;loading=false;ready=false;active=next;activeRole=window.userRole;people=[];accounts=[];entries=[];edit=null;accountEdit=null;
  if(channel){window.sb.removeChannel(channel);channel=null;}
  $('vacationAccountEditor').open=false;$('vacationEntryEditor').open=false;resetEntry();draw();window.render();
  if(next){channel=window.sb.channel('vacation-'+window.familyId+'-'+next).on('postgres_changes',{event:'*',schema:'public',table:'vacation_entries',filter:'family_id=eq.'+window.familyId},load);if(adult())channel=channel.on('postgres_changes',{event:'*',schema:'public',table:'vacation_accounts',filter:'family_id=eq.'+window.familyId},load);channel=channel.subscribe();load();}
 }
 setInterval(checkSession,2000);setInterval(()=>{if(!document.hidden)load();},30000);
 window.addEventListener('family-session-changed',checkSession);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){checkSession();load();}});window.addEventListener('online',load);
 checkSession();draw();
})();
