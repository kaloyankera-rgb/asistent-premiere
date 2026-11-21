// Read only: the chain and the tagged Transform's Position keys on every selected clip
const out=[];for(const x of sel){const g=await comps(x.ti),o=await mine(x.ti);out.push({clip:x.name,chain:g.all.map((q)=>q.m).join(' > '),geo:g.geo.length,tagged:o?o.i:null,posKeys:o?(await keys(o.l[1])).length:0,posTimes:o?await keys(o.l[1]):[]});}return out;
