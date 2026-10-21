import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  UploadCloud,
  FolderSearch,
  FolderOpen,
  Image as ImageIcon,
  CheckCircle2,
  Layers,
  Camera,
  ArrowRight,
  RotateCcw,
  ShieldAlert,
  AlertCircle,
  Box,
  HardDrive,
  Monitor,
  Wrench,
  RefreshCw,
  FileSearch,
  Check,
  AlertTriangle
} from 'lucide-react';
import {
  isElectron,
  selectNativeDirectory,
  detectEnvironment,
  selectColmapExecutable,
  selectOpenMvsExecutable,
  validateImageDirectory,
  selectWorkspaceDirectory,
} from '../services/desktopBridge';
import { getCustomToolPaths, saveCustomToolPaths } from '../services/projectService';

export default function ImportPhotographs({
  currentProject = null,
  sessionImages = [],
  nativeDirectory = null,
  projects = [],
  onUpdateProjectImages,
  onUpdateProjectNativeDirectory,
  onUpdateProjectOutputDirectory,
  onProceedToStudio,
  onNavigateHome,
  onSelectProject,
}) {
  const [dragActive, setDragActive] = useState(false);
  const [showSamplePreview, setShowSamplePreview] = useState(false);
  const [previewUrls, setPreviewUrls] = useState([]);

  // Sprint 6A: Environment detection and folder validation state
  const [envState, setEnvState] = useState({
    loading: true,
    colmap: { detected: false, path: null, version: null, status: 'Checking...', error: null },
    openmvs: { detected: false, path: null, version: null, status: 'Checking...', error: null },
    environmentReady: false,
  });
  const [isDetecting, setIsDetecting] = useState(false);
  const [folderValidation, setFolderValidation] = useState(null);

  const folderInputRef = useRef(null);
  const filesInputRef = useRef(null);

  // Generate thumbnail object URLs for genuine session image files (first 24 max to save memory)
  useEffect(() => {
    if (!sessionImages || sessionImages.length === 0) {
      setPreviewUrls([]);
      return;
    }

    const maxPreviews = Math.min(sessionImages.length, 24);
    const urls = [];

    for (let i = 0; i < maxPreviews; i++) {
      const file = sessionImages[i];
      if (file && file.type?.startsWith('image/')) {
        try {
          urls.push({
            id: `${file.name}-${i}`,
            name: file.name,
            size: file.size,
            type: file.type,
            url: URL.createObjectURL(file),
          });
        } catch (err) {
          console.warn('Could not create thumbnail object URL:', err);
        }
      }
    }

    setPreviewUrls(urls);

    // Cleanup object URLs when images change or component unmounts
    return () => {
      urls.forEach((item) => {
        if (item.url) URL.revokeObjectURL(item.url);
      });
    };
  }, [sessionImages]);

  // Load and refresh environment detection (Sprint 6A)
  const loadEnvironment = useCallback(async () => {
    setIsDetecting(true);
    try {
      const savedPaths = getCustomToolPaths();
      const res = await detectEnvironment({
        customColmapPath: savedPaths.colmapPath,
        customOpenmvsPath: savedPaths.openmvsPath,
      });
      setEnvState({
        loading: false,
        colmap: res.colmap || { detected: false, status: 'Not Detected' },
        openmvs: res.openmvs || { detected: false, status: 'Not Detected' },
        environmentReady: Boolean(res.environmentReady),
      });
    } catch (err) {
      console.error('Environment check failed:', err);
      setEnvState((prev) => ({ ...prev, loading: false }));
    } finally {
      setIsDetecting(false);
    }
  }, []);

  // Run environment detection on mount
  useEffect(() => {
    loadEnvironment();
  }, [loadEnvironment]);

  // Validate active project source directory on project change or directory update
  useEffect(() => {
    const dirPath = currentProject?.sourceDirectoryReference?.path;
    const isDesktopPath = currentProject?.sourceDirectoryReference?.storageType === 'desktop-path';

    if (!isElectron || !isDesktopPath || !dirPath) {
      setFolderValidation(null);
      return;
    }

    let isMounted = true;
    validateImageDirectory(dirPath)
      .then((res) => {
        if (isMounted) {
          setFolderValidation(res);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setFolderValidation({ valid: false, accessible: false, error: err.message, fileCount: 0 });
        }
      });

    return () => {
      isMounted = false;
    };
  }, [currentProject?.id, currentProject?.sourceDirectoryReference?.path, currentProject?.sourceDirectoryReference?.storageType]);

  // Handle selecting custom colmap.exe
  const handleSelectColmapPath = async () => {
    const result = await selectColmapExecutable();
    if (result.canceled) return;
    if (result.error) {
      alert(`COLMAP selection error: ${result.error}`);
      return;
    }
    if (result.path) {
      saveCustomToolPaths({ colmapPath: result.path });
      loadEnvironment();
    }
  };

  // Handle selecting custom OpenMVS executable
  const handleSelectOpenMvsPath = async () => {
    const result = await selectOpenMvsExecutable();
    if (result.canceled) return;
    if (result.error) {
      alert(`OpenMVS selection error: ${result.error}`);
      return;
    }
    if (result.path) {
      saveCustomToolPaths({ openmvsPath: result.path });
      loadEnvironment();
    }
  };

  // Handle native folder selection via Electron desktop bridge
  const handleNativeFolderSelect = async () => {
    if (!currentProject) {
      alert('Please create or select a local project first.');
      return;
    }

    const result = await selectNativeDirectory();
    if (result.canceled) return;

    if (result.error && !result.valid) {
      alert(`Directory selection error: ${result.error}`);
      return;
    }

    if (result.path && onUpdateProjectNativeDirectory) {
      onUpdateProjectNativeDirectory(currentProject.id, result);
    }
  };

  // Handle Folder Selection via WebKit Directory (Browser fallback)
  const handleFolderChange = (e) => {
    const rawFiles = Array.from(e.target.files || []);
    if (rawFiles.length === 0) return;

    processFiles(rawFiles);
  };

  // Handle individual files selection
  const handleFilesChange = (e) => {
    const rawFiles = Array.from(e.target.files || []);
    if (rawFiles.length === 0) return;

    processFiles(rawFiles);
  };

  const processFiles = (rawFiles) => {
    const imageFiles = rawFiles.filter((f) =>
      /\.(jpe?g|png|webp|bmp|tif|tiff)$/i.test(f.name)
    );

    if (imageFiles.length === 0) {
      alert('No supported image files (.jpg, .jpeg, .png, .webp) were found in the selection.');
      return;
    }

    // Determine directory name from first relative path or default
    let dirName = 'Imported Photos';
    if (rawFiles[0]?.webkitRelativePath) {
      const parts = rawFiles[0].webkitRelativePath.split('/');
      if (parts.length > 1) {
        dirName = parts[0];
      }
    }

    if (currentProject && onUpdateProjectImages) {
      onUpdateProjectImages(currentProject.id, dirName, imageFiles);
    }
  };

  // Drag and drop handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleResetImages = () => {
    if (!currentProject) return;
    if (window.confirm(`Detach all photographs from project "${currentProject.name}"?`)) {
      if (onUpdateProjectNativeDirectory) {
        onUpdateProjectNativeDirectory(currentProject.id, { path: null, name: null, fileCount: 0, totalSizeBytes: 0, imageFiles: [] });
      }
      if (onUpdateProjectImages) {
        onUpdateProjectImages(currentProject.id, null, []);
      }
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    const kb = bytes / 1024;
    return `${kb.toFixed(0)} KB`;
  };

  const isNativeDirectoryAttached = currentProject?.sourceDirectoryReference?.storageType === 'desktop-path' && !!currentProject?.sourceDirectoryReference?.path;
  const totalBytes = isNativeDirectoryAttached
    ? (currentProject?.sourceDirectoryReference?.totalSizeBytes || 0)
    : sessionImages.reduce((sum, f) => sum + (f.size || 0), 0);
  const hasAttachedImages = isNativeDirectoryAttached
    ? (currentProject?.sourceDirectoryReference?.fileCount || 0) > 0
    : sessionImages.length > 0;

  // Representative realistic drone photographs for design preview
  const sampleThumbnails = [
    { id: 1, name: 'DJI_0041.JPG', res: '4000x3000', focal: '24mm eq.', iso: '100', size: '6.4 MB' },
    { id: 2, name: 'DJI_0042.JPG', res: '4000x3000', focal: '24mm eq.', iso: '100', size: '6.5 MB' },
    { id: 3, name: 'DJI_0043.JPG', res: '4000x3000', focal: '24mm eq.', iso: '100', size: '6.3 MB' },
    { id: 4, name: 'DJI_0044.JPG', res: '4000x3000', focal: '24mm eq.', iso: '100', size: '6.8 MB' },
    { id: 5, name: 'DJI_0045.JPG', res: '4000x3000', focal: '24mm eq.', iso: '120', size: '6.6 MB' },
    { id: 6, name: 'DJI_0046.JPG', res: '4000x3000', focal: '24mm eq.', iso: '100', size: '6.7 MB' },
  ];

  return (
    <div className="import-screen-container">
      {/* Hidden File Inputs */}
      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory="true"
        directory="true"
        multiple
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFolderChange}
      />
      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFilesChange}
      />

      {/* Project Association Header & Controls */}
      <div className="import-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.015em' }}>
              Import Photographs
            </h2>
            {currentProject ? (
              <span className="live-indicator-tag">
                Project: {currentProject.name}
              </span>
            ) : (
              <span className="sample-indicator-tag" style={{ color: 'var(--color-warning)', borderColor: 'var(--color-warning-dim)' }}>
                No Active Project
              </span>
            )}
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px' }}>
            Aerial drone or ground photo sequences. High visual overlap (60–80%) ensures robust feature triangulation.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {hasAttachedImages && (
            <button
              type="button"
              className="btn-secondary"
              onClick={handleResetImages}
              title="Reset selection and detach photos from project"
            >
              <RotateCcw size={12} />
              <span>Reset</span>
            </button>
          )}

          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowSamplePreview(!showSamplePreview)}
            title="Toggle reference layout preview from earlier design sprints"
          >
            <span>{showSamplePreview ? 'Hide Sample Reference' : 'Sample Layout'}</span>
          </button>

          <button
            type="button"
            className="btn-primary"
            onClick={onProceedToStudio}
            title="Navigate to Reconstruction Studio"
          >
            <span>Proceed to Studio</span>
            <ArrowRight size={13} />
          </button>
        </div>
      </div>

      {/* Active Project Context Bar / Selector */}
      {currentProject ? (
        <div className="project-context-bar glass-panel" style={{ padding: '9px 14px', marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Box size={15} color="var(--accent)" />
            <div>
              <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {currentProject.name}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '8px' }}>
                ID: {currentProject.id} • Status: {currentProject.status}
              </span>
            </div>
          </div>

          {projects.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Switch:</span>
              <select
                className="form-select-compact"
                value={currentProject.id}
                onChange={(e) => onSelectProject(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      ) : (
        <div className="project-context-bar glass-panel" style={{ padding: '10px 14px', marginBottom: '14px', borderColor: 'var(--color-warning-dim)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <AlertCircle size={15} color="var(--color-warning)" />
              <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                No project selected. Create or select a local project on the Projects Home screen to bind these photographs.
              </span>
            </div>
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: '4px 10px', fontSize: '11.5px' }}
              onClick={onNavigateHome}
            >
              <span>Go to Projects Home</span>
            </button>
          </div>
        </div>
      )}

      {/* Environment-Aware Shell / Sandbox Notice */}
      {isElectron ? (
        <div className="browser-notice-box" style={{ marginBottom: '14px', borderColor: 'rgba(213, 255, 101, 0.25)' }}>
          <div className="notice-icon">
            <Monitor size={14} color="var(--accent)" />
          </div>
          <div className="notice-body">
            <strong style={{ color: 'var(--accent)' }}>Desktop Shell Active:</strong> Windows filesystem paths are securely accessed through the Electron bridge under strict context isolation. Source image folders are bound by real directory path without duplicating files into memory or localStorage.
          </div>
        </div>
      ) : (
        <div className="browser-notice-box" style={{ marginBottom: '14px' }}>
          <div className="notice-icon">
            <ShieldAlert size={14} color="var(--color-warning)" />
          </div>
          <div className="notice-body">
            <strong>Browser-Only Sandbox Notice:</strong> Web browsers cannot directly access arbitrary Windows paths (such as <code style={{ fontFamily: 'var(--font-mono)' }}>D:\images_colmap\...</code>). Selected photos are held in current session memory only. Launch the Electron desktop shell to link permanent filesystem paths.
          </div>
        </div>
      )}

      {/* Sprint 6A: Environment & Photogrammetry Toolchain Card */}
      <div className="glass-panel" style={{ padding: '14px 18px', marginBottom: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Wrench size={16} color="var(--accent)" />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
              Photogrammetry Toolchain & Environment (Sprint 6A)
            </span>
            {envState.environmentReady ? (
              <span className="live-indicator-tag" style={{ background: 'rgba(213, 255, 101, 0.1)', color: 'var(--accent)', borderColor: 'rgba(213, 255, 101, 0.3)' }}>
                Environment Ready
              </span>
            ) : (
              <span className="sample-indicator-tag" style={{ color: 'var(--color-warning)', borderColor: 'var(--color-warning-dim)' }}>
                Configuration Required
              </span>
            )}
          </div>

          <button
            type="button"
            className="btn-ghost"
            onClick={loadEnvironment}
            disabled={isDetecting}
            title="Re-run toolchain detection"
            style={{ fontSize: '11px', padding: '4px 8px', gap: '5px' }}
          >
            <RefreshCw size={12} className={isDetecting ? 'animate-spin' : ''} />
            <span>{isDetecting ? 'Detecting...' : 'Recheck Tools'}</span>
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px' }}>
          {/* COLMAP Status */}
          <div style={{ background: 'var(--bg-secondary)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <span className={`status-dot ${envState.colmap.detected ? 'online' : 'idle'}`} />
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  COLMAP (Structure from Motion)
                </span>
              </div>
              <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: envState.colmap.detected ? 'var(--accent)' : 'var(--text-muted)' }}>
                {envState.colmap.version ? `v${envState.colmap.version}` : (envState.colmap.detected ? 'Detected' : 'Missing')}
              </span>
            </div>

            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={envState.colmap.path || envState.colmap.error}>
              {envState.colmap.path ? (
                <code style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px' }}>{envState.colmap.path}</code>
              ) : (
                <span style={{ color: 'var(--color-warning)' }}>{envState.colmap.error || 'colmap.exe not found'}</span>
              )}
            </div>

            {envState.colmap.warning && (
              <div style={{ fontSize: '10.5px', color: 'var(--color-warning)', marginBottom: '8px', background: 'rgba(234, 179, 8, 0.1)', padding: '4px 8px', borderRadius: '4px' }}>
                ⚠ {envState.colmap.warning}
              </div>
            )}

            {isElectron && (
              <button
                type="button"
                className="btn-secondary"
                onClick={handleSelectColmapPath}
                style={{ width: '100%', fontSize: '11px', padding: '4px 8px', justifyContent: 'center' }}
              >
                <FileSearch size={12} />
                <span>{envState.colmap.detected ? 'Change colmap.exe Path...' : 'Locate colmap.exe...'}</span>
              </button>
            )}
          </div>

          {/* OpenMVS Status */}
          <div style={{ background: 'var(--bg-secondary)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <span className={`status-dot ${envState.openmvs.detected ? 'online' : 'idle'}`} />
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  OpenMVS (MVS & Meshing)
                </span>
              </div>
              <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: envState.openmvs.detected ? 'var(--accent)' : 'var(--text-muted)' }}>
                {envState.openmvs.version ? `v${envState.openmvs.version}` : (envState.openmvs.detected ? 'Detected' : 'Missing')}
              </span>
            </div>

            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={envState.openmvs.path || envState.openmvs.error}>
              {envState.openmvs.path ? (
                <code style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px' }}>{envState.openmvs.path}</code>
              ) : (
                <span style={{ color: 'var(--color-warning)' }}>{envState.openmvs.error || 'InterfaceCOLMAP.exe not found'}</span>
              )}
            </div>

            {envState.openmvs.warning && (
              <div style={{ fontSize: '10.5px', color: 'var(--color-warning)', marginBottom: '8px', background: 'rgba(234, 179, 8, 0.1)', padding: '4px 8px', borderRadius: '4px' }}>
                ⚠ {envState.openmvs.warning}
              </div>
            )}

            {envState.openmvs.pipelineModules && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                {Object.entries(envState.openmvs.pipelineModules).map(([key, mod]) => (
                  <span
                    key={key}
                    style={{
                      fontSize: '10px',
                      fontFamily: 'var(--font-mono)',
                      padding: '2px 5px',
                      borderRadius: '3px',
                      background: mod.available ? 'rgba(213, 255, 101, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                      color: mod.available ? 'var(--accent)' : 'var(--text-muted)',
                      border: `1px solid ${mod.available ? 'rgba(213, 255, 101, 0.25)' : 'var(--border-subtle)'}`,
                    }}
                    title={`${mod.name}: ${mod.available ? (mod.path || 'Found') : 'Not found in OpenMVS folder'}`}
                  >
                    {mod.available ? '✓ ' : '✗ '}{mod.name.replace('.exe', '')}
                  </span>
                ))}
              </div>
            )}

            {isElectron && (
              <button
                type="button"
                className="btn-secondary"
                onClick={handleSelectOpenMvsPath}
                style={{ width: '100%', fontSize: '11px', padding: '4px 8px', justifyContent: 'center' }}
              >
                <FileSearch size={12} />
                <span>{envState.openmvs.detected ? 'Change OpenMVS Path...' : 'Locate InterfaceCOLMAP.exe...'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Pipeline Readiness Disclaimer */}
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', paddingTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
          <div>
            <span style={{ color: envState.environmentReady ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: 500 }}>
              {envState.environmentReady ? '• Pipeline Ready: ' : '• Setup Needed: '}
            </span>
            <span>
              {envState.environmentReady
                ? 'Environment validated. (Reconstruction engine execution will be launched in Sprint 6B).'
                : 'Please locate missing executables above to enable reconstruction.'}
            </span>
          </div>
          <span style={{ fontSize: '10.5px', fontFamily: 'var(--font-mono)' }}>
            Sprint 6A: Environment Check Only
          </span>
        </div>
      </div>

      {/* Drag & Drop Visual Zone */}
      <div
        className={`import-dropzone ${dragActive ? 'active' : ''}`}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
      >
        <div className="dropzone-icon-box">
          <UploadCloud size={26} strokeWidth={1.8} />
        </div>
        <div>
          <div className="dropzone-title">
            {currentProject
              ? `Select or drop image files for "${currentProject.name}"`
              : 'Select or drop drone photograph folders or files here'}
          </div>
          <div className="dropzone-subtitle" style={{ marginTop: '3px' }}>
            Supports JPG, JPEG, PNG, and WebP image formats with EXIF camera calibration metadata
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {isElectron ? (
            <>
              <button
                type="button"
                className="btn-primary"
                onClick={handleNativeFolderSelect}
                title="Select a directory containing photograph files using Windows folder picker"
              >
                <FolderSearch size={14} />
                <span>Select Folder (Native)...</span>
              </button>

              <button
                type="button"
                className="btn-secondary"
                onClick={() => filesInputRef.current?.click()}
                title="Select individual image files"
              >
                <ImageIcon size={14} />
                <span>Select Image Files...</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => folderInputRef.current?.click()}
                title="Select a directory containing photograph files"
              >
                <FolderSearch size={14} />
                <span>Select Folder (Session)...</span>
              </button>

              <button
                type="button"
                className="btn-secondary"
                onClick={() => filesInputRef.current?.click()}
                title="Select individual image files"
              >
                <ImageIcon size={14} />
                <span>Select Image Files...</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Validation & Selected Dataset Summary Bar */}
      <div className="validation-bar">
        <div className="validation-tags">
          {isNativeDirectoryAttached ? (
            <>
              <div className="val-tag success">
                <CheckCircle2 size={12} />
                <span>
                  Attached: {currentProject.sourceDirectoryReference.fileCount} Photographs ({formatFileSize(totalBytes)})
                  {folderValidation?.capped ? ' [Scan capped — count may be incomplete]' : ''}
                </span>
              </div>
              <div className="val-tag">
                <Monitor size={12} color="var(--accent)" />
                <span>Native Windows Path</span>
              </div>
              <div className="val-tag" title={currentProject.sourceDirectoryReference.path}>
                <HardDrive size={12} />
                <span style={{ maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {currentProject.sourceDirectoryReference.path}
                </span>
              </div>
            </>
          ) : hasAttachedImages ? (
            <>
              <div className="val-tag success">
                <CheckCircle2 size={12} />
                <span>
                  Attached: {sessionImages.length} Photographs ({formatFileSize(totalBytes)})
                </span>
              </div>
              <div className="val-tag">
                <Camera size={12} />
                <span>Session Memory</span>
              </div>
              <div className="val-tag">
                <Layers size={12} />
                <span>Folder: {currentProject?.sourceDirectoryReference?.name || 'Local Selection'}</span>
              </div>
            </>
          ) : (
            <div className="val-tag" style={{ color: 'var(--text-muted)' }}>
              <span>No photographs attached yet</span>
            </div>
          )}
        </div>

        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {isNativeDirectoryAttached ? (
            <span>
              Real path: <code style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{currentProject.sourceDirectoryReference.path}</code>
            </span>
          ) : hasAttachedImages ? (
            <span>
              Directory reference: <code style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{currentProject?.sourceDirectoryReference?.name || 'In-Memory Session'}</code>
            </span>
          ) : (
            <span>Ready for image selection</span>
          )}
        </div>
      </div>

      {/* Native Directory Info Card (Electron Desktop Mode) */}
      {isNativeDirectoryAttached && (
        <div className="glass-panel" style={{ padding: '12px 16px', marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <HardDrive size={16} color="var(--accent)" />
              <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Native Folder: {currentProject.sourceDirectoryReference.name}
              </span>
            </div>
            <span style={{ fontSize: '11px', color: folderValidation?.capped ? 'var(--color-warning)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {currentProject.sourceDirectoryReference.fileCount} image files • {formatFileSize(totalBytes)}
              {folderValidation?.capped ? ' (scan capped at 5,000 entries — may be incomplete)' : ''}
            </span>
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', background: 'rgba(0,0,0,0.3)', padding: '6px 10px', borderRadius: 'var(--radius-xs)' }}>
            {currentProject.sourceDirectoryReference.path}
          </div>
          {folderValidation && !folderValidation.valid && (
            <div style={{ background: 'rgba(234, 179, 8, 0.1)', border: '1px solid var(--color-warning-dim)', padding: '8px 12px', borderRadius: '4px', fontSize: '11.5px', color: 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={14} />
              <span>Folder Validation Notice: {folderValidation.error}</span>
            </div>
          )}
          {folderValidation?.warning && (
            <div style={{ background: 'rgba(234, 179, 8, 0.12)', border: '1px solid var(--color-warning)', padding: '8px 12px', borderRadius: '4px', fontSize: '11.5px', color: 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={14} />
              <span>{folderValidation.warning}</span>
            </div>
          )}
          {folderValidation && folderValidation.valid && (
            <div style={{ fontSize: '11px', color: folderValidation.capped ? 'var(--color-warning)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {folderValidation.capped ? <AlertTriangle size={12} color="var(--color-warning)" /> : <CheckCircle2 size={12} color="var(--accent)" />}
              <span>Directory validated non-recursively: {folderValidation.fileCount} supported photographs found. {folderValidation.capped ? '(Scan cap of 5,000 entries reached — count may be incomplete)' : ''}</span>
            </div>
          )}
          {nativeDirectory?.imageFiles && nativeDirectory.imageFiles.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px', maxHeight: '160px', overflowY: 'auto' }}>
              {nativeDirectory.imageFiles.slice(0, 48).map((img, i) => (
                <div key={i} style={{ background: 'var(--bg-secondary)', padding: '4px 8px', borderRadius: '4px', fontSize: '10.5px', color: 'var(--text-secondary)', display: 'flex', gap: '6px' }}>
                  <ImageIcon size={11} color="var(--accent)" />
                  <span>{img.name}</span>
                  <span style={{ color: 'var(--text-muted)' }}>({formatFileSize(img.size)})</span>
                </div>
              ))}
              {nativeDirectory.imageFiles.length > 48 && (
                <div style={{ padding: '4px 8px', fontSize: '10.5px', color: 'var(--text-muted)' }}>
                  + {nativeDirectory.imageFiles.length - 48} more files...
                </div>
              )}
            </div>
          )}

          {/* Dedicated Output Workspace Section (Sprint 6B) */}
          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <FolderOpen size={13} color="var(--accent)" />
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>Separate Project Workspace (COLMAP Output):</span>
              <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: currentProject.outputDirectoryReference?.path ? 'var(--accent)' : 'var(--color-warning)' }}>
                {currentProject.outputDirectoryReference?.path || 'Not Configured (Separate from photos)'}
              </span>
            </div>
            {isElectron && (
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: '11px', padding: '3px 8px' }}
                onClick={async () => {
                  const res = await selectWorkspaceDirectory();
                  if (!res.canceled && res.path && onUpdateProjectOutputDirectory) {
                    onUpdateProjectOutputDirectory(currentProject.id, res);
                  }
                }}
              >
                {currentProject.outputDirectoryReference?.path ? 'Change Output Workspace...' : 'Set Output Workspace...'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Genuine Attached Images Thumbnails (Browser Mode) */}
      {!isNativeDirectoryAttached && hasAttachedImages && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Session Photographs ({previewUrls.length} of {sessionImages.length} previews loaded)
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Total memory: {formatFileSize(totalBytes)}
            </span>
          </div>

          <div className="thumbnails-grid">
            {previewUrls.map((item, idx) => (
              <div key={item.id} className="image-thumb-card genuine-thumb">
                <div className="thumb-preview-placeholder with-image">
                  <img
                    src={item.url}
                    alt={item.name}
                    className="thumb-image-img"
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                  <span className="thumb-index-tag">#{idx + 1}</span>
                </div>
                <div className="thumb-details">
                  <span className="thumb-filename" title={item.name}>{item.name}</span>
                  <span className="thumb-meta">{formatFileSize(item.size)}</span>
                  <span className="thumb-meta" style={{ color: 'var(--accent)' }}>Session File</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Design Sample Preview (Toggleable from earlier sprint) */}
      {showSamplePreview && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px', opacity: 0.75 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Design Sample Previews (Mock EXIF Data Reference)
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Visual reference only • Non-destructive
            </span>
          </div>

          <div className="thumbnails-grid">
            {sampleThumbnails.map((item, idx) => (
              <div key={item.id} className="image-thumb-card sample-thumb">
                <div className="thumb-preview-placeholder">
                  <ImageIcon size={26} strokeWidth={1.2} />
                  <span className="thumb-index-tag">#{idx + 1}</span>
                </div>
                <div className="thumb-details">
                  <span className="thumb-filename" title={item.name}>{item.name}</span>
                  <span className="thumb-meta">{item.res} • {item.focal}</span>
                  <span className="thumb-meta" style={{ color: 'var(--accent)' }}>ISO {item.iso} • {item.size}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
