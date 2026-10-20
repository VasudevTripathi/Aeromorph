import React from 'react';
import { Settings2, Play, Box } from 'lucide-react';

export default function PipelineSidebar({ activeStage, onSelectStage, currentProject = null }) {
  const stages = [
    {
      id: 'feature_extraction',
      num: '01',
      name: 'Feature Extraction',
      engine: 'COLMAP (SIFT)',
      status: 'done',
      stats: '128 / 128 images calibrated',
    },
    {
      id: 'feature_matching',
      num: '02',
      name: 'Feature Matching',
      engine: 'COLMAP Exhaustive',
      status: 'done',
      stats: '8,128 image pairs matched',
    },
    {
      id: 'sparse_reconstruction',
      num: '03',
      name: 'Sparse Point Cloud (SfM)',
      engine: 'COLMAP Mapper',
      status: 'done',
      stats: '61,129 3D landmarks',
    },
    {
      id: 'dense_reconstruction',
      num: '04',
      name: 'Dense Point Cloud',
      engine: 'OpenMVS Densify',
      status: 'done',
      stats: '7,845,251 dense points',
    },
    {
      id: 'mesh_reconstruction',
      num: '05',
      name: 'Mesh Generation',
      engine: 'OpenMVS ReconstructMesh',
      status: 'done',
      stats: '3,411,172 vertices / 6.8M faces',
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
                <span className={`stage-badge ${stage.status}`}>
                  {isCompleted ? 'Sample Ready' : 'Pending'}
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
          className="btn-primary"
          style={{ width: '100%', marginTop: '3px' }}
          title="Backend execution connects in future sprint"
        >
          <Play size={13} fill="currentColor" />
          <span>Run Pipeline (Visual Demo)</span>
        </button>
      </div>
    </aside>
  );
}
