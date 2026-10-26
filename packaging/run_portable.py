from __future__ import annotations

import argparse
import json
import logging
import os
import secrets
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from typing import Any

import uvicorn
from cryptography.fernet import Fernet

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.launcher_runtime import (  # noqa: E402
    ProjectLock,
    lan_ipv4_address,
    port_of,
    process_identity,
    read_json,
    request_project_stop,
    reserve_backend_socket,
    wait_for_console_or_signal,
    write_json_atomic,
)

PREFERRED_BACKEND_PORT = 8000


def runtime_home() -> Path:
    configured = os.environ.get("WIR_RUNTIME_HOME")
    return Path(configured).resolve() if configured else ROOT / "data" / "run" / "portable"


def ensure_runtime_files() -> None:
    (ROOT / "data" / "uploads" / "workers").mkdir(parents=True, exist_ok=True)
    (ROOT / "data" / "uploads" / "visitors").mkdir(parents=True, exist_ok=True)
    env_path = ROOT / ".env"
    if env_path.exists():
        return
    required = (
        "WIR_SESSION_SECRET",
        "WIR_CSRF_SECRET",
        "WIR_WORKER_ID_SECRET",
        "WIR_AADHAAR_ENCRYPTION_KEY",
    )
    if all(os.environ.get(name) for name in required):
        return
    values = {
        "WIR_SESSION_SECRET": secrets.token_urlsafe(48),
        "WIR_CSRF_SECRET": secrets.token_urlsafe(48),
        "WIR_WORKER_ID_SECRET": secrets.token_urlsafe(48),
        "WIR_VISITOR_ID_SECRET": secrets.token_urlsafe(48),
        "WIR_AADHAAR_ENCRYPTION_KEY": Fernet.generate_key().decode("ascii"),
    }
    contents = "".join(f"{key}={value}\n" for key, value in values.items())
    try:
        with env_path.open("x", encoding="ascii", newline="\n") as env_file:
            env_file.write(contents)
    except FileExistsError:
        # Another launch created first-run secrets; existing secrets are never replaced.
        pass


def configure_logging(log_path: Path) -> logging.Logger:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[logging.StreamHandler(sys.stdout), logging.FileHandler(log_path, encoding="utf-8")],
        force=True,
    )
    return logging.getLogger("workforce360.portable")


def read_http_json(url: str, timeout: float = 2) -> dict[str, Any] | None:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            if response.status != 200:
                return None
            value = json.loads(response.read())
            return value if isinstance(value, dict) else None
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        return None


def run_portable(no_browser: bool = False) -> int:
    ensure_runtime_files()
    home = runtime_home()
    home.mkdir(parents=True, exist_ok=True)
    state_path = home / "runtime.json"
    backend_state_path = home / "backend.json"
    signal_path = home / "stop.json"
    logger = configure_logging(home / "portable.log")
    run_id = secrets.token_urlsafe(24)
    listener: socket.socket | None = None
    server: uvicorn.Server | None = None
    backend_thread: threading.Thread | None = None
    with ProjectLock(home / "launcher.lock"):
        for path in (state_path, backend_state_path, signal_path):
            path.unlink(missing_ok=True)
        try:
            listener = reserve_backend_socket("0.0.0.0", PREFERRED_BACKEND_PORT)
            backend_port = port_of(listener)
            backend_url = f"http://127.0.0.1:{backend_port}"
            public_host = lan_ipv4_address()
            application_url = f"http://{public_host}:{backend_port}"
            state: dict[str, Any] = {
                "mode": "portable",
                "project_root": str(ROOT),
                "runtime_home": str(home),
                "run_id": run_id,
                "stop_token": secrets.token_urlsafe(24),
                "preferred_backend_port": PREFERRED_BACKEND_PORT,
                "backend_port": backend_port,
                "backend_url": backend_url,
                "frontend_port": backend_port,
                "frontend_url": application_url,
                "application_url": application_url,
                "backend_process": process_identity(),
            }
            write_json_atomic(backend_state_path, state)
            write_json_atomic(state_path, state)

            server = uvicorn.Server(
                uvicorn.Config(
                    "backend.main:app",
                    host="0.0.0.0",
                    port=backend_port,
                    log_level="info",
                    access_log=False,
                    log_config=None,
                )
            )
            backend_thread = threading.Thread(
                target=server.run,
                kwargs={"sockets": [listener]},
                name="workforce360-portable-api",
                daemon=False,
            )
            backend_thread.start()
            logger.info("Portable backend is bound to reserved port %s", backend_port)

            health_url = f"{backend_url}/api/health"
            page_url = f"http://127.0.0.1:{backend_port}/"
            deadline = time.monotonic() + 40
            while time.monotonic() < deadline:
                if not backend_thread.is_alive():
                    raise RuntimeError("The backend exited before becoming ready. Review the startup output above.")
                if read_http_json(health_url, 1) == {"status": "ok"}:
                    try:
                        with urllib.request.urlopen(page_url, timeout=2) as response:
                            if response.status == 200:
                                break
                    except (OSError, urllib.error.URLError):
                        pass
                time.sleep(0.25)
            else:
                raise RuntimeError("The backend and built frontend did not become ready within 40 seconds.")

            print(f"Portable Workforce360 API and frontend are ready at {application_url}", flush=True)
            if backend_port != PREFERRED_BACKEND_PORT:
                print(f"Preferred port {PREFERRED_BACKEND_PORT} was occupied; using port {backend_port}.", flush=True)
            if not no_browser:
                try:
                    if not webbrowser.open(application_url, new=2):
                        print(f"Could not open the default browser. Open {application_url} manually.", flush=True)
                except Exception as exc:
                    print(f"Could not open the default browser ({exc}). Open {application_url} manually.", flush=True)
            if public_host != "127.0.0.1":
                print(f"Other laptops on the LAN can use {application_url} if TCP {backend_port} is allowed by Windows Firewall.", flush=True)
            write_json_atomic(state_path, state)
            wait_for_console_or_signal(signal_path, state, logger)
            return 0
        finally:
            if server:
                server.should_exit = True
            if backend_thread:
                backend_thread.join(timeout=15)
                if backend_thread.is_alive() and server:
                    server.force_exit = True
                    backend_thread.join(timeout=5)
            if listener:
                listener.close()
            for path in (backend_state_path, signal_path, state_path):
                value = read_json(path)
                if value and value.get("run_id") == run_id:
                    path.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the Workforce360 portable application.")
    parser.add_argument("--stop", action="store_true", help="request graceful shutdown of this portable folder only")
    parser.add_argument("--no-browser", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.stop:
        home = runtime_home()
        requested = request_project_stop(home / "runtime.json", home / "stop.json", ROOT, "portable")
        print("Portable shutdown requested." if requested else "No portable instance is running.")
        return 0
    try:
        return run_portable(no_browser=args.no_browser)
    except Exception as exc:
        print(f"Workforce360 portable startup failed: {exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
