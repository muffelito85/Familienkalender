/* Presentation helpers. No database, auth, subscription or notification writes. */
(function(){
 'use strict';
 var paths={
  calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h1m6 0h1m-8 3h1"/>',
  home:'<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>',
  tasks:'<rect x="3" y="3" width="18" height="18" rx="5"/><path d="m7 12 3 3 7-7"/>',
  shopping:'<path d="M3 3h2l3 13h10l3-10H6m4 14h.01M18 20h.01"/><circle cx="10" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
  settings:'<path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  edit:'<path d="m15 4 5 5M4 20l4-1L21 6a2.1 2.1 0 0 0-3-3L5 16z"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  left:'<path d="m14 6-6 6 6 6"/>',
  right:'<path d="m10 6 6 6-6 6"/>'
 };
 function icon(name){return '<svg class="uiIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+(paths[name]||paths.calendar)+'</svg>';}
 function put(selector,name){var el=document.querySelector(selector);if(el)el.innerHTML=icon(name);}
 function decorateRows(){
  document.querySelectorAll('.familyItem button').forEach(function(button){
   var label=button.getAttribute('aria-label')||'';
   if(label.indexOf('bearbeiten')!==-1)button.innerHTML=icon('edit');
   else if(label==='Eintrag löschen')button.innerHTML=icon('close');
  });
 }
 function syncNavigation(){
  document.querySelectorAll('#familyNav button').forEach(function(button){
   if(button.classList.contains('active'))button.setAttribute('aria-current','page');
   else button.removeAttribute('aria-current');
  });
 }
 function init(){
  var names={home:'home',calendar:'calendar',tasks:'tasks',shopping:'shopping',more:'more'};
  Object.keys(names).forEach(function(page){put('#familyNav [data-page="'+page+'"] .navIcon',names[page]);});
  put('.appMark','calendar');put('#modernSettings','settings');put('.authMark','calendar');
  put('#familyTasks .sectionHead>span','tasks');put('#familyShopping .sectionHead>span','shopping');put('#familyMore .sectionHead>span','settings');
  put('.homeTile[data-go="tasks"] .tileIcon','tasks');put('.homeTile[data-go="shopping"] .tileIcon','shopping');put('.homeTile[data-go="calendar"] .tileIcon','calendar');put('.homeTile[data-go="more"] .tileIcon','settings');
  put('#calendarQuickAdd','plus');put('#prev','left');put('#next','right');put('#formBack','close');put('.emptySymbol','calendar');
  document.getElementById('modernSettings').onclick=function(){familySwitch('more');window.scrollTo({top:0,behavior:'smooth'});};
  document.getElementById('homeNewEvent').onclick=function(){familySwitch('calendar');sel=iso(new Date());openForm();};
  document.getElementById('homeNewTask').onclick=function(){familySwitch('tasks');document.getElementById('taskComposer').open=true;document.getElementById('taskForm').scrollIntoView({behavior:'smooth',block:'center'});document.getElementById('taskTitle').focus();};
  put('#homeNewEvent .actionIcon','plus');put('#homeNewTask .actionIcon','plus');
  var originalSwitch=familySwitch;
  familySwitch=function(page){originalSwitch(page);syncNavigation();window.scrollTo({top:0,behavior:'instant'});};
  // familyLoad redraws list buttons after each Realtime update.
  var originalDraw=familyDraw;
  familyDraw=function(table){originalDraw(table);decorateRows();};
  document.querySelectorAll('.visibilityFilters button').forEach(function(button){button.setAttribute('aria-pressed',String(button.classList.contains('selected')));});
  syncNavigation();decorateRows();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

