const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const scope={module:{exports:{}}};vm.runInNewContext(fs.readFileSync(__dirname+'/../vacation-core.js','utf8'),scope);const C=scope.module.exports;
const account=(changes={})=>({user_id:'a',year:2026,annual_entitlement:30,carryover_days:0,workweek:[1,2,3,4,5],work_location:{state:'BY'},...changes});
const entry=(start,end,changes={})=>({user_id:'a',start_date:start,end_date:end,status:'planned',half_day_information:{},...changes});
const count=(e,a=account())=>C.entryDays(e,a.year,a);
let a=account(),e=entry('2026-06-08','2026-06-17',{status:'taken'}),p=entry('2026-06-18','2026-06-26');
assert.equal(count(e),8);assert.equal(count(p),7);assert.equal(JSON.stringify(C.totals(a,[e,p])),JSON.stringify({taken:8,planned:7,budget:30,available:15,progress:50}));
assert.equal(C.totals(account({carryover_days:4}),[e,p]).available,19);
assert.equal(count(entry('2026-06-06','2026-06-07')),0); // weekend
assert.equal(count(entry('2026-05-01','2026-05-01')),0); // Labour Day
assert.equal(count(entry('2026-04-03','2026-04-06')),0); // Easter
assert.equal(count(entry('2026-06-04','2026-06-05')),1); // Corpus Christi BY
assert.equal(count(entry('2026-06-04','2026-06-05'),account({work_location:{state:'BE'}})),2);
assert.equal(count(entry('2026-06-08','2026-06-08',{half_day_information:{'2026-06-08':0.5}})),0.5);
assert.equal(count(entry('2026-05-01','2026-05-01',{half_day_information:{'2026-05-01':0.5}})),0);
assert.equal(count(entry('2026-06-08','2026-06-12'),account({workweek:[1,3,5]})),3);
assert.equal(count(entry('2026-06-06','2026-06-07'),account({workweek:[6,7]})),2);
const cross=entry('2026-12-28','2027-01-08');assert.equal(count(cross),4);assert.equal(count(cross,account({year:2027})),4); // Jan 1 + Epiphany
assert.equal(count(cross,account({year:2027,work_location:{state:'BE'}})),5);
assert.equal(count(entry('2026-06-08','2026-06-12',{status:'cancelled'})),0);
assert.equal(C.overlap({...e,id:'new'},[{...e,id:'old'}]),true);assert.equal(C.overlap({...e,id:'old'},[{...e,id:'old'}]),false);
assert.equal(C.overlap({...e,user_id:'b'},[e]),false);assert.equal(C.overlap({...e,status:'cancelled'},[e]),false);
assert.equal(C.totals(a,[e,{...p,user_id:'b'}]).planned,0);
assert.equal(C.totals(a,[{...e,end_date:'2026-06-08'}]).taken,1); // edit replaces, not adds
assert.equal(C.totals(account({annual_entitlement:0}),[e]).available,-8);
assert.equal(C.valid('2026-02-30'),false);assert.equal(C.valid('2028-02-29'),true);
assert.throws(()=>C.days('2026-06-10','2026-06-09'));assert.throws(()=>C.entryDays(e,2026,null));
assert.equal(C.holidays(2027,{state:'BY',assumption:true}).has('2027-08-15'),true);assert.equal(C.holidays(2027,{state:'BY'}).has('2027-08-15'),false);
assert.equal(C.holidays(2028,{state:'BY',augsburg:true}).has('2028-08-08'),true);
assert.equal(C.holidays(2026,{state:'SN'}).has('2026-11-18'),true);
assert.equal(C.holidays(2026,{state:'SN',corpus_christi:true}).has('2026-06-04'),true);
assert.equal(C.holidays(2028,{state:'BE'}).has('2028-06-17'),true);
assert.equal(C.holidays(2026,{state:'BB'}).has('2026-04-05'),true);
assert.equal(count(entry('2026-12-24','2026-12-24')),1);
assert.equal(count(entry('2026-12-24','2026-12-24'),account({work_location:{state:'BY',additional_holidays:['2026-12-24']}})),0);
for(const state of Object.keys(C.STATES))assert(C.holidays(2026,{state}).has('2026-12-25'));
// No drift through DST or across differently configured years.
assert.equal(count(entry('2026-03-27','2026-03-30')),2);assert.equal(count(entry('2026-10-23','2026-10-26')),2);
console.log('PASS: vacation arithmetic: 30/8/7/15, carryover, weekend/holidays/regions, half days, workweeks, year split, overlap/cancel/edit, separate users, leap years/DST, all 16 states.');
