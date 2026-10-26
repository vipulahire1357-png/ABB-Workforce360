"""Project-scoped runtime primitives shared by the source and portable launchers."""

from __future__ import annotations

import json
import os
import socket
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class ProjectLock:
    """An OS file lock whose path is owned by one project runtime directory."""

    def __init__(self, path: Path):
        self.path = Path(path).resolve()
        self._file = None

    def acquire(self) -> "ProjectLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._file = self.path.open("a+b", buffering=0)
        try:
            if os.name == "nt":
                import msvcrt

                self._file.seek(0, os.SEEK_END)
                if self._file.tell() == 0:
                    self._file.write(b"\0")
                self._file.seek(0)
                msvcrt.locking(self._file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(self._file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            self._file.close()
            self._file = None
            raise RuntimeError(f"Another launcher already holds this project lock: {self.path}") from exc
        return self

    def release(self) -> None:
        if self._file is None:
            return
        try:
            if os.name == "nt":
                import msvcrt

                self._file.seek(0)
                msvcrt.locking(self._file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(self._file.fileno(), fcntl.LOCK_UN)
        finally:
            self._file.close()
            self._file = None

    def __enter__(self) -> "ProjectLock":
        return self.acquire()

    def __exit__(self, *_: object) -> None:
        self.release()


def reserve_backend_socket(host: str, preferred_port: int) -> socket.socket:
    """Bind and retain the preferred port, falling back atomically to an OS port."""
    if not 0 <= preferred_port <= 65535:
        raise ValueError("preferred_port must be between 0 and 65535")

    for port in (preferred_port, 0) if preferred_port else (0,):
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            exclusive = getattr(socket, "SO_EXCLUSIVEADDRUSE", None)
            if os.name == "nt" and exclusive is not None:
                listener.setsockopt(socket.SOL_SOCKET, exclusive, 1)
            listener.bind((host, port))
            listener.listen(socket.SOMAXCONN)
            listener.setblocking(False)
            return listener
        except OSError:
            listener.close()
            if port == 0:
                raise

    raise RuntimeError(f"Could not reserve preferred port {preferred_port} or an available fallback port")


def port_of(listener: socket.socket) -> int:
    return int(listener.getsockname()[1])


def write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, path)
    finally:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass


def read_json(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def request_project_stop(state_path: Path, signal_path: Path, expected_root: Path, mode: str) -> bool:
    state = read_json(state_path)
    if not state:
        return False
    if Path(str(state.get("project_root", ""))).resolve() != Path(expected_root).resolve():
        raise RuntimeError("The runtime record belongs to a different project; no stop signal was sent.")
    if state.get("mode") != mode or not state.get("stop_token") or not state.get("run_id"):
        raise RuntimeError("The runtime record is incomplete or belongs to another launcher mode.")
    write_json_atomic(
        signal_path,
        {"run_id": state["run_id"], "stop_token": state["stop_token"], "requested_at": utc_now()},
    )
    return True


def stop_was_requested(signal_path: Path, state: dict[str, Any]) -> bool:
    request = read_json(signal_path)
    return bool(
        request
        and request.get("run_id") == state.get("run_id")
        and request.get("stop_token") == state.get("stop_token")
    )


def process_identity() -> dict[str, Any]:
    return {
        "pid": os.getpid(),
        "executable": str(Path(os.sys.executable).resolve()),
        "started_at": utc_now(),
    }


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def lan_ipv4_address() -> str:
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


def wait_for_console_or_signal(signal_path: Path, state: dict[str, Any], logger: Any) -> None:
    """Wait for Enter or the authenticated, project-local stop request."""
    import threading

    stopped = threading.Event()

    def wait_for_enter() -> None:
        try:
            input("Close the browser when finished, then press Enter here to stop this instance... ")
            stopped.set()
        except (EOFError, OSError):
            stopped.set()

    if sys.stdin is not None and sys.stdin.isatty():
        threading.Thread(target=wait_for_enter, name="launcher-console-input", daemon=True).start()
    while not stopped.wait(0.15):
        if stop_was_requested(signal_path, state):
            logger.info("Received this project's explicit stop request.")
            stopped.set()
