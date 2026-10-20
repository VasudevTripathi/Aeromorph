import React from 'react';
import { Layers, ShieldCheck, Cpu, Box, Monitor, Globe } from 'lucide-react';
import { isElectron } from '../services/desktopBridge';

export default function Header({ currentScreen, setCurrentScreen, currentProject = null }) {
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
            <span className="brand-version">Sprint 6A</span>
          </div>
          <span className="brand-subtitle">3D Reconstruction Studio</span>
        </div>

        {/* Active Project Pill in Header */}
        {currentProject && (
          <div
            className="header-active-project-tag"
            onClick={() => setCurrentScreen('studio')}
            title={`Active Project: ${currentProject.name} (Click to open studio)`}
          >
            <Box size={12} color="var(--accent)" />
            <span className="project-title-text">{currentProject.name}</span>
          </div>
        )}
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
        {isElectron ? (
          <div className="hardware-pill" title="Operating inside secure Electron Windows desktop shell">
            <span className="status-dot online" style={{ background: 'var(--accent)', boxShadow: '0 0 6px var(--accent)' }} />
            <Monitor size={12} color="var(--accent)" />
            <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Desktop Shell</span>
          </div>
        ) : (
          <div className="hardware-pill" title="Operating inside Web Browser sandbox">
            <span className="status-dot idle" />
            <Globe size={12} />
            <span>Browser Sandbox</span>
          </div>
        )}

        <div className="hardware-pill" title="Target architecture: Local CPU & Integrated Graphics">
          <span className="status-dot idle" />
          <Cpu size={12} />
          <span>Local CPU / iGPU Profile</span>
        </div>

        <div className="hardware-pill" title="Private local-first processing — zero cloud telemetry">
          <ShieldCheck size={12} color="var(--accent)" />
          <span>100% Local</span>
        </div>
      </div>
    </header>
  );
}
