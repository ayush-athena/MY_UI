"""
Camera Streams & PTZ Control
=============================
Extracted from the monolithic Cam.py.  Contains:
  • GlobalState        – single authoritative tracking target shared by all cameras
  • CameraStream       – per-camera capture / track / PTZ worker threads
  • PTZ dead-reckoning – velocity-integrated pan/tilt estimation
  • ptz_control()      – high-level PTZ command dispatcher
"""

import os
import threading
import queue
import time
import cv2
import numpy as np
from ultralytics import YOLO
import torch
from scipy.spatial.distance import cosine


# ═══════════════════════════════════════════════════════════════════════════
#  GLOBAL TARGET STATE
# ═══════════════════════════════════════════════════════════════════════════
class GlobalState:
    """Single authoritative target shared by ALL camera threads."""

    def __init__(self):
        self._lock = threading.Lock()
        self.target_embedding = None
        self.is_active = False
        self.global_cameras = set()

    def set_target(self, embedding):
        with self._lock:
            self.target_embedding = embedding
            self.is_active = True

    def reset(self):
        with self._lock:
            self.target_embedding = None
            self.is_active = False
            self.global_cameras.clear()

    def snapshot(self):
        with self._lock:
            return self.target_embedding, self.is_active

    def set_cameras(self, cam_set):
        with self._lock:
            self.global_cameras = set(cam_set)

    def is_global_camera(self, camera_id):
        with self._lock:
            return camera_id in self.global_cameras


# ═══════════════════════════════════════════════════════════════════════════
#  PTZ DEAD-RECKONING STATE
# ═══════════════════════════════════════════════════════════════════════════
class PTZStateManager:
    """Thread-safe dead-reckoning PTZ state per device."""

    def __init__(self):
        self._states = {}
        self._lock = threading.Lock()

    def _ensure(self, device_id):
        if device_id not in self._states:
            self._states[device_id] = {
                "pan": 0.0, "tilt": 0.0,
                "last_update": time.time(),
                "pan_vel": 0.0, "tilt_vel": 0.0,
            }

    def get(self, device_id):
        with self._lock:
            self._ensure(device_id)
            return dict(self._states[device_id])

    def update(self, device_id):
        with self._lock:
            self._ensure(device_id)
            s = self._states[device_id]
            now = time.time()
            dt = max(0, now - s["last_update"])
            s["last_update"] = now
            s["pan"]  = max(-180.0, min(180.0, s["pan"]  + s["pan_vel"]  * dt))
            s["tilt"] = max(-30.0,  min(90.0,  s["tilt"] + s["tilt_vel"] * dt))

    def set_velocity(self, device_id, action, code, speed):
        base_speed = 2.0
        with self._lock:
            self._ensure(device_id)
            s = self._states[device_id]
            if action == "stop":
                s["pan_vel"] = 0.0
                s["tilt_vel"] = 0.0
            else:
                if   code == "Left":  s["pan_vel"]  = -speed * base_speed
                elif code == "Right": s["pan_vel"]  =  speed * base_speed
                elif code == "Up":    s["tilt_vel"] =  speed * base_speed
                elif code == "Down":  s["tilt_vel"] = -speed * base_speed


# ═══════════════════════════════════════════════════════════════════════════
#  PTZ CONTROL
# ═══════════════════════════════════════════════════════════════════════════
_ptz_state_mgr = PTZStateManager()


def ptz_control(device_id, action, code, speed=5,
                *, rpc_pool, get_config):
    """
    High-level PTZ command: updates dead-reckoning, then sends RPC.

    Args:
        rpc_pool:   backend.rpc_pool.RPCSessionPool instance
        get_config: callable(device_id) → config dict
    """
    _ptz_state_mgr.update(device_id)
    _ptz_state_mgr.set_velocity(device_id, action, code, speed)

    c = get_config(device_id)
    if not c or not c.get("ip"):
        return {"error": "No camera configured"}

    if code in ("GotoPreset", "SetPreset", "ClearPreset"):
        params = {
            "code": code,
            "arg1": speed, "arg2": 0,
            "arg3": 0,     "arg4": 0,
        }
    else:
        params = {
            "code": code,
            "arg1": speed, "arg2": speed,
            "arg3": 0,     "arg4": 0,
        }
    return rpc_pool.send_rpc(device_id, f"ptz.{action}", params,
                             object_id=c.get("channel", 1))


def get_ptz_telemetry(device_id):
    """Return current dead-reckoned pan/tilt for the telemetry API."""
    _ptz_state_mgr.update(device_id)
    s = _ptz_state_mgr.get(device_id)
    return {"pan": round(s["pan"], 1),
            "tilt": round(s["tilt"], 1),
            "zoom": 1.0}


# ═══════════════════════════════════════════════════════════════════════════
#  CAMERA STREAM
# ═══════════════════════════════════════════════════════════════════════════
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
YOLO_MODEL_PATH = os.path.join(BASE_DIR, "yolo11s.pt")


class PIDController:
    """
    Discrete PID controller for PTZ axis stabilisation.

    P  – reacts to current error (how far from boundary)
    I  – accumulates past error to push through friction / steady-state
    D  – reacts to rate-of-change of error — applies a braking force
         when the subject is moving back, which kills oscillation.

    Anti-windup: integral is clamped and zeroed inside the dead zone.
    """

    def __init__(self, kp=6.0, ki=0.3, kd=3.5, dead_zone=0.55,
                 integral_limit=2.0, output_limit=4.0):
        self.kp = kp
        self.ki = ki
        self.kd = kd
        self.dead_zone = dead_zone
        self.integral_limit = integral_limit
        self.output_limit = output_limit

        self._integral = 0.0
        self._prev_error = 0.0
        self._last_time = time.time()

    def reset(self):
        """Zero all state (call when target is lost)."""
        self._integral = 0.0
        self._prev_error = 0.0
        self._last_time = time.time()

    def update(self, error):
        """
        Compute PID output from normalised error (−1 … +1).

        Returns (command_speed, direction_sign):
          command_speed:  0 (inside dead zone) … output_limit
          direction_sign: −1 / 0 / +1
        """
        now = time.time()
        dt = max(1e-4, now - self._last_time)
        self._last_time = now

        # Error relative to the dead-zone boundary
        abs_err = abs(error)
        if abs_err <= self.dead_zone:
            # Subject is comfortably inside the frame — stop & decay integral
            self._integral *= 0.8   # gentle decay, not a hard reset
            self._prev_error = error
            return 0.0, 0

        # Signed boundary error (how far past the dead zone)
        boundary_err = error - (self.dead_zone if error > 0 else -self.dead_zone)

        # P
        p_out = self.kp * boundary_err

        # I (with anti-windup clamp)
        self._integral += boundary_err * dt
        self._integral = max(-self.integral_limit,
                             min(self.integral_limit, self._integral))
        i_out = self.ki * self._integral

        # D (rate of change of the raw error, not boundary error)
        derivative = (error - self._prev_error) / dt
        self._prev_error = error
        d_out = self.kd * derivative

        # Combined output
        output = p_out + i_out + d_out
        clamped = max(-self.output_limit, min(self.output_limit, output))

        direction = 1 if clamped > 0 else (-1 if clamped < 0 else 0)
        return abs(clamped), direction


class CameraStream:
    """
    Per-camera pipeline: capture → YOLO track → ReID → PTZ control.

    Runs three daemon threads:
      _capture_worker  — reads RTSP frames
      _track_worker    — detection + tracking + ReID
      _ptz_worker      — serialised PTZ command sender
    """

    def __init__(self, device_id, *,
                 reid_engine, rpc_pool, global_state, get_config):
        self.device_id    = device_id
        self._reid        = reid_engine
        self._rpc_pool    = rpc_pool
        self._global      = global_state
        self._get_config  = get_config

        self.cap_main     = None
        self.cap_lock     = threading.Lock()

        self.latest_frame     = None
        self.new_frame_event  = threading.Event()   # signals generate_frames
        self.last_frame_time  = 0

        self.tracking_mode       = "None"
        self.manual_click_point  = None
        self.manual_tracked_box  = None

        self.frame_count      = 0
        self.last_pan         = "Stop"
        self.last_tilt        = "Stop"
        self.last_pan_speed   = 1
        self.last_tilt_speed  = 1
        self.running          = True
        self.tracked_id       = None
        self.missed_frames    = 0
        self.target_area      = 0.0

        # Health metrics
        self.stream_start_time = time.time()
        self.current_fps       = 0.0
        self.current_blur      = 0.0
        self.frame_timestamps  = []

        # PID controllers for pan/tilt axis stabilisation
        self.pid_pan  = PIDController(kp=6.0, ki=0.3, kd=3.5, dead_zone=0.55)
        self.pid_tilt = PIDController(kp=6.0, ki=0.3, kd=3.5, dead_zone=0.55)

        self.frame_for_tracking     = None
        self.tracking_frame_event   = threading.Event()

        self.boxes_lock        = threading.Lock()
        self.latest_target_box = None
        self.track_embeddings  = {}
        self.pending_reids     = set()
        self.reid_cache_lock   = threading.Lock()

        # PTZ command queue (maxsize=2 drops stale commands under backpressure)
        self.ptz_queue = queue.Queue(maxsize=2)

        # Per-camera YOLO (ByteTrack state is per-instance)
        print(f"[Stream] {device_id} loading YOLO model…")
        self.yolo = YOLO(YOLO_MODEL_PATH)
        hw_device = reid_engine.device
        self.yolo.to(hw_device)
        if torch.cuda.is_available():
            self.yolo.overrides["half"] = True

        # Start worker threads
        self.thread_capture = threading.Thread(target=self._capture_worker, daemon=True)
        self.thread_track   = threading.Thread(target=self._track_worker,   daemon=True)
        self.thread_ptz     = threading.Thread(target=self._ptz_worker,     daemon=True)
        self.thread_capture.start()
        self.thread_track.start()
        self.thread_ptz.start()
        self.reconnect()

    # ── helpers ────────────────────────────────────────────────────────────

    def get_config(self):
        return self._get_config(self.device_id)

    @staticmethod
    def get_rtsp_url(c, override_subtype=None):
        pwd = c["password"]
        st = override_subtype if override_subtype is not None else c["subtype"]
        return (f"rtsp://{c['username']}:{pwd}@{c['ip']}:{c['rtsp_port']}"
                f"/cam/realmonitor?channel={c['channel']}&subtype={st}")

    def reconnect(self):
        with self.cap_lock:
            if self.cap_main is not None:
                self.cap_main.release()
            c = self.get_config()
            if c and c.get("ip") and c.get("username") and c.get("password"):
                url = self.get_rtsp_url(c)
                print(f"[Stream] {self.device_id} connecting → {url}")
                os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
                self.cap_main = cv2.VideoCapture(url)
            else:
                self.cap_main = None

    def _send_ptz(self, action, code, speed):
        """Non-blocking enqueue — drops stale commands on overflow."""
        try:
            self.ptz_queue.put_nowait((action, code, speed))
        except queue.Full:
            try:
                self.ptz_queue.get_nowait()
            except queue.Empty:
                pass
            try:
                self.ptz_queue.put_nowait((action, code, speed))
            except queue.Full:
                pass

    # ── PTZ worker ─────────────────────────────────────────────────────────

    def _ptz_worker(self):
        while self.running:
            try:
                action, code, speed = self.ptz_queue.get(timeout=1.0)
            except queue.Empty:
                continue
            try:
                ptz_control(self.device_id, action, code, speed,
                            rpc_pool=self._rpc_pool,
                            get_config=self._get_config)
            except Exception as e:
                print(f"[PTZ Worker] {self.device_id} error: {e}")

    # ── Capture worker ─────────────────────────────────────────────────────

    def _capture_worker(self):
        while self.running:
            with self.cap_lock:
                local_cap = self.cap_main
            if local_cap is None or not local_cap.isOpened():
                time.sleep(1)
                continue

            success, frame = local_cap.read()
            if not success:
                self._fail_count = getattr(self, '_fail_count', 0) + 1
                if self._fail_count > 100:  # ~1 second of failed reads
                    print(f"[Stream] {self.device_id} connection lost, attempting reconnect...")
                    self.reconnect()
                    self._fail_count = 0
                time.sleep(0.01)
                continue
            self._fail_count = 0

            self.frame_count += 1
            h, w = frame.shape[:2]
            if w > 1920:
                scale = 1920 / w
                frame = cv2.resize(frame, (1920, int(h * scale)))
                h, w = frame.shape[:2]

            # Health Metrics Calculation
            now = time.time()
            self.frame_timestamps.append(now)
            if len(self.frame_timestamps) > 30:
                self.frame_timestamps.pop(0)
            if len(self.frame_timestamps) > 1:
                dt = self.frame_timestamps[-1] - self.frame_timestamps[0]
                if dt > 0:
                    self.current_fps = len(self.frame_timestamps) / dt
            
            if self.frame_count % 10 == 0:
                small = cv2.resize(frame, (320, 180))
                gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
                self.current_blur = cv2.Laplacian(gray, cv2.CV_64F).var()

            if not self.tracking_frame_event.is_set():
                self.frame_for_tracking = frame.copy()
                self.tracking_frame_event.set()

            # Draw tracking overlay
            with self.boxes_lock:
                t_box = self.latest_target_box
            if self.tracking_mode != "None" and t_box is not None:
                (rx1, ry1, rx2, ry2), color, label = t_box
                tx1, ty1 = int(rx1 * w), int(ry1 * h)
                tx2, ty2 = int(rx2 * w), int(ry2 * h)
                cv2.rectangle(frame, (tx1, ty1), (tx2, ty2), color, 2)
                cv2.putText(frame, label, (tx1, ty1 - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

            _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
            self.latest_frame = buffer.tobytes()
            self.last_frame_time = time.time()
            self.new_frame_event.set()

    # ── Tracking worker ────────────────────────────────────────────────────

    def _track_worker(self):
        MISS_GRACE = 25

        while self.running:
            if not self.tracking_frame_event.wait(timeout=1.0):
                continue
            frame = self.frame_for_tracking
            self.tracking_frame_event.clear()

            mode = self.tracking_mode
            if frame is None or mode == "None":
                with self.boxes_lock:
                    self.latest_target_box = None
                self.tracked_id = None
                self.missed_frames = 0
                continue

            h, w = frame.shape[:2]
            infer_w = 640
            infer_h = int(h * infer_w / w)
            infer_frame = cv2.resize(frame, (infer_w, infer_h))
            sx, sy = w / infer_w, h / infer_h

            results = self.yolo.track(
                infer_frame, classes=[0], conf=0.70, verbose=False,
                persist=True, tracker="bytetrack.yaml", imgsz=640,
            )

            best_box = None
            max_area = 0

            if results and results[0].boxes is not None and len(results[0].boxes):
                boxes   = results[0].boxes
                has_ids = boxes.id is not None
                track_ids = (boxes.id.cpu().numpy().astype(int)
                             if has_ids else [None] * len(boxes))

                # Purge stale embeddings
                if has_ids:
                    current_tids = set(track_ids)
                    with self.reid_cache_lock:
                        for tid in list(self.track_embeddings.keys()):
                            if tid not in current_tids:
                                del self.track_embeddings[tid]

                def full_box(b):
                    x1, y1, x2, y2 = b.xyxy[0].cpu().numpy()
                    return (x1 * sx, y1 * sy, x2 * sx, y2 * sy)

                def get_embedding(frm, fb, tid, sync=False):
                    with self.reid_cache_lock:
                        if tid is not None and tid in self.track_embeddings:
                            return self.track_embeddings[tid]
                    if sync:
                        emb = self._reid.extract_sync(frm, fb)
                        if tid is not None and emb is not None:
                            with self.reid_cache_lock:
                                self.track_embeddings[tid] = emb
                        return emb
                    elif tid is not None:
                        with self.reid_cache_lock:
                            if tid not in self.pending_reids:
                                self.pending_reids.add(tid)
                                self._reid.submit_async(
                                    frm.copy(), fb,
                                    lambda emb, _t=tid: self._async_reid_cb(emb, _t),
                                )
                    return None

                # ── PHASE 1: pending click ─────────────────────────────
                if mode in ("Manual", "Global") and self.manual_click_point is not None:
                    px = self.manual_click_point[0] * infer_w
                    py = self.manual_click_point[1] * infer_h
                    best_dist, chosen_i = float("inf"), None
                    for i, box in enumerate(boxes):
                        x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                        if x1 <= px <= x2 and y1 <= py <= y2:
                            dist = ((x1 + x2) / 2 - px) ** 2 + ((y1 + y2) / 2 - py) ** 2
                            if dist < best_dist:
                                best_dist, chosen_i = dist, i
                    if chosen_i is not None:
                        fb = full_box(boxes[chosen_i])
                        self.tracked_id = track_ids[chosen_i]
                        cx1, cy1, cx2, cy2 = fb
                        self.manual_tracked_box = (cx1 / w, cy1 / h, cx2 / w, cy2 / h)
                        self.missed_frames = 0
                        best_box = fb
                        emb = get_embedding(frame, fb, track_ids[chosen_i], sync=True)
                        if emb is not None:
                            self._global.set_target(emb)
                            print(f"[Handshake] Target locked by {self.device_id} "
                                  f"(track_id={self.tracked_id})")
                    self.manual_click_point = None

                # ── PHASE 2 & 3: parallel tracking ────────────────────
                elif mode in ("Manual", "Global"):
                    g_emb, g_active = self._global.snapshot()
                    if g_active and g_emb is not None:
                        matched = None
                        if self.tracked_id is not None:
                            for i, box in enumerate(boxes):
                                if track_ids[i] == self.tracked_id:
                                    matched = full_box(box)
                                    self.missed_frames = 0
                                    break
                        if matched is None:
                            best_sim, best_match, best_tid = 0.65, None, None
                            for i, box in enumerate(boxes):
                                fb = full_box(box)
                                emb = get_embedding(frame, fb, track_ids[i])
                                if emb is not None:
                                    sim = 1.0 - cosine(g_emb, emb)
                                    if sim > best_sim:
                                        best_sim, best_match, best_tid = sim, fb, track_ids[i]
                            if best_match is not None:
                                self.tracked_id = best_tid
                                matched = best_match
                                self.missed_frames = 0
                                print(f"[Parallel] {self.device_id} acquired target "
                                      f"sim={best_sim:.2f}")
                        if matched is not None:
                            cx1, cy1, cx2, cy2 = matched
                            self.manual_tracked_box = (cx1 / w, cy1 / h, cx2 / w, cy2 / h)
                            best_box = matched
                        else:
                            self.missed_frames += 1
                            if self.missed_frames >= MISS_GRACE:
                                self.manual_tracked_box = None
                                self.tracked_id = None
                                self.missed_frames = 0

                # ── PHASE 4: auto (largest person) ────────────────────
                elif mode == "Auto":
                    for i, box in enumerate(boxes):
                        fb = full_box(box)
                        fx1, fy1, fx2, fy2 = fb
                        area = (fx2 - fx1) * (fy2 - fy1)
                        if area > max_area:
                            max_area, best_box = area, fb

            # ── PTZ control ───────────────────────────────────────────
            if best_box is not None:
                x1, y1, x2, y2 = map(int, best_box)
                is_locked = mode in ("Manual", "Global") and self.manual_tracked_box is not None
                color = (0, 255, 128) if is_locked else (200, 200, 200)
                label = "TARGET" if is_locked else "TRACKING"
                with self.boxes_lock:
                    self.latest_target_box = ((x1 / w, y1 / h, x2 / w, y2 / h), color, label)

                cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
                self.target_area = (x2 - x1) * (y2 - y1)
                raw_dx = (cx - w / 2) / (w / 2)   # −1 (left edge) … +1 (right edge)
                raw_dy = (cy - h / 2) / (h / 2)   # −1 (top)       … +1 (bottom)

                # PID controller outputs: speed magnitude + direction sign
                pan_mag,  pan_dir  = self.pid_pan.update(raw_dx)
                tilt_mag, tilt_dir = self.pid_tilt.update(raw_dy)

                pan_cmd   = "Stop";  tilt_cmd   = "Stop"
                pan_speed = 1;       tilt_speed = 1

                if pan_dir < 0:      pan_cmd,  pan_speed  = "Left",  max(1, min(4, int(pan_mag)))
                elif pan_dir > 0:    pan_cmd,  pan_speed  = "Right", max(1, min(4, int(pan_mag)))
                if tilt_dir < 0:     tilt_cmd, tilt_speed = "Up",    max(1, min(4, int(tilt_mag)))
                elif tilt_dir > 0:   tilt_cmd, tilt_speed = "Down",  max(1, min(4, int(tilt_mag)))

                if pan_cmd != self.last_pan or pan_speed != self.last_pan_speed:
                    self.last_pan, self.last_pan_speed = pan_cmd, pan_speed
                    if pan_cmd == "Stop":
                        self._send_ptz("stop", self.last_pan if self.last_pan != "Stop" else "Left", 1)
                    else:
                        self._send_ptz("start", pan_cmd, pan_speed)

                if tilt_cmd != self.last_tilt or tilt_speed != self.last_tilt_speed:
                    self.last_tilt, self.last_tilt_speed = tilt_cmd, tilt_speed
                    if tilt_cmd == "Stop":
                        self._send_ptz("stop", self.last_tilt if self.last_tilt != "Stop" else "Up", 1)
                    else:
                        self._send_ptz("start", tilt_cmd, tilt_speed)
            else:
                with self.boxes_lock:
                    self.latest_target_box = None
                if self.last_pan != "Stop" or self.last_tilt != "Stop":
                    self._send_ptz("stop", "Left", 1)
                    self._send_ptz("stop", "Up",   1)
                    self.last_pan  = "Stop";  self.last_tilt  = "Stop"
                    self.last_pan_speed = 1;  self.last_tilt_speed = 1
                self.pid_pan.reset()
                self.pid_tilt.reset()
                self.target_area = 0.0

    def _async_reid_cb(self, emb, tid):
        """Callback invoked by the batch ReID engine on completion."""
        with self.reid_cache_lock:
            if emb is not None:
                self.track_embeddings[tid] = emb
            self.pending_reids.discard(tid)

    # ── Frame generator ────────────────────────────────────────────────────

    def generate_frames(self):
        """MJPEG generator with Event-based signalling (no busy-wait)."""
        try:
            while self.running:
                if self.latest_frame is None:
                    time.sleep(0.5)
                    continue
                # Wait for a new frame (up to 100 ms) instead of fixed sleep
                self.new_frame_event.wait(timeout=0.1)
                self.new_frame_event.clear()
                if self.latest_frame is not None:
                    yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
                           + self.latest_frame + b"\r\n")
        except GeneratorExit:
            pass  # client disconnected — clean exit, no socket leak
