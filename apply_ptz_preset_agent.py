"""
PTZ Preset Replication Agent
============================
Automated script for AI Agents or Developers to port Dahua PTZ preset control 
(SetPreset, GotoPreset, ClearPreset) into any secondary target codebase.

Usage:
    python apply_ptz_preset_agent.py --target-dir /path/to/other/codebase
"""

import os
import sys
import argparse

RPC_POOL_CODE = '''"""
Persistent RPC Session Pool for Dahua/Hikvision PTZ Cameras
"""
import threading
import time
import hashlib
import requests

def _md5(s):
    return hashlib.md5(s.encode("utf-8")).hexdigest().upper()

class RPCSessionPool:
    def __init__(self, get_config_fn, heartbeat_interval=30):
        self._get_config = get_config_fn
        self._heartbeat_interval = heartbeat_interval
        self._sessions = {}
        self._lock = threading.Lock()
        self._running = True
        self._hb_thread = threading.Thread(target=self._heartbeat_worker, daemon=True)
        self._hb_thread.start()

    def _authenticate(self, device_id):
        c = self._get_config(device_id)
        if not c or not c.get("ip") or not c.get("username") or not c.get("password"):
            return None
        url = f"http://{c['ip']}:{c.get('http_port', 80)}/RPC2_Login"
        try:
            r1 = requests.post(url, json={
                "method": "global.login",
                "params": {"userName": c["username"], "password": c["password"], "clientType": "Web3.0"},
                "id": 1, "session": 0
            }, timeout=3).json()
            if "params" not in r1 or "random" not in r1["params"]:
                return None
            session, realm, random_str = r1["session"], r1["params"]["realm"], r1["params"]["random"]
            h1 = _md5(f"{c['username']}:{realm}:{c['password']}")
            h2 = _md5(f"{c['username']}:{random_str}:{h1}")
            r2 = requests.post(url, json={
                "method": "global.login",
                "params": {"userName": c["username"], "password": h2, "clientType": "Web3.0"},
                "id": 2, "session": session
            }, timeout=3).json()
            if r2.get("result"):
                return r2["session"]
        except Exception as e:
            print(f"[RPC Pool Error] {device_id}: {e}")
        return None

    def get_session(self, device_id):
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
        with self._lock:
            self._sessions.pop(device_id, None)

    def send_rpc(self, device_id, method, params, object_id=1):
        c = self._get_config(device_id)
        if not c or not c.get("ip"):
            return {"error": "No camera configured"}
        session = self.get_session(device_id)
        if not session:
            return {"error": "Failed to get session"}
        url = f"http://{c['ip']}:{c.get('http_port', 80)}/RPC2"
        payload = {"method": method, "params": params, "id": 388, "session": session}
        if object_id is not None:
            payload["object"] = object_id
        try:
            res = requests.post(url, json=payload, timeout=3).json()
            if res.get("error"):
                self.invalidate(device_id)
                session = self.get_session(device_id)
                if session:
                    payload["session"] = session
                    res = requests.post(url, json=payload, timeout=3).json()
            return {"status": "ok", "response": res}
        except Exception as e:
            self.invalidate(device_id)
            return {"error": str(e)}

    def _heartbeat_worker(self):
        while self._running:
            time.sleep(self._heartbeat_interval)
            with self._lock:
                dids = list(self._sessions.keys())
            for did in dids:
                c = self._get_config(did)
                if not c or not c.get("ip"): continue
                with self._lock: session = self._sessions.get(did)
                if not session: continue
                url = f"http://{c['ip']}:{c.get('http_port', 80)}/RPC2"
                try:
                    r = requests.post(url, json={"method": "magicBox.getDeviceType", "params": None, "id": 1, "session": session}, timeout=3).json()
                    if r.get("error"): raise RuntimeError()
                except Exception:
                    self.invalidate(did)
                    nsid = self._authenticate(did)
                    if nsid:
                        with self._lock: self._sessions[did] = nsid
'''

PTZ_DISPATCHER_CODE = '''"""
PTZ Command Formatter & Dispatcher (Presets + Movement)
"""

def ptz_control(device_id, action, code, speed=5, rpc_pool=None, get_config=None):
    """
    Translates high-level PTZ actions (SetPreset, GotoPreset, Left, Right, etc.) 
    into standard Dahua RPC parameter schema.
    
    For Preset codes ('GotoPreset', 'SetPreset', 'ClearPreset'):
      • arg1 = preset index (N)
      • arg2, arg3, arg4 = 0
    """
    c = get_config(device_id)
    if not c or not c.get("ip"):
        return {"error": "No camera configured"}

    if code in ("GotoPreset", "SetPreset", "ClearPreset"):
        params = {
            "code": code,
            "arg1": int(speed),  # Preset index N
            "arg2": 0,
            "arg3": 0,
            "arg4": 0,
        }
    else:
        params = {
            "code": code,
            "arg1": int(speed),
            "arg2": int(speed),
            "arg3": 0,
            "arg4": 0,
        }
    return rpc_pool.send_rpc(device_id, f"ptz.{action}", params, object_id=c.get("channel", 1))
'''

FLASK_ROUTE_SNIPPET = '''# Flask API Route for PTZ Controls (including Presets)
@app.route("/ptz/<device_id>")
def ptz_route(device_id):
    action = request.args.get("action", "start")
    code   = request.args.get("code", "Up")
    speed  = int(request.args.get("speed", 5)) # Carries Preset N for preset codes
    if code == "Stop":
        res = ptz_control(device_id, "stop", "Up", rpc_pool=rpc_pool, get_config=get_device_config)
    else:
        res = ptz_control(device_id, action, code, speed, rpc_pool=rpc_pool, get_config=get_device_config)
    return jsonify(res)
'''

REACT_SNIPPET = '''// React PTZ Preset Quick-Bar Hook & UI Handler
const [showPresets, setShowPresets] = useState(false);
const [activePreset, setActivePreset] = useState(null);
const [isSettingPreset, setIsSettingPreset] = useState(false);

const gotoPreset = async (n) => {
  if (isSettingPreset) {
    setPreset(n);
    return;
  }
  setActivePreset(n);
  try { await fetch(`${API}/ptz/${device.id}?action=start&code=GotoPreset&speed=${n}`); } catch {}
  setTimeout(() => setActivePreset(null), 800);
};

const setPreset = async (n) => {
  setActivePreset(n);
  try { await fetch(`${API}/ptz/${device.id}?action=start&code=SetPreset&speed=${n}`); } catch {}
  setTimeout(() => {
    setActivePreset(null);
    setIsSettingPreset(false);
  }, 800);
};

const goHome = async () => {
  try { await fetch(`${API}/ptz/${device.id}?action=start&code=GotoPreset&speed=1`); } catch {}
};
'''

def port_preset_logic(target_dir):
    print(f"[+] Replicating PTZ Preset Logic to: {os.path.abspath(target_dir)}")
    
    backend_path = os.path.join(target_dir, "backend")
    os.makedirs(backend_path, exist_ok=True)
    
    with open(os.path.join(backend_path, "rpc_pool.py"), "w") as f:
        f.write(RPC_POOL_CODE)
    print("    • Generated backend/rpc_pool.py")

    with open(os.path.join(backend_path, "ptz_dispatcher.py"), "w") as f:
        f.write(PTZ_DISPATCHER_CODE)
    print("    • Generated backend/ptz_dispatcher.py")

    with open(os.path.join(target_dir, "ptz_routes_snippet.py"), "w") as f:
        f.write(FLASK_ROUTE_SNIPPET)
    print("    • Generated ptz_routes_snippet.py")

    with open(os.path.join(target_dir, "ReactPresetSnippet.jsx"), "w") as f:
        f.write(REACT_SNIPPET)
    print("    • Generated ReactPresetSnippet.jsx")

    print("\n[✔] PTZ Preset logic generation complete!")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Replicate Dahua PTZ preset logic to target project.")
    parser.add_argument("--target-dir", default="./target_app", help="Path to target project root")
    args = parser.parse_args()
    port_preset_logic(args.target_dir)
