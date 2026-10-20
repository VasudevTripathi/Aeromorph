import React, { useState } from 'react';
import {
  Plus,
  Clock,
  Box,
  Camera,
  CheckCircle2,
  ChevronRight,
  ShieldCheck,
  Cpu,
  Trash2,
  FolderOpen,
  Layers,
  HardDrive,
  AlertCircle,
  Eye
} from 'lucide-react';

export default function ProjectsHome({
  projects = [],
  activeProjectId = null,
  onNewReconstruction,
  onOpenProject,
  onDeleteProject,
}) {
  const [showSampleProjects, setShowSampleProjects] = useState(true);

  // Representative sample projects for UI demonstration from earlier design sprints
  const sampleProjects = [
    {
      id: 'sample-south-bldg',
      name: 'South Building Architectural Survey',
      path: 'D:\\images_colmap\\south-building (Sample Path)',
      images: 128,
      points: '7.85M',
      faces: '6.82M',
      status: 'Sample Ready',
      statusClass: 'ready',
      updated: '2 hours ago',
      stage: 'Mesh Generated (OpenMVS)',
    },
    {
      id: 'sample-heritage-tower',
      name: 'Old Water Tower & Reservoir',
      path: 'D:\\images_colmap\\water-tower (Sample Path)',
      images: 84,
      points: '4.12M',
      faces: '—',
      status: 'Dense Cloud Complete',
      statusClass: 'ready',
      updated: 'Yesterday',
      stage: 'Dense Point Cloud',
    },
    {
      id: 'sample-quarry-drone',
      name: 'Quarry Site Photogrammetry',
      path: 'D:\\images_colmap\\quarry-site (Sample Path)',
      images: 62,
      points: '54.2K',
      faces: '—',
      status: 'Queued (Demo)',
      statusClass: 'queued',
      updated: '3 days ago',
      stage: 'Feature Matching',
    },
  ];

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    const kb = bytes / 1024;
    return `${kb.toFixed(0)} KB`;
  };

  const formatDate = (isoStr) => {
    if (!isoStr) return 'Recently';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return 'Recently';
    }
  };

  const handleDeleteClick = (e, project) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete project "${project.name}"?`)) {
      onDeleteProject(project.id);
    }
  };

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
            onClick={() => setShowSampleProjects(!showSampleProjects)}
            title="Toggle visibility of sample demo cards"
          >
            {showSampleProjects ? 'Hide Sample Cards' : 'Show Sample Cards'}
          </button>

          <button
            type="button"
            className="btn-primary"
            onClick={onNewReconstruction}
            id="new-reconstruction-btn"
          >
            <Plus size={15} strokeWidth={2.4} />
            <span>New Reconstruction</span>
          </button>
        </div>
      </section>

      {/* SECTION 1: Real User Projects */}
      <section className="real-projects-section">
        <div className="projects-section-header">
          <div className="section-title">
            <Box size={15} color="var(--accent)" />
            <span>Active Local Projects</span>
            <span className="section-count-badge">
              {projects.length === 1 ? '1 Project' : `${projects.length} Projects`}
            </span>
            <span className="live-indicator-tag">Session &amp; LocalStorage</span>
          </div>

          <span className="workspace-path-note">
            Target local workspace: <code style={{ fontFamily: 'var(--font-mono)' }}>D:\Aeromorph</code>
          </span>
        </div>

        {projects.length === 0 ? (
          /* Useful Empty State */
          <div className="empty-state-card" id="projects-empty-state">
            <div className="empty-icon-bubble">
              <FolderOpen size={24} strokeWidth={1.8} />
            </div>
            <h3 className="empty-state-title">No local projects yet</h3>
            <p className="empty-state-desc">
              Create a local project to organize drone photographs, attach 3D meshes,
              and inspect reconstructed geometry in the 3D studio.
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={onNewReconstruction}
              style={{ marginTop: '8px' }}
              id="empty-create-project-btn"
            >
              <Plus size={15} strokeWidth={2.4} />
              <span>Create First Project</span>
            </button>
          </div>
        ) : (
          /* Populated User Projects Grid */
          <div className="project-cards-grid" style={{ marginTop: '14px' }}>
            {projects.map((proj) => {
              const isActive = proj.id === activeProjectId;
              const hasPhotos = !!proj.sourceDirectoryReference;
              const hasModel = !!proj.modelFileReference;

              return (
                <article
                  key={proj.id}
                  className={`project-card user-project-card ${isActive ? 'active-project' : ''}`}
                  onClick={() => onOpenProject(proj.id, 'studio')}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open project ${proj.name}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onOpenProject(proj.id, 'studio');
                  }}
                >
                  <div className="project-card-header">
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <h3 className="project-name">{proj.name}</h3>
                        {isActive && (
                          <span className="active-badge" title="Currently open in studio">
                            Active
                          </span>
                        )}
                        {proj.sourceDirectoryReference?.storageType === 'desktop-path' && (
                          <span className="active-badge" style={{ background: 'rgba(213,255,101,0.12)', color: 'var(--accent)', borderColor: 'rgba(213,255,101,0.3)' }} title="Referenced directly on local Windows filesystem">
                            Desktop
                          </span>
                        )}
                      </div>
                      <div className="project-location" title={proj.sourceDirectoryReference?.path || `Project ID: ${proj.id}`}>
                        {proj.sourceDirectoryReference?.path ? proj.sourceDirectoryReference.path : `ID: ${proj.id} • Created ${formatDate(proj.createdAt)}`}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="project-status-pill ready">
                        <span className="status-dot" />
                        {proj.status || 'Active'}
                      </span>
                      <button
                        type="button"
                        className="btn-ghost"
                        style={{ padding: '3px', color: 'var(--text-muted)' }}
                        title="Delete project"
                        onClick={(e) => handleDeleteClick(e, proj)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Project Summary Metrics */}
                  <div className="project-metrics-grid">
                    <div className="metric-item">
                      <span className="metric-label">Source Photos</span>
                      <span className="metric-value">
                        {hasPhotos
                          ? `${proj.sourceDirectoryReference.fileCount} photos`
                          : 'None attached'}
                      </span>
                    </div>

                    <div className="metric-item">
                      <span className="metric-label">Model Mesh</span>
                      <span className="metric-value" title={hasModel ? (proj.modelFileReference.path || proj.modelFileReference.name) : 'None'}>
                        {hasModel
                          ? formatFileSize(proj.modelFileReference.sizeBytes)
                          : 'None (Demo)'}
                      </span>
                    </div>

                    <div className="metric-item">
                      <span className="metric-label">Directory Ref</span>
                      <span
                        className="metric-value"
                        title={hasPhotos ? (proj.sourceDirectoryReference.path || proj.sourceDirectoryReference.name) : 'Not configured'}
                        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {hasPhotos ? (proj.sourceDirectoryReference.name) : '—'}
                      </span>
                    </div>
                  </div>

                  <div className="project-card-footer">
                    <div className="project-time">
                      <Clock size={11} style={{ display: 'inline', marginRight: '4px' }} />
                      Updated {formatDate(proj.updatedAt || proj.createdAt)}
                    </div>

                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenProject(proj.id, 'import');
                        }}
                        style={{ padding: '4px 8px', fontSize: '11.5px' }}
                        title="Configure or view source photographs"
                      >
                        <Camera size={12} />
                        <span>Photos</span>
                      </button>

                      <button
                        type="button"
                        className="btn-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenProject(proj.id, 'studio');
                        }}
                        style={{ padding: '4px 10px', fontSize: '11.5px' }}
                      >
                        <span>Open Studio</span>
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* SECTION 2: Sample Demonstrations (Distinguished from Real Projects) */}
      {showSampleProjects && (
        <section className="sample-projects-section" style={{ marginTop: '28px' }}>
          <div className="projects-section-header">
            <div className="section-title">
              <Layers size={14} color="var(--text-muted)" />
              <span style={{ color: 'var(--text-secondary)' }}>Sample Demonstrations</span>
              <span className="sample-indicator-tag">Design Preview Only</span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Representative telemetry from prior design sprints • Non-destructive
            </span>
          </div>

          <div className="project-cards-grid" style={{ marginTop: '12px', opacity: 0.85 }}>
            {sampleProjects.map((proj) => (
              <article key={proj.id} className="project-card sample-preview-card">
                <div className="project-card-header">
                  <div>
                    <h3 className="project-name" style={{ color: 'var(--text-secondary)' }}>
                      {proj.name}
                    </h3>
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
                    onClick={() => onOpenProject(null, 'studio')}
                    style={{ padding: '4px 9px', fontSize: '11.5px' }}
                    title="Open studio with default 3D pavilion"
                  >
                    <span>View Viewer Demo</span>
                    <ChevronRight size={13} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Target Profile Footer Banner */}
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
