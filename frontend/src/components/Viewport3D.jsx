import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
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
  FolderOpen,
  Box,
  FileCode,
  Sparkles
} from 'lucide-react';
import { isElectron, selectNativePlyFile, loadNativePlyBuffer } from '../services/desktopBridge';

export default function Viewport3D({
  currentProject = null,
  sessionModelFile = null,
  onAttachModelFile,
  onAttachNativePly,
  jobStatus = 'idle',
  activeStageKey = null,
  activeStageLabel = null,
  stageIndex = 1,
  totalStages = 6,
  elapsedSeconds = 0,
  errorMessage = null,
  onResumePipeline = null,
  onRetryPipeline = null,
  onClearError = null,
}) {
  // Viewport UI States
  const [manualViewOverride, setManualViewOverride] = useState(null); // null (auto) | 'loaded' | 'loading' | 'empty' | 'error'
  const [renderMode, setRenderMode] = useState('shaded'); // 'shaded' | 'wireframe' | 'points'
  const [lightingMode, setLightingMode] = useState('studio'); // 'studio' | 'flat'
  const [interactionMode, setInteractionMode] = useState('orbit'); // 'orbit' | 'pan'
  const [webglError, setWebglError] = useState(null);

  // Automatically sync viewport state with live pipeline execution unless manually overridden
  const effectiveState = manualViewOverride || (
    jobStatus === 'running'
      ? 'loading'
      : (errorMessage ? 'error' : 'loaded')
  );

  // When a new job begins running, reset any manual override so user views live pipeline progress
  useEffect(() => {
    if (jobStatus === 'running') {
      setManualViewOverride(null);
    }
  }, [jobStatus]);

  const formatElapsed = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  };

  // PLY Model Loading States
  const [isLoadingPly, setIsLoadingPly] = useState(false);
  const [plyLoadingName, setPlyLoadingName] = useState('');
  const [plyError, setPlyError] = useState(null);
  const [loadedModel, setLoadedModel] = useState(null); // Metadata of loaded PLY model or null if demo pavilion

  // Live Measured WebGL Runtime Telemetry
  const [liveMetrics, setLiveMetrics] = useState({
    fps: 60,
    vertices: 0,
    triangles: 0,
    drawCalls: 0,
    webglVersion: 'WebGL 2.0',
  });

  // DOM References
  const canvasContainerRef = useRef(null);
  const fileInputRef = useRef(null);
  const loadRequestIdRef = useRef(0);
  const currentProjectIdRef = useRef(currentProject?.id);
  const activeLoadedFileRef = useRef(null);

  // Three.js Core References
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const gridHelperRef = useRef(null);
  const axesHelperRef = useRef(null);
  const lightsRef = useRef({ ambient: null, main: null, fill: null });

  // Geometry Group References
  const demoPavilionGroupRef = useRef(null);
  const loadedModelGroupRef = useRef(null);
  const loadedSubGroupsRef = useRef({ solid: null, wireframe: null, points: null });

  // Camera initial framing references (updated when model is fitted)
  const defaultCameraPosRef = useRef(new THREE.Vector3(6.5, 4.8, 7.2));
  const defaultTargetPosRef = useRef(new THREE.Vector3(0, 1.1, 0));

  // --------------------------------------------------------------------------
  // Helper: Dispose all geometries & materials inside a group
  // --------------------------------------------------------------------------
  const disposeGroup = (group) => {
    if (!group) return;
    while (group.children.length > 0) {
      const child = group.children[0];
      if (child.isGroup) {
        disposeGroup(child);
      } else {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
      group.remove(child);
    }
  };

  // --------------------------------------------------------------------------
  // Three.js Scene Setup & Lifecycle
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
      scene.fog = new THREE.FogExp2(0x080A0B, 0.012);
      sceneRef.current = scene;

      // 2. Camera Setup
      const width = container.clientWidth || 800;
      const height = container.clientHeight || 500;
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
      camera.position.copy(defaultCameraPosRef.current);
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
      rendererRef.current = renderer;

      // Clear any existing children before appending (React Strict Mode safety)
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
      container.appendChild(renderer.domElement);

      // Detect active WebGL version
      const gl = renderer.getContext();
      const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
      const webglVersion = isWebGL2 ? 'WebGL 2.0' : 'WebGL 1.0';

      // 4. OrbitControls Setup
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.minDistance = 1.0;
      controls.maxDistance = 60.0;
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = Math.PI;
      controls.target.copy(defaultTargetPosRef.current);
      controls.update();
      controlsRef.current = controls;

      // 5. Lighting Setup
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
      scene.add(ambientLight);

      const mainLight = new THREE.DirectionalLight(0xffffff, 1.3);
      mainLight.position.set(10, 14, 10);
      scene.add(mainLight);

      const fillLight = new THREE.DirectionalLight(0x7890a8, 0.5);
      fillLight.position.set(-10, 6, -8);
      scene.add(fillLight);

      lightsRef.current = { ambient: ambientLight, main: mainLight, fill: fillLight };

      // 6. Ground Grid & Coordinate Helpers
      const gridHelper = new THREE.GridHelper(20, 20, 0x4e6320, 0x1e2329);
      gridHelper.position.y = 0;
      scene.add(gridHelper);
      gridHelperRef.current = gridHelper;

      const axesHelper = new THREE.AxesHelper(1.8);
      axesHelper.position.set(0, 0.01, 0);
      scene.add(axesHelper);
      axesHelperRef.current = axesHelper;

      // 7. Demo Pavilion Model Group
      const demoPavilionGroup = new THREE.Group();
      scene.add(demoPavilionGroup);
      demoPavilionGroupRef.current = demoPavilionGroup;

      const demoSolidGroup = new THREE.Group();
      const demoWireGroup = new THREE.Group();
      const demoPointsGroup = new THREE.Group();
      demoPavilionGroup.add(demoSolidGroup);
      demoPavilionGroup.add(demoWireGroup);
      demoPavilionGroup.add(demoPointsGroup);

      // 8. Loaded Model Root Group (for local PLY files)
      const loadedModelGroup = new THREE.Group();
      loadedModelGroup.visible = false;
      scene.add(loadedModelGroup);
      loadedModelGroupRef.current = loadedModelGroup;

      const loadedSolidGroup = new THREE.Group();
      const loadedWireGroup = new THREE.Group();
      const loadedPointsGroup = new THREE.Group();
      loadedModelGroup.add(loadedSolidGroup);
      loadedModelGroup.add(loadedWireGroup);
      loadedModelGroup.add(loadedPointsGroup);
      loadedSubGroupsRef.current = { solid: loadedSolidGroup, wireframe: loadedWireGroup, points: loadedPointsGroup };

      // 9. Construct Demo Pavilion Primitives
      const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x1e2329, roughness: 0.65, metalness: 0.2 });
      const columnMaterial = new THREE.MeshStandardMaterial({ color: 0x2a313a, roughness: 0.55, metalness: 0.25 });
      const accentMaterial = new THREE.MeshStandardMaterial({ color: 0xD5FF65, roughness: 0.35, metalness: 0.3, emissive: 0x1e2d00, emissiveIntensity: 0.4 });
      const wireframeMaterial = new THREE.MeshBasicMaterial({ color: 0xD5FF65, wireframe: true });
      const pointsMaterial = new THREE.PointsMaterial({ color: 0xD5FF65, size: 3.5, sizeAttenuation: false });
      const edgeLineMaterial = new THREE.LineBasicMaterial({ color: 0x3d4752, transparent: true, opacity: 0.7 });
      const accentLineMaterial = new THREE.LineBasicMaterial({ color: 0xD5FF65, transparent: true, opacity: 0.9 });

      const demoPointsVertices = [];

      const addDemoPart = (geometry, material, pos, rot, isAccent = false) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(pos);
        if (rot) mesh.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
        demoSolidGroup.add(mesh);

        const edgesGeom = new THREE.EdgesGeometry(geometry, 25);
        const edgeLines = new THREE.LineSegments(edgesGeom, isAccent ? accentLineMaterial : edgeLineMaterial);
        edgeLines.position.copy(pos);
        if (rot) edgeLines.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
        demoSolidGroup.add(edgeLines);

        const wireMesh = new THREE.Mesh(geometry, wireframeMaterial);
        wireMesh.position.copy(pos);
        if (rot) wireMesh.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
        demoWireGroup.add(wireMesh);

        const posAttr = geometry.attributes.position;
        const matrix = new THREE.Matrix4();
        if (rot) matrix.makeRotationFromEuler(new THREE.Euler(rot.x || 0, rot.y || 0, rot.z || 0));
        matrix.setPosition(pos);

        for (let i = 0; i < posAttr.count; i++) {
          const v = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
          v.applyMatrix4(matrix);
          demoPointsVertices.push(v.x, v.y, v.z);
        }
      };

      addDemoPart(new THREE.BoxGeometry(3.8, 0.22, 3.8), baseMaterial, new THREE.Vector3(0, 0.11, 0));
      addDemoPart(new THREE.BoxGeometry(3.2, 0.16, 3.2), baseMaterial, new THREE.Vector3(0, 0.3, 0));
      addDemoPart(new THREE.BoxGeometry(1.9, 1.4, 1.9), baseMaterial, new THREE.Vector3(0, 1.08, 0));
      [-1.25, 1.25].forEach((x) => {
        [-1.25, 1.25].forEach((z) => {
          addDemoPart(new THREE.CylinderGeometry(0.1, 0.13, 1.4, 12), columnMaterial, new THREE.Vector3(x, 1.08, z));
        });
      });
      addDemoPart(new THREE.BoxGeometry(3.0, 0.22, 3.0), baseMaterial, new THREE.Vector3(0, 1.89, 0));
      addDemoPart(new THREE.ConeGeometry(2.3, 1.1, 4), baseMaterial, new THREE.Vector3(0, 2.55, 0), { y: Math.PI / 4 }, true);
      addDemoPart(new THREE.CylinderGeometry(0.02, 0.06, 0.45, 8), accentMaterial, new THREE.Vector3(0, 3.25, 0), null, true);
      addDemoPart(new THREE.SphereGeometry(0.09, 12, 10), accentMaterial, new THREE.Vector3(0, 3.52, 0), null, true);

      const demoPointsGeom = new THREE.BufferGeometry();
      demoPointsGeom.setAttribute('position', new THREE.Float32BufferAttribute(demoPointsVertices, 3));
      demoPointsGroup.add(new THREE.Points(demoPointsGeom, pointsMaterial));

      // 10. Resize Observer
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

      // 11. Measured Runtime Telemetry & Render Loop
      let frameCount = 0;
      let lastTime = performance.now();

      const animate = () => {
        if (isDisposed) return;
        animationFrameId = requestAnimationFrame(animate);

        controls.update();
        renderer.render(scene, camera);

        const now = performance.now();
        frameCount++;
        if (now - lastTime >= 500) {
          const calculatedFps = Math.round((frameCount * 1000) / (now - lastTime));

          // Compute active vertex count accurately
          let activeVertexCount = 0;
          if (loadedModelGroup.visible && loadedModelGroup.children.length > 0) {
            const firstMesh = loadedSolidGroup.children[0] || loadedPointsGroup.children[0];
            if (firstMesh && firstMesh.geometry && firstMesh.geometry.attributes.position) {
              activeVertexCount = firstMesh.geometry.attributes.position.count;
            }
          } else {
            activeVertexCount = demoPointsVertices.length / 3;
          }

          setLiveMetrics({
            fps: calculatedFps,
            vertices: activeVertexCount,
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

    // Strict Cleanup
    return () => {
      isDisposed = true;
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      if (resizeObserver) resizeObserver.disconnect();
      if (controlsRef.current) controlsRef.current.dispose();

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
  // Reactive Display Modes (Shaded, Wireframe, Points)
  // --------------------------------------------------------------------------
  useEffect(() => {
    // 1. Update Demo Pavilion Visibility
    if (demoPavilionGroupRef.current) {
      const [solid, wire, points] = demoPavilionGroupRef.current.children;
      if (solid && wire && points) {
        solid.visible = renderMode === 'shaded';
        wire.visible = renderMode === 'wireframe';
        points.visible = renderMode === 'points';
      }
    }

    // 2. Update Loaded PLY Model Visibility
    const loadedSubs = loadedSubGroupsRef.current;
    if (loadedSubs.solid && loadedSubs.wireframe && loadedSubs.points) {
      if (loadedModel?.isMesh) {
        loadedSubs.solid.visible = renderMode === 'shaded';
        loadedSubs.wireframe.visible = renderMode === 'wireframe';
        loadedSubs.points.visible = renderMode === 'points';
      } else {
        // Point cloud has no triangle meshes; keep points visible
        loadedSubs.solid.visible = false;
        loadedSubs.wireframe.visible = false;
        loadedSubs.points.visible = true;
      }
    }
  }, [renderMode, loadedModel?.isMesh]);

  // Lighting Mode Handler (Studio vs Flat)
  useEffect(() => {
    const lights = lightsRef.current;
    if (!lights.ambient || !lights.main) return;

    if (lightingMode === 'studio') {
      lights.ambient.intensity = 0.75;
      lights.main.intensity = 1.3;
      if (lights.fill) lights.fill.intensity = 0.5;
    } else {
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

  // --------------------------------------------------------------------------
  // Local PLY File Loading, Validation, and Scene Integration
  // --------------------------------------------------------------------------
  const triggerFilePicker = async () => {
    if (isElectron) {
      try {
        const result = await selectNativePlyFile();
        if (result.canceled) return;
        if (result.error) {
          setPlyError(`Native file picker error: ${result.error}`);
          return;
        }
        if (result.path) {
          if (result.buffer) {
            setPlyError(null);
            setPlyLoadingName(result.name || result.path);
            setIsLoadingPly(true);
            const requestId = ++loadRequestIdRef.current;
            processPlyBuffer(result.buffer, result.name, result.sizeBytes, requestId);
            activeLoadedFileRef.current = result.path;
            if (onAttachNativePly) {
              onAttachNativePly({
                path: result.path,
                name: result.name || 'model.ply',
                sizeBytes: result.sizeBytes || 0,
              });
            }
          } else {
            loadPlyFromNativePath(result.path, result.name, result.sizeBytes, false);
          }
        }
      } catch (err) {
        console.error('Aeromorph Desktop: Native PLY picker error:', err);
        setPlyError(`Native dialog error: ${err.message}`);
      }
    } else {
      if (fileInputRef.current) {
        fileInputRef.current.value = ''; // Reset input to allow re-selecting same file if needed
        fileInputRef.current.click();
      }
    }
  };

  const loadPlyFromNativePath = async (filePath, fileName, fileSize, isAutoLoad = false) => {
    if (!filePath) return;

    setPlyError(null);
    setPlyLoadingName(fileName || filePath);
    setIsLoadingPly(true);

    const requestId = ++loadRequestIdRef.current;

    try {
      const res = await loadNativePlyBuffer(filePath);
      if (requestId !== loadRequestIdRef.current) return;

      if (!res.success || !res.buffer) {
        setIsLoadingPly(false);
        setPlyError(res.error || `Could not read PLY file from "${filePath}".`);
        return;
      }

      processPlyBuffer(res.buffer, fileName || res.name || 'model.ply', fileSize || res.sizeBytes || 0, requestId);
      activeLoadedFileRef.current = filePath;

      if (!isAutoLoad && onAttachNativePly) {
        onAttachNativePly({
          path: filePath,
          name: fileName || res.name || 'model.ply',
          sizeBytes: fileSize || res.sizeBytes || 0,
        });
      }
    } catch (err) {
      if (requestId !== loadRequestIdRef.current) return;
      setIsLoadingPly(false);
      setPlyError(`Failed to load native PLY from "${filePath}": ${err.message}`);
    }
  };

  const loadPlyFromFile = (file, isAutoLoad = false) => {
    if (!file) return;

    // Reset error & start indeterminate loader
    setPlyError(null);
    setPlyLoadingName(file.name);
    setIsLoadingPly(true);

    const requestId = ++loadRequestIdRef.current;

    const reader = new FileReader();

    reader.onerror = () => {
      if (requestId !== loadRequestIdRef.current) return;
      setIsLoadingPly(false);
      setPlyError(`Failed to read file "${file.name}": ${reader.error?.message || 'Access error'}`);
    };

    reader.onload = (event) => {
      if (requestId !== loadRequestIdRef.current) return;

      try {
        const buffer = event.target?.result;
        if (!buffer || buffer.byteLength === 0) {
          setIsLoadingPly(false);
          setPlyError(`The selected file "${file.name}" is completely empty.`);
          return;
        }

        processPlyBuffer(buffer, file.name, file.size, requestId);
        activeLoadedFileRef.current = file;

        if (!isAutoLoad && onAttachModelFile) {
          onAttachModelFile(file);
        }
      } catch (err) {
        if (requestId !== loadRequestIdRef.current) return;
        setIsLoadingPly(false);
        setPlyError(`Failed to load "${file.name}": ${err.message || 'Unknown error'}`);
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadPlyFromFile(file, false);
  };

  // Synchronize 3D model with active project, session model file, or desktop path
  useEffect(() => {
    const isProjectSwitched = currentProjectIdRef.current !== currentProject?.id;
    currentProjectIdRef.current = currentProject?.id;

    if (sessionModelFile) {
      if (activeLoadedFileRef.current !== sessionModelFile || isProjectSwitched) {
        activeLoadedFileRef.current = sessionModelFile;
        loadPlyFromFile(sessionModelFile, true);
      }
    } else if (isElectron && currentProject?.modelFileReference?.path) {
      const nativePath = currentProject.modelFileReference.path;
      if (activeLoadedFileRef.current !== nativePath || isProjectSwitched) {
        activeLoadedFileRef.current = nativePath;
        loadPlyFromNativePath(
          nativePath,
          currentProject.modelFileReference.name,
          currentProject.modelFileReference.sizeBytes,
          true
        );
      }
    } else {
      // If current project has no session model file or native path, or project switched, ensure demo pavilion is shown
      if (activeLoadedFileRef.current !== null || isProjectSwitched || (demoPavilionGroupRef.current && !demoPavilionGroupRef.current.visible)) {
        activeLoadedFileRef.current = null;
        handleRevertToDemo();
      }
    }
  }, [currentProject?.id, sessionModelFile, currentProject?.modelFileReference?.path]);

  const processPlyBuffer = (buffer, fileName, fileSize, requestId) => {
    // 1. Inspect PLY header text to determine if genuine face elements exist
    let hasFaceElement = false;
    let declaredFaceCount = 0;
    try {
      const headerChunk = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 8192));
      let headerStr = '';
      for (let i = 0; i < headerChunk.length; i++) {
        headerStr += String.fromCharCode(headerChunk[i]);
      }
      const endHeaderPos = headerStr.indexOf('end_header');
      if (endHeaderPos !== -1) {
        const headerSub = headerStr.slice(0, endHeaderPos);
        const faceMatch = headerSub.match(/element\s+face\s+(\d+)/);
        if (faceMatch) {
          declaredFaceCount = parseInt(faceMatch[1], 10);
          hasFaceElement = declaredFaceCount > 0;
        }
      }
    } catch {}

    const loader = new PLYLoader();
    let geometry;

    try {
      geometry = loader.parse(buffer);
    } catch (parseErr) {
      if (requestId !== loadRequestIdRef.current) return;
      setIsLoadingPly(false);
      setPlyError(`PLY parser error on "${fileName}": ${parseErr.message || 'Invalid PLY header or format'}`);
      return;
    }

    if (requestId !== loadRequestIdRef.current) return;

    if (!geometry) {
      setIsLoadingPly(false);
      setPlyError(`Parser did not produce a valid geometry for "${fileName}".`);
      return;
    }

    // Validation 1: Non-empty position attribute
    const positionAttr = geometry.attributes.position;
    if (!positionAttr || positionAttr.count === 0) {
      setIsLoadingPly(false);
      setPlyError(`Invalid PLY model: "${fileName}" contains no 3D vertices.`);
      return;
    }

    // Validation 2: Check for finite coordinates
    const posArray = positionAttr.array;
    let allFinite = true;
    for (let i = 0; i < posArray.length; i++) {
      if (!Number.isFinite(posArray[i])) {
        allFinite = false;
        break;
      }
    }
    if (!allFinite) {
      setIsLoadingPly(false);
      setPlyError(`Corrupt PLY: "${fileName}" contains NaN or Infinite coordinates.`);
      return;
    }

    // Validation 3: Genuine Mesh vs Sparse Point Cloud distinction
    // NEVER invent fake faces for non-indexed point clouds!
    const isIndexed = Boolean(geometry.index && geometry.index.count >= 3);
    const isMesh = Boolean(hasFaceElement && isIndexed && declaredFaceCount > 0);
    const vertexCount = positionAttr.count;
    const faceCount = isMesh ? Math.floor(geometry.index.count / 3) : 0;

    // Validation 4: Detect valid vertex colors (not all black / zeros)
    let hasVertexColors = false;
    if (geometry.attributes.color && geometry.attributes.color.count > 0) {
      const colorArray = geometry.attributes.color.array;
      const sampleLimit = Math.min(colorArray.length, 600);
      let nonZeroCount = 0;
      for (let i = 0; i < sampleLimit; i++) {
        if (colorArray[i] > 0.05) {
          nonZeroCount++;
        }
      }
      hasVertexColors = nonZeroCount > 0;
    }

    // Validation 5: Compute vertex normals only for real meshes
    if (isMesh && !geometry.attributes.normal && faceCount > 0) {
      try {
        geometry.computeVertexNormals();
      } catch (normErr) {
        console.warn('Could not compute normals for PLY geometry:', normErr);
      }
    }

    // Center geometry around origin and compute bounds
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.center();

    // ------------------------------------------------------------------------
    // Scene Integration: Replace Demo Model with Loaded PLY
    // ------------------------------------------------------------------------
    const loadedSubs = loadedSubGroupsRef.current;
    if (!loadedSubs.solid || !loadedSubs.wireframe || !loadedSubs.points) return;

    // Dispose previous loaded model geometries and materials
    disposeGroup(loadedSubs.solid);
    disposeGroup(loadedSubs.wireframe);
    disposeGroup(loadedSubs.points);

    if (isMesh) {
      // Solid Shaded Mesh
      const solidMaterial = new THREE.MeshStandardMaterial({
        color: hasVertexColors ? 0xffffff : 0x8a9ba8,
        vertexColors: hasVertexColors,
        roughness: 0.65,
        metalness: 0.15,
        side: THREE.DoubleSide,
      });
      const solidMesh = new THREE.Mesh(geometry, solidMaterial);
      loadedSubs.solid.add(solidMesh);

      // Wireframe Mesh
      const wireMaterial = new THREE.MeshBasicMaterial({
        color: 0xD5FF65,
        wireframe: true,
        side: THREE.DoubleSide,
      });
      const wireMesh = new THREE.Mesh(geometry, wireMaterial);
      loadedSubs.wireframe.add(wireMesh);

      // Point representation of mesh
      const pointMaterial = new THREE.PointsMaterial({
        size: 3.5,
        vertexColors: hasVertexColors,
        color: hasVertexColors ? 0xffffff : 0xD5FF65,
        sizeAttenuation: false,
      });
      const pointsMesh = new THREE.Points(geometry, pointMaterial);
      loadedSubs.points.add(pointsMesh);

      loadedSubs.solid.visible = renderMode === 'shaded';
      loadedSubs.wireframe.visible = renderMode === 'wireframe';
      loadedSubs.points.visible = renderMode === 'points';
    } else {
      // Vertex-only Sparse Point Cloud:
      // Render vertices using Three.js Points / BufferGeometry path.
      // Do NOT create THREE.Mesh or fabricate triangle faces!
      const pointMaterial = new THREE.PointsMaterial({
        size: 3.5,
        vertexColors: hasVertexColors,
        color: hasVertexColors ? 0xffffff : 0xD5FF65,
        sizeAttenuation: false,
      });
      const pointsMesh = new THREE.Points(geometry, pointMaterial);
      loadedSubs.points.add(pointsMesh);

      // Solid and wireframe meshes are not created for point clouds
      loadedSubs.solid.visible = false;
      loadedSubs.wireframe.visible = false;
      loadedSubs.points.visible = true;

      // Automatically switch render mode to points
      if (renderMode !== 'points') {
        setRenderMode('points');
      }
    }

    // Show loaded group and hide demo pavilion
    if (demoPavilionGroupRef.current) demoPavilionGroupRef.current.visible = false;
    if (loadedModelGroupRef.current) loadedModelGroupRef.current.visible = true;

    // ------------------------------------------------------------------------
    // Camera Fitting: Frame Model in Viewport
    // ------------------------------------------------------------------------
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (camera && controls && geometry.boundingSphere) {
      const radius = Math.max(geometry.boundingSphere.radius, 0.5);
      const fovRad = (camera.fov * Math.PI) / 180;
      let fitDistance = (radius / Math.sin(fovRad / 2)) * 1.35;
      fitDistance = Math.max(fitDistance, 2.5);

      const targetPos = new THREE.Vector3(0, 0, 0);
      const camPos = new THREE.Vector3(fitDistance * 0.72, fitDistance * 0.55, fitDistance * 0.82);

      camera.position.copy(camPos);
      controls.target.copy(targetPos);
      controls.minDistance = Math.max(fitDistance * 0.05, 0.5);
      controls.maxDistance = fitDistance * 8.0;
      controls.update();

      // Store fitted positions as default for reset button
      defaultCameraPosRef.current.copy(camPos);
      defaultTargetPosRef.current.copy(targetPos);

      // Adjust ground grid to sit directly beneath model's lowest boundary
      if (gridHelperRef.current && geometry.boundingBox) {
        gridHelperRef.current.position.y = geometry.boundingBox.min.y;
      }
      if (axesHelperRef.current && geometry.boundingBox) {
        axesHelperRef.current.position.set(0, geometry.boundingBox.min.y + 0.01, 0);
      }
    }

    // Set state
    setLoadedModel({
      name: fileName,
      size: fileSize,
      vertexCount,
      faceCount,
      isMesh,
      isPointCloud: !isMesh,
      hasVertexColors,
      isIndexed,
    });

    setIsLoadingPly(false);
    setViewportState('loaded');
  };

  // Revert to default Demo Pavilion
  const handleRevertToDemo = () => {
    if (loadedSubGroupsRef.current.solid) {
      disposeGroup(loadedSubGroupsRef.current.solid);
      disposeGroup(loadedSubGroupsRef.current.wireframe);
      disposeGroup(loadedSubGroupsRef.current.points);
    }
    if (loadedModelGroupRef.current) loadedModelGroupRef.current.visible = false;
    if (demoPavilionGroupRef.current) demoPavilionGroupRef.current.visible = true;

    // Reset camera & grid
    const defaultPos = new THREE.Vector3(6.5, 4.8, 7.2);
    const defaultTarget = new THREE.Vector3(0, 1.1, 0);
    defaultCameraPosRef.current.copy(defaultPos);
    defaultTargetPosRef.current.copy(defaultTarget);

    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.copy(defaultPos);
      controlsRef.current.target.copy(defaultTarget);
      controlsRef.current.minDistance = 1.0;
      controlsRef.current.maxDistance = 60.0;
      controlsRef.current.update();
    }

    if (gridHelperRef.current) gridHelperRef.current.position.y = 0;
    if (axesHelperRef.current) axesHelperRef.current.position.set(0, 0.01, 0);

    activeLoadedFileRef.current = null;
    setLoadedModel(null);
    setPlyError(null);
  };

  // --------------------------------------------------------------------------
  // Camera & Toolbar Action Handlers
  // --------------------------------------------------------------------------
  const handleResetCamera = () => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.copy(defaultCameraPosRef.current);
      controlsRef.current.target.copy(defaultTargetPosRef.current);
      controlsRef.current.update();
    }
  };

  const handleZoomStep = () => {
    if (cameraRef.current && controlsRef.current) {
      const dir = new THREE.Vector3().subVectors(controlsRef.current.target, cameraRef.current.position);
      cameraRef.current.position.addScaledVector(dir, 0.2);
      controlsRef.current.update();
    }
  };

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
      {/* Hidden Native File Input for PLY Loading */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".ply"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Interactive UI State & File Loader Control Bar */}
      <div className="viewport-state-bar" role="toolbar" aria-label="Review UI States and PLY Loading">
        <span className="state-switcher-label">View:</span>
        <button
          type="button"
          className={`state-pill-btn ${effectiveState === 'loaded' ? 'active' : ''}`}
          onClick={() => setManualViewOverride('loaded')}
          title="Display loaded 3D geometry"
        >
          Model Loaded
        </button>
        <button
          type="button"
          className={`state-pill-btn ${effectiveState === 'loading' ? 'active' : ''}`}
          onClick={() => setManualViewOverride('loading')}
          title={jobStatus === 'running' ? `Active: ${activeStageLabel || 'Reconstructing'}` : 'Inspect processing progress view'}
        >
          {jobStatus === 'running' ? 'Processing (Live)' : 'Processing'}
        </button>
        <button
          type="button"
          className={`state-pill-btn ${effectiveState === 'empty' ? 'active' : ''}`}
          onClick={() => setManualViewOverride('empty')}
          title="Inspect empty viewport state"
        >
          Empty Viewport
        </button>
        <button
          type="button"
          className={`state-pill-btn ${effectiveState === 'error' ? 'active' : ''}`}
          onClick={() => setManualViewOverride('error')}
          title={errorMessage ? `Active Error: ${errorMessage}` : 'Inspect pipeline error state'}
        >
          {errorMessage ? 'Error State (Active)' : 'Error State'}
        </button>

        {manualViewOverride !== null && (
          <button
            type="button"
            className="state-pill-btn"
            style={{ fontSize: '10px', color: 'var(--accent)', borderColor: 'rgba(213, 255, 101, 0.3)' }}
            onClick={() => setManualViewOverride(null)}
            title="Reset to automatic mode synced with real pipeline status"
          >
            Auto Sync
          </button>
        )}

        <div className="toolbar-separator" style={{ height: '14px', margin: '0 2px' }} />

        {/* Load Local PLY Button */}
        <button
          type="button"
          className="state-pill-btn accent-btn"
          onClick={triggerFilePicker}
          title="Select a local .PLY 3D model file from your computer"
        >
          <FolderOpen size={12} />
          <span>{loadedModel ? 'Change PLY...' : 'Load Local PLY...'}</span>
        </button>

        {/* Notice if metadata model reference exists but File handle is expired upon refresh */}
        {currentProject?.modelFileReference && !loadedModel && !sessionModelFile && (
          <span
            className="state-pill-btn"
            style={{ color: 'var(--color-warning)', borderColor: 'var(--color-warning-dim)', fontSize: '10.5px' }}
            title="Model reference is recorded in project history, but browser security resets memory file handles across page reloads. Click 'Load Local PLY...' to re-select."
          >
            Ref: {currentProject.modelFileReference.name} (Reload required)
          </span>
        )}

        {/* Revert to Demo Pavilion if model loaded */}
        {loadedModel && (
          <button
            type="button"
            className="state-pill-btn"
            onClick={handleRevertToDemo}
            title="Revert back to the lightweight demo pavilion"
          >
            <span>Revert to Demo</span>
          </button>
        )}
      </div>

      {/* Floating Telemetry HUD (Top-Right) — Realtime Measured Three.js Metrics */}
      {effectiveState === 'loaded' && !webglError && (
        <div className="viewport-hud-top-right">
          <div className="hud-badge-row">
            <span className="hud-label-dim" title={currentProject ? currentProject.name : ''}>
              {currentProject ? currentProject.name.toUpperCase() : (loadedModel ? 'LOCAL PLY MODEL' : 'THREE.JS VIEWPORT')}
            </span>
            <span className="hud-demo-pill">
              {loadedModel
                ? (loadedModel.isMesh ? (currentProject ? 'Project Mesh' : 'Custom Mesh') : 'Sparse Point Cloud')
                : 'Demo Pavilion (Sample)'}
            </span>
          </div>

          {!loadedModel && (
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px', letterSpacing: '0.02em' }}>
              Sample preview (no reconstruction loaded)
            </div>
          )}

          {loadedModel && (
            <div className="hud-stat-row" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '3px' }}>
              <span>File</span>
              <span className="hud-stat-value" title={loadedModel.name} style={{ maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {loadedModel.name}
              </span>
            </div>
          )}

          <div className="hud-stat-row">
            <span>Live FPS</span>
            <span className="hud-stat-value accent">{liveMetrics.fps}</span>
          </div>

          <div className="hud-stat-row">
            <span>{loadedModel ? (loadedModel.isMesh ? 'Vertices' : '3D Points') : 'Vertices'}</span>
            <span className="hud-stat-value">
              {loadedModel ? loadedModel.vertexCount.toLocaleString() : liveMetrics.vertices.toLocaleString()}
            </span>
          </div>

          <div className="hud-stat-row">
            <span>Faces</span>
            <span className="hud-stat-value">
              {loadedModel
                ? (loadedModel.isMesh ? loadedModel.faceCount.toLocaleString() : 'None (Point Cloud)')
                : liveMetrics.triangles.toLocaleString()}
            </span>
          </div>

          {loadedModel && (
            <div className="hud-stat-row">
              <span>Vertex Colors</span>
              <span className="hud-stat-value" style={{ color: loadedModel.hasVertexColors ? 'var(--accent)' : 'var(--text-muted)' }}>
                {loadedModel.hasVertexColors ? 'Detected' : 'None (Fallback)'}
              </span>
            </div>
          )}

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
            display: effectiveState === 'loaded' && !webglError ? 'block' : 'none',
          }}
        />

        {/* Indeterminate Loading Indicator while parsing PLY */}
        {isLoadingPly && (
          <div className="viewport-state-overlay" style={{ zIndex: 45 }}>
            <Loader2 size={32} color="var(--accent)" className="animate-spin" style={{ animation: 'spin 1.8s linear infinite' }} />
            <div>
              <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                Parsing Local PLY Model
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Reading &ldquo;{plyLoadingName}&rdquo; into BufferGeometry...
              </p>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Validating position buffers and computing vertex normals
            </span>
          </div>
        )}

        {/* Local PLY Loading Error Alert Overlay */}
        {plyError && (
          <div className="viewport-state-overlay" style={{ zIndex: 46, borderColor: 'var(--color-error-dim)' }}>
            <div className="empty-icon-bubble" style={{ background: 'var(--color-error-dim)', color: 'var(--color-error)' }}>
              <AlertTriangle size={24} strokeWidth={1.8} />
            </div>
            <div>
              <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--color-error)', letterSpacing: '-0.01em' }}>
                PLY Loading Error
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', maxWidth: '340px' }}>
                {plyError}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button type="button" className="btn-primary" onClick={triggerFilePicker}>
                <FolderOpen size={13} />
                <span>Select Another PLY File</span>
              </button>
              <button type="button" className="btn-secondary" onClick={() => setPlyError(null)}>
                <span>Dismiss</span>
              </button>
            </div>
          </div>
        )}

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

        {/* View State: Realtime Reconstruction Progress */}
        {effectiveState === 'loading' && (
          <div className="viewport-state-overlay" style={{ minWidth: '380px' }}>
            <Loader2 size={32} color="var(--accent)" className="animate-spin" style={{ animation: 'spin 1.6s linear infinite' }} />
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                {jobStatus === 'running'
                  ? (activeStageLabel || 'Reconstruction in Progress')
                  : 'Pipeline Processing View'}
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                {jobStatus === 'running'
                  ? `Active Stage: ${activeStageKey || 'executing'} • Step ${stageIndex} of ${totalStages}`
                  : 'No reconstruction job is actively running right now.'}
              </p>
            </div>

            {jobStatus === 'running' && (
              <>
                <div className="state-progress-bar-container">
                  <div
                    className="state-progress-bar-fill"
                    style={{
                      width: `${Math.min(95, Math.max(10, Math.round(((stageIndex - 1 + 0.3) / totalStages) * 100)))}%`,
                    }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '11px', color: 'var(--text-muted)' }}>
                  <span>Elapsed: {formatElapsed(elapsedSeconds)}</span>
                  <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
                    {`${Math.min(95, Math.max(10, Math.round(((stageIndex - 1 + 0.3) / totalStages) * 100)))}%`}
                  </span>
                </div>
              </>
            )}

            <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
              {jobStatus === 'running'
                ? 'Processing locally on CPU with conservative memory bounds (8 GB RAM profile)'
                : 'Click "Start Reconstruction" in the studio sidebar to start processing photographs.'}
            </span>
          </div>
        )}

        {/* View State: Empty Viewport */}
        {effectiveState === 'empty' && (
          <div className="viewport-state-overlay">
            <div className="empty-icon-bubble">
              <Box size={24} strokeWidth={1.8} />
            </div>
            <div>
              <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                No 3D Model Loaded
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Select a local PLY mesh file or run a reconstruction pipeline to generate 3D geometry.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <button type="button" className="btn-primary" onClick={triggerFilePicker}>
                <FolderOpen size={13} />
                <span>Select Local PLY File...</span>
              </button>
            </div>
          </div>
        )}

        {/* View State: Pipeline Error */}
        {effectiveState === 'error' && (
          <div className="viewport-state-overlay" style={{ borderColor: 'var(--color-error-dim)', maxWidth: '460px' }}>
            <div className="empty-icon-bubble" style={{ background: 'var(--color-error-dim)', color: 'var(--color-error)' }}>
              <AlertTriangle size={24} strokeWidth={1.8} />
            </div>
            <div>
              <h3 style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--color-error)', letterSpacing: '-0.01em' }}>
                {errorMessage ? 'Reconstruction Halted' : 'No Pipeline Errors'}
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                {errorMessage
                  ? 'A pipeline stage encountered an error during execution:'
                  : 'The reconstruction pipeline has no active errors recorded.'}
              </p>
            </div>

            {errorMessage ? (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-xs)',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-error, #f87171)',
                  width: '100%',
                  wordBreak: 'break-word',
                  maxHeight: '110px',
                  overflowY: 'auto',
                  textAlign: 'left',
                }}
              >
                {errorMessage}
              </div>
            ) : (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                If any stage fails during execution, full diagnostic logs and exit codes will display here.
              </span>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
              {onResumePipeline && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={onResumePipeline}
                  style={{ background: 'var(--accent)', color: '#000', fontWeight: 600 }}
                  title="Resume from where the error occurred without repeating finished steps"
                >
                  <Sparkles size={12} />
                  <span>Resume from Checkpoint</span>
                </button>
              )}
              {onRetryPipeline && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onRetryPipeline}
                  title="Restart entire reconstruction from the beginning"
                >
                  <RotateCcw size={12} />
                  <span>Restart from Beginning</span>
                </button>
              )}
              {onClearError && errorMessage && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    onClearError();
                    setManualViewOverride('loaded');
                  }}
                >
                  <span>Dismiss</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Floating Viewer Toolbar (Glassmorphism) — All Functional */}
      {effectiveState === 'loaded' && !webglError && (
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
            title="Solid Shaded Mesh"
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
            title="Reset Camera to Initial Framing"
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
