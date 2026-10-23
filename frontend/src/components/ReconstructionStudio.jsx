import React, { useState, useEffect, useRef } from 'react';
import { Box, Camera, FolderOpen, ArrowLeft, Clock, HardDrive, CheckCircle2, AlertTriangle, Play, StopCircle } from 'lucide-react';
import PipelineSidebar from './PipelineSidebar';
import Viewport3D from './Viewport3D';
import LogPanel from './LogPanel';
import {
  selectWorkspaceDirectory,
  startSparseReconstruction,
  cancelSparseReconstruction,
  getReconstructionStatus,
  subscribeReconstructionProgress,
  subscribeReconstructionLog,
} from '../services/desktopBridge';

export default function ReconstructionStudio({
  currentProject = null,
  sessionModelFile = null,
  onAttachModelFile,
  onAttachNativePly,
  onUpdateProjectOutputDirectory,
  onNavigateHome,
  onNavigateImport,
}) {
  const [activeStage, setActiveStage] = useState('sparse_reconstruction');
  const [targetStage, setTargetStage] = useState('mesh'); // 'sparse' | 'dense' | 'mesh'
  const [jobStatus, setJobStatus] = useState('idle'); // 'idle' | 'running' | 'completed' | 'cancelled' | 'failed'
  const [activeStageKey, setActiveStageKey] = useState(null);
  const [activeStageLabel, setActiveStageLabel] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [reconstructionLogs, setReconstructionLogs] = useState([]);
  const [errorMessage, setErrorMessage] = useState(null);
  const [modelStats, setModelStats] = useState(null);

  // Sync with current reconstruction state on mount
  useEffect(() => {
    getReconstructionStatus().then((status) => {
      if (status && status.status && status.status !== 'idle') {
        setJobStatus(status.status);
        setActiveStageKey(status.stage);
        setActiveStageLabel(status.stageLabel);
        if (status.elapsedMs) {
          setElapsedSeconds(Math.floor(status.elapsedMs / 1000));
        }
        if (status.logs && status.logs.length > 0) {
          setReconstructionLogs(status.logs);
        }
        if (status.modelStats) {
          setModelStats(status.modelStats);
        }
        if (status.error) {
          setErrorMessage(status.error);
        }
      }
    });
  }, []);

  // Subscribe to progress and log updates
  useEffect(() => {
    const unsubProgress = subscribeReconstructionProgress((data) => {
      if (!data) return;
      if (data.status) setJobStatus(data.status);
      if (data.stage) setActiveStageKey(data.stage);
      if (data.stageLabel) setActiveStageLabel(data.stageLabel);
      if (data.elapsedMs != null) {
        setElapsedSeconds(Math.floor(data.elapsedMs / 1000));
      }

      if (data.status === 'completed') {
        setModelStats(data.modelStats || null);
        if (data.plyPath && onAttachNativePly) {
          const isMesh = Boolean(data.modelStats?.isMesh);
          const isPointCloud = Boolean(data.modelStats?.isPointCloud ?? !isMesh);
          const defaultName = isMesh
            ? 'scene_mesh.ply'
            : (data.plyPath.includes('dense') ? 'scene_dense.ply' : 'sparse.ply');

          onAttachNativePly({
            path: data.plyPath,
            name: defaultName,
            sizeBytes: data.modelStats?.fileSizeBytes || data.modelStats?.pointsSize || 0,
            isMesh,
            isPointCloud,
            vertexCount: data.modelStats?.vertexCount,
            faceCount: data.modelStats?.faceCount || 0,
            lastModified: Date.now(),
          });
        }
      }

      if (data.status === 'failed') {
        setModelStats(null);
        setErrorMessage(data.error || 'Reconstruction failed.');
      }

      if (data.status === 'cancelled') {
        setModelStats(null);
      }
    });

    const unsubLog = subscribeReconstructionLog((entry) => {
      setReconstructionLogs((prev) => {
        const next = [...prev, entry];
        return next.length > 500 ? next.slice(-500) : next;
      });
    });

    return () => {
      unsubProgress();
      unsubLog();
    };
  }, [onAttachNativePly]);

  // Elapsed timer when job is running
  useEffect(() => {
    let timer = null;
    if (jobStatus === 'running') {
      timer = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [jobStatus]);

  // Handle workspace folder selection
  const handleSelectWorkspace = async () => {
    if (!currentProject) return null;
    const res = await selectWorkspaceDirectory();
    if (res.canceled) return null;
    if (res.error) {
      alert(`Workspace selection error: ${res.error}`);
      return null;
    }
    if (res.path && onUpdateProjectOutputDirectory) {
      onUpdateProjectOutputDirectory(currentProject.id, res);
      return res.path;
    }
    return null;
  };

  // Launch reconstruction pipeline
  const handleStartPipeline = async () => {
    if (!currentProject) {
      alert('Please create or select an active project first.');
      return;
    }

    const imageDir = currentProject.sourceDirectoryReference?.path;
    if (!imageDir) {
      if (window.confirm('No source photographs directory is attached to this project. Navigate to Import Photographs screen to select photos?')) {
        onNavigateImport();
      }
      return;
    }

    let outputDir = currentProject.outputDirectoryReference?.path;
    if (!outputDir) {
      alert('Please select a dedicated output workspace folder for COLMAP and OpenMVS files.');
      outputDir = await handleSelectWorkspace();
      if (!outputDir) return; // User canceled
    }

    // Reset logs, model stats, and error
    setReconstructionLogs([]);
    setErrorMessage(null);
    setModelStats(null);
    setElapsedSeconds(0);
    setJobStatus('running');

    const result = await startSparseReconstruction({
      imageDir,
      outputDir,
      targetStage,
      numThreads: 4,
      resolutionLevel: 1,
      maxResolution: 1920,
    });

    if (!result.success) {
      setJobStatus('failed');
      setErrorMessage(result.error);
      alert(`Failed to start reconstruction: ${result.error}`);
    }
  };

  // Cancel running pipeline
  const handleCancelPipeline = async () => {
    if (window.confirm('Cancel active reconstruction? Any running subprocesses will be terminated.')) {
      await cancelSparseReconstruction();
      setJobStatus('cancelled');
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    const kb = bytes / 1024;
    return `${kb.toFixed(0)} KB`;
  };

  return (
    <div className="studio-container">
      {/* Left Stage Pipeline Sidebar */}
      <PipelineSidebar
        activeStage={activeStage}
        onSelectStage={setActiveStage}
        currentProject={currentProject}
        jobStatus={jobStatus}
        activeStageKey={activeStageKey}
        targetStage={targetStage}
        onTargetStageChange={setTargetStage}
        elapsedSeconds={elapsedSeconds}
        onStartPipeline={handleStartPipeline}
        onCancelPipeline={handleCancelPipeline}
        onSelectWorkspace={handleSelectWorkspace}
      />

      {/* Central 3D Viewport with Floating Controls & Overlays */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
        {/* Studio Project Header Sub-bar */}
        <div className="studio-project-bar">
          <div className="studio-project-info">
            <button
              type="button"
              className="btn-ghost"
              style={{ padding: '3px 7px', fontSize: '11px', color: 'var(--text-secondary)' }}
              onClick={onNavigateHome}
              title="Return to Projects Home"
            >
              <ArrowLeft size={12} />
              <span>Projects</span>
            </button>

            <span className="studio-bar-divider">|</span>

            <div className="studio-project-title-group">
              <span className="studio-project-label">PROJECT:</span>
              <span className="studio-project-name">
                {currentProject ? currentProject.name : 'Default Workspace (Demo Mode)'}
              </span>
              {currentProject && (
                <span className="studio-project-id-badge">
                  {currentProject.id}
                </span>
              )}
            </div>

            {currentProject?.sourceDirectoryReference && (
              <span className="studio-asset-pill photos" title={`Source: ${currentProject.sourceDirectoryReference.path || currentProject.sourceDirectoryReference.name}`}>
                <Camera size={11} />
                <span>{currentProject.sourceDirectoryReference.fileCount} photos</span>
              </span>
            )}

            {currentProject?.outputDirectoryReference && (
              <span className="studio-asset-pill" style={{ background: 'rgba(213, 255, 101, 0.08)', color: 'var(--accent)', border: '1px solid rgba(213, 255, 101, 0.2)' }} title={`Workspace: ${currentProject.outputDirectoryReference.path}`}>
                <HardDrive size={11} />
                <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {currentProject.outputDirectoryReference.name}
                </span>
              </span>
            )}

            {currentProject?.modelFileReference && (
              <span
                className="studio-asset-pill"
                style={{
                  background: currentProject.modelFileReference.isMesh ? 'rgba(168, 85, 247, 0.12)' : 'rgba(56, 189, 248, 0.12)',
                  color: currentProject.modelFileReference.isMesh ? '#c084fc' : '#38bdf8',
                  border: `1px solid ${currentProject.modelFileReference.isMesh ? 'rgba(168, 85, 247, 0.3)' : 'rgba(56, 189, 248, 0.3)'}`,
                }}
                title={`Model: ${currentProject.modelFileReference.name} (${currentProject.modelFileReference.isMesh ? 'Polygonal Mesh' : 'Point Cloud'})`}
              >
                <Box size={11} />
                <span>
                  {currentProject.modelFileReference.isMesh ? 'Mesh: ' : 'Point Cloud: '}
                  {currentProject.modelFileReference.name} ({formatFileSize(currentProject.modelFileReference.sizeBytes)})
                </span>
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {currentProject && !currentProject.outputDirectoryReference && (
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: '11px', padding: '3px 8px' }}
                onClick={handleSelectWorkspace}
                title="Select a dedicated folder for reconstruction output"
              >
                <FolderOpen size={12} />
                <span>Set Workspace...</span>
              </button>
            )}

            {currentProject && (
              <button
                type="button"
                className="btn-ghost"
                style={{ fontSize: '11px', padding: '3px 8px' }}
                onClick={onNavigateImport}
                title="Manage source photographs for this project"
              >
                <Camera size={12} />
                <span>Manage Photos</span>
              </button>
            )}
          </div>
        </div>

        {/* Status notification banner if failed or error */}
        {errorMessage && (
          <div style={{ background: 'rgba(239, 68, 68, 0.12)', borderBottom: '1px solid var(--color-danger, #ef4444)', padding: '6px 14px', fontSize: '11.5px', color: 'var(--color-danger, #f87171)', display: 'flex', alignItems: 'center', gap: '8px', zIndex: 10 }}>
            <AlertTriangle size={13} />
            <span>Reconstruction Error: {errorMessage}</span>
          </div>
        )}

        {/* 3D WebGL Viewport */}
        <Viewport3D
          currentProject={currentProject}
          sessionModelFile={sessionModelFile}
          onAttachModelFile={onAttachModelFile}
          onAttachNativePly={onAttachNativePly}
        />

        {/* Bottom Collapsible Pipeline Output & Console */}
        <LogPanel
          externalLogs={reconstructionLogs}
          currentStage={activeStageLabel}
          jobStatus={jobStatus}
        />
      </div>
    </div>
  );
}
