#!/usr/bin/env node
// Collect independent pregame projections for Rick's Picks.
// Requires Node 20+; no third-party packages.
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {execFile} = require('node:child_process');

function fetchText(url) {
  return new Promise((resolve,reject)=>execFile('curl',['--compressed','--fail','--silent','--show-error','--location','--retry','2','--max-time','35',url],
    {encoding:'utf8',maxBuffer:12_000_000},(err,stdout)=>err?reject(err):resolve(stdout)));
}
function centralDay(date=new Date()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
function xmlTags(text,tag) {
  const re=new RegExp('<'+tag+'\\s+([^>]+?)/?>','g');
  return [...text.matchAll(re)].map(m=>{
    const attrs={};
    for(const x of m[1].matchAll(/([a-z][a-z0-9]*)="([^"]*)"/gi))
      attrs[x[1]]=x[2].replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
    return {...attrs,getAttribute(k){return attrs[k]??null;}};
  });
}
function haslamScores(html,xml,day) {
  const data={mr:xmlTags(xml,'mr'),av:xmlTags(xml,'av'),ha:xmlTags(xml,'ha'),tg:xmlTags(xml,'tg')};
  if(data.mr.length<300||data.av.length!==1||data.ha.length!==1)throw new Error('Incomplete Haslametrics ratings XML');
  const start=html.indexOf('function refreshThisUpcomingGame(');
  const end=html.indexOf('function calcGameRating(',start);
  if(start<0||end<start)throw new Error('Haslametrics projection function not found');
  const source=html.slice(start,end).trim();
  if(!source.includes('var av_u =')||!source.includes('var ScoreDiff='))throw new Error('Haslametrics formula structure changed');
  // Isolate the numerical part of the site's original score calculation.
  // The DOM shims capture writes; the returned ts/os are the actual formula results.
  const body=source.replace(/}\s*$/,'return {ts,os};\n}');
  const xmlDoc={getElementsByTagName:k=>data[k]||[]};
  const dom=new Map();
  const document={getElementById:k=>{if(!dom.has(k))dom.set(k,{innerHTML:'',style:{}});return dom.get(k);}};
  const context={xmlDoc,xmlhttp:{responseXML:xmlDoc},document,calcGameRating:()=>2,
    transId:x=>x,YearParam:'',ThisTimeIndependent:'',TimeIndependentParam:'',ThisYearShort:''};
  vm.createContext(context,{codeGeneration:{strings:false,wasm:false}});
  vm.runInContext(body,context,{timeout:1000});
  const wanted=`${Number(day.slice(5,7))}/${Number(day.slice(8,10))}/${day.slice(0,4)}`;
  const rows=[];
  for(const g of data.tg.filter(g=>g.d===wanted)) {
    const awayId=data.mr.findIndex(m=>m.t===g.t),homeId=data.mr.findIndex(m=>m.t===g.o);
    if(awayId<0||homeId<0)throw new Error('Haslametrics team not resolved: '+g.t+' / '+g.o);
    const home=data.mr[homeId],away=data.mr[awayId];
    const avgAP=(Number(away.ap)+Number(home.ap))/2;
    const result=context.refreshThisUpcomingGame(g.o,homeId,g.t,awayId,1,g.s==='A'?1:0,Number(g.pc),Number(g.sht),avgAP,'Winner');
    if(!Number.isFinite(result?.ts)||!Number.isFinite(result?.os))throw new Error('Invalid Haslametrics scores: '+g.t+' / '+g.o);
    rows.push({date:day,away:g.t,home:g.o,neutral:g.s!=='A',away_score:+result.os.toFixed(2),home_score:+result.ts.toFixed(2),
      home_margin:+(result.ts-result.os).toFixed(2)});
  }
  if(rows.length<5)throw new Error('Too few Haslametrics games for '+day);
  return rows;
}
function torvikScores(raw,day) {
  const [year,mon,date]=day.split('-');const wanted=`${Number(mon)}/${Number(date)}/${year.slice(2)}`;
  const rows=[];
  for(const g of raw) {
    if(g[1]!==wanted)continue;
    const pred=String(g[4]||'');
    const match=pred.match(/^(.*?)\s+(-?\d+(?:\.\d+)?),\s*(\d+)-(\d+)\s*\((\d+)%\)/);
    if(!match)continue; // non-D1 games may not have a numerical forecast
    const away=g[8],home=g[14],favorite=match[1];
    const margin=Math.abs(Number(match[2]));
    const favKey=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
    const homeFavorite=favKey(home)===favKey(favorite);
    const awayFavorite=favKey(away)===favKey(favorite);
    if(!homeFavorite&&!awayFavorite)continue;
    rows.push({date:day,away,home,neutral:g[7]===1,projected_favorite:favorite,
      home_margin:+(homeFavorite?margin:-margin).toFixed(2),win_probability:Number(match[5])/100});
  }
  if(rows.length<5)throw new Error('Too few Torvik games for '+day);
  return rows;
}
async function main(){
  const day=process.argv[2]||centralDay();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw new Error('Expected YYYY-MM-DD date');
  const season=Number(day.slice(0,4))+(Number(day.slice(5,7))>=7?1:0);
  const [torvikText,haslamHtml,haslamXml]=await Promise.all([
    fetchText(`https://barttorvik.com/${season}_super_sked.json`),
    fetchText('https://haslametrics.com/ratings.php'),
    fetchText('https://haslametrics.com/ratings.xml')]);
  const torvik=torvikScores(JSON.parse(torvikText),day);
  const haslam=haslamScores(haslamHtml,haslamXml,day);
  const generated=new Date();
  const output={date:day,generated_at_utc:generated.toISOString(),torvik,haslam};
  const filename=path.join('wrong-team-projections',day,'projections.json');
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  const body=JSON.stringify(output,null,2)+'\n';
  fs.writeFileSync(filename,body);
  const stamped=path.join(path.dirname(filename),generated.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')+'.json');
  fs.writeFileSync(stamped,body);
  console.log(`Saved ${filename} and ${stamped}: ${torvik.length} Torvik, ${haslam.length} Haslametrics games`);
}
main().catch(err=>{console.error(err);process.exitCode=1;});
