import React from 'react';
import { Settings2, Play, Box } from 'lucide-react';

export default function PipelineSidebar({ activeStage, onSelectStage, currentProject = null }) {
  const stages = [
    {
      id: 'feature_extraction',
      num: '01',
      name: 'Feature Extraction',
      engine: 'COLMAP (SIFT)',
      status: 'pending',
      stats: 'Pending pipeline launch (Sprint 6B)',
    },
    {
      id: 'feature_matching',
      num: '02',
      name: 'Feature Matching',
      engine: 'COLMAP Exhaustive',
      status: 'pending',
      stats: 'Pending pipeline launch (Sprint 6B)',
    },
    {
      id: 'sparse_reconstruction',
      num: '03',
      name: 'Sparse Point Cloud (SfM)',
      engine: 'COLMAP Mapper',
      status: 'pending',
      stats: 'Pending pipeline launch (Sprint 6B)',
    },
    {
      id: 'dense_reconstruction',
      num: '04',
      name: 'Dense Point Cloud',
      engine: 'OpenMVS Densify',
      status: 'pending',
      stats: 'Pending pipeline launch (Sprint 6B)',
    },
    {
      id: 'mesh_reconstruction',
      num: '05',
      name: 'Mesh Generation',
      engine: 'OpenMVS ReconstructMesh',
      status: currentProject?.modelFileReference ? 'ready' : 'pending',
      stats: currentProject?.modelFileReference ? `Attached PLY: ${currentProject.modelFileReference.name}` : 'Pending pipeline launch (Sprint 6B)',
    },
    {
      id: 'texture_mapping',
      num: '06',
      name: 'Texture Mapping',
      engine: 'OpenMVS TextureMesh',
      status: 'pending',
      stats: 'Optional — Planned next phase',
    },
  ];

  return (
    <aside className="pipeline-sidebar" aria-label="Pipeline Stages">
      <div className="sidebar-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <span className="sidebar-title">Pipeline Stages</span>
          <span className="sidebar-sample-pill">Profile</span>
        </div>
        <button type="button" className="btn-ghost" title="Pipeline parameters">
          <Settings2 size={13} />
        </button>
      </div>

      {/* Active Project Indicator in Sidebar */}
      <div className="sidebar-project-indicator">
        <Box size={13} color="var(--accent)" />
        <div className="sidebar-project-text">
          <span className="sidebar-project-label">
            {currentProject ? 'ACTIVE PROJECT' : 'WORKSPACE'}
          </span>
          <span className="sidebar-project-name" title={currentProject ? currentProject.name : 'Default Pavilion Demo'}>
            {currentProject ? currentProject.name : 'Default Pavilion Demo'}
          </span>
        </div>
      </div>

      {/* Stage list */}
      <div className="stages-list">
        {stages.map((stage) => {
          const isCompleted = stage.status === 'done';

          return (
            <div
              key={stage.id}
              className={`stage-item ${isCompleted ? 'completed' : ''}`}
            >
              <div className="stage-top">
                <div className="stage-name-group">
                  <span className="stage-number">{stage.num}</span>
                  <span className="stage-title">{stage.name}</span>
                </div>
                <span className={`stage-badge ${stage.status === 'ready' ? 'done' : 'idle'}`}>
                  {stage.status === 'ready' ? 'Attached Mesh' : 'Pending (6B)'}
                </span>
              </div>
              <div className="stage-detail">
                {stage.stats}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sidebar Footer with Execution Profile Summary */}
      <div className="sidebar-footer">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11px', color: 'var(--text-muted)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Target Concurrency</span>
            <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>4 CPU Threads</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Target RAM Cap</span>
            <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>6.0 GB (8 GB Host)</span>
          </div>
        </div>

        <button
          type="button"
          className="btn-secondary"
          style={{ width: '100%', marginTop: '3px', opacity: 0.85 }}
          title="Reconstruction pipeline execution will be launched in Sprint 6B. Environment detection complete."
        >
          <Play size={13} />
          <span>Launch Pipeline (Sprint 6B)</span>
        </button>
      </div>
    </aside>
  );
}
