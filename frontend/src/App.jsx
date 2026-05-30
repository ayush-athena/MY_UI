import React from 'react';
import { AthenaProvider, useAthena } from './context/AthenaContext';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import VideoView from './components/VideoView';
import './index.css';

function AppShell() {
  const {
    devices, alerts, snapshots,
    activeCamera, setActiveCamera,
  } = useAthena();

  const [settingsOpen, setSettingsOpen] = React.useState(false);

  return (
    <div style={{ height: '100vh', display: 'flex', overflow: 'hidden', background: '#0a0d14', color: '#e5e7eb', fontFamily: 'Inter, sans-serif' }}>
      <Sidebar />

      <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {!activeCamera ? (
          <Dashboard
            devices={devices}
            alerts={alerts}
            snapshots={snapshots}
            onViewCamera={setActiveCamera}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        ) : (
          <VideoView device={activeCamera} onClose={() => setActiveCamera(null)} />
        )}
      </main>

      {settingsOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="glass-panel" style={{ width: 360, padding: 24, position: 'relative' }}>
            <button onClick={() => setSettingsOpen(false)} style={{ position: 'absolute', top: 14, right: 14, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 18 }}>✕</button>
            <h3 style={{ margin: '0 0 10px', color: '#fff', fontSize: 16 }}>Settings</h3>
            <p style={{ color: '#9ca3af', fontSize: 13 }}>Add/Edit device configuration here.</p>
            <button onClick={() => setSettingsOpen(false)} style={{ marginTop: 16, padding: '8px 16px', background: '#1f2937', border: '1px solid #374151', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 12 }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AthenaProvider>
      <AppShell />
    </AthenaProvider>
  );
}
