// Prefix: const W={1:[0.75,0.5]};  (param index -> static value) on the tagged Transform of every selected clip
const out=[],jobs=[];for(const x of sel){const o=await mine(x.ti);if(!o){out.push({clip:x.name,error:'no tagged Transform'});continue;}jobs.push({x,o});}
premiere.transaction(project,'Asistent probe: set',(c)=>{for(const j of jobs)for(const k of Object.keys(W)){const p=j.o.l[k];c.addAction(p.createSetTimeVaryingAction(false));c.addAction(p.createSetValueAction(mk(p,W[k]),true));}});
for(const j of jobs){const back={};for(const k of Object.keys(W))back[k]=await val(j.o.l[k],j.x.inPt);out.push({clip:j.x.name,back,mid:(j.x.start+j.x.end)/2});}
return out;
