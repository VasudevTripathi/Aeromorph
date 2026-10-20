import React, { useState } from 'react';
import { Box, Camera, FolderOpen, ArrowLeft, Clock } from 'lucide-react';
import PipelineSidebar from './PipelineSidebar';
import Viewport3D from './Viewport3D';
import LogPanel from './LogPanel';

export default function ReconstructionStudio({
  currentProject = null,
  sessionModelFile = null,
  onAttachModelFile,
  onAttachNativePly,
  onNavigateHome,
  onNavigateImport,
}) {
  const [activeStage, setActiveStage] = useState('mesh_reconstruction');

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
              <span className="studio-asset-pill photos" title={`Source: ${currentProject.sourceDirectoryReference.name}`}>
                <Camera size={11} />
                <span>{currentProject.sourceDirectoryReference.fileCount} photos</span>
              </span>
            )}

            {currentProject?.modelFileReference && (
              <span className="studio-asset-pill mesh" title={`Model: ${currentProject.modelFileReference.name}`}>
                <Box size={11} />
                <span>{currentProject.modelFileReference.name} ({formatFileSize(currentProject.modelFileReference.sizeBytes)})</span>
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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

        {/* 3D WebGL Viewport */}
        <Viewport3D
          currentProject={currentProject}
          sessionModelFile={sessionModelFile}
          onAttachModelFile={onAttachModelFile}
          onAttachNativePly={onAttachNativePly}
        />

        {/* Bottom Collapsible Pipeline Output & Console */}
        <LogPanel />
      </div>
    </div>
  );
}
