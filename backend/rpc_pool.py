"""
RPC Session Pool
================
Persistent keep-alive connection pool for Dahua/Hikvision camera RPC2
endpoints.  A background heartbeat thread verifies each cached session
every 30 s and re-authenticates transparently on failure.

This completely removes session-negotiation latency from the PTZ
tracking hot-path.
"""

import threading
import time
import hashlib
import requests


def _md5(s):
    """MD5 hex-digest (uppercase) — required by the Dahua RPC auth protocol."""
    return hashlib.md5(s.encode("utf-8")).hexdigest().upper()


class RPCSessionPool:
    """Thread-safe pool of authenticated camera RPC sessions."""

    def __init__(self, get_config_fn, heartbeat_interval=30):
        """
        Args:
            get_config_fn:      callable(device_id) → config dict or None
            heartbeat_interval: seconds between background heartbeat pings
        """
        self._get_config = get_config_fn
        self._heartbeat_interval = heartbeat_interval

        self._sessions = {}           # device_id → session_id
        self._lock = threading.Lock()
        self._running = True

        self._hb_thread = threading.Thread(
            target=self._heartbeat_worker, daemon=True, name="RPC-Heartbeat"
        )
        self._hb_thread.start()
        print(f"[RPC Pool] Ready, heartbeat every {heartbeat_interval}s")

    # ── authentication ─────────────────────────────────────────────────────

    def _authenticate(self, device_id):
        """Two-phase MD5 auth against RPC2_Login.  Returns session_id or None."""
        c = self._get_config(device_id)
        if not c or not c.get("ip") or not c.get("username") or not c.get("password"):
            return None

        url = f"http://{c['ip']}:{c.get('http_port', 80)}/RPC2_Login"

        try:
            # Phase 1 — request challenge
            r1 = requests.post(url, json={
                "method": "global.login",
                "params": {"userName": c["username"],
                           "password": c["password"],
                           "clientType": "Web3.0"},
                "id": 1, "session": 0,
            }, timeout=3).json()

            if "params" not in r1 or "random" not in r1["params"]:
                return None

            session    = r1["session"]
            realm      = r1["params"]["realm"]
            random_str = r1["params"]["random"]

            # Phase 2 — respond with hashed credentials
            h1 = _md5(f"{c['username']}:{realm}:{c['password']}")
            h2 = _md5(f"{c['username']}:{random_str}:{h1}")

            r2 = requests.post(url, json={
                "method": "global.login",
                "params": {"userName": c["username"],
                           "password": h2,
                           "clientType": "Web3.0"},
                "id": 2, "session": session,
            }, timeout=3).json()

            if r2.get("result"):
                return r2["session"]
        except Exception as e:
            print(f"[RPC Pool] Auth error ({device_id}): {e}")
        return None

    # ── public API ─────────────────────────────────────────────────────────

    def get_session(self, device_id):
        """Return a cached session, or authenticate on-demand. Never blocks long."""
        with self._lock:
            sid = self._sessions.get(device_id)
        if sid is not None:
            return sid

        sid = self._authenticate(device_id)
        if sid is not None:
            with self._lock:
                self._sessions[device_id] = sid
        return sid

    def invalidate(self, device_id):
        """Drop a cached session (e.g. after an RPC error response)."""
        with self._lock:
            self._sessions.pop(device_id, None)

    def send_rpc(self, device_id, method, params, object_id=None):
        """
        Send an RPC command with automatic session management and one retry.

        Returns:  {"status": "ok", "response": …}  or  {"error": "…"}
        """
        c = self._get_config(device_id)
        if not c or not c.get("ip"):
            return {"error": "No camera configured"}

        session = self.get_session(device_id)
        if not session:
            return {"error": "Failed to get session"}

        url = f"http://{c['ip']}:{c.get('http_port', 80)}/RPC2"
        payload = {"method": method, "params": params,
                   "id": 388, "session": session}
        if object_id is not None:
            payload["object"] = object_id

        try:
            res = requests.post(url, json=payload, timeout=3).json()
            if res.get("error"):
                # Re-auth once and retry
                self.invalidate(device_id)
                session = self.get_session(device_id)
                if session:
                    payload["session"] = session
                    res = requests.post(url, json=payload, timeout=3).json()
            return {"status": "ok", "response": res}
        except Exception as e:
            self.invalidate(device_id)
            return {"error": str(e)}

    # ── heartbeat ──────────────────────────────────────────────────────────

    def _heartbeat_worker(self):
        """Periodically pings every cached session; re-authenticates on failure."""
        while self._running:
            time.sleep(self._heartbeat_interval)
            with self._lock:
                device_ids = list(self._sessions.keys())

            for did in device_ids:
                c = self._get_config(did)
                if not c or not c.get("ip"):
                    continue

                with self._lock:
                    session = self._sessions.get(did)
                if session is None:
                    continue

                # Lightweight RPC keepalive
                url = f"http://{c['ip']}:{c.get('http_port', 80)}/RPC2"
                try:
                    r = requests.post(url, json={
                        "method": "magicBox.getDeviceType",
                        "params": None, "id": 1, "session": session,
                    }, timeout=3).json()
                    if r.get("error"):
                        raise RuntimeError("stale session")
                except Exception:
                    print(f"[RPC Pool] Heartbeat failed for {did}, re-authenticating…")
                    self.invalidate(did)
                    new_sid = self._authenticate(did)
                    if new_sid:
                        with self._lock:
                            self._sessions[did] = new_sid

    def shutdown(self):
        self._running = False
