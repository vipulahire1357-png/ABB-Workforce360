from __future__ import annotations

import socket
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import pytest

from backend.launcher_runtime import (
    ProjectLock,
    port_of,
    read_json,
    request_project_stop,
    reserve_backend_socket,
    stop_was_requested,
    write_json_atomic,
)


def _unused_local_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def test_preferred_port_is_reserved_when_available() -> None:
    preferred = _unused_local_port()
    listener = reserve_backend_socket("127.0.0.1", preferred)
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        assert port_of(listener) == preferred
        with pytest.raises(OSError):
            probe.bind(("127.0.0.1", preferred))
    finally:
        probe.close()
        listener.close()


def test_occupied_preferred_port_falls_back_without_releasing_reservation() -> None:
    occupied = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    occupied.bind(("127.0.0.1", 0))
    occupied.listen()
    preferred = port_of(occupied)
    fallback = reserve_backend_socket("127.0.0.1", preferred)
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        assert port_of(fallback) != preferred
        assert fallback.getsockname()[1] > 0
        with pytest.raises(OSError):
            probe.bind(("127.0.0.1", fallback.getsockname()[1]))
    finally:
        probe.close()
        fallback.close()
        occupied.close()


def test_development_and_portable_projects_hold_independent_locks(tmp_path: Path) -> None:
    development_lock = ProjectLock(tmp_path / "development" / "data" / "run" / "launcher.lock")
    portable_lock = ProjectLock(tmp_path / "portable" / "data" / "run" / "launcher.lock")
    with development_lock:
        with portable_lock:
            assert development_lock.path != portable_lock.path


def test_simultaneous_startups_receive_distinct_reserved_ports() -> None:
    blocker = reserve_backend_socket("127.0.0.1", 0)
    preferred = port_of(blocker)
    barrier = Barrier(2)

    def start() -> socket.socket:
        barrier.wait(timeout=5)
        return reserve_backend_socket("127.0.0.1", preferred)

    with ThreadPoolExecutor(max_workers=2) as executor:
        first_future = executor.submit(start)
        second_future = executor.submit(start)
        first = first_future.result(timeout=5)
        second = second_future.result(timeout=5)
    try:
        assert port_of(first) != port_of(second)
        assert port_of(first) != preferred
        assert port_of(second) != preferred
    finally:
        first.close()
        second.close()
        blocker.close()


def test_stop_signal_is_bound_to_runtime_identity_and_project(tmp_path: Path) -> None:
    development_root = tmp_path / "development"
    portable_root = tmp_path / "portable"
    development_state_path = development_root / "data" / "run" / "development" / "runtime.json"
    portable_state_path = portable_root / "data" / "run" / "portable" / "runtime.json"
    development_signal = development_state_path.with_name("stop.json")
    portable_signal = portable_state_path.with_name("stop.json")
    write_json_atomic(
        development_state_path,
        {"mode": "development", "project_root": str(development_root), "run_id": "dev", "stop_token": "dev-token"},
    )
    write_json_atomic(
        portable_state_path,
        {"mode": "portable", "project_root": str(portable_root), "run_id": "port", "stop_token": "port-token"},
    )

    assert request_project_stop(development_state_path, development_signal, development_root, "development")
    assert stop_was_requested(development_signal, read_json(development_state_path) or {})
    assert not portable_signal.exists()
    with pytest.raises(RuntimeError, match="different project"):
        request_project_stop(development_state_path, portable_signal, portable_root, "portable")
