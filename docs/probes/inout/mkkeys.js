// Prefix: const MK={t:[1,1.2],v:[[0.3,0.5],[0.7,0.5]]};  two hand-made Motion Position keys on the FIRST selected clip (a probe clip)
if(!sel.length)return {error:'select one probe clip'};
const x=sel[0],g=await comps(x.ti),mo=g.all.find((o)=>o.m==='AE.ADBE Motion');const l=await prm(mo.c);const p=l.find((q)=>String(q.displayName).toLowerCase()==='position');
if((await mb(p,'isTimeVarying'))!==false)return {error:'Position already has keys'};
premiere.transaction(project,'Asistent probe: Motion keys',(c)=>{c.addAction(p.createSetTimeVaryingAction(true));for(let i=0;i<MK.t.length;i++){const kf=mk(p,MK.v[i]);kf.position=tt(x.inPt+MK.t[i]);c.addAction(p.createAddKeyframeAction(kf));}});
await new Promise((r)=>setTimeout(r,80));
return {clip:x.name,start:x.start,inPt:x.inPt,keys:await keys(p),v0:await val(p,x.inPt+MK.t[0]),v1:await val(p,x.inPt+MK.t[1]),mid:await val(p,x.inPt+(MK.t[0]+MK.t[1])/2)};
