"""
Athena Camera System — Flask API Server
=======================================
Slim routing layer that wires together the modular backend components:
  • backend.reid_engine   — Batched GPU ReID inference
  • backend.rpc_pool      — Persistent RPC session management
  • backend.streams       — CameraStream pipelines & PTZ control

Storage: devices.json (kept for simplicity — SQLite upgrade deferred).
Thread-safe access to DEVICES / ALERTS / SNAPSHOTS via _data_lock.
"""

import os
import json
import copy
import time
import threading

import torch
from flask import Flask, Response, request, jsonify, send_from_directory
from flask_cors import CORS

from backend.reid_engine import BatchReIDEngine
from backend.rpc_pool import RPCSessionPool
from backend.streams import (
    GlobalState, CameraStream,
    ptz_control, get_ptz_telemetry,
)

# ═══════════════════════════════════════════════════════════════════════════
#  FLASK APP
# ═══════════════════════════════════════════════════════════════════════════
app = Flask(__name__)

# CORS — strict origin whitelist from env, falls back to localhost dev server
_allowed_origins = os.environ.get(
    "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")
CORS(app, resources={r"/*": {"origins": _allowed_origins}},
     supports_credentials=False)

# ═══════════════════════════════════════════════════════════════════════════
#  HARDWARE
# ═══════════════════════════════════════════════════════════════════════════
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print("=" * 41)
print(f"  Hardware: {'CUDA (Nvidia GPU)' if torch.cuda.is_available() else 'CPU (WARNING: No GPU)'}")
print("=" * 41)

# ═══════════════════════════════════════════════════════════════════════════
#  BACKEND SINGLETONS
# ═══════════════════════════════════════════════════════════════════════════
reid_engine  = BatchReIDEngine(device)
global_state = GlobalState()

# ═══════════════════════════════════════════════════════════════════════════
#  DEVICE STORAGE  (thread-safe JSON file)
# ═══════════════════════════════════════════════════════════════════════════
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, "devices.json")
_data_lock = threading.Lock()    # guards DEVICES, ALERTS, SNAPSHOTS

def load_devices():
    if os.path.exists(DB_FILE):
        with open(DB_FILE, "r") as f:
            return json.load(f)
    return []

def save_devices():
    """Must be called while holding _data_lock."""
    with open(DB_FILE, "w") as f:
        json.dump(DEVICES, f, indent=4)

DEVICES = load_devices()
ALERTS  = []
SNAPSHOTS = []

# Ensure defaults
for d in DEVICES:
    for key in ("ip", "username", "password"):
        d.setdefault(key, "")
    d.setdefault("rtsp_port", 554)
    d.setdefault("http_port", 80)
    d.setdefault("channel", 1)
    d.setdefault("subtype", 1)
    d.setdefault("location", "Unknown Sector")
    d.setdefault("camera_type", "PTZ")
    d.setdefault("status", "Active")

def get_device_config(device_id):
    """Thread-safe config lookup — used by streams and RPC pool."""
    with _data_lock:
        return next((dict(d) for d in DEVICES if d["id"] == device_id), None)

def add_alert(device_id, message, severity="info"):
    with _data_lock:
        ALERTS.insert(0, {
            "id": str(time.time()),
            "device_id": device_id,
            "message": message,
            "severity": severity,
            "timestamp": time.time(),
        })
        if len(ALERTS) > 50:
            ALERTS.pop()

# ═══════════════════════════════════════════════════════════════════════════
#  RPC POOL  (uses get_device_config for camera credentials)
# ═══════════════════════════════════════════════════════════════════════════
rpc_pool = RPCSessionPool(get_device_config)

# ═══════════════════════════════════════════════════════════════════════════
#  CAMERA STREAMS
# ═══════════════════════════════════════════════════════════════════════════
camera_streams = {}

def init_streams():
    with _data_lock:
        devices_copy = list(DEVICES)
    for d in devices_copy:
        if d.get("ip") and d.get("username") and d["id"] not in camera_streams:
            camera_streams[d["id"]] = CameraStream(
                d["id"],
                reid_engine=reid_engine,
                rpc_pool=rpc_pool,
                global_state=global_state,
                get_config=get_device_config,
            )

init_streams()


# ═══════════════════════════════════════════════════════════════════════════
#  CALIBRATION
# ═══════════════════════════════════════════════════════════════════════════
def _calibration_worker(device_id):
    stream = camera_streams.get(device_id)
    if not stream:
        return
    c = get_device_config(device_id)
    if not c:
        return

    print(f"[Calibration] Starting for {device_id}")

    def test_limit(command):
        ptz_control(device_id, "start", command, 8,
                    rpc_pool=rpc_pool, get_config=get_device_config)
        start_time = time.time()
        last_val = None
        while time.time() - start_time < 30:
            time.sleep(0.5)
            tel = get_ptz_telemetry(device_id)
            val = tel["pan"] if command in ("Left", "Right") else tel["tilt"]
            if last_val is not None and abs(val - last_val) < 0.1:
                break
            last_val = val
        dt = time.time() - start_time
        ptz_control(device_id, "stop", command,
                    rpc_pool=rpc_pool, get_config=get_device_config)
        time.sleep(1)
        return round(dt, 2)

    dt_left  = test_limit("Left")
    dt_right = test_limit("Right")
    dt_up    = test_limit("Up")
    dt_down  = test_limit("Down")

    calibration_data = {
        "left_time": dt_left, "right_time": dt_right,
        "up_time": dt_up, "down_time": dt_down,
        "calibrated_at": time.time(),
    }

    with _data_lock:
        dev = next((d for d in DEVICES if d["id"] == device_id), None)
        if dev:
            dev["calibration"] = calibration_data
        save_devices()
    print(f"[Calibration] Finished for {device_id}: {calibration_data}")


# ═══════════════════════════════════════════════════════════════════════════
#  ROUTES
# ═══════════════════════════════════════════════════════════════════════════

@app.route("/api/ping", methods=["GET"])
def ping():
    return jsonify({"timestamp": time.time()})


@app.route("/api/health", methods=["GET"])
def health():
    stats = {
        "hardware": {
            "cuda_available": torch.cuda.is_available(),
            "vram_allocated_mb": (round(torch.cuda.memory_allocated() / (1024 * 1024), 2)
                                  if torch.cuda.is_available() else 0),
        },
        "streams": [],
    }
    for sid, stream in camera_streams.items():
        connected = stream.cap_main is not None and stream.cap_main.isOpened()
        fps = stream.current_fps
        blur = stream.current_blur
        
        if not connected or fps == 0:
            quality = "Offline"
        elif fps < 10 or blur < 50:
            quality = "Poor"
        elif fps < 20 or blur < 150:
            quality = "Good"
        else:
            quality = "Excellent"

        stats["streams"].append({
            "device_id": sid,
            "missed_frames": stream.missed_frames,
            "seconds_since_last_frame": round(time.time() - stream.last_frame_time, 2),
            "tracking_mode": stream.tracking_mode,
            "embeddings_cached": len(stream.track_embeddings),
            "fps": round(fps, 1),
            "blur_score": round(blur, 1),
            "active_time": round(time.time() - stream.stream_start_time, 0),
            "is_connected": connected,
            "quality": quality,
        })
    return jsonify(stats)


@app.route("/api/calibrate/<device_id>", methods=["POST"])
def calibrate_camera(device_id):
    if device_id not in camera_streams:
        return jsonify({"error": "Stream not configured"}), 404
    threading.Thread(target=_calibration_worker, args=(device_id,), daemon=True).start()
    return jsonify({"status": "ok", "message": "Calibration started"})


@app.route("/api/config/<device_id>", methods=["GET"])
def get_config(device_id):
    with _data_lock:
        dev = next((d for d in DEVICES if d["id"] == device_id), None)
    if not dev:
        return jsonify({"error": "Device not found"}), 404
    safe = {k: v for k, v in dev.items()
            if k in ("ip", "username", "rtsp_port", "http_port", "channel", "subtype")}
    safe["password"] = "***" if dev.get("password") else ""
    return jsonify(safe)


@app.route("/api/config/<device_id>", methods=["POST"])
def set_config(device_id):
    with _data_lock:
        dev = next((d for d in DEVICES if d["id"] == device_id), None)
        if not dev:
            return jsonify({"error": "Device not found"}), 404
        data = request.json or {}
        for key in ("ip", "username", "password", "rtsp_port", "http_port", "channel", "subtype", "name", "override_status"):
            if key in data and data[key] != "":
                if key == "password" and data[key] == "***":
                    continue
                dev[key] = data[key]
        save_devices()

    if device_id not in camera_streams:
        camera_streams[device_id] = CameraStream(
            device_id, reid_engine=reid_engine, rpc_pool=rpc_pool,
            global_state=global_state, get_config=get_device_config,
        )
    else:
        camera_streams[device_id].reconnect()
    return jsonify({"status": "ok", "message": "Camera config updated and stream reconnected."})


@app.route("/video/<device_id>")
def video(device_id):
    stream = camera_streams.get(device_id)
    if not stream:
        return Response("Stream not configured", status=404)
    return Response(stream.generate_frames(),
                    mimetype="multipart/x-mixed-replace; boundary=frame")


@app.route("/ptz/<device_id>")
def ptz_route(device_id):
    action = request.args.get("action", "start")
    code   = request.args.get("code", "Up")
    speed  = int(request.args.get("speed", 5))
    if code == "Stop":
        res = ptz_control(device_id, "stop", "Up",
                          rpc_pool=rpc_pool, get_config=get_device_config)
    else:
        res = ptz_control(device_id, action, code, speed,
                          rpc_pool=rpc_pool, get_config=get_device_config)
    return jsonify(res)


@app.route("/api/telemetry/<device_id>")
def telemetry(device_id):
    return jsonify(get_ptz_telemetry(device_id))


@app.route("/api/light/<device_id>", methods=["POST"])
def light_control(device_id):
    data = request.json or {}
    mode = data.get("mode", "Auto")
    stream = camera_streams.get(device_id)
    if not stream:
        return jsonify({"error": "Stream not configured"}), 404
    c = get_device_config(device_id)
    if not c or not c.get("ip"):
        return jsonify({"error": "No camera"}), 400
    result = rpc_pool.send_rpc(
        device_id, "configManager.setConfig",
        {"name": "Lighting", "table": [[{"Mode": mode}]]},
    )
    return jsonify(result)


@app.route("/api/tracking/<device_id>", methods=["POST"])
def toggle_tracking(device_id):
    stream = camera_streams.get(device_id)
    if not stream:
        return jsonify({"error": "Stream not configured"}), 404
    data = request.json or {}
    mode = data.get("mode", "None")

    def _reset_stream(s):
        s.manual_click_point = None
        s.manual_tracked_box = None
        s.tracked_id = None
        s.missed_frames = 0
        s.last_pan = "Stop"
        s.last_tilt = "Stop"
        s.pid_pan.reset()
        s.pid_tilt.reset()
        s._send_ptz("stop", "Left", 1)
        s._send_ptz("stop", "Up",   1)

    if mode in ("Global", "Auto"):
        cam_ids = list(camera_streams.keys())
        for sid, s in camera_streams.items():
            s.tracking_mode = mode
            _reset_stream(s)
            with s.boxes_lock:
                s.latest_target_box = None
        global_state.reset()
        global_state.set_cameras(cam_ids)
        return jsonify({"status": "ok", "tracking_mode": mode})

    if mode == "None":
        for sid, s in camera_streams.items():
            s.tracking_mode = "None"
            _reset_stream(s)
            with s.boxes_lock:
                s.latest_target_box = None
        global_state.reset()
        return jsonify({"status": "ok", "tracking_mode": mode})

    # Local Manual
    stream.tracking_mode = mode
    _reset_stream(stream)
    return jsonify({"status": "ok", "tracking_mode": mode})


@app.route("/api/track_point/<device_id>", methods=["POST"])
def track_point(device_id):
    stream = camera_streams.get(device_id)
    if not stream:
        return jsonify({"error": "Stream not configured"}), 404
    data = request.json or {}
    x, y = data.get("x"), data.get("y")
    if x is None or y is None:
        return jsonify({"error": "Invalid coordinates"}), 400

    for sid, s in camera_streams.items():
        if s.tracking_mode not in ("Global",):
            s.tracking_mode = "Global"

    stream.manual_click_point = (x, y)
    stream.manual_tracked_box = None
    stream.tracked_id = None
    stream.missed_frames = 0

    with global_state._lock:
        global_state.target_embedding = None
        global_state.is_active = False

    for sid, s in camera_streams.items():
        if sid != device_id:
            s.manual_tracked_box = None
            s.tracked_id = None
            s.missed_frames = 0

    global_state.set_cameras(list(camera_streams.keys()))
    return jsonify({"status": "ok"})


@app.route("/api/global_status", methods=["GET"])
def api_global_status():
    emb, active = global_state.snapshot()
    cams = []
    for sid, s in camera_streams.items():
        cams.append({
            "id": sid, "mode": s.tracking_mode,
            "has_target_box": s.manual_tracked_box is not None,
            "tracked_id": s.tracked_id,
            "missed_frames": s.missed_frames,
            "target_area": getattr(s, "target_area", 0.0)
        })
    return jsonify({"global_active": active, "has_embedding": emb is not None, "cameras": cams})


@app.route("/api/devices", methods=["GET"])
def get_devices():
    with _data_lock:
        ret = copy.deepcopy(DEVICES)
    emb, g_active = global_state.snapshot()
    for d in ret:
        stream = camera_streams.get(d["id"])
        db_status = d.get("status", "Active")
        override = d.get("override_status", "None")
        if override and override != "None":
            d["status"] = override
        elif db_status != "Maintenance":
            d["status"] = ("Active" if stream and time.time() - stream.last_frame_time < 5 else "Inactive")
        else:
            d["status"] = "Maintenance"
            
        d["is_tracking_target"] = (g_active and stream is not None
                                   and stream.manual_tracked_box is not None)
    return jsonify(ret)

@app.route("/api/events")
def sse_events():
    def event_stream():
        while True:
            emb, g_active = global_state.snapshot()
            cams = []
            with _data_lock:
                devices_copy = copy.deepcopy(DEVICES)
            
            for d in devices_copy:
                sid = d["id"]
                s = camera_streams.get(sid)
                
                # Check persistent override first
                override = d.get("override_status", "None")
                if override and override != "None":
                    status = override
                else:
                    db_status = d.get("status", "Active")
                    if db_status != "Maintenance":
                        status = "Active" if (s and time.time() - s.last_frame_time < 5) else "Inactive"
                    else:
                        status = "Maintenance"
                d["status"] = status
                d["is_tracking_target"] = (g_active and s is not None and s.manual_tracked_box is not None)
                
                if s:
                    cams.append({
                        "id": sid, 
                        "mode": s.tracking_mode,
                        "has_target_box": s.manual_tracked_box is not None,
                        "tracked_id": s.tracked_id,
                        "missed_frames": s.missed_frames,
                        "target_area": getattr(s, "target_area", 0.0),
                        "fps": getattr(s, "current_fps", 0),
                        "blur_score": getattr(s, "current_blur", 0),
                        "is_connected": time.time() - s.last_frame_time < 5
                    })
            
            payload = {
                "devices": devices_copy,
                "global_status": {
                    "global_active": g_active,
                    "has_embedding": emb is not None,
                    "cameras": cams
                }
            }
            yield f"data: {json.dumps(payload)}\n\n"
            time.sleep(0.5)
            
    return Response(event_stream(), mimetype="text/event-stream")

@app.route("/api/master_track", methods=["POST"])
def master_track():
    data = request.json or {}
    mode = data.get("mode", "Manual") # 'Auto' or 'Manual'
    for sid, stream in camera_streams.items():
        stream.tracking_mode = mode
    return jsonify({"status": "ok", "mode": mode})

@app.route("/api/devices", methods=["POST"])
def add_device():
    data = request.json or {}
    dev_id = data.get("id")
    if not dev_id:
        return jsonify({"error": "Device ID is required"}), 400
    
    with _data_lock:
        if any(d["id"] == dev_id for d in DEVICES):
            return jsonify({"error": "Device ID already exists"}), 409
        
        new_dev = {
            "id": dev_id,
            "name": data.get("name", dev_id),
            "ip": data.get("ip", ""),
            "username": data.get("username", ""),
            "password": data.get("password", ""),
            "rtsp_port": int(data.get("rtsp_port", 554)),
            "http_port": int(data.get("http_port", 80)),
            "channel": int(data.get("channel", 1)),
            "subtype": int(data.get("subtype", 1)),
            "location": data.get("location", "Unknown"),
            "camera_type": data.get("camera_type", "PTZ"),
            "status": "Active"
        }
        DEVICES.append(new_dev)
        save_devices()
        
    if new_dev["ip"] and new_dev["username"]:
        camera_streams[dev_id] = CameraStream(
            dev_id, reid_engine=reid_engine, rpc_pool=rpc_pool,
            global_state=global_state, get_config=get_device_config
        )
        
    return jsonify({"status": "ok", "message": "Camera added"})

@app.route("/api/devices/<device_id>", methods=["DELETE"])
def delete_device(device_id):
    with _data_lock:
        global DEVICES
        initial_len = len(DEVICES)
        DEVICES = [d for d in DEVICES if d["id"] != device_id]
        if len(DEVICES) == initial_len:
            return jsonify({"error": "Device not found"}), 404
        save_devices()
        
    stream = camera_streams.pop(device_id, None)
    if stream:
        stream.running = False
        if stream.cap_main:
            stream.cap_main.release()
            
    return jsonify({"status": "ok", "message": "Camera deleted"})

@app.route("/api/devices/<device_id>", methods=["GET"])
def get_device_metadata(device_id):
    with _data_lock:
        dev = next((d for d in DEVICES if d["id"] == device_id), None)
    if dev:
        return jsonify(dev)
    return jsonify({"error": "Device not found"}), 404


@app.route("/api/alerts", methods=["GET"])
def get_alerts():
    with _data_lock:
        return jsonify(list(ALERTS))


@app.route("/api/snapshots", methods=["GET"])
def get_snapshots():
    with _data_lock:
        return jsonify(list(SNAPSHOTS))


@app.route("/api/snapshot/<device_id>", methods=["POST"])
def take_snapshot(device_id):
    stream = camera_streams.get(device_id)
    if not stream or stream.latest_frame is None:
        return jsonify({"error": "No stream available"}), 400
    filename = f"{device_id}_{int(time.time())}.jpg"
    snapshot_dir = os.path.join(BASE_DIR, "snapshots")
    filepath = os.path.join(snapshot_dir, filename)
    os.makedirs(snapshot_dir, exist_ok=True)
    with open(filepath, "wb") as f:
        f.write(stream.latest_frame)
    snapshot_info = {
        "id": str(time.time()), "device_id": device_id,
        "url": f"/snapshots/{filename}", "timestamp": time.time(),
    }
    with _data_lock:
        SNAPSHOTS.insert(0, snapshot_info)
    return jsonify({"status": "ok", "snapshot": snapshot_info})


@app.route("/snapshots/<path:filename>")
def serve_snapshot(filename):
    snapshot_dir = os.path.join(BASE_DIR, "snapshots")
    return send_from_directory(snapshot_dir, filename)


# ═══════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)