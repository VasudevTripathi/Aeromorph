import React, { useState } from 'react';
import { Plus, Clock, Box, Camera, CheckCircle2, ChevronRight, ShieldCheck, Cpu } from 'lucide-react';

export default function ProjectsHome({ onNewReconstruction, onOpenProject }) {
  const [showEmptyState, setShowEmptyState] = useState(false);

  // Representative sample projects for UI demonstration
  const sampleProjects = [
    {
      id: 'proj-south-bldg',
      name: 'South Building Architectural Survey',
      path: 'D:\\images_colmap\\south-building',
      images: 128,
      points: '7.85M',
      faces: '6.82M',
      status: 'Sample Ready',
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
      status: 'Queued (Demo)',
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
            All processing and assets remain on your local machine by design.
          </p>
        </div>

        <div className="hero-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowEmptyState(!showEmptyState)}
            title="Toggle between populated sample projects and empty state preview"
          >
            {showEmptyState ? 'Show Sample Projects' : 'Preview Empty State'}
          </button>

          <button
            type="button"
            className="btn-primary"
            onClick={onNewReconstruction}
          >
            <Plus size={15} strokeWidth={2.4} />
            <span>New Reconstruction</span>
          </button>
        </div>
      </section>

      {/* Projects List / Empty State */}
      <section>
        <div className="projects-section-header">
          <div className="section-title">
            <Box size={15} color="var(--accent)" />
            <span>Sample Reconstructions</span>
            <span className="section-count-badge">
              {showEmptyState ? '0 Projects' : `${sampleProjects.length} Sample Projects`}
            </span>
            <span className="sample-indicator-tag">Design Preview</span>
          </div>
          <span className="workspace-path-note">
            Target local workspace: <code style={{ fontFamily: 'var(--font-mono)' }}>D:\Aeromorph</code>
          </span>
        </div>

        {showEmptyState ? (
          /* Polished Empty State Design */
          <div className="empty-state-card">
            <div className="empty-icon-bubble">
              <Camera size={24} strokeWidth={1.8} />
            </div>
            <h3 className="empty-state-title">No reconstructions found</h3>
            <p className="empty-state-desc">
              Import a set of drone or architectural photographs to reconstruct a detailed 3D mesh
              using local COLMAP and OpenMVS engines.
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={onNewReconstruction}
              style={{ marginTop: '6px' }}
            >
              <Plus size={15} strokeWidth={2.4} />
              <span>Start First Reconstruction</span>
            </button>
          </div>
        ) : (
          /* Populated Sample Project Cards */
          <div className="project-cards-grid" style={{ marginTop: '16px' }}>
            {sampleProjects.map((proj) => (
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
                    style={{ padding: '4px 9px', fontSize: '11.5px' }}
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

      {/* Understated Target Profile Footer Banner */}
      <footer className="system-spec-banner-quiet">
        <div className="spec-item-group-quiet">
          <div className="spec-item-quiet">
            <Cpu size={13} color="var(--accent)" />
            <span>Target Host: <strong>Windows x64 Native</strong></span>
          </div>
          <span className="spec-bullet-quiet">•</span>
          <div className="spec-item-quiet">
            <span>Hardware Target Profile: <strong>8 GB RAM / CPU + Integrated Graphics</strong></span>
          </div>
          <span className="spec-bullet-quiet">•</span>
          <div className="spec-item-quiet">
            <span>Pipeline Engine: <strong>COLMAP (No-CUDA) + OpenMVS x64</strong></span>
          </div>
        </div>

        <div className="spec-privacy-quiet">
          <ShieldCheck size={12} color="var(--accent)" />
          <span>Local processing architecture • Zero cloud telemetry</span>
        </div>
      </footer>
    </div>
  );
}
