
from __future__ import annotations

import re
import sys
from pathlib import Path
import xml.etree.ElementTree as ET


def fail(code: int, where: str, detail: str) -> None:
    print(f"[FAIL:{code}] {where}\n  {detail}", file=sys.stderr)
    sys.exit(code)


def read_text(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        # fallback for files saved in ANSI/GBK etc. on Windows
        return p.read_text(encoding="mbcs", errors="replace")
    except FileNotFoundError:
        raise
    except Exception as e:
        raise RuntimeError(str(e))


def normalise_xml(xml_text: str) -> str:
    # Preserve file content as-is as much as possible; only strip trailing spaces.
    return "\n".join(line.rstrip() for line in xml_text.splitlines()).strip() + "\n"


def extract_rc_from_build_rs(build_rs: str) -> str | None:
    # Accept: res.set_resource_file("app.rc");
    m = re.search(r'set_resource_file\(\s*"([^"]+\.rc)"\s*\)', build_rs)
    if m:
        return m.group(1)
    return None


def extract_manifest_from_rc(app_rc: str) -> tuple[str, int] | None:
    """
    Parse a line like:
      1 RT_MANIFEST "app.manifest"
    Also supports:
      1 24 "app.manifest"         (24 == RT_MANIFEST)
      1 RT_MANIFEST "path\\x.manifest"
    Returns: (manifest_path_string, line_number_1_based)
    """
    lines = app_rc.splitlines()

    for i, raw in enumerate(lines, start=1):
        s = raw.strip()
        if not s:
            continue
        if s.startswith("//"):
            continue

        # 1 RT_MANIFEST "app.manifest"
        m = re.match(r'^\s*\d+\s+RT_MANIFEST\s+"([^"]+)"\s*$', raw, flags=re.IGNORECASE)
        if m:
            return m.group(1), i

        # 1 24 "app.manifest"
        m = re.match(r'^\s*\d+\s+24\s+"([^"]+)"\s*$', raw)
        if m:
            return m.group(1), i

    return None


def main() -> None:
    # Locate the directory containing this script (expected: same as build.rs).
    here = Path(__file__).resolve().parent

    build_rs_path = here / "build.rs"
    if not build_rs_path.exists():
        fail(2, "build.rs", f"Not found at: {build_rs_path}")

    try:
        build_rs = read_text(build_rs_path)
    except Exception as e:
        fail(2, "build.rs", f"Cannot read: {e}")

    rc_rel = extract_rc_from_build_rs(build_rs)
    if not rc_rel:
        fail(4, "build.rs", 'Cannot find set_resource_file("*.rc") in build.rs')

    rc_path = (here / rc_rel).resolve()
    if not rc_path.exists():
        fail(3, "app.rc", f'build.rs references "{rc_rel}" but file not found: {rc_path}')

    try:
        app_rc = read_text(rc_path)
    except Exception as e:
        fail(3, "app.rc", f"Cannot read: {e}")

    mani_hit = extract_manifest_from_rc(app_rc)
    if not mani_hit:
        fail(
            5,
            "app.rc",
            f'Cannot find a RT_MANIFEST line like: 1 RT_MANIFEST "xxx.manifest"\n  rc: {rc_path}',
        )

    mani_rel, mani_line = mani_hit
    mani_path = (rc_path.parent / mani_rel).resolve()

    if not mani_path.exists():
        fail(
            6,
            "app.manifest",
            f'app.rc line {mani_line} references "{mani_rel}" but file not found.\n'
            f"  rc:  {rc_path}\n"
            f"  expected manifest path: {mani_path}",
        )

    try:
        mani_text = read_text(mani_path)
    except Exception as e:
        fail(6, "app.manifest", f"Cannot read: {e}")

    try:
        ET.fromstring(mani_text.encode("utf-8", errors="ignore"))
    except Exception as e:
        fail(7, "app.manifest XML", f"XML parse failed: {e}\n  manifest: {mani_path}")

    print("=== BLIND TEST: build.rs -> app.rc -> app.manifest ===")
    print(f"[OK] script_dir        : {here}")
    print(f"[OK] build.rs          : {build_rs_path}")
    print(f"[OK] rc referenced     : {rc_rel}")
    print(f"[OK] app.rc resolved   : {rc_path}")
    print(f"[OK] manifest ref @    : {rc_path.name}:{mani_line} -> \"{mani_rel}\"")
    print(f"[OK] manifest resolved : {mani_path}")
    print()
    print("=== THEORETICAL EMBEDDED RT_MANIFEST (#1) CONTENT ===")
    print(normalise_xml(mani_text))
    print("=== END ===")
    sys.exit(0)


if __name__ == "__main__":
    main()