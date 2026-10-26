"""Run the source checkout's API and Vite UI as one project-scoped instance."""

from __future__ import annotations

import argparse
import json
import logging
import os
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import uvicorn

from backend.launcher_runtime import (
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


ROOT = Path(__file__).resolve().parents[1]
PREFERRED_BACKEND_PORT = 8000
PREFERRED_FRONTEND_PORT = 5173


def _runtime_home() -> Path:
    value = os.environ.get("WIR_RUNTIME_HOME")
    return Path(value).resolve() if value else ROOT / "data" / "run" / "development"


def _http_json(url: str, timeout: float = 2) -> dict[str, Any] | None:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            if response.status != 200:
                return None
            value = json.loads(response.read())
            return value if isinstance(value, dict) else None
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        return None


def _http_text(url: str, timeout: float = 3) -> tuple[int, str] | None:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", errors="replace")
    except (OSError, urllib.error.URLError):
        return None


def _configure_logging(log_path: Path) -> logging.Logger:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[logging.StreamHandler(sys.stdout), logging.FileHandler(log_path, encoding="utf-8")],
        force=True,
    )
    return logging.getLogger("workforce360.development")


def _stream_frontend(process: subprocess.Popen[str], logger: logging.Logger) -> None:
    assert process.stdout is not None
    for line in process.stdout:
        logger.info("[vite] %s", line.rstrip())


def _start_frontend(
    node: str,
    runtime_home: Path,
    run_id: str,
    backend_state_path: Path,
    frontend_state_path: Path,
    logger: logging.Logger,
) -> subprocess.Popen[str]:
    frontend_root = ROOT / "frontend"
    dependencies = frontend_root / "node_modules" / "vite"
    if not dependencies.exists():
        raise RuntimeError(f"Frontend dependencies are missing at {frontend_root / 'node_modules'}. Run npm ci in frontend first.")

    branding = subprocess.run(
        [node, str(frontend_root / "scripts" / "copy-branding.mjs")],
        cwd=frontend_root,
        check=False,
        capture_output=True,
        text=True,
    )
    if branding.returncode:
        raise RuntimeError(f"Could not prepare frontend branding: {branding.stderr.strip() or branding.stdout.strip()}")

    environment = os.environ.copy()
    environment.update(
        {
            "WIR_PROJECT_ROOT": str(ROOT),
            "WIR_RUNTIME_HOME": str(runtime_home),
            "WIR_RUN_ID": run_id,
            "WIR_BACKEND_STATE_PATH": str(backend_state_path),
            "WIR_FRONTEND_STATE_PATH": str(frontend_state_path),
            "WIR_FRONTEND_PREFERRED_PORT": str(PREFERRED_FRONTEND_PORT),
        }
    )
    process = subprocess.Popen(
        [node, str(frontend_root / "scripts" / "dev-server.mjs")],
        cwd=frontend_root,
        env=environment,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    threading.Thread(target=_stream_frontend, args=(process, logger), name="vite-log-forwarder", daemon=True).start()
    return process


def _wait_for_ready(
    backend_thread: threading.Thread,
    frontend: subprocess.Popen[str],
    backend_url: str,
    frontend_state_path: Path,
    run_id: str,
    timeout: float = 45,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    health_url = f"{backend_url}/api/health"
    while time.monotonic() < deadline:
        if not backend_thread.is_alive():
            raise RuntimeError("FastAPI exited before becoming healthy. Check the startup error above.")
        if frontend.poll() is not None:
            raise RuntimeError(f"Vite exited during startup with code {frontend.returncode}. Check the frontend log above.")
        if _http_json(health_url, 1) == {"status": "ok"}:
            state = read_json(frontend_state_path)
            if state and state.get("run_id") == run_id:
                url = str(state.get("frontend_url", ""))
                page = _http_text(url, 2) if url else None
                proxy_health = _http_json(f"{url}/api/health", 2) if url else None
                if page and page[0] == 200 and proxy_health == {"status": "ok"}:
                    return state
        time.sleep(0.25)
    raise RuntimeError("Backend and Vite did not both become ready within 45 seconds.")


def _clean_owned_file(path: Path, run_id: str) -> None:
    value = read_json(path)
    if value and value.get("run_id") == run_id:
        path.unlink(missing_ok=True)


def _stop_frontend(process: subprocess.Popen[str] | None, logger: logging.Logger) -> None:
    if not process or process.poll() is not None:
        return
    try:
        if process.stdin:
            process.stdin.write("STOP\n")
            process.stdin.flush()
        process.wait(timeout=12)
    except (OSError, subprocess.TimeoutExpired):
        logger.warning("Vite did not exit gracefully; stopping only its owned process %s", process.pid)
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def run_development(no_browser: bool = False) -> int:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js was not found. Install the project-supported Node.js release and reopen PowerShell.")

    runtime_home = _runtime_home()
    runtime_home.mkdir(parents=True, exist_ok=True)
    state_path = runtime_home / "runtime.json"
    backend_state_path = runtime_home / "backend.json"
    frontend_state_path = runtime_home / "frontend.json"
    signal_path = runtime_home / "stop.json"
    logger = _configure_logging(runtime_home / "development.log")
    listener: socket.socket | None = None
    server_thread: threading.Thread | None = None
    frontend: subprocess.Popen[str] | None = None
    server: uvicorn.Server | None = None
    run_id = secrets.token_urlsafe(24)

    with ProjectLock(runtime_home / "launcher.lock"):
        for path in (state_path, backend_state_path, frontend_state_path, signal_path):
            path.unlink(missing_ok=True)
        try:
            listener = reserve_backend_socket("0.0.0.0", PREFERRED_BACKEND_PORT)
            backend_port = port_of(listener)
            backend_url = f"http://127.0.0.1:{backend_port}"
            public_host = lan_ipv4_address()
            state: dict[str, Any] = {
                "mode": "development",
                "project_root": str(ROOT),
                "runtime_home": str(runtime_home),
                "run_id": run_id,
                "stop_token": secrets.token_urlsafe(24),
                "preferred_backend_port": PREFERRED_BACKEND_PORT,
                "backend_port": backend_port,
                "backend_url": backend_url,
                "backend_process": process_identity(),
            }
            write_json_atomic(backend_state_path, {**state, "frontend_url": None})
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
            server_thread = threading.Thread(
                target=server.run,
                kwargs={"sockets": [listener]},
                name="workforce360-development-api",
                daemon=False,
            )
            server_thread.start()
            logger.info("Development backend is bound to reserved port %s", backend_port)
            if not _wait_for_health_thread(server_thread, backend_url, 40):
                raise RuntimeError("FastAPI did not pass /api/health within 40 seconds.")

            frontend = _start_frontend(node, runtime_home, run_id, backend_state_path, frontend_state_path, logger)
            frontend_state = _wait_for_ready(server_thread, frontend, backend_url, frontend_state_path, run_id)
            frontend_port = int(frontend_state["frontend_port"])
            frontend_local_url = str(frontend_state["frontend_url"])
            application_url = f"http://{public_host}:{frontend_port}"
            state.update(
                {
                    "frontend_port": frontend_port,
                    "frontend_local_url": frontend_local_url,
                    "frontend_url": application_url,
                    "application_url": application_url,
                    "frontend_process": frontend_state.get("process"),
                }
            )
            write_json_atomic(state_path, state)

            print(f"Development API: {backend_url} (LAN port {backend_port})", flush=True)
            print(f"Development frontend: {application_url}", flush=True)
            print("This development instance has its own runtime state, lock and data root.", flush=True)
            if not no_browser:
                import webbrowser

                try:
                    if not webbrowser.open(application_url, new=2):
                        print(f"Could not open the browser automatically. Open {application_url} manually.", flush=True)
                except Exception as exc:
                    print(f"Could not open the browser automatically ({exc}). Open {application_url} manually.", flush=True)
            wait_for_console_or_signal(signal_path, state, logger)
            return 0
        finally:
            if frontend:
                _stop_frontend(frontend, logger)
            if server:
                server.should_exit = True
            if server_thread:
                server_thread.join(timeout=15)
                if server_thread.is_alive() and server:
                    server.force_exit = True
                    server_thread.join(timeout=5)
            if listener:
                listener.close()
            for path in (frontend_state_path, backend_state_path, signal_path):
                _clean_owned_file(path, run_id)
            _clean_owned_file(state_path, run_id)


def _wait_for_health_thread(thread: threading.Thread, backend_url: str, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not thread.is_alive():
            return False
        if _http_json(f"{backend_url}/api/health", 1) == {"status": "ok"}:
            return True
        time.sleep(0.25)
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the Workforce360 source development app.")
    parser.add_argument("--stop", action="store_true", help="request graceful shutdown of this source checkout only")
    parser.add_argument("--no-browser", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.stop:
        runtime_home = _runtime_home()
        requested = request_project_stop(
            runtime_home / "runtime.json", runtime_home / "stop.json", ROOT, "development"
        )
        print("Development shutdown requested." if requested else "No development instance is running.")
        return 0
    try:
        return run_development(no_browser=args.no_browser)
    except Exception as exc:
        print(f"Workforce360 development startup failed: {exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
