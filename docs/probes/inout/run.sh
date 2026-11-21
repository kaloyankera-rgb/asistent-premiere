# In/Out Phase 0 probe helpers. Source from the repo root: `. docs/probes/inout/run.sh`
# Only in NEW TEST / TEST (the panel refuses elsewhere). Check first: ASISTENT_LANE=26 python3 scripts/dev_cmd.py ping
D=docs/probes/inout
# run <body.js> ['const X=...;']   optional constants line, then pre.js, then the body
run(){ ASISTENT_LANE=26 python3 scripts/dev_cmd.py uxp_eval "$(printf '%s\n' "$2" | cat - $D/pre.js "$D/$1" | python3 -c 'import json,sys;print(json.dumps({"code":sys.stdin.read()}))')"; }
sel(){ ASISTENT_LANE=26 python3 scripts/dev_cmd.py select "$1"; }
shot(){ ASISTENT_LANE=26 python3 scripts/dev_cmd.py frame "{\"seconds\": $1, \"name\": \"$2\"}"; }   # prints {path}; the file may be path + ".png"
PY="$HOME/Library/Application Support/Asistent/venv/bin/python"
# meas <frame.png>   numbers only (bright shape on black); never open a frame as an image
meas(){ "$PY" -c "import cv2,sys,numpy as n;g=cv2.imread(sys.argv[1],0).astype(int);m=g>24;ys,xs=n.where(m);print(dict(size=g.shape[::-1],box=[int(xs.min()),int(ys.min()),int(xs.max()),int(ys.max())],w=int(xs.max()-xs.min()+1),h=int(ys.max()-ys.min()+1),cx=round(float(xs.mean()),2),cy=round(float(ys.mean()),2),area=int(m.sum()),peak=int(g.max()),grad=int(n.abs(n.diff(g,axis=1)).max())))" "$1"; }
