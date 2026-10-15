import React, { useState } from 'react';
import { Plus, FolderOpen, Clock, Box, Camera, HardDrive, CheckCircle2, ChevronRight, Sparkles } from 'lucide-react';

export default function ProjectsHome({ onNewReconstruction, onOpenProject }) {
  const [showEmptyState, setShowEmptyState] = useState(false);

  const mockProjects = [
    {
      id: 'proj-south-bldg',
      name: 'South Building Architectural Survey',
      path: 'D:\\images_colmap\\south-building',
      images: 128,
      points: '7.85M',
      faces: '6.82M',
      status: 'Ready',
      statusClass: 'ready',
      updated: '2 hours ago',
      stage: 'Mesh Generated (OpenMVS)',
    },
    {
      id: 'proj-heritage-tower',
      name: 'Old Water Tower & Reservoir',
      path: 'D:\\images_colmap\\water-tower',
      images: 84,
      points: '4.12M',
      faces: '—',
      status: 'Dense Cloud Complete',
      statusClass: 'ready',
      updated: 'Yesterday',
      stage: 'Dense Point Cloud',
    },
    {
      id: 'proj-quarry-drone',
      name: 'Quarry Site Photogrammetry',
      path: 'D:\\images_colmap\\quarry-site',
      images: 62,
      points: '54.2K',
      faces: '—',
      status: 'Queued',
      statusClass: 'queued',
      updated: '3 days ago',
      stage: 'Feature Matching',
    },
  ];

  return (
    <div className="projects-home-container">
      {/* Hero Welcome Section */}
      <section className="home-hero-section">
        <div className="hero-text-group">
          <h1>Welcome to Aeromorph Studio</h1>
          <p>
            Local photogrammetry and 3D reconstruction engine designed for aerial, drone, and architectural image sets.
            All computation and reconstruction files remain entirely private on your Windows machine.
          </p>
        </div>

        <div className="hero-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowEmptyState(!showEmptyState)}
            title="Toggle between populated recent projects and empty state preview"
          >
            {showEmptyState ? 'Show Recent Projects' : 'Preview Empty State'}
          </button>

          <button
            type="button"
            className="btn-primary"
            onClick={onNewReconstruction}
          >
            <Plus size={16} strokeWidth={2.4} />
            <span>New Reconstruction</span>
          </button>
        </div>
      </section>

      {/* Projects List / Empty State */}
      <section>
        <div className="projects-section-header">
          <div className="section-title">
            <Box size={16} color="var(--accent)" />
            <span>Recent Reconstructions</span>
            <span className="section-count-badge">
              {showEmptyState ? 0 : mockProjects.length}
            </span>
          </div>
          <span className="brand-subtitle">
            Local workspace: D:\Aeromorph
          </span>
        </div>

        {showEmptyState ? (
          /* Polished Empty State Design */
          <div className="empty-state-card">
            <div className="empty-icon-bubble">
              <Camera size={26} strokeWidth={1.75} />
            </div>
            <h3 className="empty-state-title">No reconstructions found yet</h3>
            <p className="empty-state-desc">
              Import a set of drone or ground photographs to reconstruct a detailed 3D mesh
              using local COLMAP and OpenMVS engines.
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={onNewReconstruction}
              style={{ marginTop: '8px' }}
            >
              <Plus size={16} strokeWidth={2.4} />
              <span>Start First Reconstruction</span>
            </button>
          </div>
        ) : (
          /* Populated Project Cards */
          <div className="project-cards-grid" style={{ marginTop: '16px' }}>
            {mockProjects.map((proj) => (
              <article key={proj.id} className="project-card">
                <div className="project-card-header">
                  <div>
                    <h3 className="project-name">{proj.name}</h3>
                    <div className="project-location" title={proj.path}>
                      {proj.path}
                    </div>
                  </div>
                  <span className={`project-status-pill ${proj.statusClass}`}>
                    <span className="status-dot" />
                    {proj.status}
                  </span>
                </div>

                <div className="project-metrics-grid">
                  <div className="metric-item">
                    <span className="metric-label">Photographs</span>
                    <span className="metric-value">{proj.images}</span>
                  </div>
                  <div className="metric-item">
                    <span className="metric-label">Point Cloud</span>
                    <span className="metric-value">{proj.points}</span>
                  </div>
                  <div className="metric-item">
                    <span className="metric-label">Mesh Faces</span>
                    <span className="metric-value">{proj.faces}</span>
                  </div>
                </div>

                <div className="project-card-footer">
                  <div className="project-time">
                    <Clock size={11} style={{ display: 'inline', marginRight: '4px' }} />
                    {proj.updated} • {proj.stage}
                  </div>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onOpenProject(proj.id)}
                    style={{ padding: '4px 10px', fontSize: '12px' }}
                  >
                    <span>Open Studio</span>
                    <ChevronRight size={13} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* System Hardware & Local Processing Spec Banner */}
      <footer className="system-spec-banner">
        <div className="spec-item-group">
          <div className="spec-item">
            <HardDrive size={14} color="var(--accent)" />
            <span>Reconstruction Storage: <strong>91.7 GB Free (D:\)</strong></span>
          </div>
          <div className="spec-item">
            <span>Memory Allocated: <strong>7.7 GB RAM (Optimized for 8 GB iGPU)</strong></span>
          </div>
          <div className="spec-item">
            <span>Core Engines: <strong>COLMAP (No-CUDA) + OpenMVS x64 v2.4</strong></span>
          </div>
        </div>

        <div className="spec-item" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          <CheckCircle2 size={13} color="var(--accent)" />
          <span>Windows Local Native Host</span>
        </div>
      </footer>
    </div>
  );
}
