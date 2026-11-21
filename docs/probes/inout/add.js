// One append step for all selected clips, then one tag step. Prefix "const AT='group';" inserts before the Graphic group.
if(!sel.length)return {error:'select clips'};
const before=[],made=[];
for(const x of sel){const g=await comps(x.ti);before.push({clip:x.name,chain:g.all.map((o)=>o.m).join(' > '),geo:g.geo.length});
 const at=(typeof AT!=='undefined')?g.all.findIndex((o)=>o.m==='AE.ADBE Graphic Group'):-1;
 made.push({x,ch:g.ch,geo:g.geo.length,at,comp:await ppro.VideoFilterFactory.createComponent(M)});}
premiere.transaction(project,'Asistent probe: add Transform',(c)=>{for(const m of made)c.addAction(m.at>=0?m.ch.createInsertComponentAction(m.comp,m.at):m.ch.createAppendComponentAction(m.comp));});
globalThis.__ioKeep=made;await new Promise((r)=>setTimeout(r,80));
const fresh=[],out=[];
for(const m of made){const g=await comps(m.x.ti);if(g.geo.length!==m.geo+1){out.push({clip:m.x.name,error:'did not attach',geo:g.geo.length});continue;}
 const o=m.at>=0?g.geo.find((q)=>q.i===m.at):g.geo[g.geo.length-1];if(!o){out.push({clip:m.x.name,error:'not where expected'});continue;}
 const l=await prm(o.c),rest=[];for(let i=0;i<l.length;i++)rest.push([i,l[i].displayName,await val(l[i],m.x.inPt)]);
 fresh.push({m,l,o,g,rest});}
premiere.transaction(project,'Asistent probe: tag',(c)=>{for(const f of fresh)c.addAction(f.l[6].createSetValueAction(mk(f.l[6],TAG),true));});
for(const f of fresh)out.push({clip:f.m.x.name,inPt:f.m.x.inPt,outPt:f.m.x.outPt,start:f.m.x.start,end:f.m.x.end,speed:f.m.x.speed,fps:tl.fps,index:f.o.i,last:f.o.i===f.g.n-1,rest:f.rest,tag:await val(f.l[6],0)});
return {before,out};
