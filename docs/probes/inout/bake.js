// Prefix: const C={f0:5,n:10,x0:0.3,x1:0.7,sh:0};  a per-frame linear Position ramp + shutter, the blur's action pattern.
// Key base inPt * |speed| (measured, P7); frames sampled mid-frame (a head-trimmed clip starts off the frame grid)
const out=[],jobs=[];
for(const x of sel){const o=await mine(x.ti);if(!o){out.push({clip:x.name,error:'no tagged Transform'});continue;}
 const step=Math.abs(x.speed||1)/tl.fps,ks=[];for(let k=0;k<=C.n;k++)ks.push({t:x.inPt*Math.abs(x.speed||1)+(C.f0+k)*step,v:[C.x0+(C.x1-C.x0)*k/C.n,0.5]});jobs.push({x,o,step,ks});}
premiere.transaction(project,'Asistent probe: bake',(c)=>{for(const j of jobs){const l=j.o.l,p=l[1];
 c.addAction(p.createSetTimeVaryingAction(false));c.addAction(p.createSetTimeVaryingAction(true));
 for(const k of j.ks){const kf=mk(p,k.v);kf.position=tt(k.t);c.addAction(p.createAddKeyframeAction(kf));}
 const b=j.ks[0].t-j.step/8;if(b>0)c.addAction(p.createRemoveKeyframeRangeAction(tt(0),tt(b),true));
 c.addAction(l[9].createSetValueAction(mk(l[9],false),true));c.addAction(l[10].createSetValueAction(mk(l[10],C.sh),true));}});
for(const j of jobs){const got=await keys(j.o.l[1]),want=j.ks.map((k)=>k.t);
 out.push({clip:j.x.name,speed:j.x.speed,step:j.step,keys:got.length,want:want.length,
  maxErrFrames:Math.max.apply(null,want.map((t,i)=>Math.abs((got[i]===undefined?1e9:got[i])-t)/j.step)),
  quarter:await val(j.o.l[1],j.ks[4].t+j.step/4),angle:await val(j.o.l[10],0),
  seqT:[2,5,8,C.n+3].map((k)=>j.x.start+(C.f0+k+0.5)/tl.fps)});}
return out;
