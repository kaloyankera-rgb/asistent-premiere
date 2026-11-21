// prefix: const BOX='kf_2:1';
const b=document.getElementById(BOX);if(!b)return {error:'no box'};b.checked=false;try{b.dispatchEvent(new Event('change'));}catch(e){return {note:'change event: '+e.message,checked:b.checked}}return {checked:b.checked};
