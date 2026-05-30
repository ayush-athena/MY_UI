import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Video, MousePointerClick, Camera,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Crosshair, ZoomIn, ZoomOut, Focus, Scan, WifiOff,
  Home, Cpu, BookMarked, Edit2
} from 'lucide-react';

const C = { bg: '#0a0d14', panel: '#131826', border: '#1f2937', text: '#e5e7eb', muted: '#9ca3af' };

function PtzBtn({ onMouseDown, onMouseUp, onMouseLeave, onClick, children, style = {}, title = '' }) {
  return (
    <button
      className="ptz-btn"
      title={title}
      style={{ width: 32, height: 32, ...style }}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// Pill-style toggle button used for Auto + Preset toggles in the header
function HeaderBtn({ onClick, active, activeColor = '#4f46e5', activeBorder = '#6366f1', activeText = '#818cf8', children }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
        cursor: 'pointer',
        background: active ? `${activeColor}33` : '#1f2937',
        border: `1px solid ${active ? activeBorder : C.border}`,
        color: active ? activeText : C.text,
        transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  );
}

/**
 * Computes the actual rendered video rectangle inside a container
 * using object-fit: contain rules.
 */
function getVideoRect(containerW, containerH, videoW, videoH) {
  if (!videoW || !videoH) return { x: 0, y: 0, w: containerW, h: containerH };
  const containerAR = containerW / containerH;
  const videoAR = videoW / videoH;
  let w, h;
  if (videoAR > containerAR) {
    w = containerW;
    h = containerW / videoAR;
  } else {
    h = containerH;
    w = containerH * videoAR;
  }
  return { x: (containerW - w) / 2, y: (containerH - h) / 2, w, h };
}

export default function VideoView({ device, onClose }) {
  const API = 'http://127.0.0.1:5000';
  const [tracking, setTracking]       = useState('None');
  const [showPresets, setShowPresets] = useState(false);
  const [activePreset, setActivePreset] = useState(null);
  const [isSettingPreset, setIsSettingPreset] = useState(false);
  const [clickFeedback, setClickFeedback] = useState(null); // {x,y} in canvas coords

  // ── Refs for canvas overlay ─────────────────────────────────────────
  const containerRef = useRef(null);
  const canvasRef    = useRef(null);
  const imgRef       = useRef(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [videoNatural, setVideoNatural]   = useState({ w: 0, h: 0 });

  // Track container resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerSize({ w: width, h: height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Track natural video dimensions from the MJPEG img element
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const onLoad = () => {
      if (img.naturalWidth && img.naturalHeight) {
        setVideoNatural({ w: img.naturalWidth, h: img.naturalHeight });
      }
    };
    img.addEventListener('load', onLoad);
    // Fire once immediately if already loaded
    if (img.naturalWidth) onLoad();
    return () => img.removeEventListener('load', onLoad);
  }, []);

  // ── Draw canvas overlay ─────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width  = containerSize.w;
    canvas.height = containerSize.h;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Click feedback animation
    if (clickFeedback) {
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(clickFeedback.x, clickFeedback.y, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(clickFeedback.x - 8, clickFeedback.y);
      ctx.lineTo(clickFeedback.x + 8, clickFeedback.y);
      ctx.moveTo(clickFeedback.x, clickFeedback.y - 8);
      ctx.lineTo(clickFeedback.x, clickFeedback.y + 8);
      ctx.stroke();
    }
  }, [containerSize, clickFeedback]);

  // ── Normalised click handler ────────────────────────────────────────
  const handleCanvasClick = useCallback((e) => {
    if (tracking !== 'Global') return;

    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Compute the actual video region (accounting for letterboxing)
    const vr = getVideoRect(
      containerSize.w, containerSize.h,
      videoNatural.w, videoNatural.h
    );

    // Check if click is inside the video region
    if (clickX < vr.x || clickX > vr.x + vr.w ||
        clickY < vr.y || clickY > vr.y + vr.h) {
      return; // clicked on letterbox — ignore
    }

    // Normalise to [0, 1] relative to the video region
    const normX = (clickX - vr.x) / vr.w;
    const normY = (clickY - vr.y) / vr.h;

    // Visual feedback
    setClickFeedback({ x: clickX, y: clickY });
    setTimeout(() => setClickFeedback(null), 600);

    // Send to backend
    fetch(`${API}/api/track_point/${device.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: normX, y: normY }),
    }).then(() => setTracking('Acquired')).catch(() => {});
  }, [tracking, containerSize, videoNatural, device.id]);

  // ── PTZ ──────────────────────────────────────────────────────────────
  const ptz = async (action, command, speed = 5) => {
    if (tracking !== 'None' && action === 'start') stopTracking();
    try { await fetch(`${API}/ptz/${device.id}?action=${action}&code=${command}&speed=${speed}`); } catch {}
  };

  const goHome = async () => {
    try { await fetch(`${API}/ptz/${device.id}?action=start&code=GotoPreset&speed=1`); } catch {}
  };

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

  // ── Tracking toggles ─────────────────────────────────────────────────
  const setTrackingMode = async (mode) => {
    const next = tracking === mode ? 'None' : mode;
    setTracking(next);
    try {
      await fetch(`${API}/api/tracking/${device.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: next })
      });
    } catch {}
  };

  const stopTracking = async () => {
    setTracking('None');
    try {
      await fetch(`${API}/api/tracking/${device.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'None' })
      });
    } catch {}
  };

  const snapshot = async () => {
    try { await fetch(`${API}/api/snapshot/${device.id}`, { method: 'POST' }); alert('Snapshot saved!'); } catch {}
  };

  const isActive   = device.status === 'Active';
  const isTracking = tracking === 'Global';
  const isAcquired = tracking === 'Acquired';
  const isAuto     = tracking === 'Auto';

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#06080d', display: 'flex', flexDirection: 'column', zIndex: 30 }}>

      {/* ── Header ── */}
      <div style={{ height: 52, borderBottom: `1px solid ${C.border}`, background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', flexShrink: 0, gap: 12 }}>
        {/* Left: back + camera id */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <ArrowLeft size={15} /> Back
          </button>
          <div style={{ width: 1, height: 16, background: C.border }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Video size={15} color={C.muted} />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '0.05em' }}>{device.id}</span>
            <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', background: isActive ? '#10b98122' : '#ef444422', color: isActive ? '#10b981' : '#ef4444', border: `1px solid ${isActive ? '#10b98144' : '#ef444444'}` }}>
              {device.status}
            </span>
          </div>
        </div>

        {/* Right: control buttons */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <HeaderBtn onClick={goHome} active={false}>
            <Home size={13} /> Home
          </HeaderBtn>
          <HeaderBtn onClick={() => setShowPresets(s => !s)} active={showPresets}
            activeColor='#0e7490' activeBorder='#06b6d4' activeText='#67e8f9'>
            <BookMarked size={13} /> Presets
          </HeaderBtn>
          <HeaderBtn onClick={() => setTrackingMode('Auto')} active={isAuto}
            activeColor='#b45309' activeBorder='#f59e0b' activeText='#fcd34d'>
            <Cpu size={13} /> Auto
          </HeaderBtn>
          <HeaderBtn onClick={() => setTrackingMode('Global')} active={isTracking || isAcquired}
            activeColor='#4f46e5' activeBorder='#6366f1' activeText='#818cf8'>
            <MousePointerClick size={13} /> Target Lock
          </HeaderBtn>
          <button onClick={snapshot} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', background: '#4f46e5', border: '1px solid #6366f1', color: '#fff' }}>
            <Camera size={13} /> Snapshot
          </button>
        </div>
      </div>

      {/* ── Preset quick-bar ── */}
      {showPresets && (
        <div style={{ background: '#0d1117', borderBottom: `1px solid ${C.border}`, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: isSettingPreset ? '#ef4444' : C.muted, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginRight: 4 }}>
            {isSettingPreset ? 'Select number to save:' : 'Jump to Preset:'}
          </span>
          {[1, 2, 3, 4, 5, 6].map(n => (
            <button key={n} onClick={() => gotoPreset(n)}
              style={{ 
                width: 34, height: 28, borderRadius: 6, 
                background: activePreset === n ? (isSettingPreset ? '#991b1b' : '#0e7490') : '#1a2233', 
                border: `1px solid ${activePreset === n ? (isSettingPreset ? '#ef4444' : '#06b6d4') : (isSettingPreset ? '#7f1d1d' : C.border)}`, 
                color: activePreset === n ? (isSettingPreset ? '#fca5a5' : '#67e8f9') : (isSettingPreset ? '#ef4444' : C.muted), 
                fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all 0.12s' 
              }}>
              {n}
            </button>
          ))}
          <div style={{ width: 1, height: 20, background: C.border, margin: '0 4px' }} />
          <button onClick={() => setIsSettingPreset(!isSettingPreset)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, background: isSettingPreset ? '#7f1d1d' : '#1a2233', border: `1px solid ${isSettingPreset ? '#ef4444' : C.border}`, color: isSettingPreset ? '#fca5a5' : C.muted, fontSize: 11, cursor: 'pointer' }}>
            <Edit2 size={12} /> {isSettingPreset ? 'Cancel Save' : 'Save'}
          </button>
          <div style={{ width: 1, height: 20, background: C.border, margin: '0 4px' }} />
          <button onClick={goHome}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, background: '#1a2233', border: `1px solid ${C.border}`, color: C.muted, fontSize: 11, cursor: 'pointer' }}>
            <Home size={12} /> Home
          </button>
        </div>
      )}

      {/* ── Video area with canvas overlay ── */}
      <div
        ref={containerRef}
        style={{ flex: 1, position: 'relative', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
      >
        {isActive ? (
          <>
            <img
              ref={imgRef}
              src={`${API}/video/${device.id}`}
              style={{ width: '100%', height: '100%', objectFit: 'contain', zIndex: 10, position: 'relative', pointerEvents: 'none' }}
              alt="live stream"
            />
            {/* Transparent canvas overlay — handles clicks with letterbox-aware normalisation */}
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              style={{
                position: 'absolute', inset: 0, zIndex: 15,
                cursor: isTracking ? 'crosshair' : 'default',
                pointerEvents: isTracking ? 'auto' : 'none',
              }}
            />
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, color: '#ef4444' }}>
            <WifiOff size={64} style={{ opacity: 0.7 }} />
            <span style={{ fontFamily: 'monospace', fontSize: 18, letterSpacing: '0.2em', fontWeight: 700, textTransform: 'uppercase' }}>Signal Lost</span>
          </div>
        )}

        {/* HUD — tracking status */}
        <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 20, pointerEvents: 'none' }}>
          <div style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', borderRadius: 4, padding: '3px 10px', border: '1px solid rgba(255,255,255,0.08)', fontSize: 10, fontFamily: 'monospace', color: '#fff' }}>
            TRACKING:{' '}
            {isAcquired && <span style={{ color: '#10b981', fontWeight: 700 }}>TARGET ACQUIRED</span>}
            {isTracking && !isAcquired && <span style={{ color: '#818cf8', fontWeight: 700 }}>CLICK TO LOCK</span>}
            {isAuto && <span style={{ color: '#f59e0b', fontWeight: 700 }}>AUTO MOVEMENT</span>}
            {tracking === 'None' && <span style={{ color: '#6b7280' }}>IDLE</span>}
          </div>
        </div>

        {/* ── PTZ Controls (floating bottom-right) ── */}
        <div style={{ position: 'absolute', bottom: 20, right: 20, zIndex: 20, background: 'rgba(10,13,20,0.82)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 12, display: 'flex', gap: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>

          {/* D-pad */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 32px)', gridTemplateRows: 'repeat(3, 32px)', gap: 3 }}>
            <div />
            <PtzBtn title="Tilt Up" onMouseDown={() => ptz('start', 'Up')} onMouseUp={() => ptz('stop', 'Up')} onMouseLeave={() => ptz('stop', 'Up')}><ChevronUp size={15} /></PtzBtn>
            <div />
            <PtzBtn title="Pan Left" onMouseDown={() => ptz('start', 'Left')} onMouseUp={() => ptz('stop', 'Left')} onMouseLeave={() => ptz('stop', 'Left')}><ChevronLeft size={15} /></PtzBtn>
            <PtzBtn title="Go Home" onClick={goHome} style={{ background: '#1e1b4b' }}><Home size={13} color="#818cf8" /></PtzBtn>
            <PtzBtn title="Pan Right" onMouseDown={() => ptz('start', 'Right')} onMouseUp={() => ptz('stop', 'Right')} onMouseLeave={() => ptz('stop', 'Right')}><ChevronRight size={15} /></PtzBtn>
            <div />
            <PtzBtn title="Tilt Down" onMouseDown={() => ptz('start', 'Down')} onMouseUp={() => ptz('stop', 'Down')} onMouseLeave={() => ptz('stop', 'Down')}><ChevronDown size={15} /></PtzBtn>
            <div />
          </div>

          {/* Divider */}
          <div style={{ width: 1, background: 'rgba(255,255,255,0.08)', alignSelf: 'stretch' }} />

          {/* Zoom / Focus + Auto toggle */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="ptz-btn" title="Zoom Wide" style={{ padding: '4px 8px', fontSize: 10, gap: 4, display: 'flex', alignItems: 'center' }} onMouseDown={() => ptz('start', 'ZoomWide')} onMouseUp={() => ptz('stop', 'ZoomWide')} onMouseLeave={() => ptz('stop', 'ZoomWide')}>
                <ZoomOut size={11} /> Wide
              </button>
              <button className="ptz-btn" title="Zoom Tele" style={{ padding: '4px 8px', fontSize: 10, gap: 4, display: 'flex', alignItems: 'center' }} onMouseDown={() => ptz('start', 'ZoomTele')} onMouseUp={() => ptz('stop', 'ZoomTele')} onMouseLeave={() => ptz('stop', 'ZoomTele')}>
                <ZoomIn size={11} /> Tele
              </button>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="ptz-btn" title="Focus Near" style={{ padding: '4px 8px', fontSize: 10, gap: 4, display: 'flex', alignItems: 'center' }} onMouseDown={() => ptz('start', 'FocusNear')} onMouseUp={() => ptz('stop', 'FocusNear')} onMouseLeave={() => ptz('stop', 'FocusNear')}>
                <Focus size={11} /> Near
              </button>
              <button className="ptz-btn" title="Focus Far" style={{ padding: '4px 8px', fontSize: 10, gap: 4, display: 'flex', alignItems: 'center' }} onMouseDown={() => ptz('start', 'FocusFar')} onMouseUp={() => ptz('stop', 'FocusFar')} onMouseLeave={() => ptz('stop', 'FocusFar')}>
                <Scan size={11} /> Far
              </button>
            </div>

            {/* Auto Movement inline toggle */}
            <button
              onClick={() => setTrackingMode('Auto')}
              title="Toggle Auto Movement"
              style={{
                padding: '4px 8px', fontSize: 10, gap: 4, display: 'flex', alignItems: 'center',
                justifyContent: 'center', borderRadius: 6, cursor: 'pointer',
                background: isAuto ? '#b4530933' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${isAuto ? '#f59e0b' : 'rgba(255,255,255,0.1)'}`,
                color: isAuto ? '#fcd34d' : C.muted,
                transition: 'all 0.15s',
              }}
            >
              <Cpu size={11} /> {isAuto ? 'Auto ON' : 'Auto'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
