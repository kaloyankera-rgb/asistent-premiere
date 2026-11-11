"""The Asistent host channel (hostbridge / devbridge.Bridge)."""


# ---- 0.10.45: two Premiere versions side by side: a command goes only to the Premiere it came from

def test_commands_go_only_to_their_own_lane():
    from asistent.devbridge import Bridge
    b = Bridge()
    old = b.submit("audio_route", {"n": 1})                  # from a panel before 0.10.45 (no lane)
    mine = b.submit("audio_route", {"n": 2}, lane="27")      # from the panel in Premiere 27
    got27 = b.poll(0, "27")
    assert got27["id"] == mine
    assert b.poll(0, "27") is None                           # never the other Premiere's command
    assert b.poll(0, "")["id"] == old


def test_route_audio_passes_the_chosen_second_track_on(monkeypatch):
    from asistent import hostbridge
    sent = {}
    monkeypatch.setattr(hostbridge, "run", lambda name, args, wait=60.0: sent.update(args) or {"ok": True})
    hostbridge.route_audio([{"track": 2, "start": 0, "end": 5, "route": "split", "lower": 3},
                            {"track": 0, "start": 0, "end": 5, "route": "split", "lower": 0},
                            {"track": 0, "start": 6, "end": 9, "route": "split"}], "S", None)
    assert [it.get("lower") for it in sent["items"]] == [3, None, None]     # never above, onto, or below the source
