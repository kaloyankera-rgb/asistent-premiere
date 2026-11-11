#!/usr/bin/env python3
"""Drive the Asistent panel in TEST.prproj through the engine's test bridge (see engine/asistent/devbridge.py).

  dev_cmd.py on | off                   create / remove the flag file (the bridge is off without it)
  dev_cmd.py ping | state | selection | timeline [json args]
  dev_cmd.py click "Auto color"                       press a panel button by its label (waits until the panel is idle)
  dev_cmd.py click "Cancel" now                       press it at once, while a job runs
  dev_cmd.py click "#afterSwitch"                     press an element by its id (the Automatic switches)
  dev_cmd.py fill '{"id": "notes", "value": "раф => рафт"}'   fill the corrections box
  dev_cmd.py wait_idle [seconds]                     wait until the panel is not busy, print its answer
  dev_cmd.py select '{"kind": "any"}'               select clips on the timeline (kind video|audio|any, names, track, from, to)
  dev_cmd.py frame '{"seconds": 12.5, "name": "a"}'  export a sequence frame into the engine's frames folder
  dev_cmd.py lumetri '{"names": ["fx39026"]}'        what Lumetri holds on those clips
  dev_cmd.py set_lumetri '{"names": ["fx39026"], "from": 126, "to": 127, "values": {"exposure": 3}}'   ONE clip, one Undo step
  dev_cmd.py chain '{"names": ["fx39026"]}'          every effect on those clips in chain order
  dev_cmd.py srt_import '{"paths": ["/abs/a.srt"]}'     P1: import into bin "Asistent test"
  dev_cmd.py caption_place '{"name": "a.srt"}'       P2: place it after the sequence end
  dev_cmd.py transcript_export                       P3: Premiere's transcript of the selected clip
  dev_cmd.py api '{"target": "sequence"}'            method names of project | sequence | ppro | selection
  dev_cmd.py host ping | probe                       the CEP host (ExtendScript) inside Premiere: status / caption API names
  dev_cmd.py host captions '{"srt": "/abs/a.srt", "sequence": "name"}'   put an SRT on a caption track (what the panel does)
  dev_cmd.py host eval '{"code": "app.project.name"}'   ExtendScript expression, TEST.prproj only
  dev_cmd.py host_status                             is the host polling the engine?
  dev_cmd.py css_probe                               which CSS this UXP really supports (panel redesign)

Any other name is sent as a command as it is. ASISTENT_LANE=27 (env) sends it to the panel / host in Premiere 27 only
(0.10.45: two Premiere versions side by side; without it only to clients from before 0.10.45). The panel refuses everything but `ping` outside TEST.prproj and NEW TEST.prproj.
"""
import json
import os
import sys
import time
from http.client import HTTPConnection

APP = os.path.expanduser("~/Library/Application Support/Asistent")
FLAG = os.path.join(APP, "devbridge.enabled")
HEAD = {"X-Asistent": "1", "Content-Type": "application/json"}
LANE = os.environ.get("ASISTENT_LANE", "")


def call(method, path, body=None, timeout=130):
    c = HTTPConnection("127.0.0.1", 47390, timeout=timeout)
    c.request(method, path, json.dumps(body) if body is not None else None, HEAD)
    r = c.getresponse()
    data = json.loads(r.read() or b"{}")
    c.close()
    return r.status, data


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    name, rest = argv[0], argv[1:]
    if name in ("on", "off"):
        if name == "on":
            open(FLAG, "w").close()
        elif os.path.exists(FLAG):
            os.remove(FLAG)
        print("bridge", name)
        return 0
    if name == "host_status":
        code, res = call("GET", "/host/status")
        print(json.dumps(res, ensure_ascii=False))
        return 0 if code == 200 else 1
    if name == "host":
        code, res = call("POST", "/host/command", {"name": rest[0], "args": json.loads(rest[1]) if len(rest) > 1 else {}, "wait": 90, "lane": LANE}, 120)
        print(json.dumps(res, ensure_ascii=False, indent=1))
        return 0 if code == 200 and res.get("ok") else 1
    args = {}
    if name == "click":
        args = {"text": rest[0], **({"now": True} if "now" in rest[1:] else {})}      # click "Cancel" now: while busy
        if rest[0].startswith("#"):                       # click "#afterSwitch": by id (the switches have no label, 0.10.59)
            args = {"id": rest[0][1:], **({"now": True} if "now" in rest[1:] else {})}
    elif name == "wait_idle":
        args = {"timeout": float(rest[0]) if rest else 120}
    elif rest:
        args = json.loads(rest[0])
    code, sent = call("POST", "/dev/command", {"name": name, "args": args, "lane": LANE})
    if code != 200:
        print(code, sent)
        return 1
    end = time.time() + (args.get("timeout", 120) + 30 if name == "wait_idle" else 60)
    while time.time() < end:
        code, res = call("GET", f"/dev/result?id={sent['id']}&wait=20")
        if code == 200:
            print(json.dumps(res["data"], ensure_ascii=False, indent=1))
            return 0 if res["ok"] else 1
    print("No answer from the panel (is Premiere open, is the panel open?)")
    return 3


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
