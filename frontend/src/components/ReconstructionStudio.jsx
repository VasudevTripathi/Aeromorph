import React, { useState } from 'react';
import PipelineSidebar from './PipelineSidebar';
import Viewport3D from './Viewport3D';
import LogPanel from './LogPanel';

export default function ReconstructionStudio() {
  const [activeStage, setActiveStage] = useState('mesh_reconstruction');

  return (
    <div className="studio-container">
      {/* Left Stage Pipeline Sidebar */}
      <PipelineSidebar
        activeStage={activeStage}
        onSelectStage={setActiveStage}
      />

      {/* Central 3D Viewport with Floating Controls & Overlays */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
        <Viewport3D />

        {/* Bottom Collapsible Pipeline Output & Console */}
        <LogPanel />
      </div>
    </div>
  );
}
