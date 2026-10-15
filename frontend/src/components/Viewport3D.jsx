import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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
  // View state switcher for inspecting required UI states
  const [viewportState, setViewportState] = useState('loaded'); // 'loaded' | 'loading' | 'empty' | 'error'
  const [renderMode, setRenderMode] = useState('shaded'); // 'shaded' | 'wireframe' | 'points'
  const [lightingMode, setLightingMode] = useState('studio'); // 'studio' | 'flat'
  const [interactionMode, setInteractionMode] = useState('orbit'); // 'orbit' | 'pan'
  const [webglError, setWebglError] = useState(null);

  // Live WebGL runtime metrics (measured directly from Three.js renderer)
  const [liveMetrics, setLiveMetrics] = useState({
    fps: 60,
    vertices: 0,
    triangles: 0,
    drawCalls: 0,
    webglVersion: 'WebGL 2.0',
  });

  // DOM References
  const canvasContainerRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const lightsRef = useRef({ ambient: null, main: null, fill: null });
  const objectGroupsRef = useRef({ solid: null, wireframe: null, points: null });

  // Initial camera parameters for reset functionality
  const INITIAL_CAMERA_POS = new THREE.Vector3(6.5, 4.8, 7.2);
  const INITIAL_TARGET_POS = new THREE.Vector3(0, 1.1, 0);

  // --------------------------------------------------------------------------
  // Three.js Scene Initialization and Lifecycle
  // --------------------------------------------------------------------------
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    let animationFrameId;
    let resizeObserver;
    let isDisposed = false;

    try {
      // 1. Scene Setup
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x080A0B);
      scene.fog = new THREE.FogExp2(0x080A0B, 0.015);
      sceneRef.current = scene;

      // 2. Camera Setup
      const width = container.clientWidth || 800;
      const height = container.clientHeight || 500;
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
      camera.position.copy(INITIAL_CAMERA_POS);
      cameraRef.current = camera;

      // 3. WebGL Renderer with strict resource caps for 8 GB RAM / iGPU
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'default',
        alpha: false,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(width, height, false);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.domElement.className = 'viewport-three-canvas';
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      rendererRef.current = renderer;

      // Clear any existing children before appending (Strict Mode safety)
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
      container.appendChild(renderer.domElement);

      // Detect active WebGL version for telemetry
      const gl = renderer.getContext();
      const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
      const webglVersion = isWebGL2 ? 'WebGL 2.0' : 'WebGL 1.0';

      // 4. OrbitControls Setup
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.minDistance = 2.0;
      controls.maxDistance = 35.0;
      controls.maxPolarAngle = Math.PI / 2 + 0.08; // Allow slight sub-horizon viewing
      controls.target.copy(INITIAL_TARGET_POS);
      controls.update();
      controlsRef.current = controls;

      // 5. Lighting Setup
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
      scene.add(ambientLight);

      const mainLight = new THREE.DirectionalLight(0xffffff, 1.3);
      mainLight.position.set(8, 12, 9);
      scene.add(mainLight);

      const fillLight = new THREE.DirectionalLight(0x7890a8, 0.5);
      fillLight.position.set(-8, 6, -7);
      scene.add(fillLight);

      lightsRef.current = { ambient: ambientLight, main: mainLight, fill: fillLight };

      // 6. Ground Grid & Coordinate Helpers
      // GridHelper: subtle electric lime accent on center lines (0x4e6320), dark graphite grid (0x1e2329)
      const gridHelper = new THREE.GridHelper(16, 16, 0x4e6320, 0x1e2329);
      gridHelper.position.y = 0;
      scene.add(gridHelper);

      // World Axes Helper (Red=X, Green=Y, Blue=Z)
      const axesHelper = new THREE.AxesHelper(1.6);
      axesHelper.position.set(0, 0.01, 0);
      scene.add(axesHelper);

      // 7. Low-Poly Architectural Demo Geometry Construction
      // Represents a drone survey subject (Pavilion Structure) built from Three.js primitives
      const solidGroup = new THREE.Group();
      const wireframeGroup = new THREE.Group();
      const pointsGroup = new THREE.Group();
      scene.add(solidGroup);
      scene.add(wireframeGroup);
      scene.add(pointsGroup);
      objectGroupsRef.current = { solid: solidGroup, wireframe: wireframeGroup, points: pointsGroup };

      // Materials for Shaded Mode
      const baseMaterial = new THREE.MeshStandardMaterial({
        color: 0x1e2329,
        roughness: 0.65,
        metalness: 0.2,
      });

      const columnMaterial = new THREE.MeshStandardMaterial({
        color: 0x2a313a,
        roughness: 0.55,
        metalness: 0.25,
      });

      const accentMaterial = new THREE.MeshStandardMaterial({
        color: 0xD5FF65,
        roughness: 0.35,
        metalness: 0.3,
        emissive: 0x1e2d00,
        emissiveIntensity: 0.4,
      });

      // Material for Wireframe Mode
      const wireframeMaterial = new THREE.MeshBasicMaterial({
        color: 0xD5FF65,
        wireframe: true,
      });

      // Material for Points Mode (Photogrammetry Point Cloud scan aesthetic)
      const pointsMaterial = new THREE.PointsMaterial({
        color: 0xD5FF65,
        size: 3.5,
        sizeAttenuation: false,
      });

      // Edge outline material for crisp architectural drafting feel in solid mode
      const edgeLineMaterial = new THREE.LineBasicMaterial({
        color: 0x3d4752,
        transparent: true,
        opacity: 0.7,
      });

      const accentLineMaterial = new THREE.LineBasicMaterial({
        color: 0xD5FF65,
        transparent: true,
        opacity: 0.9,
      });

      // Collect point cloud positions
      const allPointsVertices = [];

      // Helper function to build architectural parts
      const addArchitecturalPart = (geometry, material, pos, rot, isAccent = false) => {
        // Solid Mesh
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(pos);
        if (rot) mesh.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
        solidGroup.add(mesh);

        // Subtle architectural edge lines
        const edgesGeom = new THREE.EdgesGeometry(geometry, 25);
        const edgeLines = new THREE.LineSegments(
          edgesGeom,
          isAccent ? accentLineMaterial : edgeLineMaterial
        );
        edgeLines.position.copy(pos);
        if (rot) edgeLines.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
        solidGroup.add(edgeLines);

        // Wireframe part
        const wireMesh = new THREE.Mesh(geometry, wireframeMaterial);
        wireMesh.position.copy(pos);
        if (rot) wireMesh.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
        wireframeGroup.add(wireMesh);

        // Extract vertices for Point Cloud mode
        const posAttr = geometry.attributes.position;
        const matrix = new THREE.Matrix4();
        if (rot) matrix.makeRotationFromEuler(new THREE.Euler(rot.x || 0, rot.y || 0, rot.z || 0));
        matrix.setPosition(pos);

        for (let i = 0; i < posAttr.count; i++) {
          const v = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
          v.applyMatrix4(matrix);
          allPointsVertices.push(v.x, v.y, v.z);
        }
      };

      // Part A: Ground Plinth Foundation
      addArchitecturalPart(
        new THREE.BoxGeometry(3.8, 0.22, 3.8),
        baseMaterial,
        new THREE.Vector3(0, 0.11, 0)
      );

      // Part B: Second Tier Step
      addArchitecturalPart(
        new THREE.BoxGeometry(3.2, 0.16, 3.2),
        baseMaterial,
        new THREE.Vector3(0, 0.3, 0)
      );

      // Part C: Main Sanctuary Core Block
      addArchitecturalPart(
        new THREE.BoxGeometry(1.9, 1.4, 1.9),
        baseMaterial,
        new THREE.Vector3(0, 1.08, 0)
      );

      // Part D: 4 Corner Architectural Columns
      const columnOffsets = [
        { x: -1.25, z: -1.25 },
        { x: 1.25, z: -1.25 },
        { x: -1.25, z: 1.25 },
        { x: 1.25, z: 1.25 },
      ];
      columnOffsets.forEach((col) => {
        addArchitecturalPart(
          new THREE.CylinderGeometry(0.1, 0.13, 1.4, 12),
          columnMaterial,
          new THREE.Vector3(col.x, 1.08, col.z)
        );
      });

      // Part E: Entablature / Roof Beam
      addArchitecturalPart(
        new THREE.BoxGeometry(3.0, 0.22, 3.0),
        baseMaterial,
        new THREE.Vector3(0, 1.89, 0)
      );

      // Part F: Pyramidal Roof
      addArchitecturalPart(
        new THREE.ConeGeometry(2.3, 1.1, 4),
        baseMaterial,
        new THREE.Vector3(0, 2.55, 0),
        { y: Math.PI / 4 },
        true // Electric lime roof edge accent
      );

      // Part G: Decorative Roof Finial / Aerial Survey Beacon
      addArchitecturalPart(
        new THREE.CylinderGeometry(0.02, 0.06, 0.45, 8),
        accentMaterial,
        new THREE.Vector3(0, 3.25, 0),
        null,
        true
      );
      addArchitecturalPart(
        new THREE.SphereGeometry(0.09, 12, 10),
        accentMaterial,
        new THREE.Vector3(0, 3.52, 0),
        null,
        true
      );

      // Build Combined Point Cloud Geometry
      const pointsGeometry = new THREE.BufferGeometry();
      pointsGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(allPointsVertices, 3)
      );
      const pointsMesh = new THREE.Points(pointsGeometry, pointsMaterial);
      pointsGroup.add(pointsMesh);

      // Calculate exact actual vertices in the demo object
      const totalDemoVertices = allPointsVertices.length / 3;

      // Initial visibility based on renderMode
      solidGroup.visible = true;
      wireframeGroup.visible = false;
      pointsGroup.visible = false;

      // 8. Resize Observer
      resizeObserver = new ResizeObserver((entries) => {
        if (!entries || entries.length === 0 || isDisposed) return;
        const entry = entries[0];
        const newWidth = Math.floor(entry.contentRect.width);
        const newHeight = Math.floor(entry.contentRect.height);

        if (newWidth > 0 && newHeight > 0) {
          camera.aspect = newWidth / newHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(newWidth, newHeight, false);
        }
      });
      resizeObserver.observe(container);

      // 9. Animation & Measured Runtime Telemetry Loop
      let frameCount = 0;
      let lastTime = performance.now();

      const animate = () => {
        if (isDisposed) return;
        animationFrameId = requestAnimationFrame(animate);

        // Update controls with damping
        controls.update();

        // Render actual scene
        renderer.render(scene, camera);

        // Measure live runtime FPS (averaged over 500ms intervals)
        const now = performance.now();
        frameCount++;
        if (now - lastTime >= 500) {
          const calculatedFps = Math.round((frameCount * 1000) / (now - lastTime));
          setLiveMetrics({
            fps: calculatedFps,
            vertices: totalDemoVertices,
            triangles: renderer.info.render.triangles,
            drawCalls: renderer.info.render.calls,
            webglVersion,
          });
          frameCount = 0;
          lastTime = now;
        }
      };

      animate();
    } catch (err) {
      console.error('Aeromorph Three.js initialization error:', err);
      setWebglError(err.message || 'WebGL context could not be created.');
    }

    // 10. Strict Cleanup on Unmount
    return () => {
      isDisposed = true;
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      if (resizeObserver) resizeObserver.disconnect();

      if (controlsRef.current) {
        controlsRef.current.dispose();
      }

      if (sceneRef.current) {
        sceneRef.current.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach((m) => m.dispose());
            } else {
              obj.material.dispose();
            }
          }
        });
      }

      if (rendererRef.current) {
        rendererRef.current.dispose();
        if (container && rendererRef.current.domElement && container.contains(rendererRef.current.domElement)) {
          container.removeChild(rendererRef.current.domElement);
        }
      }
    };
  }, []);

  // --------------------------------------------------------------------------
  // Reactive Control Handlers (Solid, Wireframe, Points)
  // --------------------------------------------------------------------------
  useEffect(() => {
    const groups = objectGroupsRef.current;
    if (!groups.solid || !groups.wireframe || !groups.points) return;

    if (renderMode === 'shaded') {
      groups.solid.visible = true;
      groups.wireframe.visible = false;
      groups.points.visible = false;
    } else if (renderMode === 'wireframe') {
      groups.solid.visible = false;
      groups.wireframe.visible = true;
      groups.points.visible = false;
    } else if (renderMode === 'points') {
      groups.solid.visible = false;
      groups.wireframe.visible = false;
      groups.points.visible = true;
    }
  }, [renderMode]);

  // Lighting Mode Handler (Studio vs Flat)
  useEffect(() => {
    const lights = lightsRef.current;
    if (!lights.ambient || !lights.main) return;

    if (lightingMode === 'studio') {
      lights.ambient.intensity = 0.7;
      lights.main.intensity = 1.3;
      if (lights.fill) lights.fill.intensity = 0.5;
    } else {
      // Flat lighting mode (uniform illumination)
      lights.ambient.intensity = 1.6;
      lights.main.intensity = 0.2;
      if (lights.fill) lights.fill.intensity = 0.2;
    }
  }, [lightingMode]);

  // Interaction Mode Handler (Orbit vs Pan on left-click)
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    if (interactionMode === 'orbit') {
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
    } else {
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      };
    }
  }, [interactionMode]);

  // Camera Reset Handler
  const handleResetCamera = () => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.copy(INITIAL_CAMERA_POS);
      controlsRef.current.target.copy(INITIAL_TARGET_POS);
      controlsRef.current.update();
    }
  };

  // Zoom Step Handler
  const handleZoomStep = () => {
    if (cameraRef.current && controlsRef.current) {
      const dir = new THREE.Vector3().subVectors(controlsRef.current.target, cameraRef.current.position);
      cameraRef.current.position.addScaledVector(dir, 0.2);
      controlsRef.current.update();
    }
  };

  // Fullscreen Handler
  const handleToggleFullscreen = () => {
    const container = canvasContainerRef.current?.parentElement;
    if (!container) return;

    if (!document.fullscreenElement) {
      if (container.requestFullscreen) {
        container.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

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
          Processing
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

      {/* Floating Telemetry HUD (Top-Right) — Measured Realtime Three.js Metrics */}
      {viewportState === 'loaded' && !webglError && (
        <div className="viewport-hud-top-right">
          <div className="hud-badge-row">
            <span className="hud-label-dim">THREE.JS WEBGL VIEWPORT</span>
            <span className="hud-demo-pill">Demo Geometry</span>
          </div>
          <div className="hud-stat-row">
            <span>Live FPS</span>
            <span className="hud-stat-value accent">{liveMetrics.fps}</span>
          </div>
          <div className="hud-stat-row">
            <span>Vertices (Live)</span>
            <span className="hud-stat-value">{liveMetrics.vertices.toLocaleString()}</span>
          </div>
          <div className="hud-stat-row">
            <span>Faces (Live)</span>
            <span className="hud-stat-value">{liveMetrics.triangles.toLocaleString()}</span>
          </div>
          <div className="hud-stat-row">
            <span>Draw Calls</span>
            <span className="hud-stat-value">{liveMetrics.drawCalls}</span>
          </div>
          <div className="hud-stat-row">
            <span>Renderer</span>
            <span className="hud-stat-value" style={{ fontSize: '9.5px' }}>{liveMetrics.webglVersion}</span>
          </div>
          <div className="hud-stat-row">
            <span>Shading Mode</span>
            <span className="hud-stat-value" style={{ textTransform: 'capitalize' }}>{renderMode}</span>
          </div>
        </div>
      )}

      {/* Primary 3D Viewport Area */}
      <div className="viewport-canvas-mock">
        {/* Dedicated Three.js WebGL Container */}
        <div
          ref={canvasContainerRef}
          className="viewport-three-container"
          style={{
            width: '100%',
            height: '100%',
            position: 'absolute',
            inset: 0,
            display: viewportState === 'loaded' && !webglError ? 'block' : 'none',
          }}
        />

        {/* WebGL Context Unavailable Fallback Message */}
        {webglError && (
          <div className="viewport-state-overlay" style={{ borderColor: 'var(--color-warning-dim)' }}>
            <div className="empty-icon-bubble" style={{ color: 'var(--color-warning)', background: 'var(--color-warning-dim)' }}>
              <AlertTriangle size={24} />
            </div>
            <div>
              <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                WebGL Context Unavailable
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                {webglError}
              </p>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Ensure hardware acceleration is enabled in your browser settings.
            </span>
          </div>
        )}

        {/* View State: Model Loading / In Progress (Simulated) */}
        {viewportState === 'loading' && (
          <div className="viewport-state-overlay">
            <Loader2 size={32} color="var(--accent)" className="animate-spin" style={{ animation: 'spin 2s linear infinite' }} />
            <div>
              <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                Reconstructing Mesh Geometry (Simulated)
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                OpenMVS Delaunay Tetrahedralization • Step 5 of 6
              </p>
            </div>

            <div className="state-progress-bar-container">
              <div className="state-progress-bar-fill" style={{ width: '84%' }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '11px', color: 'var(--text-muted)' }}>
              <span>Delaunay cells: 42.8M (Simulated)</span>
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>84%</span>
            </div>

            <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Illustrative state — Real pipeline execution connects in future sprint
            </span>
          </div>
        )}

        {/* View State: Empty Viewport */}
        {viewportState === 'empty' && (
          <div className="viewport-state-overlay">
            <div className="empty-icon-bubble">
              <Box size={24} strokeWidth={1.8} />
            </div>
            <div>
              <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                No 3D Model Loaded
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Import a set of drone photographs or open a saved reconstruction project to view 3D geometry.
              </p>
            </div>
            <button type="button" className="btn-primary" style={{ marginTop: '6px' }}>
              <FolderPlus size={13} />
              <span>Import Image Sequence</span>
            </button>
          </div>
        )}

        {/* View State: Pipeline Error (Illustrative) */}
        {viewportState === 'error' && (
          <div className="viewport-state-overlay" style={{ borderColor: 'var(--color-error-dim)' }}>
            <div className="empty-icon-bubble" style={{ background: 'var(--color-error-dim)', color: 'var(--color-error)' }}>
              <AlertTriangle size={24} strokeWidth={1.8} />
            </div>
            <div>
              <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--color-error)', letterSpacing: '-0.01em' }}>
                Reconstruction Halted (Sample Error State)
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                COLMAP Feature Matcher registered &lt; 30 matching pairs between adjacent viewpoints.
              </p>
            </div>
            <div style={{ background: 'rgba(0, 0, 0, 0.45)', padding: '6px 10px', borderRadius: 'var(--radius-xs)', fontSize: '10.5px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              Error Code: ERR_COLMAP_MATCH_BELOW_THRESHOLD (Sample)
            </div>
            <button type="button" className="btn-secondary">
              <RotateCcw size={12} />
              <span>Reset &amp; Retry Thresholds</span>
            </button>
          </div>
        )}
      </div>

      {/* Floating Viewer Toolbar (Glassmorphism) — All Functional */}
      {viewportState === 'loaded' && !webglError && (
        <nav className="floating-viewer-toolbar glass-toolbar" aria-label="3D Viewport Controls">
          {/* Orbit Tool */}
          <button
            type="button"
            className={`tool-btn ${interactionMode === 'orbit' ? 'active' : ''}`}
            onClick={() => setInteractionMode('orbit')}
            title="Orbit Camera Mode (Left-Click Drag to Rotate, Right-Click to Pan)"
          >
            <Rotate3d size={15} />
          </button>

          {/* Pan Tool */}
          <button
            type="button"
            className={`tool-btn ${interactionMode === 'pan' ? 'active' : ''}`}
            onClick={() => setInteractionMode('pan')}
            title="Pan Camera Mode (Left-Click Drag to Pan)"
          >
            <Move size={15} />
          </button>

          {/* Zoom Step Tool */}
          <button
            type="button"
            className="tool-btn"
            onClick={handleZoomStep}
            title="Zoom In Step (or use Mouse Scroll Wheel)"
          >
            <ZoomIn size={15} />
          </button>

          <div className="toolbar-separator" />

          {/* Shaded Solid Mesh */}
          <button
            type="button"
            className={`tool-btn ${renderMode === 'shaded' ? 'active' : ''}`}
            onClick={() => setRenderMode('shaded')}
            title="Solid Shaded Mesh with Architectural Edges"
          >
            <Layers size={15} />
          </button>

          {/* Wireframe Mesh */}
          <button
            type="button"
            className={`tool-btn ${renderMode === 'wireframe' ? 'active' : ''}`}
            onClick={() => setRenderMode('wireframe')}
            title="Wireframe View (Electric Lime)"
          >
            <Grid3X3 size={15} />
          </button>

          {/* Point Cloud Scan */}
          <button
            type="button"
            className={`tool-btn ${renderMode === 'points' ? 'active' : ''}`}
            onClick={() => setRenderMode('points')}
            title="Point Cloud Scan Mode (Three.js Particles)"
          >
            <Eye size={15} />
          </button>

          <div className="toolbar-separator" />

          {/* Lighting Mode: Studio vs Flat */}
          <button
            type="button"
            className={`tool-btn ${lightingMode === 'flat' ? 'active' : ''}`}
            onClick={() => setLightingMode(lightingMode === 'studio' ? 'flat' : 'studio')}
            title={`Lighting Mode: ${lightingMode === 'studio' ? 'Studio Lights (Click for Flat)' : 'Flat Ambient (Click for Studio)'}`}
          >
            <Sun size={15} />
          </button>

          {/* Camera Reset */}
          <button
            type="button"
            className="tool-btn"
            onClick={handleResetCamera}
            title="Reset Camera to Default View (7, 5, 7)"
          >
            <RotateCcw size={15} />
          </button>

          {/* Fullscreen Viewport */}
          <button
            type="button"
            className="tool-btn"
            onClick={handleToggleFullscreen}
            title="Toggle Viewport Fullscreen"
          >
            <Maximize2 size={15} />
          </button>
        </nav>
      )}
    </div>
  );
}
