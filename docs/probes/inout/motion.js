// Prefix: const MV={Position:[0.3,0.35],Scale:50};  moves the first selected clip with Motion, returns the old values
// (run again with those to restore). Only on the probe clips A-F. Refuses unless the parameter is known to have no keys.
if(!sel.length)return {error:'select one probe clip'};
const x=sel[0],g=await comps(x.ti),mo=g.all.find((o)=>o.m==='AE.ADBE Motion');if(!mo)return {error:'no Motion'};
const l=await prm(mo.c),old={},todo=[];
for(const k of Object.keys(MV)){const p=l.find((q)=>String(q.displayName).toLowerCase()===k.toLowerCase());if(!p||(await mb(p,'isTimeVarying'))!==false)return {error:'cannot set '+k};old[k]=await val(p,x.inPt);todo.push([p,MV[k]]);}
premiere.transaction(project,'Asistent probe: Motion',(c)=>{for(const [p,v] of todo)c.addAction(p.createSetValueAction(mk(p,v),true));});
return {old,mid:(x.start+x.end)/2};
