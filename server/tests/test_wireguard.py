import os
import time
import uuid
from types import SimpleNamespace

from app.wireguard_tunnel import (
    latest_handshakes,
    new_preshared_key,
    read_preshared_key,
    remove_preshared_key,
    rewrite_peers,
)


class _FakeSession:
    def __init__(self, monitors):
        self._monitors = monitors

    def scalars(self, _query):
        return SimpleNamespace(all=lambda: self._monitors)


def test_preshared_key_file_is_private_and_removable(state_dir):
    monitor_id = uuid.uuid4()
    key = new_preshared_key(monitor_id)
    path = state_dir / "psk" / f"{monitor_id}.key"
    assert path.is_file()
    assert os.stat(path).st_mode & 0o777 == 0o600
    assert read_preshared_key(monitor_id) == key
    remove_preshared_key(monitor_id)
    assert not path.exists()


def test_peer_file_carries_the_preshared_key(state_dir):
    enrolled = SimpleNamespace(
        id=uuid.uuid4(), wg_public_key="A" * 43 + "=", wg_address="10.7.0.5", identity_public_key="I" * 43 + "="
    )
    missing_key = SimpleNamespace(
        id=uuid.uuid4(), wg_public_key="B" * 43 + "=", wg_address="10.7.0.6", identity_public_key="J" * 43 + "="
    )
    legacy = SimpleNamespace(id=uuid.uuid4(), wg_public_key="C" * 43 + "=", wg_address="10.7.0.7", identity_public_key=None)
    preshared = new_preshared_key(enrolled.id)
    rewrite_peers(_FakeSession([enrolled, missing_key, legacy]))
    peers = (state_dir / "peers.conf").read_text()
    assert f"PresharedKey = {preshared}" in peers
    assert "AllowedIPs = 10.7.0.5/32" in peers
    assert "10.7.0.6" not in peers
    assert "AllowedIPs = 10.7.0.7/32" in peers
    assert os.stat(state_dir / "peers.conf").st_mode & 0o777 == 0o600


def test_handshake_file_skips_peers_that_never_connected(state_dir):
    now = int(time.time())
    (state_dir / "handshakes").write_text(f"AAA=\t{now}\nBBB=\t0\nnot a line\n")
    seen = latest_handshakes()
    assert set(seen) == {"AAA="}
    assert int(seen["AAA="].timestamp()) == now
