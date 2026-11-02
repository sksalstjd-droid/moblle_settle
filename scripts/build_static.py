#!/usr/bin/env python3
"""Build the client-only production site from the Flask template and assets."""

from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "templates" / "index.html"
OUTPUT = ROOT / "dist"

# Explicit allowlist: development helpers and the PNG review page stay out of production.
STATIC_FILES = (
    "style.css",
    "settlement-core.js",
    "share-report.js",
    "app.js",
    "images/calculator.svg",
    "images/credit-card.svg",
    "images/user.svg",
)
SCRIPT_ORDER = ("settlement-core.js", "share-report.js", "app.js")
DEV_BLOCK = re.compile(
    r"^[ \t]*\{%\s*if\s+dev_live_reload_enabled\s*%\}\s*\n"
    r".*?^[ \t]*\{%\s*endif\s*%\}\s*\n?",
    re.MULTILINE | re.DOTALL,
)
STATIC_URL = re.compile(
    r"\{\{\s*url_for\(\s*(['\"])static\1\s*,\s*"
    r"filename\s*=\s*(['\"])([A-Za-z0-9_./-]+)\2\s*\)\s*\}\}"
)
JINJA_MARKER = re.compile(r"\{\{.*?\}\}|\{%.*?%\}|\{#.*?#\}", re.DOTALL)


class BuildError(RuntimeError):
    pass


def render_html() -> str:
    source = TEMPLATE.read_text(encoding="utf-8")
    source, removed = DEV_BLOCK.subn("", source)
    if removed != 1:
        raise BuildError(f"Expected one development Live Reload block, found {removed}.")

    def static_url(match: re.Match[str]) -> str:
        filename = match.group(3)
        if ".." in Path(filename).parts:
            raise BuildError(f"Unsafe static path in template: {filename}")
        return f"/static/{filename}"

    rendered, replacements = STATIC_URL.subn(static_url, source)
    if replacements != 4:
        raise BuildError(f"Expected four production static URLs, found {replacements}.")
    unresolved = JINJA_MARKER.search(rendered)
    if unresolved:
        raise BuildError(f"Unprocessed template syntax remains: {unresolved.group(0)}")

    positions = [rendered.find(f"/static/{name}") for name in SCRIPT_ORDER]
    if any(position < 0 for position in positions) or positions != sorted(positions):
        raise BuildError("Production scripts are missing or out of order.")
    if "dev-live-reload.js" in rendered or "png-review" in rendered:
        raise BuildError("Development-only references remain in the production HTML.")
    return rendered


def validate_sources() -> None:
    for relative in STATIC_FILES:
        source = ROOT / "static" / relative
        if not source.is_file():
            raise BuildError(f"Required production asset is missing: {source}")


def _safe_remove_generated(path: Path) -> None:
    candidate = path.absolute()
    if candidate.parent.resolve() != ROOT or candidate.name not in {"dist", ".dist-stage", ".dist-backup"}:
        raise BuildError(f"Refusing to remove unexpected path: {candidate}")
    if candidate.is_symlink() or (hasattr(candidate, "is_junction") and candidate.is_junction()):
        raise BuildError(f"Refusing to remove a link: {candidate}")
    if candidate.is_dir():
        shutil.rmtree(candidate)
    elif candidate.exists():
        candidate.unlink()


def build() -> None:
    validate_sources()
    html = render_html()
    stage = ROOT / ".dist-stage"
    backup = ROOT / ".dist-backup"
    _safe_remove_generated(stage)
    _safe_remove_generated(backup)
    stage.mkdir()
    try:
        (stage / "index.html").write_text(html, encoding="utf-8", newline="\n")
        for relative in STATIC_FILES:
            destination = stage / "static" / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / "static" / relative, destination)

        # Swap only after the complete staging tree has been created.
        if OUTPUT.is_symlink() or (hasattr(OUTPUT, "is_junction") and OUTPUT.is_junction()):
            raise BuildError(f"Refusing to replace a linked output path: {OUTPUT}")
        if OUTPUT.exists():
            if not OUTPUT.is_dir() or OUTPUT.resolve().parent != ROOT:
                raise BuildError(f"Refusing to replace unexpected output path: {OUTPUT}")
            OUTPUT.rename(backup)
        try:
            stage.rename(OUTPUT)
        except Exception:
            if backup.exists() and not OUTPUT.exists():
                backup.rename(OUTPUT)
            raise
        _safe_remove_generated(backup)
    finally:
        if stage.exists():
            _safe_remove_generated(stage)


def main() -> int:
    try:
        build()
    except (BuildError, OSError) as error:
        print(f"Static build failed: {error}", file=sys.stderr)
        return 1
    print(f"Built static site: {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
