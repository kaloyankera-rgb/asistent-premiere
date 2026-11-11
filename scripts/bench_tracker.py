"""Motion tracker accuracy benchmark (0.10.51): synthetic scenes with a known path, run from the repo root:
    "$HOME/Library/Application Support/Asistent/venv/bin/python" scripts/bench_tracker.py
Numbers of the release are in docs/TRACKER.md. Synthetic only (no footage needed, none looked at)."""
# ---- scenes 1: plain, scale + rotation, blur + light, occlusion
import sys, math, time, numpy as np, cv2
sys.path.insert(0, "engine")
from asistent import tracker as T

def scene(n=240, W=1280, H=720, seed=1, occl=None, blur=0, light=False, rot=True, scale=True):
    rng = np.random.default_rng(seed)
    bg = cv2.GaussianBlur((rng.random((H*2, W*2))*255).astype(np.float32), (0,0), 3)
    bg = cv2.normalize(bg, None, 30, 220, cv2.NORM_MINMAX)
    obj = cv2.GaussianBlur((rng.random((140,140))*255).astype(np.float32), (0,0), 1.5)
    obj = cv2.normalize(obj, None, 0, 255, cv2.NORM_MINMAX)
    frames, truth = [], []
    for k in range(n):
        t = k / n
        # camera pan of the background + object path (fast and curved)
        ox, oy = 200*math.sin(2*math.pi*t), 80*math.cos(2*math.pi*t)
        f = bg[int(H/2+oy):int(H/2+oy)+H, int(W/2+ox):int(W/2+ox)+W].copy()
        cx = 300 + 700*t + 60*math.sin(6*math.pi*t)
        cy = 360 + 150*math.sin(4*math.pi*t)
        s = 1 + (0.5*t if scale else 0)
        a = (40*t if rot else 0)
        M = cv2.getRotationMatrix2D((70, 70), -a, s)       # cv2: positive = counter-clockwise; we want clockwise a
        M[0,2] += cx - 70; M[1,2] += cy - 70
        m = cv2.warpAffine(np.ones((140,140), np.float32), M, (W,H))
        o = cv2.warpAffine(obj, M, (W,H))
        f = f*(1-m) + o*m
        if light: f = f*(0.7+0.3*math.cos(3*t))
        if occl and occl[0] <= k < occl[1]:
            f[int(cy)-120:int(cy)+120, int(cx)-120:int(cx)+120] = 128
        if blur: f = cv2.GaussianBlur(f, (0,0), blur)
        f = f + rng.normal(0, 3, f.shape)
        frames.append(np.clip(f, 0, 255).astype(np.uint8)); truth.append((cx, cy, s, a))
    return frames, truth

def run(name, **kw):
    frames, truth = scene(**kw)
    k0 = len(frames)//3
    cx, cy, s0, a0 = truth[k0]
    hw = 70*s0*0.9
    box = (cx-hw, cy-hw, 2*hw, 2*hw)
    t = time.time()
    out = T.track_frames(iter(frames[k0:]), iter(frames[k0::-1]), box, k0, len(frames))
    dt = time.time()-t
    err = []; serr=[]; aerr=[]; lost=0
    for r, (x,y,s,a) in zip(out, truth):
        if r["state"]=="lost": lost+=1; continue
        err.append(math.hypot(r["x"]-x, r["y"]-y)); serr.append(abs(r["s"]*s0 - s)/s); aerr.append(abs(r["a"]+a0-a))
    err=np.array(err)
    print(f"{name:12s} pos median {np.median(err):.3f} p95 {np.percentile(err,95):.3f} max {err.max():.3f} px | scale max {max(serr)*100:.2f}% | angle max {max(aerr):.2f} deg | lost {lost} | {1000*dt/len(frames):.1f} ms/frame")
    return out

run("plain", rot=False, scale=False)
run("scale+rot")
run("blur+light", blur=1.5, light=True)
o = run("occlusion", occl=(150, 162))
print("  states 145-170:", "".join(r["state"][0] for r in o[145:170]))

# ---- scenes 2: fast moves, a flat logo, a change of look
rng = np.random.default_rng(3)
W,H=1280,720
bg = cv2.normalize(cv2.GaussianBlur((rng.random((H, W))*255).astype(np.float32),(0,0),4),None,40,200,cv2.NORM_MINMAX)
def logo():
    o = np.full((120,200), 230, np.uint8)
    cv2.putText(o, "LOGO", (10,85), cv2.FONT_HERSHEY_SIMPLEX, 2.4, 20, 8)
    cv2.rectangle(o,(2,2),(197,117),40,4); return o.astype(np.float32)
def make(path_fn, n, obj, look=None, mb=0):
    frames, truth = [], []
    h,w = obj.shape
    for k in range(n):
        cx, cy, s, a = path_fn(k)
        M = cv2.getRotationMatrix2D((w/2,h/2), -a, s); M[0,2]+=cx-w/2; M[1,2]+=cy-h/2
        m = cv2.warpAffine(np.ones_like(obj), M, (W,H)); o = cv2.warpAffine(obj, M, (W,H))
        f = bg*(1-m)+o*m
        if look: f = look(k, f, m)
        if mb: 
            ker = np.zeros((1, mb), np.float32); ker[0,:]=1/mb; f = cv2.filter2D(f, -1, ker)
        f += rng.normal(0,3,f.shape)
        frames.append(np.clip(f,0,255).astype(np.uint8)); truth.append((cx,cy,s,a))
    return frames, truth
def run2(name, frames, truth, half):
    k0=0; cx,cy,s0,a0=truth[0]
    box=(cx-half[0],cy-half[1],2*half[0],2*half[1])
    out=T.track_frames(iter(frames), iter([frames[0]]), box, 0, len(frames))
    e=[math.hypot(r["x"]-x,r["y"]-y) for r,(x,y,s,a) in zip(out,truth) if r["state"]!="lost"]
    st="".join(r["state"][0] for r in out)
    print(f"{name:14s} median {np.median(e):.3f} max {max(e):.3f} px, lost {st.count('l')}, unsure {st.count('u')}")
# fast: 45 px per frame horizontally with direction changes
fr,tr = make(lambda k:(200+45*(k%20) if (k//20)%2==0 else 200+45*(20-k%20), 360+30*math.sin(k/3), 1, 0), 120, logo())
run2("fast 45px/f", fr, tr, (95,55))
fr,tr = make(lambda k:(200+70*(k%12) if (k//12)%2==0 else 200+70*(12-k%12), 360, 1, 0), 96, logo(), mb=9)
run2("fast70+blur", fr, tr, (95,55))
# changing look: brightness of the object drifts and it fades to a different contrast
fr,tr = make(lambda k:(300+3*k, 300+1.5*k, 1+0.002*k, 0.1*k), 200, logo(), look=lambda k,f,m: f*(1-m)+ (f*(1-0.004*k)+0.4*k)*m)
run2("look change", fr, tr, (95,55))

# ---- scene 3: an object turning away in depth (error at its real, projected centre)
def run3(maxdeg, seed=7):
    rng=np.random.default_rng(seed); W,H=1280,720
    bg=cv2.normalize(cv2.GaussianBlur((rng.random((H,W))*255).astype(np.float32),(0,0),3),None,30,220,cv2.NORM_MINMAX)
    obj=cv2.normalize(cv2.GaussianBlur((rng.random((160,160))*255).astype(np.float32),(0,0),1.5),None,0,255,cv2.NORM_MINMAX)
    frames=[];truth=[]
    for k in range(150):
        t=k/150; cx=400+400*t; cy=360+50*math.sin(5*t)
        tilt=math.radians(maxdeg*t); hw=80*math.cos(tilt); d=40*math.sin(tilt)
        src=np.float32([[0,0],[160,0],[160,160],[0,160]])
        dst=np.float32([[cx-hw,cy-80-d*0.3],[cx+hw,cy-80+d*0.3],[cx+hw,cy+80-d*0.3],[cx-hw,cy+80+d*0.3]])
        M=cv2.getPerspectiveTransform(src,dst)
        m=cv2.warpPerspective(np.ones_like(obj),M,(W,H)); f=bg*(1-m)+cv2.warpPerspective(obj,M,(W,H))*m
        c=cv2.perspectiveTransform(np.float32([[[80,80]]]),M)[0,0]; frames.append(np.clip(f+rng.normal(0,3,f.shape),0,255).astype(np.uint8)); truth.append((float(c[0]),float(c[1])))
    out=T.track_frames(iter(frames),iter([frames[0]]),(330,290,140,140),0,150)
    e=[math.hypot(r["x"]-x,r["y"]-y) for r,(x,y) in zip(out,truth)]
    st="".join(r["state"][0] for r in out)
    print("tilt 0->%d deg: median %.2f p95 %.2f max %.2f px; sure %d unsure %d lost %d"%(maxdeg,np.median(e),np.percentile(e,95),max(e),st.count('s'),st.count('u'),st.count('l')))
for d in (30, 55, 70): run3(d)
