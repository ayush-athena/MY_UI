/**
 * AthenaContext — Centralised state layer for the Athena Camera System.
 *
 * Manages devices, alerts, snapshots, and per-camera telemetry with
 * tiered polling intervals to minimise unnecessary UI re-renders.
 *
 *   Devices   → every 3 s
 *   Alerts    → every 5 s
 *   Telemetry → every 1 s  (only for the currently viewed camera)
 */

import React, {
  createContext, useContext, useState, useEffect,
  useCallback, useRef, useMemo,
} from 'react';

const API = 'http://127.0.0.1:5000';

// ── Context ────────────────────────────────────────────────────────────────
const AthenaContext = createContext(null);

// ── Shallow-compare helper ─────────────────────────────────────────────────
function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Provider ───────────────────────────────────────────────────────────────
export function AthenaProvider({ children }) {
  const [devices,   setDevices]   = useState([]);
  const [alerts,    setAlerts]    = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [telemetry, setTelemetry] = useState({});  // { deviceId: {pan,tilt,zoom} }
  const [activeCamera, setActiveCamera] = useState(null); // device object or null
  const [globalTrackingStatus, setGlobalTrackingStatus] = useState(null);

  // Refs to avoid stale-closure issues in intervals
  const devicesRef   = useRef(devices);
  const alertsRef    = useRef(alerts);
  const snapshotsRef = useRef(snapshots);

  // ── Fetch alerts (5 s) ──────────────────────────────────────────────
  const fetchAlerts = useCallback(async () => {
    try {
      const [aRes, sRes] = await Promise.all([
        fetch(`${API}/api/alerts`),
        fetch(`${API}/api/snapshots`),
      ]);
      if (aRes.ok) {
        const a = await aRes.json();
        if (!shallowEqual(a, alertsRef.current)) {
          alertsRef.current = a;
          setAlerts(a);
        }
      }
      if (sRes.ok) {
        const s = await sRes.json();
        if (!shallowEqual(s, snapshotsRef.current)) {
          snapshotsRef.current = s;
          setSnapshots(s);
        }
      }
    } catch { /* backend offline */ }
  }, []);

  // ── Fetch telemetry for active camera (1 s) ─────────────────────────
  const fetchTelemetry = useCallback(async (deviceId) => {
    if (!deviceId) return;
    try {
      const res = await fetch(`${API}/api/telemetry/${deviceId}`);
      if (res.ok) {
        const data = await res.json();
        setTelemetry(prev => ({ ...prev, [deviceId]: data }));
      }
    } catch { /* ignore */ }
  }, []);

  // ── Server-Sent Events (Real-time Updates) ──────────────────────────
  useEffect(() => {
    const sse = new EventSource(`${API}/api/events`);
    sse.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (!shallowEqual(data.devices, devicesRef.current)) {
          devicesRef.current = data.devices;
          setDevices(data.devices);
        }
        setGlobalTrackingStatus(data.global_status);

        // Auto-switch to the stream where the target is best visible
        if (data.global_status.global_active) {
          const validCams = data.global_status.cameras.filter(c => c.has_target_box && c.missed_frames < 10);
          if (validCams.length > 0) {
            const bestCam = validCams.reduce((prev, curr) => (curr.target_area > prev.target_area ? curr : prev));
            setActiveCamera(current => {
              if (bestCam.target_area > 0 && (!current || current.id !== bestCam.id)) {
                const currentStatus = data.global_status.cameras.find(c => current && c.id === current.id);
                const currentArea = currentStatus ? currentStatus.target_area : 0;
                const currentIsValid = currentStatus && currentStatus.has_target_box && currentStatus.missed_frames < 10;
                if (!currentIsValid || bestCam.target_area > currentArea * 1.5) {
                  const dev = devicesRef.current.find(d => d.id === bestCam.id);
                  return dev || current;
                }
              }
              return current;
            });
          }
        }
      } catch (err) {
        console.error("SSE parse error", err);
      }
    };
    return () => sse.close();
  }, []);

  // ── Timers for non-SSE data ─────────────────────────────────────────
  useEffect(() => {
    fetchAlerts();
    const alertTimer = setInterval(fetchAlerts, 5000);
    return () => clearInterval(alertTimer);
  }, [fetchAlerts]);

  useEffect(() => {
    if (!activeCamera) return;
    fetchTelemetry(activeCamera.id);
    const t1 = setInterval(() => fetchTelemetry(activeCamera.id), 1000);
    return () => clearInterval(t1);
  }, [activeCamera, fetchTelemetry]);

  const fetchDevices = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/devices`);
      if (res.ok) {
        const d = await res.json();
        if (!shallowEqual(d, devicesRef.current)) {
          devicesRef.current = d;
          setDevices(d);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // ── Context value (memoised) ─────────────────────────────────────────
  const value = useMemo(() => ({
    devices, alerts, snapshots, telemetry,
    activeCamera, setActiveCamera,
    globalTrackingStatus,
    refreshDevices: fetchDevices,
    refreshAlerts: fetchAlerts,
  }), [devices, alerts, snapshots, telemetry,
       activeCamera, globalTrackingStatus,
       fetchDevices, fetchAlerts]);

  return (
    <AthenaContext.Provider value={value}>
      {children}
    </AthenaContext.Provider>
  );
}

// ── Slice hooks ────────────────────────────────────────────────────────────
export function useAthena()    { return useContext(AthenaContext); }
export function useDevices()   { const ctx = useContext(AthenaContext); return ctx.devices; }
export function useAlerts()    { const ctx = useContext(AthenaContext); return ctx.alerts; }
export function useSnapshots() { const ctx = useContext(AthenaContext); return ctx.snapshots; }
export function useTelemetry(deviceId) {
  const ctx = useContext(AthenaContext);
  return deviceId ? ctx.telemetry[deviceId] : null;
}
