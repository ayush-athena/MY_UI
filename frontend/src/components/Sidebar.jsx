import React from 'react';
import { Shield, Video, User, ChevronsUpDown } from 'lucide-react';

export default function Sidebar() {
  return (
    <aside style={{ width: 240, background: '#131826', borderRight: '1px solid #1f2937', display: 'flex', flexDirection: 'column', flexShrink: 0, zIndex: 20 }}>
      {/* Logo */}
      <div style={{ padding: '24px 20px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 36, height: 36, background: '#1f2937', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Shield size={18} color="#e5e7eb" />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.15em', color: '#fff' }}>ATHENA CAMERA SYSTEM</div>
          <div style={{ fontSize: 9, letterSpacing: '0.12em', color: '#6b7280', textTransform: 'uppercase' }}>Command &amp; Control</div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: '#1f2937', margin: '0 16px 12px' }} />

      {/* Nav */}
      <nav style={{ flex: 1, padding: '4px 12px' }}>
        <div className="nav-item active">
          <Video size={16} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Cam</span>
        </div>
      </nav>

      {/* User */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #1f2937', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <User size={15} color="#d1d5db" />
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#f3f4f6' }}>Operator 1</div>
          <div style={{ fontSize: 10, color: '#6b7280' }}>Administrator</div>
        </div>
        <ChevronsUpDown size={13} color="#4b5563" />
      </div>
    </aside>
  );
}
