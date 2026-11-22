/* Pure vacation arithmetic. Shared by the browser and Node tests. No network/storage. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.VacationCore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const STATES={BW:'Baden-Württemberg',BY:'Bayern',BE:'Berlin',BB:'Brandenburg',HB:'Bremen',HH:'Hamburg',HE:'Hessen',MV:'Mecklenburg-Vorpommern',NI:'Niedersachsen',NW:'Nordrhein-Westfalen',RP:'Rheinland-Pfalz',SL:'Saarland',SN:'Sachsen',ST:'Sachsen-Anhalt',SH:'Schleswig-Holstein',TH:'Thüringen'};
 function valid(day){return typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&!isNaN(Date.parse(day+'T12:00:00Z'))&&new Date(day+'T12:00:00Z').toISOString().slice(0,10)===day;}
 function shift(day,n){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
 function days(start,end){if(!valid(start)||!valid(end)||end<start)throw Error('Bitte einen gültigen Zeitraum wählen.');if((Date.parse(end)-Date.parse(start))/86400000>730)throw Error('Ein Urlaub darf höchstens 731 Kalendertage umfassen.');const out=[];for(let d=start;d<=end;d=shift(d,1))out.push(d);return out;}
 function easter(y){const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),n=h+l-7*m+114;return y+'-'+String(Math.floor(n/31)).padStart(2,'0')+'-'+String(n%31+1).padStart(2,'0');}
 function holidays(year,location){
  if(!location||!STATES[location.state])throw Error('Bitte den Arbeitsort im Urlaubskonto festlegen.');
  const s=location.state,map=new Map(),add=(md,name)=>map.set(year+'-'+md,name),relative=(n,name)=>map.set(shift(easter(year),n),name);
  [['01-01','Neujahr'],['05-01','Tag der Arbeit'],['10-03','Tag der Deutschen Einheit'],['12-25','1. Weihnachtstag'],['12-26','2. Weihnachtstag']].forEach(x=>add(...x));
  [[-2,'Karfreitag'],[1,'Ostermontag'],[39,'Christi Himmelfahrt'],[50,'Pfingstmontag']].forEach(x=>relative(...x));
  if(['BW','BY','ST'].includes(s))add('01-06','Heilige Drei Könige');
  if(s==='BE'||s==='MV'&&year>=2023)add('03-08','Internationaler Frauentag');
  if(['BW','BY','HE','NW','RP','SL'].includes(s)||['SN','TH'].includes(s)&&location.corpus_christi)relative(60,'Fronleichnam');
  if(s==='SL'||s==='BY'&&(location.assumption||location.augsburg))add('08-15','Mariä Himmelfahrt');
  if(s==='BY'&&location.augsburg)add('08-08','Augsburger Friedensfest');
  if(s==='TH')add('09-20','Weltkindertag');
  if(['BB','MV','SN','ST','TH','HB','HH','NI','SH'].includes(s))add('10-31','Reformationstag');
  if(['BW','BY','NW','RP','SL'].includes(s))add('11-01','Allerheiligen');
  if(s==='SN'){let d=year+'-11-22';while(new Date(d+'T12:00Z').getUTCDay()!==3)d=shift(d,-1);map.set(d,'Buß- und Bettag');}
  if(s==='BB'){relative(0,'Ostersonntag');relative(49,'Pfingstsonntag');}
  if(s==='BE'&&[2020,2025].includes(year))add('05-08','Tag der Befreiung');
  if(s==='BE'&&year===2028)add('06-17','Volksaufstand 1953');
  for(const d of location.additional_holidays||[]){if(valid(d)&&Number(d.slice(0,4))===year)map.set(d,'Zusätzlicher freier Tag am Arbeitsort');}
  return map;
 }
 function entryDays(entry,year,account){
  if(entry.status==='cancelled')return 0;
  if(!account)throw Error('Urlaubskonto für '+year+' fehlt.');
  const h=holidays(year,account.work_location),week=account.workweek||[],halves=entry.half_day_information||{};
  return days(entry.start_date,entry.end_date).filter(d=>Number(d.slice(0,4))===Number(year)).reduce((n,d)=>{const wd=new Date(d+'T12:00Z').getUTCDay()||7;return n+(!week.includes(wd)||h.has(d)?0:halves[d]===0.5?0.5:1);},0);
 }
 function totals(account,entries){
  if(!account)return null;
  let taken=0,planned=0;
  for(const e of entries){if(e.user_id!==account.user_id||e.end_date<account.year+'-01-01'||e.start_date>account.year+'-12-31')continue;const n=entryDays(e,account.year,account);if(e.status==='taken')taken+=n;else if(e.status==='planned')planned+=n;}
  const budget=Number(account.annual_entitlement)+Number(account.carryover_days);
  return {taken,planned,budget,available:budget-taken-planned,progress:budget?Math.min(100,(taken+planned)/budget*100):taken+planned?100:0};
 }
 function overlap(entry,entries){return entries.some(e=>e.id!==entry.id&&e.user_id===entry.user_id&&e.status!=='cancelled'&&entry.status!=='cancelled'&&e.start_date<=entry.end_date&&e.end_date>=entry.start_date);}
 return {STATES,valid,shift,days,holidays,entryDays,totals,overlap};
});
