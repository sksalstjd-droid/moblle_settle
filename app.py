import hashlib
import os
from pathlib import Path

from flask import Flask, jsonify, render_template


def _enabled(value):
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def create_app():
    app = Flask(__name__)
    # Development tooling is explicit opt-in and is disabled on Render.
    dev_live_reload = _enabled(os.getenv("SETTLE_DEV")) and not _enabled(os.getenv("RENDER"))
    app.config["DEV_LIVE_RELOAD"] = dev_live_reload
    app.config["DEV_SERVER_ID"] = str(os.getpid()) if dev_live_reload else None

    @app.context_processor
    def inject_dev_flags():
        return {
            "dev_live_reload_enabled": app.config["DEV_LIVE_RELOAD"],
            "dev_server_id": app.config["DEV_SERVER_ID"],
        }

    @app.after_request
    def disable_development_caches(response):
        if app.config["DEV_LIVE_RELOAD"]:
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

    @app.route("/")
    def index():
        return render_template("index.html")

    if dev_live_reload:
        @app.get("/__dev/revision")
        def dev_revision():
            root = Path(app.root_path)
            watched_files = [root / "templates" / "index.html"]
            static_root = root / "static"
            watched_files.extend(static_root.rglob("*.css"))
            watched_files.extend(static_root.rglob("*.js"))
            digest = hashlib.sha256()
            for file_path in sorted(set(watched_files)):
                if not file_path.is_file():
                    continue
                relative_path = file_path.relative_to(root).as_posix()
                digest.update(relative_path.encode("utf-8"))
                digest.update(b"\0")
                digest.update(file_path.read_bytes())
                digest.update(b"\0")
            return jsonify(revision=digest.hexdigest(), server_id=app.config["DEV_SERVER_ID"])

    return app


app = create_app()


if __name__ == "__main__":
    dev_mode = app.config["DEV_LIVE_RELOAD"]
    app.run(
        host="0.0.0.0",
        port=int(os.getenv("PORT", 5000)),
        debug=False,
        use_debugger=False,
        use_reloader=dev_mode,
    )
