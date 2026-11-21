// prefix: const LABEL='Apply'; clicks that button inside the Keyframer dock (not the Anchor page's), waits for it to finish
const b=[...document.querySelectorAll('#kfDock .btn')].find((x)=>x.textContent.trim()===LABEL);if(!b)return {error:'no such dock button',have:[...document.querySelectorAll('#kfDock .btn')].map((x)=>x.textContent.trim())};
b.click();await new Promise((r)=>setTimeout(r,2500));
for(let i=0;i<20;i++){const busy=[...document.querySelectorAll('#kfDock .btn')].some((x)=>x.className.includes('disabled')||x.disabled);if(!busy)break;await new Promise((r)=>setTimeout(r,500));}
return {status:[...document.querySelectorAll('.kf-status > *')].map((c)=>c.textContent)};
