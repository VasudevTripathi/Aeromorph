import React from 'react';
import { Settings2, Play, Box, FolderSearch, StopCircle, Loader2, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';

export default function PipelineSidebar({
  activeStage = null,
  onSelectStage,
  currentProject = null,
  jobStatus = 'idle',
  activeStageKey = null,
  elapsedSeconds = 0,
  onStartPipeline,
  onCancelPipeline,
  onSelectWorkspace,
}) {
  const isRunning = jobStatus === 'running';

  // Determine stage status based on active reconstruction state
  const getStageStatus = (stageId, stageNum) => {
    if (stageId === 'feature_extraction') {
      if (activeStageKey === 'feature_extractor' && isRunning) return 'running';
      if (jobStatus === 'completed' || (isRunning && (activeStageKey === 'exhaustive_matcher' || activeStageKey === 'mapper'))) return 'done';
      if (jobStatus === 'failed' && activeStageKey === 'feature_extractor') return 'failed';
      return 'pending';
    }
    if (stageId === 'feature_matching') {
      if (activeStageKey === 'exhaustive_matcher' && isRunning) return 'running';
      if (jobStatus === 'completed' || (isRunning && activeStageKey === 'mapper')) return 'done';
      if (jobStatus === 'failed' && activeStageKey === 'exhaustive_matcher') return 'failed';
      return 'pending';
    }
    if (stageId === 'sparse_reconstruction') {
      if (activeStageKey === 'mapper' && isRunning) return 'running';
      if (jobStatus === 'completed') return 'done';
      if (jobStatus === 'failed' && activeStageKey === 'mapper') return 'failed';
      return 'pending';
    }
    if (stageId === 'mesh_reconstruction') {
      return currentProject?.modelFileReference ? 'ready' : 'pending';
    }
    return 'pending';
  };

  const stages = [
    {
      id: 'feature_extraction',
      num: '01',
      name: 'Feature Extraction',
      engine: 'COLMAP (SIFT)',
      status: getStageStatus('feature_extraction', 1),
      stats: 'SIFT keypoints & descriptors (CPU-only)',
    },
    {
      id: 'feature_matching',
      num: '02',
      name: 'Feature Matching',
      engine: 'COLMAP Exhaustive',
      status: getStageStatus('feature_matching', 2),
      stats: 'Two-view geometric verification',
    },
    {
      id: 'sparse_reconstruction',
      num: '03',
      name: 'Sparse Point Cloud (SfM)',
      engine: 'COLMAP Mapper',
      status: getStageStatus('sparse_reconstruction', 3),
      stats: 'Incremental camera pose & 3D triangulation',
    },
    {
      id: 'dense_reconstruction',
      num: '04',
      name: 'Dense Point Cloud',
      engine: 'OpenMVS Densify',
      status: 'pending',
      stats: 'Sprint 6B: Excluded (Planned Sprint 6C)',
    },
    {
      id: 'mesh_reconstruction',
      num: '05',
      name: 'Mesh Generation',
      engine: 'OpenMVS ReconstructMesh',
      status: currentProject?.modelFileReference ? 'ready' : 'pending',
      stats: currentProject?.modelFileReference ? `Attached PLY: ${currentProject.modelFileReference.name}` : 'Sprint 6B: Excluded (Planned Sprint 6C)',
    },
    {
      id: 'texture_mapping',
      num: '06',
      name: 'Texture Mapping',
      engine: 'OpenMVS TextureMesh',
      status: 'pending',
      stats: 'Sprint 6B: Excluded (Planned next phase)',
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
          <span className="sidebar-sample-pill">Sprint 6B</span>
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
              title="Select a dedicated folder for COLMAP output files"
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

          return (
            <div
              key={stage.id}
              className={`stage-item ${isDone ? 'completed' : ''} ${isCurrentRunning ? 'active' : ''}`}
            >
              <div className="stage-top">
                <div className="stage-name-group">
                  <span className="stage-number">{stage.num}</span>
                  <span className="stage-title">{stage.name}</span>
                </div>
                <span className={`stage-badge ${isDone ? 'done' : (isCurrentRunning ? 'running' : (isFailed ? 'failed' : 'idle'))}`}>
                  {isCurrentRunning && <Loader2 size={10} className="animate-spin" style={{ marginRight: '3px' }} />}
                  {isDone ? 'Done' : (isCurrentRunning ? 'Running' : (isFailed ? 'Failed' : (stage.status === 'ready' ? 'Ready' : 'Pending')))}
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
            <span>Target RAM Cap</span>
            <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>6.0 GB (8 GB Host)</span>
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
            title="Terminate COLMAP reconstruction subprocesses"
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
            title="Run COLMAP feature extraction, matching, and mapper on CPU"
          >
            <Play size={13} />
            <span>Launch Sparse Pipeline (6B)</span>
          </button>
        )}
      </div>
    </aside>
  );
}
