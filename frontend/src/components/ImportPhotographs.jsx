import React, { useState, useRef, useEffect } from 'react';
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
  Monitor
} from 'lucide-react';
import { isElectron, selectNativeDirectory } from '../services/desktopBridge';

export default function ImportPhotographs({
  currentProject = null,
  sessionImages = [],
  nativeDirectory = null,
  projects = [],
  onUpdateProjectImages,
  onUpdateProjectNativeDirectory,
  onProceedToStudio,
  onNavigateHome,
  onSelectProject,
}) {
  const [dragActive, setDragActive] = useState(false);
  const [showSamplePreview, setShowSamplePreview] = useState(false);
  const [previewUrls, setPreviewUrls] = useState([]);

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

  // Handle native folder selection via Electron desktop bridge
  const handleNativeFolderSelect = async () => {
    if (!currentProject) {
      alert('Please create or select a local project first.');
      return;
    }

    const result = await selectNativeDirectory();
    if (result.canceled) return;

    if (result.error) {
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
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {currentProject.sourceDirectoryReference.fileCount} image files • {formatFileSize(totalBytes)}
            </span>
          </div>
          <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', background: 'rgba(0,0,0,0.3)', padding: '6px 10px', borderRadius: 'var(--radius-xs)' }}>
            {currentProject.sourceDirectoryReference.path}
          </div>
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
