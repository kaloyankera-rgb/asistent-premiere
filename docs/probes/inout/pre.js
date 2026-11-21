// Shared head of every In/Out Phase 0 probe body (run.sh puts it in front). Single quotes only: it travels as JSON.
const M='AE.ADBE Geometry2',TAG=17.25,tt=(s)=>ppro.TickTime.createWithSeconds(s),mb=premiere.maybe;
const sx=(t)=>(t&&Number.isFinite(t.seconds)?t.seconds:undefined);
const uw=(v)=>{for(let i=0;i<4&&v&&typeof v==='object'&&'value' in v;i++)v=v.value;return v&&Number.isFinite(v.x)?[v.x,v.y]:v;};
const tl=await premiere.readTimeline(project);
const sel=tl.items.filter((x)=>x.selected&&x.kind==='video');
const comps=async(ti)=>{const ch=await ti.getComponentChain(),n=await ch.getComponentCount(),all=[];for(let i=0;i<n;i++){const c=await ch.getComponentAtIndex(i);all.push({c,i,m:(await mb(c,'getMatchName'))||''});}return {ch,n,all,geo:all.filter((o)=>o.m===M)};};
const prm=async(c)=>{const n=await c.getParamCount(),l=[];for(let i=0;i<n;i++)l.push(await c.getParam(i));return l;};
const val=async(p,t)=>uw((await mb(p,'isTimeVarying'))?await mb(p,'getValueAtTime',tt(t)):await mb(p,'getStartValue'));
const keys=async(p)=>((await mb(p,'getKeyframeListAsTickTimes'))||[]).map(sx);
const mk=(p,v)=>p.createKeyframe(Array.isArray(v)?new ppro.PointF(v[0],v[1]):v);
// the probe's own Transform: Skew 0 and a static Skew Axis (param 6, checked by name) holding the tag
const mine=async(ti)=>{const g=await comps(ti);for(const o of g.geo.slice().reverse()){const l=await prm(o.c);if(l[5]&&l[6]&&/skew axis/i.test(String(l[6].displayName))&&Number(await val(l[5],0))===0&&(await mb(l[6],'isTimeVarying'))===false&&Math.abs(Number(await val(l[6],0))-TAG)<1e-3)return {c:o.c,i:o.i,l,ch:g.ch,n:g.n,geo:g.geo.length};}return null;};
const sig=async(ti)=>(await comps(ti)).all.map((o)=>o.m).join(' > ');
