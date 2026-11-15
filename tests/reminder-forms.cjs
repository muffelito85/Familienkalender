const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
for(const [i,m] of [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].entries())if(!m[1].includes('src='))new vm.Script(m[2],{filename:'inline-'+i});
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
for(const id of ['reminder','reminder2','taskReminder','taskReminder2']){
 const select=html.match(new RegExp('<select id="'+id+'">([\\s\\S]*?)</select>'))[1];
 assert.deepEqual([...select.matchAll(/value="([^"]*)"/g)].map(m=>m[1]),['','15','30','60','1440','10080']);assert(!select.includes(' selected'));
}
class Element{
 constructor(){this.value='';this.checked=false;this.hidden=false;this.children=[];this.style={};this.textContent='';this.dataset={};}
 appendChild(e){this.children.push(e);return e}replaceChildren(){this.children=[]}setAttribute(k,v){this[k]=v}addEventListener(){}scrollIntoView(){}focus(){}
 reset(){for(const id of ['taskTitle','taskDue','taskTime','taskAssignee','taskReminder','taskReminder2'])elements[id].value='';elements.taskVisibility.value='family';elements.taskLegacyDue.checked=false}
}
const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));let stored,notice='';
const context={$:id=>elements[id],document:{createElement:()=>new Element()},MEMBERS:[{id:'daniel'}],FAM:['daniel'],isFam:()=>false,familyId:'test-family',canDeleteEvent:()=>true,canEditEvent:()=>true,render:()=>{},window:{scrollTo(){}},sel:'2026-11-15',fm:{},familyData:{tasks:[]},taskScope:'all',familyNotice:m=>notice=m,store:{add:async p=>{stored=JSON.parse(JSON.stringify(p));return true},update:async(id,p)=>{stored=JSON.parse(JSON.stringify(p));return true}},familyMutate:async(table,action,p)=>{stored=JSON.parse(JSON.stringify(p));return true},today:new Date('2026-11-15T09:00Z'),iso:()=> '2026-11-15',Date,console};
vm.createContext(context);const run=s=>vm.runInContext(s,context),part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b));
run(part('function legacyReminderValue(', 'function occ('));
run(part('function openForm(', 'function plus1('));
run(part('function familyElement(', 'var anniversaryExpanded='));
run(part('function familyDraw(', 'async function familyLoad('));
run(part('var taskEditingId=null;', "$('shoppingForm').onsubmit="));
run(part("$('save').onclick=async function(){", "$('del').onclick=async function(){"));
run(html.match(/var fields=\[[^;]+;/)[0]);run(part('function record(', 'function msg('));
function taskEdit(row){context.familyData.tasks=[row];context.familyDraw('tasks');const edit=elements.taskList.children[0].children.find(e=>e['aria-label']==='Aufgabe bearbeiten');edit.onclick()}
const taskValues=()=>['taskTitle','taskAssignee','taskDue','taskTime','taskVisibility','taskReminder','taskReminder2'].map(id=>elements[id].value);
const submit=()=>elements.taskForm.onsubmit({preventDefault(){}});
(async()=>{
 context.openForm(null);assert.equal(elements.reminder.value,'');assert.equal(elements.reminder2.value,'');assert.equal(elements.eventLegacyDue.checked,false);
 const row={id:'e',title:'Event',start:'2026-11-15',end:'2026-11-15',allDay:false,st:'11:45',et:'',ms:['daniel'],rep:'weekly',note:'',visibility:'private',reminder_minutes:60,reminder2_minutes:15,legacy_due_notification:false};
 context.openForm(row);assert.equal(elements.reminder.value,'60');assert.equal(elements.reminder2.value,'15');await elements.save.onclick();
 assert.equal(stored.reminder_minutes,60);assert.equal(stored.reminder2_minutes,15);assert.equal(stored.legacy_due_notification,false);
 const persisted=context.record(stored);assert.equal(persisted.reminder2_minutes,15);context.openForm({...row,...JSON.parse(JSON.stringify(persisted))});assert.equal(elements.reminder2.value,'15');
 elements.reminder.value='';elements.reminder2.value='30';await elements.save.onclick();assert.equal(stored.reminder_minutes,null);assert.equal(stored.reminder2_minutes,30);
 const t={id:'t',title:'Task',assigned_to:'caro',due_date:'2026-11-15',due_time:'11:45:00',visibility:'private',reminder_minutes:60,reminder2_minutes:15,legacy_due_notification:false};
 taskEdit(t);assert.deepEqual(taskValues(),['Task','caro','2026-11-15','11:45','private','60','15']);await submit();assert.equal(stored.reminder_minutes,60);assert.equal(stored.reminder2_minutes,15);
 taskEdit({...t,...JSON.parse(JSON.stringify(stored))});assert.equal(elements.taskReminder2.value,'15');elements.taskReminder.value='';await submit();assert.equal(stored.reminder_minutes,null);assert.equal(stored.reminder2_minutes,15);
 taskEdit({...t,reminder_minutes:null,reminder2_minutes:null,legacy_due_notification:true});assert.equal(elements.taskLegacyReminder.hidden,false);await submit();assert.equal(stored.legacy_due_notification,true,'Title-only save loses legacy due reminder');
 taskEdit({...t,reminder_minutes:null,reminder2_minutes:null,legacy_due_notification:true});elements.taskLegacyDue.checked=false;await submit();assert.equal(stored.legacy_due_notification,false);
 context.taskResetForm();assert.equal(elements.taskReminder.value,'');assert.equal(elements.taskReminder2.value,'');assert.equal(elements.taskLegacyDue.checked,false);
 elements.taskTitle.value='No due date';elements.taskReminder.value='15';stored=undefined;await submit();assert.equal(stored,undefined);assert.match(notice,/Fälligkeitsdatum/);
 context.openForm({...row,allDay:true,reminder_minutes:null,reminder2_minutes:null,legacy_due_notification:true});await elements.save.onclick();assert.equal(stored.legacy_due_notification,true);
 elements.eventLegacyDue.checked=false;await elements.save.onclick();assert.equal(stored.legacy_due_notification,false);
 console.log('PASS: form defaults/options/unique IDs/syntax, both reminder fields saved/reloaded, only reminder 2, task fields and visibility retained, legacy due notification preserved or explicitly disabled, task reminder requires due date.');
})().catch(e=>{console.error(e);process.exitCode=1});
