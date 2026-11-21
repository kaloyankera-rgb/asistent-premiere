// Removes only tagged Transforms (effects, never track items) on the SELECTED clips, in one step.
// Prefix "const ALL=1;" sweeps the whole sequence instead (only when a probe lost its selection).
const pool=(typeof ALL!=='undefined')?tl.items.filter((q)=>q.kind==='video'):sel;
const acts=[];for(const x of pool){let o;try{o=await mine(x.ti);}catch(e){o=null;}if(o)acts.push([o.ch,o.c,x.name]);}
if(acts.length)premiere.transaction(project,'Asistent probe: clean up',(c)=>{for(const a of acts)c.addAction(a[0].createRemoveComponentAction(a[1]));});
await new Promise((r)=>setTimeout(r,80));let left=0;for(const x of pool){if(await mine(x.ti))left++;}
return {removed:acts.map((a)=>a[2]),left};
