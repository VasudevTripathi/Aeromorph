import React, { useState } from 'react';
import {
  Rotate3d,
  Move,
  ZoomIn,
  Maximize2,
  Sun,
  Grid3X3,
  Eye,
  RotateCcw,
  Layers,
  Loader2,
  AlertTriangle,
  FolderPlus,
  Box
} from 'lucide-react';

export default function Viewport3D() {
  // State switcher for reviewing all four required UI states
  const [viewportState, setViewportState] = useState('loaded'); // 'loaded' | 'loading' | 'empty' | 'error'
  const [renderMode, setRenderMode] = useState('shaded'); // 'shaded' | 'wireframe' | 'points'
  const [lightingMode, setLightingMode] = useState('studio');

  return (
    <div className="studio-center-area">
      {/* Interactive UI State Switcher Bar */}
      <div className="viewport-state-bar" role="toolbar" aria-label="Review UI States">
        <span className="state-switcher-label">View State:</span>
        <button
          type="button"
          className={`state-pill-btn ${viewportState === 'loaded' ? 'active' : ''}`}
          onClick={() => setViewportState('loaded')}
        >
          Model Loaded
        </button>
        <button
          type="button"
          className={`state-pill-btn ${viewportState === 'loading' ? 'active' : ''}`}
          onClick={() => setViewportState('loading')}
        >
          Loading / Processing
        </button>
        <button
          type="button"
          className={`state-pill-btn ${viewportState === 'empty' ? 'active' : ''}`}
          onClick={() => setViewportState('empty')}
        >
          Empty Viewport
        </button>
        <button
          type="button"
          className={`state-pill-btn ${viewportState === 'error' ? 'active' : ''}`}
          onClick={() => setViewportState('error')}
        >
          Error State
        </button>
      </div>

      {/* Floating Realtime Telemetry HUD (Top-Right) */}
      {viewportState === 'loaded' && (
        <div className="viewport-hud-top-right">
          <div className="hud-stat-row">
            <span>FPS</span>
            <span className="hud-stat-value accent">60.0</span>
          </div>
          <div className="hud-stat-row">
            <span>Vertices</span>
            <span className="hud-stat-value">3,411,172</span>
          </div>
          <div className="hud-stat-row">
            <span>Faces</span>
            <span className="hud-stat-value">6,818,166</span>
          </div>
          <div className="hud-stat-row">
            <span>VRAM (Shared)</span>
            <span className="hud-stat-value">340 MB</span>
          </div>
          <div className="hud-stat-row">
            <span>Shading</span>
            <span className="hud-stat-value" style={{ textTransform: 'capitalize' }}>{renderMode}</span>
          </div>
        </div>
      )}

      {/* Viewport Canvas & Representative Visualizations */}
      <div className="viewport-canvas-mock">
        {viewportState === 'loaded' && (
          <>
            {/* Cinematic Architectural Mesh Wireframe Vector Graphic */}
            <svg
              className="mesh-wireframe-svg"
              viewBox="0 0 800 500"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-label="3D Model Mesh Preview"
            >
              <defs>
                <linearGradient id="meshGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#D5FF65" stopOpacity="0.8" />
                  <stop offset="50%" stopColor="#5CAEFF" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#85BF1B" stopOpacity="0.2" />
                </linearGradient>
                <linearGradient id="facetFill" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="rgba(213, 255, 101, 0.08)" />
                  <stop offset="100%" stopColor="rgba(21, 24, 27, 0.6)" />
                </linearGradient>
              </defs>

              {/* Perspective Ground Grid Lines */}
              <g stroke="rgba(255, 255, 255, 0.06)" strokeWidth="1">
                <line x1="100" y1="420" x2="700" y2="420" />
                <line x1="150" y1="380" x2="650" y2="380" />
                <line x1="200" y1="350" x2="600" y2="350" />
                <line x1="250" y1="330" x2="550" y2="330" />
                {/* Radial lines */}
                <line x1="400" y1="300" x2="100" y2="440" />
                <line x1="400" y1="300" x2="250" y2="440" />
                <line x1="400" y1="300" x2="400" y2="440" />
                <line x1="400" y1="300" x2="550" y2="440" />
                <line x1="400" y1="300" x2="700" y2="440" />
              </g>

              {/* Architectural Building Facets */}
              <g
                stroke={renderMode === 'wireframe' ? 'var(--accent)' : 'url(#meshGradient)'}
                strokeWidth={renderMode === 'wireframe' ? '1.2' : '1.5'}
                fill={renderMode === 'shaded' ? 'url(#facetFill)' : 'none'}
              >
                {/* Roof & Tower */}
                <polygon points="400,110 320,180 480,180" />
                <polygon points="400,110 480,180 540,150" />
                <polygon points="400,110 540,150 460,85" />
                <polygon points="400,110 460,85 320,180" />

                {/* Main Structure Façade */}
                <polygon points="320,180 480,180 480,310 320,310" />
                <polygon points="480,180 540,150 540,280 480,310" />
                <polygon points="320,180 260,150 260,280 320,310" />

                {/* Triangulation Edges (OpenMVS Delaunay Aesthetic) */}
                <line x1="320" y1="180" x2="480" y2="310" strokeOpacity="0.4" />
                <line x1="480" y1="180" x2="320" y2="310" strokeOpacity="0.4" />
                <line x1="480" y1="180" x2="540" y2="280" strokeOpacity="0.4" />
                <line x1="320" y1="180" x2="260" y2="280" strokeOpacity="0.4" />

                {/* Supporting Wings */}
                <polygon points="260,280 200,260 200,340 260,310" />
                <polygon points="540,280 600,260 600,340 540,310" />
                <polygon points="320,310 480,310 510,360 290,360" />
              </g>

              {/* Point Cloud Vertices (visible in point cloud or shaded mode) */}
              {(renderMode === 'points' || renderMode === 'shaded') && (
                <g fill="#D5FF65">
                  <circle cx="400" cy="110" r="2.5" />
                  <circle cx="320" cy="180" r="2" />
                  <circle cx="480" cy="180" r="2" />
                  <circle cx="540" cy="150" r="2" />
                  <circle cx="460" cy="85" r="2" />
                  <circle cx="320" cy="310" r="2" />
                  <circle cx="480" cy="310" r="2" />
                  <circle cx="540" cy="280" r="2" />
                  <circle cx="260" cy="150" r="2" />
                  <circle cx="260" cy="280" r="2" />
                  <circle cx="200" cy="260" r="1.5" />
                  <circle cx="600" cy="260" r="1.5" />
                  <circle cx="400" cy="245" r="2" fill="#5CAEFF" />
                  <circle cx="360" cy="210" r="1.5" />
                  <circle cx="440" cy="210" r="1.5" />
                </g>
              )}
            </svg>

            {/* 3D Coordinate Axis Gizmo (Bottom-Left) */}
            <div className="axis-gizmo" aria-hidden="true" title="Orientation Gizmo">
              <svg width="44" height="44" viewBox="0 0 60 60">
                {/* Origin */}
                <circle cx="30" cy="30" r="3" fill="#ffffff" />
                {/* X axis (Red) */}
                <line x1="30" y1="30" x2="52" y2="30" stroke="#FF5C5C" strokeWidth="2.5" />
                <text x="54" y="33" fill="#FF5C5C" fontSize="10" fontFamily="sans-serif" fontWeight="bold">X</text>
                {/* Y axis (Green) */}
                <line x1="30" y1="30" x2="30" y2="8" stroke="#67E8A0" strokeWidth="2.5" />
                <text x="27" y="6" fill="#67E8A0" fontSize="10" fontFamily="sans-serif" fontWeight="bold">Y</text>
                {/* Z axis (Blue / Perspective) */}
                <line x1="30" y1="30" x2="16" y2="44" stroke="#5CAEFF" strokeWidth="2.5" />
                <text x="8" y="52" fill="#5CAEFF" fontSize="10" fontFamily="sans-serif" fontWeight="bold">Z</text>
              </svg>
            </div>
          </>
        )}

        {/* State: Model Loading / In Progress */}
        {viewportState === 'loading' && (
          <div className="viewport-state-overlay">
            <Loader2 size={36} color="var(--accent)" className="animate-spin" style={{ animation: 'spin 2s linear infinite' }} />
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Reconstructing Mesh Geometry
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                OpenMVS Delaunay Tetrahedralization • Step 5 of 6
              </p>
            </div>

            <div className="state-progress-bar-container">
              <div className="state-progress-bar-fill" style={{ width: '84%' }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '11px', color: 'var(--text-muted)' }}>
              <span>Delaunay tetrahedras: 42.8M cells</span>
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>84%</span>
            </div>
          </div>
        )}

        {/* State: Empty Viewport */}
        {viewportState === 'empty' && (
          <div className="viewport-state-overlay">
            <div className="empty-icon-bubble">
              <Box size={28} strokeWidth={1.8} />
            </div>
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
                No 3D Model In Viewport
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Load an existing reconstruction project or import a sequence of drone photographs to generate a new 3D model.
              </p>
            </div>
            <button type="button" className="btn-primary" style={{ marginTop: '8px' }}>
              <FolderPlus size={14} />
              <span>Import Image Sequence</span>
            </button>
          </div>
        )}

        {/* State: Pipeline Error */}
        {viewportState === 'error' && (
          <div className="viewport-state-overlay" style={{ borderColor: 'var(--color-error-dim)' }}>
            <div className="empty-icon-bubble" style={{ background: 'var(--color-error-dim)', color: 'var(--color-error)' }}>
              <AlertTriangle size={28} strokeWidth={1.8} />
            </div>
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-error)' }}>
                Reconstruction Halted: Insufficient Visual Overlap
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                COLMAP Feature Matcher was unable to register camera poses for 18 out of 42 images due to low baseline overlap.
              </p>
            </div>
            <div style={{ background: 'rgba(0, 0, 0, 0.4)', padding: '8px 12px', borderRadius: 'var(--radius-xs)', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              Error code: ERR_COLMAP_MATCH_BELOW_THRESHOLD (matches &lt; 30)
            </div>
            <button type="button" className="btn-secondary">
              <RotateCcw size={13} />
              <span>Retry With Adjusted SIFT Thresholds</span>
            </button>
          </div>
        )}
      </div>

      {/* Floating Viewer Toolbar (Glassmorphism) */}
      {viewportState === 'loaded' && (
        <nav className="floating-viewer-toolbar glass-toolbar" aria-label="3D Viewport Controls">
          <button type="button" className="tool-btn active" title="Orbit Camera (Left Click + Drag)">
            <Rotate3d size={16} />
          </button>
          <button type="button" className="tool-btn" title="Pan Camera (Right Click + Drag)">
            <Move size={16} />
          </button>
          <button type="button" className="tool-btn" title="Zoom Camera (Scroll Wheel)">
            <ZoomIn size={16} />
          </button>

          <div className="toolbar-separator" />

          <button
            type="button"
            className={`tool-btn ${renderMode === 'shaded' ? 'active' : ''}`}
            onClick={() => setRenderMode('shaded')}
            title="Solid Shaded Mesh"
          >
            <Layers size={16} />
          </button>
          <button
            type="button"
            className={`tool-btn ${renderMode === 'wireframe' ? 'active' : ''}`}
            onClick={() => setRenderMode('wireframe')}
            title="Wireframe View"
          >
            <Grid3X3 size={16} />
          </button>
          <button
            type="button"
            className={`tool-btn ${renderMode === 'points' ? 'active' : ''}`}
            onClick={() => setRenderMode('points')}
            title="Dense Point Cloud"
          >
            <Eye size={16} />
          </button>

          <div className="toolbar-separator" />

          <button
            type="button"
            className="tool-btn"
            onClick={() => setLightingMode(lightingMode === 'studio' ? 'flat' : 'studio')}
            title={`Lighting: ${lightingMode}`}
          >
            <Sun size={16} />
          </button>
          <button type="button" className="tool-btn" title="Reset Viewport Camera">
            <RotateCcw size={16} />
          </button>
          <button type="button" className="tool-btn" title="Fullscreen Viewport">
            <Maximize2 size={16} />
          </button>
        </nav>
      )}
    </div>
  );
}
