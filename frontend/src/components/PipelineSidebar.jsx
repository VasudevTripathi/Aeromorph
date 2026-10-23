import React from 'react';
import { Settings2, Play, Box, FolderSearch, StopCircle, Loader2, CheckCircle2, AlertTriangle, Clock, Layers, Sparkles } from 'lucide-react';

export default function PipelineSidebar({
  activeStage = null,
  onSelectStage,
  currentProject = null,
  jobStatus = 'idle',
  activeStageKey = null,
  targetStage = 'mesh',
  onTargetStageChange = null,
  elapsedSeconds = 0,
  onStartPipeline,
  onCancelPipeline,
  onSelectWorkspace,
}) {
  const isRunning = jobStatus === 'running';

  // Determine stage status based on active reconstruction state and target depth
  const getStageStatus = (stageId) => {
    if (jobStatus === 'cancelled') {
      if (activeStageKey === 'feature_extractor' && stageId === 'feature_extraction') return 'cancelled';
      if (activeStageKey === 'exhaustive_matcher' && stageId === 'feature_matching') return 'cancelled';
      if (activeStageKey === 'mapper' && stageId === 'sparse_reconstruction') return 'cancelled';
      if (activeStageKey === 'interface_colmap' && stageId === 'openmvs_interface') return 'cancelled';
      if (activeStageKey === 'densify_point_cloud' && stageId === 'dense_reconstruction') return 'cancelled';
      if (activeStageKey === 'reconstruct_mesh' && stageId === 'mesh_reconstruction') return 'cancelled';
      return 'pending';
    }

    if (stageId === 'feature_extraction') {
      if (activeStageKey === 'feature_extractor' && isRunning) return 'running';
      if (jobStatus === 'completed' || (isRunning && activeStageKey !== 'feature_extractor')) return 'done';
      if (jobStatus === 'failed' && activeStageKey === 'feature_extractor') return 'failed';
      return 'pending';
    }

    if (stageId === 'feature_matching') {
      if (activeStageKey === 'exhaustive_matcher' && isRunning) return 'running';
      if (jobStatus === 'completed' || (isRunning && !['feature_extractor', 'exhaustive_matcher'].includes(activeStageKey))) return 'done';
      if (jobStatus === 'failed' && activeStageKey === 'exhaustive_matcher') return 'failed';
      return 'pending';
    }

    if (stageId === 'sparse_reconstruction') {
      if (activeStageKey === 'mapper' && isRunning) return 'running';
      if (jobStatus === 'completed' || (isRunning && ['interface_colmap', 'densify_point_cloud', 'reconstruct_mesh'].includes(activeStageKey))) return 'done';
      if (jobStatus === 'failed' && activeStageKey === 'mapper') return 'failed';
      return 'pending';
    }

    if (stageId === 'openmvs_interface') {
      if (targetStage === 'sparse') return 'not_requested';
      if (activeStageKey === 'interface_colmap' && isRunning) return 'running';
      if (jobStatus === 'completed' || (isRunning && ['densify_point_cloud', 'reconstruct_mesh'].includes(activeStageKey))) return 'done';
      if (jobStatus === 'failed' && activeStageKey === 'interface_colmap') return 'failed';
      return 'pending';
    }

    if (stageId === 'dense_reconstruction') {
      if (targetStage === 'sparse') return 'not_requested';
      if (activeStageKey === 'densify_point_cloud' && isRunning) return 'running';
      if (jobStatus === 'completed' || (isRunning && activeStageKey === 'reconstruct_mesh')) return 'done';
      if (jobStatus === 'failed' && activeStageKey === 'densify_point_cloud') return 'failed';
      return 'pending';
    }

    if (stageId === 'mesh_reconstruction') {
      if (targetStage !== 'mesh') {
        return currentProject?.modelFileReference?.isMesh ? 'ready' : 'not_requested';
      }
      if (activeStageKey === 'reconstruct_mesh' && isRunning) return 'running';
      if (jobStatus === 'completed') return 'done';
      if (jobStatus === 'failed' && activeStageKey === 'reconstruct_mesh') return 'failed';
      return currentProject?.modelFileReference?.isMesh ? 'ready' : 'pending';
    }

    return 'pending';
  };

  const stages = [
    {
      id: 'feature_extraction',
      num: '01',
      name: 'Feature Extraction',
      engine: 'COLMAP (SIFT)',
      status: getStageStatus('feature_extraction'),
      stats: 'SIFT keypoints & descriptors (CPU-only)',
    },
    {
      id: 'feature_matching',
      num: '02',
      name: 'Feature Matching',
      engine: 'COLMAP Exhaustive',
      status: getStageStatus('feature_matching'),
      stats: 'Two-view geometric verification',
    },
    {
      id: 'sparse_reconstruction',
      num: '03',
      name: 'Sparse Point Cloud (SfM)',
      engine: 'COLMAP Mapper',
      status: getStageStatus('sparse_reconstruction'),
      stats: 'Incremental triangulation & camera poses',
    },
    {
      id: 'openmvs_interface',
      num: '04',
      name: 'Scene Preparation',
      engine: 'OpenMVS InterfaceCOLMAP',
      status: getStageStatus('openmvs_interface'),
      stats: targetStage === 'sparse' ? 'Not requested (Sparse target)' : 'Exports COLMAP model to scene.mvs',
    },
    {
      id: 'dense_reconstruction',
      num: '05',
      name: 'Dense Point Cloud',
      engine: 'OpenMVS Densify',
      status: getStageStatus('dense_reconstruction'),
      stats: targetStage === 'sparse'
        ? 'Not requested (Sparse target)'
        : 'Multi-view stereo dense point cloud',
    },
    {
      id: 'mesh_reconstruction',
      num: '06',
      name: 'Mesh Generation',
      engine: 'OpenMVS ReconstructMesh',
      status: getStageStatus('mesh_reconstruction'),
      stats: targetStage !== 'mesh'
        ? (currentProject?.modelFileReference?.isMesh ? `Attached: ${currentProject.modelFileReference.name}` : 'Not requested for this run')
        : 'Surface Delaunay & graph-cut polygonal mesh',
    },
  ];

  const formatTime = (secs) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  const hasPhotos = Boolean(currentProject?.sourceDirectoryReference?.path && (currentProject?.sourceDirectoryReference?.fileCount || 0) >= 2);
  const hasWorkspace = Boolean(currentProject?.outputDirectoryReference?.path);

  return (
    <aside className="pipeline-sidebar" aria-label="Pipeline Stages">
      <div className="sidebar-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <span className="sidebar-title">Pipeline Stages</span>
          <span className="sidebar-sample-pill">Sprint 9</span>
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
          <span className="sidebar-project-name" title={currentProject ? currentProject.name : 'Default Workspace'}>
            {currentProject ? currentProject.name : 'Default Workspace'}
          </span>
        </div>
      </div>

      {/* Target Stage Depth Selector */}
      <div style={{ padding: '8px 12px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>Pipeline Target:</span>
          <select
            value={targetStage}
            onChange={(e) => onTargetStageChange && onTargetStageChange(e.target.value)}
            disabled={isRunning}
            style={{
              background: 'var(--bg-primary, #0f172a)',
              color: 'var(--accent, #38bdf8)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '4px',
              padding: '2px 6px',
              fontSize: '11px',
              cursor: isRunning ? 'not-allowed' : 'pointer',
            }}
          >
            <option value="mesh">Mesh (Dense + Mesh)</option>
            <option value="dense">Dense Cloud Only</option>
            <option value="sparse">Sparse Cloud Only</option>
          </select>
        </div>
      </div>

      {/* Workspace & Source Status Card */}
      <div style={{ padding: '8px 12px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>Input Photos:</span>
          <span style={{ color: hasPhotos ? 'var(--accent)' : 'var(--color-warning)', fontFamily: 'var(--font-mono)' }}>
            {hasPhotos ? `${currentProject.sourceDirectoryReference.fileCount} photos` : 'Not Attached'}
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>Output Workspace:</span>
          {hasWorkspace ? (
            <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={currentProject.outputDirectoryReference.path}>
              {currentProject.outputDirectoryReference.name || 'Workspace'}
            </span>
          ) : (
            <button
              type="button"
              className="btn-ghost"
              style={{ fontSize: '10.5px', padding: '1px 5px', color: 'var(--color-warning)' }}
              onClick={onSelectWorkspace}
              title="Select a dedicated folder for COLMAP and OpenMVS output files"
            >
              + Set Output
            </button>
          )}
        </div>
      </div>

      {/* Stage list */}
      <div className="stages-list">
        {stages.map((stage) => {
          const isCurrentRunning = stage.status === 'running';
          const isDone = stage.status === 'done';
          const isFailed = stage.status === 'failed';
          const isNotRequested = stage.status === 'not_requested';

          let badgeClass = 'idle';
          let badgeText = 'Pending';
          if (isCurrentRunning) {
            badgeClass = 'running';
            badgeText = 'Running';
          } else if (isDone) {
            badgeClass = 'done';
            badgeText = 'Done';
          } else if (isFailed) {
            badgeClass = 'failed';
            badgeText = 'Failed';
          } else if (stage.status === 'ready') {
            badgeClass = 'ready';
            badgeText = 'Ready';
          } else if (isNotRequested) {
            badgeClass = 'idle';
            badgeText = 'Skipped';
          }

          return (
            <div
              key={stage.id}
              className={`stage-item ${isDone ? 'completed' : ''} ${isCurrentRunning ? 'active' : ''} ${isNotRequested ? 'disabled' : ''}`}
            >
              <div className="stage-top">
                <div className="stage-name-group">
                  <span className="stage-number">{stage.num}</span>
                  <span className="stage-title">{stage.name}</span>
                </div>
                <span className={`stage-badge ${badgeClass}`}>
                  {isCurrentRunning && <Loader2 size={10} className="animate-spin" style={{ marginRight: '3px' }} />}
                  {badgeText}
                </span>
              </div>
              <div className="stage-detail">
                {stage.stats}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sidebar Footer with Execution Profile Summary & Controls */}
      <div className="sidebar-footer">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11px', color: 'var(--text-muted)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Target Concurrency</span>
            <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>4 CPU Threads</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>RAM Safeguard</span>
            <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>8 GB Safe Profile</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>OpenMVS Setting</span>
            <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>Level 1 / 1920px</span>
          </div>
          {isRunning && (
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--accent)', marginTop: '2px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Clock size={11} />
                <span>Elapsed</span>
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatTime(elapsedSeconds)}</span>
            </div>
          )}
        </div>

        {isRunning ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancelPipeline}
            style={{ width: '100%', marginTop: '4px', borderColor: 'var(--color-danger, #ef4444)', color: 'var(--color-danger, #f87171)' }}
            title="Terminate active reconstruction subprocesses"
          >
            <StopCircle size={13} />
            <span>Cancel Reconstruction</span>
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary"
            onClick={onStartPipeline}
            style={{ width: '100%', marginTop: '4px' }}
            title={targetStage === 'mesh' ? 'Run COLMAP + OpenMVS Densify + ReconstructMesh' : (targetStage === 'dense' ? 'Run COLMAP + OpenMVS Densify' : 'Run COLMAP Sparse Reconstruction')}
          >
            <Play size={13} />
            <span>
              {targetStage === 'mesh' ? 'Launch Mesh Pipeline (Sprint 9)' : (targetStage === 'dense' ? 'Launch Dense Pipeline' : 'Launch Sparse Pipeline')}
            </span>
          </button>
        )}
      </div>
    </aside>
  );
}
