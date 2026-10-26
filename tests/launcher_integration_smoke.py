"""Run source and packaged Workforce360 together and verify isolated UI/API paths."""

from __future__ import annotations

import argparse
import json
import os
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from cryptography.fernet import Fernet


def _get_json(url: str, timeout: float = 2) -> dict | None:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            if response.status != 200:
                return None
            value = json.loads(response.read())
            return value if isinstance(value, dict) else None
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        return None


def _get_page(url: str, timeout: float = 3) -> str | None:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            if response.status != 200:
                return None
            return response.read().decode("utf-8", errors="replace")
    except (OSError, urllib.error.URLError):
        return None


def _wait_for_state(path: Path, process: subprocess.Popen[bytes], timeout: float) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Launcher exited with {process.returncode}; inspect its smoke log.")
        try:
            state = json.loads(path.read_text(encoding="utf-8"))
            if state.get("frontend_url") and state.get("backend_url"):
                if _get_json(f"{state['backend_url']}/api/health") == {"status": "ok"}:
                    page = _get_page(state["frontend_local_url"] if state.get("frontend_local_url") else state["frontend_url"])
                    if page and "<title>ABB Workforce360</title>" in page:
                        return state
        except (OSError, json.JSONDecodeError):
            pass
        time.sleep(0.25)
    raise RuntimeError(f"Timed out waiting for launcher state {path}.")


def _temporary_environment(base: dict[str, str], root: Path, mode: str) -> dict[str, str]:
    home = root / mode
    home.mkdir(parents=True, exist_ok=True)
    env = base.copy()
    env.update(
        {
            "WIR_RUNTIME_HOME": str(home / "runtime"),
            "WIR_DATABASE_URL": f"sqlite:///{(home / 'wir.sqlite3').as_posix()}",
            "WIR_UPLOAD_DIR": str(home / "uploads" / "workers"),
            "WIR_VISITOR_UPLOAD_DIR": str(home / "uploads" / "visitors"),
            "WIR_SESSION_SECRET": secrets.token_urlsafe(48),
            "WIR_CSRF_SECRET": secrets.token_urlsafe(48),
            "WIR_WORKER_ID_SECRET": secrets.token_urlsafe(48),
            "WIR_VISITOR_ID_SECRET": secrets.token_urlsafe(48),
            "WIR_AADHAAR_ENCRYPTION_KEY": Fernet.generate_key().decode("ascii"),
            "WIR_COOKIE_SECURE": "false",
        }
    )
    return env


def _stop(process: subprocess.Popen[bytes] | None, label: str, log_path: Path) -> None:
    if not process:
        return
    try:
        if process.poll() is None:
            if process.stdin:
                process.stdin.write(b"\n")
                process.stdin.flush()
            process.wait(timeout=20)
        if process.returncode:
            raise RuntimeError(f"{label} exited with {process.returncode}. Log: {log_path}")
    except (OSError, subprocess.TimeoutExpired):
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        raise RuntimeError(f"{label} did not shut down cleanly. Log: {log_path}")


def _request_stop(command: list[str], root: Path, environment: dict[str, str], label: str) -> None:
    result = subprocess.run(command, cwd=root, env=environment, capture_output=True, text=True, timeout=10)
    if result.returncode:
        raise RuntimeError(f"{label} stop request failed: {result.stdout}{result.stderr}")


def run(source_root: Path, portable_root: Path, dev_python: Path, portable_python: Path, timeout: float) -> None:
    source_root = source_root.resolve()
    portable_root = portable_root.resolve()
    if source_root == portable_root:
        raise RuntimeError("Development and portable launchers must use distinct code roots.")
    if not (source_root / "frontend" / "node_modules" / "vite").exists():
        raise RuntimeError("Install frontend dependencies with npm ci before running the two-variant smoke test.")
    if not (portable_root / "frontend" / "dist" / "index.html").exists():
        raise RuntimeError("The portable smoke folder is missing frontend/dist/index.html.")

    development_process = portable_process = None
    with tempfile.TemporaryDirectory(prefix="workforce360-launcher-smoke-") as temporary:
        test_root = Path(temporary)
        dev_log = test_root / "development.log"
        portable_log = test_root / "portable.log"
        dev_state_path = test_root / "development" / "runtime" / "runtime.json"
        portable_state_path = test_root / "portable" / "runtime" / "runtime.json"
        base_env = os.environ.copy()
        base_env["PYTHONDONTWRITEBYTECODE"] = "1"
        dev_env = _temporary_environment(base_env, test_root, "development")
        portable_env = _temporary_environment(base_env, test_root, "portable")

        with dev_log.open("wb") as dev_output, portable_log.open("wb") as portable_output:
            try:
                development_process = subprocess.Popen(
                    [str(dev_python), "-m", "backend.dev_server", "--no-browser"],
                    cwd=source_root,
                    env=dev_env,
                    stdin=subprocess.PIPE,
                    stdout=dev_output,
                    stderr=subprocess.STDOUT,
                )
                dev_backend_state = test_root / "development" / "runtime" / "backend.json"
                deadline = time.monotonic() + timeout
                while time.monotonic() < deadline and not dev_backend_state.exists():
                    if development_process.poll() is not None:
                        raise RuntimeError(f"Development launcher exited early. Log: {dev_log}")
                    time.sleep(0.1)
                if not dev_backend_state.exists():
                    raise RuntimeError(f"Development backend did not reserve a port. Log: {dev_log}")

                portable_process = subprocess.Popen(
                    [str(portable_python), str(portable_root / "packaging" / "run_portable.py"), "--no-browser"],
                    cwd=portable_root,
                    env=portable_env,
                    stdin=subprocess.PIPE,
                    stdout=portable_output,
                    stderr=subprocess.STDOUT,
                )
                dev_state = _wait_for_state(dev_state_path, development_process, timeout)
                portable_state = _wait_for_state(portable_state_path, portable_process, timeout)

                if dev_state["project_root"] != str(source_root):
                    raise RuntimeError("Development runtime state points outside the source checkout.")
                if portable_state["project_root"] != str(portable_root):
                    raise RuntimeError("Portable runtime state points outside the portable package.")
                if dev_state["runtime_home"] == portable_state["runtime_home"]:
                    raise RuntimeError("The two variants unexpectedly share a runtime state root.")
                if dev_state["backend_port"] == portable_state["backend_port"]:
                    raise RuntimeError("The two backend listeners unexpectedly share a port.")

                dev_url = str(dev_state["frontend_local_url"])
                portable_url = str(portable_state["application_url"])
                dev_page = _get_page(dev_url)
                portable_page = _get_page(portable_url)
                if not dev_page or "@vite/client" not in dev_page:
                    raise RuntimeError(f"Development Vite page did not respond as a development frontend: {dev_url}")
                if not portable_page or "@vite/client" in portable_page:
                    raise RuntimeError(f"Portable built frontend did not respond as a production page: {portable_url}")
                if _get_json(f"{dev_url}/api/health") != {"status": "ok"}:
                    raise RuntimeError("Development frontend proxy did not reach its own backend health endpoint.")
                if _get_json(f"{portable_url}/api/health") != {"status": "ok"}:
                    raise RuntimeError("Portable frontend did not reach its own backend health endpoint.")
                print(
                    "Both Workforce360 variants ran together: "
                    f"development={dev_url} (API {dev_state['backend_url']}), "
                    f"portable={portable_url} (API {portable_state['backend_url']})."
                )

                _request_stop(
                    [str(dev_python), "-m", "backend.dev_server", "--stop"],
                    source_root,
                    dev_env,
                    "Development",
                )
                development_process.wait(timeout=25)
                if development_process.returncode:
                    raise RuntimeError(f"Development launcher exited with {development_process.returncode}. Log: {dev_log}")
                if _get_json(f"{dev_state['backend_url']}/api/health") is not None:
                    raise RuntimeError("The development API was still responding after its project stop request.")
                if _get_json(f"{portable_state['backend_url']}/api/health") != {"status": "ok"}:
                    raise RuntimeError("Stopping development affected the portable API.")

                _request_stop(
                    [str(portable_python), str(portable_root / "packaging" / "run_portable.py"), "--stop"],
                    portable_root,
                    portable_env,
                    "Portable",
                )
                portable_process.wait(timeout=25)
                if portable_process.returncode:
                    raise RuntimeError(f"Portable launcher exited with {portable_process.returncode}. Log: {portable_log}")
                if _get_json(f"{portable_state['backend_url']}/api/health") is not None:
                    raise RuntimeError("The portable API was still responding after its project stop request.")
            finally:
                failures = []
                for process, label, log_path in (
                    (portable_process, "Portable launcher", portable_log),
                    (development_process, "Development launcher", dev_log),
                ):
                    try:
                        _stop(process, label, log_path)
                    except Exception as exc:
                        failures.append(str(exc))
                if failures:
                    raise RuntimeError("; ".join(failures))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--portable-root", type=Path, required=True)
    parser.add_argument("--dev-python", type=Path, default=Path(sys.executable))
    parser.add_argument("--portable-python", type=Path, required=True)
    parser.add_argument("--timeout", type=float, default=70)
    args = parser.parse_args()
    run(args.source_root, args.portable_root, args.dev_python, args.portable_python, args.timeout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
