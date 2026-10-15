import React from 'react';
import { Layers, HardDrive, ShieldCheck, Cpu } from 'lucide-react';

export default function Header({ currentScreen, setCurrentScreen }) {
  const navItems = [
    { id: 'home', label: 'Projects Home' },
    { id: 'import', label: 'Import Photographs' },
    { id: 'studio', label: 'Reconstruction Studio' },
  ];

  return (
    <header className="app-header">
      {/* Brand & Identity */}
      <div className="brand-section">
        <div className="brand-logo-mark" aria-hidden="true">
          <Layers size={16} strokeWidth={2.4} />
        </div>
        <div className="brand-title-group">
          <div className="brand-name">
            Aeromorph
            <span className="brand-version">UI Preview</span>
          </div>
          <span className="brand-subtitle">3D Reconstruction Studio</span>
        </div>
      </div>

      {/* Primary Navigation Tabs */}
      <nav className="nav-tabs" aria-label="Main Navigation">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-tab-btn ${currentScreen === item.id ? 'active' : ''}`}
            onClick={() => setCurrentScreen(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* Local Processing & Hardware Status Indicator */}
      <div className="header-status-section">
        <div className="hardware-pill" title="Processing strictly on local Windows machine">
          <span className="status-dot idle" />
          <Cpu size={12} />
          <span>Local CPU / iGPU</span>
        </div>

        <div className="hardware-pill" title="Zero cloud telemetry or external uploads">
          <ShieldCheck size={12} color="var(--accent)" />
          <span>100% Local Processing</span>
        </div>
      </div>
    </header>
  );
}
