import React from 'react';
import { useAthena } from '../context/AthenaContext';
import {
  Bell, Settings, Monitor, Video, VideoOff, Wrench,
  Search, LayoutGrid, List, Download, MoreVertical,
  Edit2, MonitorPlay, AlertCircle, Image as ImageIcon,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Home, ZoomIn, ZoomOut, Focus, Scan,
  Camera, Cpu, MousePointerClick, BookMarked
} from 'lucide-react';
import StatusChart from './StatusChart';

const C = {
  bg: '#0a0d14',
  panel: '#131826',
  border: '#1f2937',
  text: '#e5e7eb',
  muted: '#9ca3af',
  dim: '#6b7280',
};

function MetricCard({ icon, iconColor, iconBg, label, value, pct, ringColor, ringFade }) {
  return (
    <div className="glass-panel" style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 48, height: 48, borderRadius: 8, background: iconBg, border: `1px solid ${iconColor}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {React.cloneElement(icon, { size: 22, color: iconColor })}
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted }}>{label}</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#fff', lineHeight: 1.1 }}>{value}</div>
          <div style={{ fontSize: 10, color: C.dim }}>{pct}% of total</div>
        </div>
      </div>
      {pct !== undefined && (
        <div className="metric-ring" style={{ borderColor: `${ringFade}`, borderTopColor: ringColor }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: ringColor }}>{pct}%</span>
        </div>
      )}
    </div>
  );
}

function PtzBtn({ children, ...props }) {
  return (
    <button
      {...props}
      style={{
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#f3f4f6',
        cursor: 'pointer',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        ...props.style
      }}
      onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
      onMouseOut={e => e.currentTarget.style.background = props.style?.background || 'rgba(255,255,255,0.06)'}
    >
      {children}
    </button>
  );
}

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

export default function Dashboard({ devices, alerts, snapshots, onViewCamera, onOpenSettings }) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [viewMode, setViewMode] = React.useState('grid');
  const [activeTab, setActiveTab] = React.useState('All Camera');
  const [healthData, setHealthData] = React.useState(null);
  const [selectedFullViewCam, setSelectedFullViewCam] = React.useState(null);

  const [showAllSnapshots, setShowAllSnapshots] = React.useState(false);
  const [showAllAlerts, setShowAllAlerts] = React.useState(false);

  const [showPresets, setShowPresets] = React.useState(false);
  const [activePreset, setActivePreset] = React.useState(null);
  const [isSettingPreset, setIsSettingPreset] = React.useState(false);
  const [tracking, setTracking] = React.useState('None');

  const goHome = async () => {
    if (!selectedFullViewCam) return;
    try { await fetch(`http://127.0.0.1:5000/ptz/${selectedFullViewCam}?action=start&code=GotoPreset&speed=1`); } catch {}
  };

  const gotoPreset = async (n) => {
    if (!selectedFullViewCam) return;
    if (isSettingPreset) {
      setPreset(n);
      return;
    }
    setActivePreset(n);
    try { await fetch(`http://127.0.0.1:5000/ptz/${selectedFullViewCam}?action=start&code=GotoPreset&speed=${n}`); } catch {}
    setTimeout(() => setActivePreset(null), 800);
  };

  const setPreset = async (n) => {
    if (!selectedFullViewCam) return;
    setActivePreset(n);
    try { await fetch(`http://127.0.0.1:5000/ptz/${selectedFullViewCam}?action=start&code=SetPreset&speed=${n}`); } catch {}
    setTimeout(() => {
      setActivePreset(null);
      setIsSettingPreset(false);
    }, 800);
  };

  const setTrackingMode = async (mode) => {
    if (!selectedFullViewCam) return;
    const next = tracking === mode ? 'None' : mode;
    setTracking(next);
    try {
      await fetch(`http://127.0.0.1:5000/api/tracking/${selectedFullViewCam}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: next })
      });
    } catch {}
  };

  const snapshot = async () => {
    if (!selectedFullViewCam) return;
    try { await fetch(`http://127.0.0.1:5000/api/snapshot/${selectedFullViewCam}`, { method: 'POST' }); alert('Snapshot saved!'); } catch {}
  };

  // CRUD States
  const [isDeleteMode, setIsDeleteMode] = React.useState(false);
  const [selectedForDeletion, setSelectedForDeletion] = React.useState(new Set());
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [addForm, setAddForm] = React.useState({ id: '', name: '', ip: '', username: '', password: '' });

  React.useEffect(() => {
    if (activeTab !== 'Camera Management') return;
    const fetchHealth = async () => {
      try {
        const res = await fetch('http://127.0.0.1:5000/api/health');
        if (res.ok) setHealthData(await res.json());
      } catch (e) { console.error(e); }
    };
    fetchHealth();
    const timer = setInterval(fetchHealth, 2000);
    return () => clearInterval(timer);
  }, [activeTab]);

  const { globalTrackingStatus } = useAthena();
  React.useEffect(() => {
    if (globalTrackingStatus?.global_active) {
      const activeCams = globalTrackingStatus.cameras.filter(c => c.has_target_box && c.missed_frames < 10);
      if (activeCams.length > 0) {
        const bestCam = activeCams.reduce((prev, curr) => (curr.target_area > prev.target_area ? curr : prev));
        if (bestCam && bestCam.id !== selectedFullViewCam) {
            setSelectedFullViewCam(bestCam.id);
            if (activeTab === 'Full View') {
              console.log("[Stream Switch] Auto-focusing on", bestCam.id);
            }
        }
      }
    }
  }, [globalTrackingStatus, selectedFullViewCam, activeTab]);

  const total = devices.length;
  const active = devices.filter(d => d.status === 'Active').length;
  const inactive = devices.filter(d => d.status === 'Inactive').length;
  const maint = devices.filter(d => d.status === 'Maintenance').length;

  const pct = (n) => total ? Math.round((n / total) * 100) : 0;

  const statusColor = (s) => s === 'Active' ? '#10b981' : s === 'Maintenance' ? '#f59e0b' : '#ef4444';

  const filteredDevices = devices.filter(dev => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (dev.id && dev.id.toLowerCase().includes(q)) ||
      (dev.location && dev.location.toLowerCase().includes(q)) ||
      (dev.ip && dev.ip.toLowerCase().includes(q))
    );
  });

  const handleExport = () => {
    const header = "Camera ID,Location,IP,Type,Status\n";
    const rows = filteredDevices.map(d => 
      `${d.id || ''},${d.location || ''},${d.ip || ''},${d.camera_type || 'PTZ'},${d.status || ''}`
    ).join("\n");
    
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'athena_cameras_export.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleEditName = async (dev) => {
    const newName = window.prompt(`Enter new name for camera (${dev.id}):`, dev.name || dev.id);
    if (newName && newName.trim() !== "") {
      try {
        await fetch(`http://127.0.0.1:5000/api/config/${dev.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName.trim() })
        });
        // The AthenaContext polls devices every 3s, so UI will auto-update shortly
      } catch (e) {
        console.error("Failed to update camera name:", e);
      }
    }
  };

  const [isMasterAuto, setIsMasterAuto] = React.useState(false);

  const toggleMasterTrack = async () => {
    const next = !isMasterAuto;
    setIsMasterAuto(next);
    try {
      await fetch(`http://127.0.0.1:5000/api/master_track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: next ? 'Auto' : 'Manual' })
      });
    } catch (e) { console.error(e); }
  };

  const handleOverrideStatus = async (dev, status) => {
    try {
      await fetch(`http://127.0.0.1:5000/api/config/${dev.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override_status: status })
      });
    } catch (e) { console.error(e); }
  };

  const handlePtz = (action, code, speed = 5) => {
    if (!selectedFullViewCam) return;
    fetch(`http://127.0.0.1:5000/ptz/${selectedFullViewCam}?action=${action}&code=${code}&speed=${speed}`)
      .catch(console.error);
  };

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    if (!addForm.id) return alert("Device ID is required");
    try {
      const res = await fetch(`http://127.0.0.1:5000/api/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm)
      });
      if (res.ok) {
        setIsAddModalOpen(false);
        setAddForm({ id: '', name: '', ip: '', username: '', password: '' });
      } else {
        const data = await res.json();
        alert(data.error || "Failed to add camera");
      }
    } catch (e) {
      console.error("Add camera error:", e);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedForDeletion.size === 0) return;
    if (!window.confirm(`Delete ${selectedForDeletion.size} camera(s)? This cannot be undone.`)) return;
    
    for (const id of selectedForDeletion) {
      try {
        await fetch(`http://127.0.0.1:5000/api/devices/${id}`, { method: 'DELETE' });
      } catch (e) {
        console.error(`Failed to delete ${id}:`, e);
      }
    }
    setSelectedForDeletion(new Set());
    setIsDeleteMode(false);
  };

  const toggleDeleteSelection = (id) => {
    const next = new Set(selectedForDeletion);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedForDeletion(next);
  };

  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 20, background: C.bg }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#fff' }}>Cam</h2>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <button onClick={toggleMasterTrack} style={{ background: isMasterAuto ? '#10b981' : 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 600, color: isMasterAuto ? '#fff' : C.text, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: '0.2s' }}>
            <Focus size={14} color={isMasterAuto ? "#fff" : C.muted} />
            Master Track: {isMasterAuto ? 'ON' : 'OFF'}
          </button>
          <div style={{ width: 1, height: 24, background: C.border }} />
          <button onClick={() => setIsAddModalOpen(true)} style={{ background: '#10b981', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 600, color: '#fff', cursor: 'pointer' }}>
            + Add Camera
          </button>
          <button onClick={() => { setIsDeleteMode(!isDeleteMode); setSelectedForDeletion(new Set()); }} style={{ background: isDeleteMode ? '#ef4444' : 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 600, color: '#fff', cursor: 'pointer' }}>
            {isDeleteMode ? 'Cancel Selection' : 'Manage Cameras'}
          </button>
          <button onClick={() => {}} style={{ background: 'none', border: 'none', cursor: 'pointer', position: 'relative', color: C.muted }}>
            <Bell size={18} />
            {alerts.length > 0 && (
              <span style={{ position: 'absolute', top: -4, right: -4, width: 14, height: 14, background: '#ef4444', borderRadius: '50%', fontSize: 8, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{alerts.length}</span>
            )}
          </button>
          <button onClick={onOpenSettings} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted }}>
            <Settings size={18} />
          </button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 24, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        {['All Camera', 'Full View', 'Camera Management', 'Report'].map((t, i) => (
          <button key={t} onClick={() => setActiveTab(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0', fontSize: 13, fontWeight: activeTab === t ? 600 : 400, color: activeTab === t ? '#818cf8' : C.muted, borderBottom: activeTab === t ? '2px solid #6366f1' : '2px solid transparent', marginBottom: -1 }}>
            {t}
          </button>
        ))}
      </div>

      {activeTab === 'All Camera' && (
        <>

      {/* ── Metrics ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, flexShrink: 0 }}>
        {/* Total */}
        <div className="glass-panel" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 48, height: 48, borderRadius: 8, background: '#3b82f611', border: '1px solid #3b82f633', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Monitor size={22} color="#6366f1" />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted }}>Total Cameras</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#fff', lineHeight: 1.1 }}>{total}</div>
            <div style={{ fontSize: 10, color: C.dim }}>All Registered</div>
          </div>
        </div>
        <MetricCard icon={<Video />} iconColor="#10b981" iconBg="#10b98111" label="Active Cameras" value={active} pct={pct(active)} ringColor="#10b981" ringFade="#10b98133" />
        <MetricCard icon={<VideoOff />} iconColor="#ef4444" iconBg="#ef444411" label="Inactive Cameras" value={inactive} pct={pct(inactive)} ringColor="#ef4444" ringFade="#ef444433" />
        <MetricCard icon={<Wrench />} iconColor="#f59e0b" iconBg="#f59e0b11" label="Maintenance" value={maint} pct={pct(maint)} ringColor="#f59e0b" ringFade="#f59e0b33" />
      </div>

      {/* ── Filters ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, maxWidth: 360, position: 'relative' }}>
          <Search size={14} color={C.dim} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input 
            placeholder="Search camera name, location, IP…" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px 8px 32px', fontSize: 12, color: C.text, outline: 'none' }} 
          />
        </div>
        {['Status: All', 'Camera Type: All', 'Location: All'].map(p => (
          <select key={p} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: C.muted, outline: 'none', appearance: 'none', cursor: 'pointer' }}>
            <option>{p}</option>
          </select>
        ))}
        <div style={{ display: 'flex', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 4, gap: 2 }}>
          <button onClick={() => setViewMode('grid')} style={{ background: viewMode === 'grid' ? '#374151' : 'none', border: 'none', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', color: viewMode === 'grid' ? '#fff' : C.dim, display: 'flex' }}><LayoutGrid size={15} /></button>
          <button onClick={() => setViewMode('list')} style={{ background: viewMode === 'list' ? '#374151' : 'none', border: 'none', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', color: viewMode === 'list' ? '#fff' : C.dim, display: 'flex' }}><List size={15} /></button>
        </div>
        <button onClick={handleExport} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#4f46e5', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 600, color: '#fff', cursor: 'pointer' }}>
          <Download size={13} /> Export
        </button>
      </div>

      {/* ── Camera Container ── */}
      <div style={
        viewMode === 'grid' 
          ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, flexShrink: 0 }
          : { display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0 }
      }>
        {devices.length === 0 ? (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', color: C.dim, padding: '40px 0', fontSize: 13 }}>
            Waiting for backend data…
          </div>
        ) : filteredDevices.length === 0 ? (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', color: C.dim, padding: '40px 0', fontSize: 13 }}>
            No cameras match your search.
          </div>
        ) : filteredDevices.map(dev => {
          const sc = statusColor(dev.status);
          const isList = viewMode === 'list';
          const isSelected = selectedForDeletion.has(dev.id);
          return (
            <div 
              key={dev.id} 
              className="glass-panel" 
              onClick={() => isDeleteMode ? toggleDeleteSelection(dev.id) : null}
              style={{ 
                overflow: 'hidden', 
                display: 'flex', 
                flexDirection: isList ? 'row' : 'column',
                cursor: isDeleteMode ? 'pointer' : 'default',
                border: isSelected ? '2px solid #ef4444' : `1px solid ${C.border}`,
                opacity: isDeleteMode && !isSelected ? 0.6 : 1,
                transform: isSelected ? 'scale(0.98)' : 'none',
                transition: 'all 0.2s ease'
              }}
            >
              {/* Thumbnail */}
              <div style={{ width: isList ? 240 : '100%', height: isList ? 135 : 140, background: '#000', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <img
                  src={`http://127.0.0.1:5000/video/${dev.id}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.85 }}
                  onError={e => e.currentTarget.style.display = 'none'}
                  alt={dev.id}
                />
                {/* Status badge */}
                <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 5, background: `${sc}22`, border: `1px solid ${sc}55`, borderRadius: 999, padding: '2px 8px', fontSize: 9, fontWeight: 700, color: sc, letterSpacing: '0.06em' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: sc, display: 'inline-block' }} />
                  {dev.status}
                </div>
                {/* Timestamp */}
                <div style={{ position: 'absolute', top: 8, right: 8, fontSize: 9, color: 'rgba(255,255,255,0.7)', background: 'rgba(0,0,0,0.45)', padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' }}>
                  {new Date().toLocaleTimeString('en-GB')}
                </div>
              </div>

              {/* Card body */}
              <div style={{ padding: '12px 14px', background: C.panel, flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#f3f4f6' }}>{dev.name || dev.id}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{dev.location || 'Unknown Location'}</div>
                  </div>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.dim }}><MoreVertical size={15} /></button>
                </div>
                <div style={{ display: 'flex', gap: 20, fontSize: 10, fontFamily: 'monospace', color: C.muted }}>
                  <div><span style={{ color: C.dim }}>IP</span><br />{dev.ip || '—'}</div>
                  <div><span style={{ color: C.dim }}>Type</span><br />{dev.camera_type || 'PTZ'}</div>
                  <div style={{ flex: 1, textAlign: 'right' }}>
                    <span style={{ color: C.dim }}>Override</span><br />
                    <select 
                      value={dev.override_status || 'None'} 
                      onChange={e => handleOverrideStatus(dev, e.target.value)}
                      onClick={e => e.stopPropagation()}
                      style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${C.border}`, color: '#fff', fontSize: 10, borderRadius: 4, padding: '2px 4px', cursor: 'pointer', outline: 'none' }}
                    >
                      <option value="None">Auto</option>
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                      <option value="Recording">Recording</option>
                      <option value="Maintenance">Maintenance</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => handleEditName(dev)} style={{ flex: 1, padding: '6px 0', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, color: '#818cf8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                    <Edit2 size={12} /> Edit
                  </button>
                  <button onClick={() => onViewCamera(dev)} style={{ flex: 1, padding: '6px 0', background: '#4f46e5', border: '1px solid #6366f1', borderRadius: 6, fontSize: 11, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                    <MonitorPlay size={12} /> View
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </>
      )}

      {activeTab === 'Camera Management' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 8 }}>Real-time Health Monitoring</div>
          {!healthData ? (
            <div style={{ color: C.dim, fontSize: 13 }}>Loading health metrics...</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
              {healthData.streams && healthData.streams.map(stream => {
                const dev = devices.find(d => d.id === stream.device_id) || {};
                const qColor = stream.quality === 'Excellent' ? '#10b981' : stream.quality === 'Good' ? '#3b82f6' : stream.quality === 'Poor' ? '#f59e0b' : '#ef4444';
                
                const formatTime = (secs) => {
                  if (!secs) return '00:00:00';
                  const h = Math.floor(secs / 3600);
                  const m = Math.floor((secs % 3600) / 60);
                  const s = secs % 60;
                  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                };

                return (
                  <div key={stream.device_id} className="glass-panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{dev.name || stream.device_id}</div>
                      <div style={{ fontSize: 10, fontWeight: 700, background: `${qColor}22`, color: qColor, padding: '2px 8px', borderRadius: 12, border: `1px solid ${qColor}55` }}>
                        {stream.quality || 'Unknown'}
                      </div>
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12, color: C.text }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ color: C.dim, fontSize: 10, textTransform: 'uppercase' }}>Connection</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: stream.is_connected ? '#10b981' : '#ef4444' }} />
                          {stream.is_connected ? 'Connected' : 'Offline'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ color: C.dim, fontSize: 10, textTransform: 'uppercase' }}>Stream FPS</span>
                        <div style={{ fontWeight: 600 }}>{stream.fps !== undefined ? stream.fps.toFixed(1) : '—'}</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ color: C.dim, fontSize: 10, textTransform: 'uppercase' }}>Blur Score</span>
                        <div style={{ fontWeight: 600 }}>{stream.blur_score !== undefined ? stream.blur_score.toFixed(1) : '—'}</div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ color: C.dim, fontSize: 10, textTransform: 'uppercase' }}>Uptime</span>
                        <div style={{ fontFamily: 'monospace' }}>{formatTime(stream.active_time)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'Full View' && (
        <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: 24, height: 'calc(100vh - 180px)', minHeight: 600 }}>
          {/* Main Focus Area */}
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 12, border: `1px solid ${C.border}` }}>
            <div style={{ padding: '12px 20px', background: 'rgba(0,0,0,0.4)', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>
                {selectedFullViewCam ? (devices.find(d => d.id === selectedFullViewCam)?.name || selectedFullViewCam) : 'Select a camera'}
              </div>
              {selectedFullViewCam && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginRight: 16 }}>
                    <HeaderBtn onClick={goHome} active={false}>
                      <Home size={13} /> Home
                    </HeaderBtn>
                    <HeaderBtn onClick={() => setShowPresets(s => !s)} active={showPresets}
                      activeColor='#0e7490' activeBorder='#06b6d4' activeText='#67e8f9'>
                      <BookMarked size={13} /> Presets
                    </HeaderBtn>
                    <HeaderBtn onClick={() => setTrackingMode('Auto')} active={tracking === 'Auto'}
                      activeColor='#b45309' activeBorder='#f59e0b' activeText='#fcd34d'>
                      <Cpu size={13} /> Auto
                    </HeaderBtn>
                    <HeaderBtn onClick={() => setTrackingMode('Global')} active={tracking === 'Global' || tracking === 'Acquired'}
                      activeColor='#4f46e5' activeBorder='#6366f1' activeText='#818cf8'>
                      <MousePointerClick size={13} /> Target Lock
                    </HeaderBtn>
                    <button onClick={snapshot} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer', background: '#4f46e5', border: '1px solid #6366f1', color: '#fff' }}>
                      <Camera size={13} /> Snapshot
                    </button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: '#10b981', background: '#10b98122', padding: '4px 10px', borderRadius: 999, border: '1px solid #10b98155' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                    LIVE
                  </div>
                </div>
              )}
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
            <div style={{ flex: 1, background: '#000', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {selectedFullViewCam ? (
                <>
                  <img
                    src={`http://127.0.0.1:5000/video/${selectedFullViewCam}`}
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    alt={selectedFullViewCam}
                    onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.parentElement.innerHTML = '<div style="color: #666; font-size: 14px;">Stream Offline</div>'; }}
                  />
                  {/* PTZ Controls overlay */}
                  <div style={{ position: 'absolute', bottom: 20, right: 20, zIndex: 20, background: 'rgba(10,13,20,0.82)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 12, display: 'flex', gap: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
                    {/* D-pad */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 32px)', gridTemplateRows: 'repeat(3, 32px)', gap: 3 }}>
                      <div />
                      <PtzBtn title="Tilt Up" onMouseDown={() => handlePtz('start', 'Up')} onMouseUp={() => handlePtz('stop', 'Up')} onMouseLeave={() => handlePtz('stop', 'Up')}><ChevronUp size={15} /></PtzBtn>
                      <div />
                      <PtzBtn title="Pan Left" onMouseDown={() => handlePtz('start', 'Left')} onMouseUp={() => handlePtz('stop', 'Left')} onMouseLeave={() => handlePtz('stop', 'Left')}><ChevronLeft size={15} /></PtzBtn>
                      <PtzBtn title="Go Home" onMouseDown={() => handlePtz('start', 'Home')} style={{ background: '#1e1b4b' }}><Home size={13} color="#818cf8" /></PtzBtn>
                      <PtzBtn title="Pan Right" onMouseDown={() => handlePtz('start', 'Right')} onMouseUp={() => handlePtz('stop', 'Right')} onMouseLeave={() => handlePtz('stop', 'Right')}><ChevronRight size={15} /></PtzBtn>
                      <div />
                      <PtzBtn title="Tilt Down" onMouseDown={() => handlePtz('start', 'Down')} onMouseUp={() => handlePtz('stop', 'Down')} onMouseLeave={() => handlePtz('stop', 'Down')}><ChevronDown size={15} /></PtzBtn>
                      <div />
                    </div>
                    {/* Divider */}
                    <div style={{ width: 1, background: 'rgba(255,255,255,0.08)', alignSelf: 'stretch' }} />
                    {/* Zoom / Focus */}
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5 }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="ptz-btn" title="Zoom Wide" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 6, cursor: 'pointer', padding: '4px 8px', fontSize: 10, gap: 4, display: 'flex', alignItems: 'center' }} onMouseDown={() => handlePtz('start', 'ZoomWide')} onMouseUp={() => handlePtz('stop', 'ZoomWide')} onMouseLeave={() => handlePtz('stop', 'ZoomWide')}>
                          <ZoomOut size={11} /> Wide
                        </button>
                        <button className="ptz-btn" title="Zoom Tele" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 6, cursor: 'pointer', padding: '4px 8px', fontSize: 10, gap: 4, display: 'flex', alignItems: 'center' }} onMouseDown={() => handlePtz('start', 'ZoomTele')} onMouseUp={() => handlePtz('stop', 'ZoomTele')} onMouseLeave={() => handlePtz('stop', 'ZoomTele')}>
                          <ZoomIn size={11} /> Tele
                        </button>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="ptz-btn" title="Focus Near" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 6, cursor: 'pointer', padding: '4px 8px', fontSize: 10, gap: 4, display: 'flex', alignItems: 'center' }} onMouseDown={() => handlePtz('start', 'FocusNear')} onMouseUp={() => handlePtz('stop', 'FocusNear')} onMouseLeave={() => handlePtz('stop', 'FocusNear')}>
                          <Focus size={11} /> Near
                        </button>
                        <button className="ptz-btn" title="Focus Far" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 6, cursor: 'pointer', padding: '4px 8px', fontSize: 10, gap: 4, display: 'flex', alignItems: 'center' }} onMouseDown={() => handlePtz('start', 'FocusFar')} onMouseUp={() => handlePtz('stop', 'FocusFar')} onMouseLeave={() => handlePtz('stop', 'FocusFar')}>
                          <Scan size={11} /> Far
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ color: C.dim, fontSize: 15, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <MonitorPlay size={48} opacity={0.5} />
                  <span>Select a camera from the right panel to view here</span>
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Camera List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', paddingRight: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', position: 'sticky', top: 0, background: C.bg, paddingBottom: 8, zIndex: 10 }}>
              Available Streams ({filteredDevices.length})
            </div>
            {filteredDevices.map(dev => {
              const isSelected = selectedFullViewCam === dev.id;
              const sc = statusColor(dev.status);
              return (
                <div 
                  key={dev.id} 
                  onClick={() => setSelectedFullViewCam(dev.id)}
                  className="glass-panel" 
                  style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    overflow: 'hidden', 
                    cursor: 'pointer', 
                    border: isSelected ? '2px solid #6366f1' : `1px solid ${C.border}`,
                    transform: isSelected ? 'scale(1.02)' : 'none',
                    transition: 'all 0.2s ease',
                    boxShadow: isSelected ? '0 0 15px rgba(99, 102, 241, 0.3)' : 'none'
                  }}
                >
                  <div style={{ height: 100, background: '#000', position: 'relative' }}>
                    <img
                      src={`http://127.0.0.1:5000/video/${dev.id}`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: isSelected ? 1 : 0.7 }}
                      alt={dev.id}
                    />
                    <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', alignItems: 'center', gap: 4, background: `${sc}cc`, borderRadius: 4, padding: '2px 6px', fontSize: 9, fontWeight: 700, color: '#fff' }}>
                      {dev.status}
                    </div>
                  </div>
                  <div style={{ padding: '10px 12px', background: isSelected ? 'rgba(99, 102, 241, 0.1)' : C.panel }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: isSelected ? '#818cf8' : '#f3f4f6' }}>{dev.name || dev.id}</div>
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{dev.location || 'Unknown'}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Bottom Panels ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, flexShrink: 0, paddingBottom: 40 }}>

        {/* Alerts */}
        <div className="glass-panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', height: 260 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Alerts</span>
            <button onClick={() => setShowAllAlerts(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#818cf8', padding: 0 }}>View All</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {alerts.length === 0
              ? <div style={{ textAlign: 'center', color: C.dim, fontSize: 12, marginTop: 16 }}>No alerts</div>
              : alerts.slice(0, 6).map(a => {
                const ac = a.severity === 'critical' ? '#ef4444' : a.severity === 'warning' ? '#f59e0b' : '#6366f1';
                return (
                  <div key={a.id} style={{ padding: '10px 12px', background: C.bg, borderRadius: 6, border: `1px solid ${ac}33`, borderLeft: `3px solid ${ac}`, display: 'flex', gap: 10, alignItems: 'center' }}>
                    <AlertCircle size={14} color={ac} style={{ flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 11, color: C.text }}><strong>{a.device_id}</strong> {a.message}</div>
                      <div style={{ fontSize: 9, color: C.dim }}>{new Date(a.timestamp * 1000).toLocaleString('en-GB')}</div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Snapshots */}
        <div className="glass-panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', height: 260 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Snapshots / Recordings</span>
            <button onClick={() => setShowAllSnapshots(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#818cf8', padding: 0 }}>View All</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {snapshots.length === 0
              ? <div style={{ gridColumn: '1/-1', textAlign: 'center', color: C.dim, fontSize: 12, marginTop: 16 }}>No snapshots</div>
              : snapshots.slice(0, 4).map(s => (
                <div key={s.id} style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', height: 90, border: `1px solid ${C.border}`, cursor: 'pointer' }}>
                  <img src={`http://127.0.0.1:5000${s.url}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="snap" />
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.75), transparent)' }} />
                  <div style={{ position: 'absolute', bottom: 6, left: 8, right: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#fff' }}>{s.device_id}</div>
                      <div style={{ fontSize: 8, color: '#9ca3af' }}>{new Date(s.timestamp * 1000).toLocaleTimeString('en-GB')}</div>
                    </div>
                    <ImageIcon size={11} color="rgba(255,255,255,0.7)" />
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* Status Overview */}
        <div className="glass-panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', height: 260 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Camera Status Overview</span>
            <button onClick={() => setActiveTab('Camera Management')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#818cf8', padding: 0 }}>View All</button>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ width: 120, height: 120, position: 'relative', flexShrink: 0 }}>
              <StatusChart active={active} inactive={inactive} maintenance={maint} />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{total}</div>
                <div style={{ fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total</div>
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { label: 'Active', count: active, color: '#10b981' },
                { label: 'Inactive', count: inactive, color: '#ef4444' },
                { label: 'Maintenance', count: maint, color: '#f59e0b' },
              ].map(r => (
                <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.text }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: r.color }} />
                    {r.label}
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 11, color: C.muted }}>{r.count} ({pct(r.count)}%)</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center', fontSize: 10, color: '#374151', paddingBottom: 8 }}>All times are in local time</div>

      {/* ── Floating Delete Button ── */}
      {isDeleteMode && selectedForDeletion.size > 0 && (
        <div style={{ position: 'fixed', bottom: 40, left: '50%', transform: 'translateX(-50%)', zIndex: 100 }}>
          <button onClick={handleDeleteSelected} style={{ background: '#ef4444', border: 'none', borderRadius: 24, padding: '12px 24px', fontSize: 14, fontWeight: 700, color: '#fff', cursor: 'pointer', boxShadow: '0 10px 25px rgba(239, 68, 68, 0.4)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={18} /> Delete Selected ({selectedForDeletion.size})
          </button>
        </div>
      )}

      {/* ── Add Camera Modal ── */}
      {isAddModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="glass-panel" style={{ width: 400, padding: 24, borderRadius: 16, display: 'flex', flexDirection: 'column', gap: 16, border: '1px solid #1f2937' }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#fff' }}>Add New Camera</h3>
            <form onSubmit={handleAddSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input required placeholder="Device ID (e.g. cam4)" value={addForm.id} onChange={e => setAddForm({...addForm, id: e.target.value})} style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, padding: 10, borderRadius: 8, color: '#fff' }} />
              <input placeholder="Display Name (Optional)" value={addForm.name} onChange={e => setAddForm({...addForm, name: e.target.value})} style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, padding: 10, borderRadius: 8, color: '#fff' }} />
              <input placeholder="IP Address" value={addForm.ip} onChange={e => setAddForm({...addForm, ip: e.target.value})} style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, padding: 10, borderRadius: 8, color: '#fff' }} />
              <input placeholder="Username" value={addForm.username} onChange={e => setAddForm({...addForm, username: e.target.value})} style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, padding: 10, borderRadius: 8, color: '#fff' }} />
              <input type="password" placeholder="Password" value={addForm.password} onChange={e => setAddForm({...addForm, password: e.target.value})} style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, padding: 10, borderRadius: 8, color: '#fff' }} />
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button type="button" onClick={() => setIsAddModalOpen(false)} style={{ flex: 1, padding: '10px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, cursor: 'pointer' }}>Cancel</button>
                <button type="submit" style={{ flex: 1, padding: '10px', background: '#10b981', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── All Snapshots Modal ── */}
      {showAllSnapshots && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}>
          <div className="glass-panel" style={{ width: '80%', height: '80%', padding: 24, borderRadius: 16, display: 'flex', flexDirection: 'column', gap: 16, border: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#fff' }}>All Snapshots & Recordings</h3>
              <button onClick={() => setShowAllSnapshots(false)} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, paddingRight: 8 }}>
              {snapshots.length === 0 ? (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', color: C.dim, fontSize: 14, marginTop: 40 }}>No snapshots available</div>
              ) : (
                snapshots.map(s => (
                  <div key={s.id} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: `1px solid ${C.border}`, aspectRatio: '16/9' }}>
                    <img src={`http://127.0.0.1:5000${s.url}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="snap" />
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent 50%)' }} />
                    <div style={{ position: 'absolute', bottom: 10, left: 12, right: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{s.device_id}</div>
                        <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{new Date(s.timestamp * 1000).toLocaleString('en-GB')}</div>
                      </div>
                      <ImageIcon size={14} color="rgba(255,255,255,0.7)" />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── All Alerts Modal ── */}
      {showAllAlerts && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}>
          <div className="glass-panel" style={{ width: '60%', height: '70%', padding: 24, borderRadius: 16, display: 'flex', flexDirection: 'column', gap: 16, border: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#fff' }}>All Alerts</h3>
              <button onClick={() => setShowAllAlerts(false)} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 20 }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, paddingRight: 8 }}>
              {alerts.length === 0 ? (
                <div style={{ textAlign: 'center', color: C.dim, fontSize: 14, marginTop: 40 }}>No alerts available</div>
              ) : (
                alerts.map(a => {
                  const ac = a.severity === 'critical' ? '#ef4444' : a.severity === 'warning' ? '#f59e0b' : '#6366f1';
                  return (
                    <div key={a.id} style={{ padding: '16px', background: C.bg, borderRadius: 8, border: `1px solid ${ac}33`, borderLeft: `4px solid ${ac}`, display: 'flex', gap: 16, alignItems: 'center' }}>
                      <AlertCircle size={20} color={ac} style={{ flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 14, color: C.text }}><strong>{a.device_id}</strong> {a.message}</div>
                        <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>{new Date(a.timestamp * 1000).toLocaleString('en-GB')}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
