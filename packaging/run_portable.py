from __future__ import annotations

import json
import secrets
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

import uvicorn
from cryptography.fernet import Fernet


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
HOST = "0.0.0.0"
PORT = 8000
HEALTH_URL = f"http://127.0.0.1:{PORT}/api/health"


def ensure_runtime_files() -> None:
    (ROOT / "data" / "uploads" / "workers").mkdir(parents=True, exist_ok=True)
    (ROOT / "data" / "uploads" / "visitors").mkdir(parents=True, exist_ok=True)
    if (ROOT / ".env").exists():
        return

    values = {
        "WIR_SESSION_SECRET": secrets.token_urlsafe(48),
        "WIR_CSRF_SECRET": secrets.token_urlsafe(48),
        "WIR_WORKER_ID_SECRET": secrets.token_urlsafe(48),
        "WIR_VISITOR_ID_SECRET": secrets.token_urlsafe(48),
        "WIR_AADHAAR_ENCRYPTION_KEY": Fernet.generate_key().decode("ascii"),
    }
    contents = "".join(f"{name}={value}\n" for name, value in values.items())
    env_path = ROOT / ".env"
    try:
        with env_path.open("x", encoding="ascii", newline="\n") as env_file:
            env_file.write(contents)
    except FileExistsError:
        # A concurrent launcher created the first-run secrets; never overwrite them.
        pass


def lan_address() -> str:
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("192.0.0.1", 80))
        address = probe.getsockname()[0]
        if address and not address.startswith("169.254."):
            return address
    except OSError:
        pass
    finally:
        probe.close()
    return "127.0.0.1"


def health_is_ready() -> bool:
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=2) as response:
            return response.status == 200 and json.loads(response.read()).get("status") == "ok"
    except (OSError, urllib.error.URLError):
        return False


def check_port_available() -> None:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        probe.bind((HOST, PORT))
    except OSError as exc:
        raise RuntimeError(
            f"Port {PORT} is already in use. Close the other server or configure it to use another port. "
            "Workforce360 did not stop or modify that process."
        ) from exc
    finally:
        probe.close()


def main() -> int:
    ensure_runtime_files()
    check_port_available()

    server = uvicorn.Server(
        uvicorn.Config(
            "backend.main:app",
            host=HOST,
            port=PORT,
            log_level="info",
            access_log=False,
        )
    )
    backend_thread = threading.Thread(target=server.run, name="workforce360-backend", daemon=False)
    backend_thread.start()
    url = f"http://{lan_address()}:{PORT}"

    try:
        print("Starting ABB Workforce360. Waiting for the backend health check...", flush=True)
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            if not backend_thread.is_alive():
                raise RuntimeError("The backend exited before becoming ready. Review the startup error above.")
            if health_is_ready():
                break
            time.sleep(0.5)
        else:
            raise RuntimeError("The backend did not become healthy within 40 seconds. Review the startup output above.")

        print(f"Workforce360 is ready at {url}", flush=True)
        print("Opening the default browser. Keep this console open while the app is in use.", flush=True)
        try:
            if not webbrowser.open(url, new=2):
                print(f"Windows could not open the default browser. Open {url} manually.", file=sys.stderr, flush=True)
        except Exception as exc:
            print(f"Windows could not open the default browser ({exc}). Open {url} manually.", file=sys.stderr, flush=True)
        if url.startswith("http://127.0.0.1"):
            print("No LAN address was detected; other laptops will need the server's reachable LAN IP.", flush=True)
        else:
            print(f"Other laptops on the same network can use {url} if Windows Firewall allows TCP {PORT}.", flush=True)
        input("Close the browser when finished, then press Enter here to stop Workforce360 cleanly... ")
        return 0
    except KeyboardInterrupt:
        print("\nStopping Workforce360...", flush=True)
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        return 1
    finally:
        server.should_exit = True
        backend_thread.join(timeout=15)
        if backend_thread.is_alive():
            server.force_exit = True
            backend_thread.join(timeout=5)
        if backend_thread.is_alive():
            print("ERROR: Backend did not stop within the shutdown timeout.", file=sys.stderr, flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
