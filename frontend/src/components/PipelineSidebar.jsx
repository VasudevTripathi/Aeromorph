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
  pipelinePreset = 'balanced',
  onPipelinePresetChange = null,
  matcherType = 'sequential',
  onMatcherTypeChange = null,
  numThreads = 8,
  onNumThreadsChange = null,
  elapsedSeconds = 0,
  stageProgress = null,
  onStartPipeline,
  onResumePipeline = null,
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
      if (['exhaustive_matcher', 'sequential_matcher'].includes(activeStageKey) && isRunning) return 'running';
      if (jobStatus === 'completed' || (isRunning && !['feature_extractor', 'exhaustive_matcher', 'sequential_matcher'].includes(activeStageKey))) return 'done';
      if (jobStatus === 'failed' && ['exhaustive_matcher', 'sequential_matcher'].includes(activeStageKey)) return 'failed';
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
      engine: matcherType === 'sequential' ? 'COLMAP Sequential' : 'COLMAP Exhaustive',
      status: getStageStatus('feature_matching'),
      stats: matcherType === 'sequential' ? 'Fast overlap window matching (recommended)' : 'Two-view geometric verification (all pairs)',
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
          <span className="sidebar-sample-pill">Local Engine</span>
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

      {/* Target Stage Depth Selector & Performance Controls */}
      <div style={{ padding: '8px 12px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-subtle)', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
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

        {/* Speed / Quality Preset */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>Speed Preset:</span>
          <select
            value={pipelinePreset}
            onChange={(e) => onPipelinePresetChange && onPipelinePresetChange(e.target.value)}
            disabled={isRunning}
            style={{
              background: 'var(--bg-primary, #0f172a)',
              color: pipelinePreset === 'fast' ? 'var(--accent)' : 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '4px',
              padding: '2px 6px',
              fontSize: '11px',
              cursor: isRunning ? 'not-allowed' : 'pointer',
            }}
          >
            <option value="fast">⚡ Fast (Manual speed: 1000px, 3 views, 1 level)</option>
            <option value="balanced">⚖ Balanced (Manual fast MVS: 1000px, 3 views, 1 level)</option>
            <option value="full">🎯 Full Precision (1920px, 5 views, 2 levels)</option>
          </select>
        </div>

        {/* Matcher Strategy */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>Matcher Mode:</span>
          <select
            value={matcherType}
            onChange={(e) => onMatcherTypeChange && onMatcherTypeChange(e.target.value)}
            disabled={isRunning}
            style={{
              background: 'var(--bg-primary, #0f172a)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '4px',
              padding: '2px 6px',
              fontSize: '11px',
              cursor: isRunning ? 'not-allowed' : 'pointer',
            }}
          >
            <option value="sequential">Sequential (Overlap 10)</option>
            <option value="exhaustive">Exhaustive (All Pairs)</option>
          </select>
        </div>

        {/* Multi-core CPU allocation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10.5px' }}>
          <span style={{ color: 'var(--text-muted)' }}>CPU Allocation:</span>
          <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
            {numThreads || 8} Threads (Multi-core)
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
              {isCurrentRunning && (
                <div style={{ marginTop: '6px' }}>
                  <div style={{ width: '100%', height: '3.5px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.min(100, Math.max(0, stageProgress?.percent || 0))}%`,
                        height: '100%',
                        background: 'var(--accent)',
                        transition: 'width 0.35s ease',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', fontSize: '10px', color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                    <span>
                      {stageProgress?.percent != null ? `${stageProgress.percent}%` : 'Processing'}
                      {stageProgress?.current ? ` (${stageProgress.current}/${stageProgress.total || '?'})` : ''}
                    </span>
                    <span>{stageProgress?.etaText ? `ETA: ${stageProgress.etaText}` : 'Estimating ETA...'}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sidebar Footer with Execution Profile Summary & Controls */}
      <div className="sidebar-footer">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11px', color: 'var(--text-muted)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Target Concurrency</span>
            <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{numThreads || 8} CPU Threads</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>RAM Safeguard</span>
            <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>8 GB Safe Profile</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>OpenMVS Setting</span>
            <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>Level 2 / 1000px</span>
          </div>
          {isRunning && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', marginTop: '3px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={11} />
                  <span>Elapsed</span>
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{formatTime(elapsedSeconds)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--accent)', marginTop: '2px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Sparkles size={11} />
                  <span>Est. Remaining (ETA)</span>
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{stageProgress?.etaText || 'Calculating...'}</span>
              </div>
            </>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', marginTop: '4px' }}>
            <button
              type="button"
              className="btn-primary"
              onClick={onStartPipeline}
              style={{ width: '100%' }}
              title={targetStage === 'mesh' ? 'Run COLMAP + OpenMVS Densify + ReconstructMesh' : (targetStage === 'dense' ? 'Run COLMAP + OpenMVS Densify' : 'Run COLMAP Sparse Reconstruction')}
            >
              <Play size={13} />
              <span>
                {targetStage === 'mesh' ? 'Launch Full Mesh Pipeline' : (targetStage === 'dense' ? 'Launch Dense Pipeline' : 'Launch Sparse Pipeline')}
              </span>
            </button>
            {onResumePipeline && (
              <button
                type="button"
                className="btn-secondary"
                onClick={onResumePipeline}
                style={{ width: '100%', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', background: 'rgba(213, 255, 101, 0.08)', borderColor: 'rgba(213, 255, 101, 0.3)', color: 'var(--accent)' }}
                title="Resume pipeline reusing already computed features, matching, or sparse point clouds"
              >
                <Sparkles size={11} color="var(--accent)" />
                <span>Resume from Last Stage</span>
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
