import React from 'react';
import { Layers, ShieldCheck, Cpu } from 'lucide-react';

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
          <Layers size={15} strokeWidth={2.4} />
        </div>
        <div className="brand-title-group">
          <div className="brand-name">
            Aeromorph
            <span className="brand-version">Preview</span>
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

      {/* Local Processing & Hardware Profile Badges */}
      <div className="header-status-section">
        <div className="hardware-pill" title="Target architecture: Local CPU & Integrated Graphics">
          <span className="status-dot idle" />
          <Cpu size={12} />
          <span>Local CPU / iGPU Profile</span>
        </div>

        <div className="hardware-pill" title="Private local-first processing — no external network requests">
          <ShieldCheck size={12} color="var(--accent)" />
          <span>100% Local Processing</span>
        </div>
      </div>
    </header>
  );
}
