"""Brand kits (0.10.71): finding kits, the client from the project, reading a kit, local copies, managing, adding files."""
import json
import os
import shutil
import struct
import sys
import time
import zlib

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "engine"))
sys.path.insert(0, os.path.dirname(__file__))
from asistent import brandkit as B, config  # noqa: E402
from test_server import call, engine  # noqa: E402,F401

FONTS = os.path.join(os.path.dirname(__file__), "..", "fonts")


def png(path, w=4, h=3, rgba=(255, 0, 0, 255)):
    """A tiny real PNG (FFmpeg can make a thumbnail of it)."""
    raw = b"".join(b"\x00" + bytes(rgba) * w for _ in range(h))

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    return path


def touch(path, data=b"x"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    return path


BRAND = {
    "client": "GStroy", "display_name": "GStroy", "status": "draft-2 (read)",
    "name_rules": {"write_as": "GStroy"},
    "slogan": {"text": "Майсторът си ти."},
    "colors": {
        "primary": [{"name": "Sheen Green", "hex": "#98D100", "role": "main"}, {"name": "Raising Black", "hex": "#251f20"}],
        "website": {"dark": "#251F20", "green": "#99CF28 и #A6CE39"},
        "subtitle_accent": {"hex": "#94D000", "note": "measured"},
        "campaign": {"green": "#00AA00", "blue": "#0000FF"},
        "source": "brandbook p. 30",
    },
    "fonts": {"brand": {"family": "LT Superior", "missing": "Regular"}, "subtitles": {"family": "Montserrat"}},
    "text": {"subtitles": {"style_name": "GStroy", "fill": "#FFFFFF", "highlight": "#94D000", "case": "UPPERCASE"}},
    "editing_notes": ["no store counts", "prices only after checking the site"],
}


@pytest.fixture
def lib(tmp_path, monkeypatch):
    app = tmp_path / "app"
    app.mkdir()
    monkeypatch.setattr(config, "app_dir", lambda: str(app))
    monkeypatch.setattr(B, "SERVER_LIBRARIES", {sys.platform: []})
    monkeypatch.delenv("ASISTENT_BRANDKITS", raising=False)
    monkeypatch.setattr(B, "_font_dirs", lambda: [])
    B._font_cache.update(key=None, names=set())
    root = tmp_path / "Brand Kits"
    g = root / "GStroy"
    with open(touch(str(g / "brand.json")), "w", encoding="utf-8") as f:
        json.dump(BRAND, f, ensure_ascii=False)
    png(str(g / "assets/logo/gstroy-logo-horizontal.png"))
    touch(str(g / "assets/logo/gstroy-logo-horizontal.svg"), b"<svg xmlns='http://www.w3.org/2000/svg'/>")
    png(str(g / "assets/logo/gstroy-logo-horizontal-white.png"))
    touch(str(g / "assets/logo/only-vector.svg"), b"<svg xmlns='http://www.w3.org/2000/svg'/>")
    png(str(g / "assets/mascot/beaver.png"))
    touch(str(g / "assets/intro-outro/GStroy outro.mp4"), b"not really a video")
    touch(str(g / "assets/design/brandbook.pdf"), b"%PDF")
    touch(str(g / "assets/templates/price tag.mogrt"), b"PK")
    touch(str(g / "assets/fonts/LTSuperior-Medium.woff2"), b"wOF2")
    shutil.copy(os.path.join(FONTS, "Montserrat-Bold.ttf"), str(g / "assets/fonts/Montserrat-Bold.ttf"))
    touch(str(g / "assets/.DS_Store"))
    a = root / "AULA"
    png(str(a / "Logo/aula.png"))
    (root / "_Deleted kits").mkdir()
    (root / "empty file.txt").write_text("not a kit")
    B.manage("set_root", {"path": str(root)})
    return root


def kid(lib, name):
    return B.kit_id(str(lib / name))


def test_names_compare_across_scripts():
    assert B.norm("ЕКОПАК") == "ekopak"
    assert B.norm("Beauty Sector") == "beautysector"
    assert B.norm("RE/SHAPE") == "reshape"
    assert B.norm("Щастие Ъ") == "shtastiea"


def test_kits_are_listed_and_the_client_found_from_the_project(lib):
    r = B.list_kits("/Volumes/Production/GStroy/Projects/Видео 4.prproj")
    assert sorted(k["name"] for k in r["kits"]) == ["AULA", "GStroy"]                # _Deleted kits and files are not kits
    assert r["detected"] == kid(lib, "GStroy") and "GStroy" in r["why"]
    assert B.list_kits("/x/AULA КП-27 финал.prproj")["detected"] == kid(lib, "AULA")   # the project's own name wins
    assert B.list_kits("/x/NEW TEST.prproj")["detected"] is None                      # nothing matches: nothing guessed
    assert B.list_kits("")["detected"] is None


def test_aliases_and_a_brand_kit_folder_above_the_project(lib, tmp_path):
    B.manage("aliases", {"id": kid(lib, "AULA"), "aliases": ["Ала Бг", " "]})
    assert B.list_kits("/x/ala bg reel.prproj")["detected"] == kid(lib, "AULA")
    proj = tmp_path / "Production" / "Fornetti" / "Projects" / "a.prproj"
    png(str(tmp_path / "Production" / "Fornetti" / "Brand Kit" / "Logo" / "f.png"))
    touch(str(proj))
    r = B.list_kits(str(proj))
    found = [k for k in r["kits"] if k["source"] == "project"]
    assert len(found) == 1 and found[0]["name"] == "Brand Kit" and r["detected"] == found[0]["id"]


def test_a_kit_is_read_by_its_files_and_brand_json(lib):
    k = B.read_kit(kid(lib, "GStroy"))
    names = {c: [a["name"] for a in k["assets"][c]] for c in k["assets"]}
    # logo.png + logo.svg in one folder: the PNG shows, the SVG rides along; a lone SVG shows, not importable
    logos = {a["name"]: a for a in k["assets"]["logos"]}
    assert set(logos) == {"gstroy-logo-horizontal", "gstroy-logo-horizontal-white", "only-vector"}
    assert logos["gstroy-logo-horizontal"]["ext"] == "png" and logos["gstroy-logo-horizontal"]["alts"][0]["ext"] == "svg"
    assert logos["gstroy-logo-horizontal-white"]["variant"] == "for dark backgrounds"
    assert logos["only-vector"]["importable"] is False and "SVG" in logos["only-vector"]["why"]
    assert names["graphics"] == ["beaver"]
    assert names["video"] == ["GStroy outro"] and k["assets"]["video"][0]["role"] == "outro"
    assert names["references"] == ["brandbook"] and names["presets"] == ["price tag"]
    assert k["assets"]["presets"][0]["kind"] == "mogrt"
    # colours: groups from brand.json (website and notes skipped), the subtitle colours
    groups = {g["group"]: [i["hex"] for i in g["items"]] for g in k["colors"]}
    assert groups["Primary"] == ["#98D100", "#251F20"]
    assert groups["Subtitle accent"] == ["#94D000"] and groups["Campaign"] == ["#00AA00", "#0000FF"]
    assert groups["Subtitles"] == ["#FFFFFF", "#94D000"] and "Website" not in groups
    # fonts: the TTF read from its name table; LT Superior only as a web font; Montserrat declared and present
    fonts = {f["family"]: f for f in k["fonts"]}
    assert fonts["Montserrat"]["files"][0]["usable"] and fonts["Montserrat"]["role"] == "subtitles"
    assert fonts["LT Superior"]["files"][0]["usable"] is False and fonts["LT Superior"]["missing"] == "Regular"
    assert k["subtitle"]["preset"] == "gstroy" and k["notes"][0] == "Name: GStroy"
    assert k["counts"]["logos"] == 3 and k["deletable"] is True
    assert B.read_kit(kid(lib, "GStroy"), sig=k["sig"]) == {"unchanged": True, "sig": k["sig"]}
    time.sleep(0.01)
    png(str(lib / "GStroy/assets/logo/new.png"))
    assert "unchanged" not in B.read_kit(kid(lib, "GStroy"), sig=k["sig"])


def test_the_category_of_a_file(lib):
    c = B._category_of
    assert c(["assets", "logo", "vector"], "pdf") == "logos"
    assert c(["Лого"], "png") == "logos"
    assert c(["assets", "campaigns", "black-friday-2026"], "png") == "graphics"
    assert c(["assets", "fonts"], "png") == "graphics"                     # a picture in the fonts folder: by its type
    assert c([], "mogrt") == "presets" and c(["x"], "otf") == "fonts"
    assert c(["assets", "reference"], "mp4") == "references" and c([], "mov") == "video"
    assert B._family_from_file("cormac-black-webfont") == "cormac"
    assert B._family_from_file("Muller-ExtraBold") == "Muller"


def test_font_names_from_the_file():
    fam, style, full = B.font_names(os.path.join(FONTS, "Montserrat-Black.ttf"))
    assert fam == "Montserrat" and style == "Black" and "Montserrat" in full
    assert B.font_names(__file__) is None


def test_files_outside_the_kit_are_refused(lib):
    k = kid(lib, "GStroy")
    for bad in ("../AULA/Logo/aula.png", "/etc/passwd", "", "assets/../../AULA/Logo/aula.png"):
        with pytest.raises(ValueError):
            B.resolve(k, bad)
    with pytest.raises(ValueError):
        B.resolve(k, "assets/logo/missing.png")
    with pytest.raises(ValueError):
        B.read_kit("000000000000")


def test_uses_favourites_and_the_local_copy_when_the_server_is_away(lib, monkeypatch):
    monkeypatch.setattr(B, "is_remote", lambda p: True)
    k = kid(lib, "GStroy")
    rel = "assets/logo/gstroy-logo-horizontal.png"
    assert B.resolve(k, rel)["cached"] is False
    assert B.resolve(k, rel)["path"] == str(lib / "GStroy" / rel)                # 2nd use: copied to this computer
    cached = os.path.join(config.app_dir(), "brandkits", "cache", k, rel)
    for _ in range(50):
        if os.path.isfile(cached):
            break
        time.sleep(0.05)
    assert os.path.isfile(cached)
    B.favorite(k, rel, True)
    kit = B.read_kit(k)
    a = next(x for x in kit["assets"]["logos"] if x["rel"] == rel)
    assert a["fav"] and a["uses"] == 2 and a["cached"]
    # the server goes away (the whole library): the last reading and the copy still work
    os.rename(lib, lib.parent / "Brand Kits away")
    off = B.read_kit(k)
    assert off["online"] is False and "not reachable" in off["note"]
    r = B.resolve(k, rel)
    assert r["cached"] and r["path"] == cached and "Relink" in r["note"]
    with pytest.raises(ValueError):
        B.resolve(k, "assets/mascot/beaver.png")                                  # never used: no copy
    listed = B.list_kits("")
    assert any(x["id"] == k and not x["online"] for x in listed["kits"]) and str(lib) in listed["missing"]
    os.rename(lib.parent / "Brand Kits away", lib)
    shutil.rmtree(lib / "GStroy")                                                 # library back, kit gone: not listed
    assert k not in {x["id"] for x in B.list_kits("")["kits"]}


def test_manage_create_rename_colours_duplicate_delete(lib):
    r = B.manage("create", {"name": "New: Client/2"})
    folder = r["folder"]
    assert os.path.basename(folder) == "New Client 2" and os.path.isdir(os.path.join(folder, "assets", "logo"))
    with pytest.raises(ValueError):
        B.manage("create", {"name": "New: Client/2"})
    nid = r["id"]
    B.manage("rename", {"id": nid, "name": "Newco"})
    B.manage("color_add", {"id": nid, "hex": "ff7000", "name": "Orange"})
    with pytest.raises(ValueError):
        B.manage("color_add", {"id": nid, "hex": "#12345"})
    k = B.read_kit(nid)
    assert k["name"] == "Newco" and k["colors"][-1] == {"group": "Added", "items": [{"hex": "#FF7000", "name": "Orange", "note": ""}], "editable": True}
    # a brand.json colour is hidden in the sidecar, brand.json itself is not touched
    before = (lib / "GStroy/brand.json").read_bytes()
    B.manage("color_remove", {"id": kid(lib, "GStroy"), "hex": "#251F20"})
    assert (lib / "GStroy/brand.json").read_bytes() == before
    prim = next(g for g in B.read_kit(kid(lib, "GStroy"))["colors"] if g["group"] == "Primary")
    assert [i["hex"] for i in prim["items"]] == ["#98D100"]
    d = B.manage("duplicate", {"id": kid(lib, "GStroy"), "name": "GStroy 2027"})
    assert B.read_kit(d["id"])["name"] == "GStroy 2027" and os.path.isfile(os.path.join(d["folder"], "brand.json"))
    gone = B.manage("delete", {"id": d["id"]})
    assert "_Deleted kits" in gone["moved_to"] and os.path.isfile(os.path.join(gone["moved_to"], "brand.json"))
    assert "GStroy 2027" not in [k["name"] for k in B.list_kits("")["kits"]]


def test_a_client_folder_anywhere_and_library_roots(lib, tmp_path):
    ext = tmp_path / "Server" / "Credissimo" / "Brand Kit"
    png(str(ext / "logo" / "c.png"))
    r = B.manage("add_folder", {"path": str(ext), "name": "Credissimo"})
    kits = {k["id"]: k for k in B.list_kits("")["kits"]}
    assert kits[r["id"]]["name"] == "Credissimo" and kits[r["id"]]["source"] == "folder"
    with pytest.raises(ValueError):
        B.manage("delete", {"id": r["id"]})                                       # not in a library: forget only
    B.manage("forget", {"id": r["id"]})
    assert r["id"] not in {k["id"] for k in B.list_kits("")["kits"]}
    assert os.path.isdir(ext)                                                     # its files stay
    B.manage("remove_root", {"path": str(lib)})
    assert B.list_kits("")["kits"] == []
    with pytest.raises(ValueError):
        B.manage("create", {"name": "X"})                                         # no library folder
    with pytest.raises(ValueError):
        B.manage("set_root", {"path": str(tmp_path / "nope")})


def test_adding_files_copies_into_the_right_folder(lib, tmp_path):
    k = kid(lib, "GStroy")
    src = tmp_path / "in"
    a = png(str(src / "gstroy-logo-horizontal.png"))
    b = touch(str(src / "sting.mov"))
    c = touch(str(src / "Font-Regular.otf"))
    plan = B.plan_add(k, [a, b, c], "logos")
    assert [os.path.relpath(d, lib / "GStroy") for _s, d in plan][0] == os.path.join("assets", "logo", "gstroy-logo-horizontal (2).png")
    plan = B.plan_add(k, [b, c])
    rels = [os.path.relpath(d, lib / "GStroy").replace("\\", "/") for _s, d in plan]
    assert rels == ["assets/intro-outro/sting.mov", "assets/fonts/Font-Regular.otf"]
    res = B.add_files(plan)
    assert res["added"] == ["sting.mov", "Font-Regular.otf"] and os.path.isfile(src / "sting.mov")      # copied, not moved
    with pytest.raises(ValueError):
        B.plan_add(k, [str(src)])                                                 # a folder
    with pytest.raises(ValueError):
        B.plan_add(k, [a], "nonsense")


def test_thumbnails(lib):
    pytest.importorskip("numpy")
    from asistent import media
    try:
        media._tool("ffmpeg")
    except media.MediaError:
        pytest.skip("no FFmpeg")
    k = kid(lib, "GStroy")
    t = B.thumbs(k, ["assets/logo/gstroy-logo-horizontal.png", "assets/logo/only-vector.svg", "assets/design/brandbook.pdf", "../x.png"])["thumbs"]
    assert t["assets/logo/gstroy-logo-horizontal.png"].startswith("data:image/png;base64,")
    assert t["assets/logo/only-vector.svg"].startswith("data:image/svg+xml;base64,")
    assert t["assets/design/brandbook.pdf"] is None and t["../x.png"] is None


def test_fonts_install_for_this_user(lib, tmp_path, monkeypatch):
    dst = tmp_path / "MyFonts"
    monkeypatch.setattr(B, "user_font_dir", lambda: str(dst))
    k = kid(lib, "GStroy")
    r = B.install_font(k, "Montserrat")
    assert r["added"] == ["Montserrat-Bold.ttf"] and (dst / "Montserrat-Bold.ttf").is_file()
    with pytest.raises(ValueError):
        B.install_font(k, "LT Superior")                                          # web font only
    with pytest.raises(ValueError):
        B.install_font(k, "Comic Sans")


def test_copy_goes_to_the_clipboard(monkeypatch):
    seen = {}

    def fake(cmd, input=None, check=None, timeout=None):
        seen.update(cmd=cmd, input=input)
    monkeypatch.setattr(B.subprocess, "run", fake)
    B.copy_text("#98D100")
    assert seen["input"] in (b"#98D100", "#98D100".encode("utf-16-le"))
    with pytest.raises(ValueError):
        B.copy_text("")


def test_endpoints(engine, lib):  # noqa: F811
    code, r = call("GET", "/brand/kits?project=" + "/x/GStroy/p.prproj")
    assert code == 200 and r["detected"] == kid(lib, "GStroy")
    code, k = call("GET", f"/brand/kit?id={kid(lib, 'GStroy')}")
    assert code == 200 and k["counts"]["logos"] == 3
    assert call("GET", f"/brand/kit?id={kid(lib, 'GStroy')}&sig={k['sig']}")[1] == {"unchanged": True, "sig": k["sig"]}
    assert call("GET", "/brand/kit?id=nope")[0] == 404
    code, r = call("POST", "/brand/manage", {"action": "rename", "id": kid(lib, "AULA"), "name": "AULA.BG"})
    assert code == 200 and call("GET", f"/brand/kit?id={kid(lib, 'AULA')}")[1]["name"] == "AULA.BG"
    assert call("POST", "/brand/manage", {"action": "nope", "id": kid(lib, "AULA")})[0] == 400
    assert call("POST", "/brand/resolve", {"id": kid(lib, "AULA"), "rel": "../GStroy/brand.json"})[0] == 400
    code, r = call("POST", "/brand/favorite", {"id": kid(lib, "AULA"), "rel": "Logo/aula.png", "on": True})
    assert code == 200 and r["favorites"] == ["Logo/aula.png"]
    # the host commands check their input before Premiere is asked
    assert call("POST", "/brand/mogrt", {"path": "/nope.mogrt", "sequence": "S"})[0] == 400
    assert call("POST", "/brand/color", {"hex": "red", "sequence": "S"})[0] == 400
    assert call("POST", "/brand/color", {"hex": "#FF0000"})[0] == 400
