import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  FolderPlus,
  FolderOpen,
  Box,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  HardDrive,
  Cpu,
  Monitor
} from 'lucide-react';
import { validateProjectName, createProject } from '../services/projectService';
import { isElectron, selectNativeDirectory, selectNativePlyFile } from '../services/desktopBridge';

export default function CreateProjectModal({
  isOpen,
  onClose,
  onProjectCreated,
  existingProjects = [],
}) {
  const [projectName, setProjectName] = useState('');
  const [nameError, setNameError] = useState(null);
  const [touched, setTouched] = useState(false);

  // Optional Source Folder / Images
  const [sourceDirName, setSourceDirName] = useState(null);
  const [selectedImages, setSelectedImages] = useState([]);
  const [nativeDirectory, setNativeDirectory] = useState(null);

  // Optional PLY Model
  const [selectedPlyFile, setSelectedPlyFile] = useState(null);
  const [nativePly, setNativePly] = useState(null);

  // Navigation preference
  const [openDirectlyInStudio, setOpenDirectlyInStudio] = useState(false);

  const nameInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const plyInputRef = useRef(null);

  // Reset state and autofocus when modal opens
  useEffect(() => {
    if (isOpen) {
      setProjectName('');
      setNameError(null);
      setTouched(false);
      setSourceDirName(null);
      setSelectedImages([]);
      setNativeDirectory(null);
      setSelectedPlyFile(null);
      setNativePly(null);
      setOpenDirectlyInStudio(false);

      setTimeout(() => {
        nameInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleNameChange = (e) => {
    const val = e.target.value;
    setProjectName(val);
    if (touched) {
      const validation = validateProjectName(val, existingProjects);
      setNameError(validation.isValid ? null : validation.error);
    }
  };

  const handleNameBlur = () => {
    setTouched(true);
    const validation = validateProjectName(projectName, existingProjects);
    setNameError(validation.isValid ? null : validation.error);
  };

  // Folder Selection (WebKit Directory)
  const handleFolderSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Filter for common image extensions
    const imageFiles = files.filter((f) =>
      /\.(jpe?g|png|webp|bmp|tif|tiff)$/i.test(f.name)
    );

    // Extract directory name from first relative path or default
    let dirName = 'Selected Photos';
    if (files[0]?.webkitRelativePath) {
      const parts = files[0].webkitRelativePath.split('/');
      if (parts.length > 1) {
        dirName = parts[0];
      }
    }

    setSourceDirName(dirName);
    setSelectedImages(imageFiles);
    setNativeDirectory(null);
  };

  // PLY Model Selection (Browser input)
  const handlePlySelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.ply')) {
      alert('Please select a valid .ply 3D mesh file.');
      return;
    }

    setSelectedPlyFile(file);
    setNativePly(null);
    // If a PLY file is selected, conveniently default to opening directly in Studio
    setOpenDirectlyInStudio(true);
  };

  // Folder trigger (Electron native vs Browser input)
  const handleTriggerFolder = async () => {
    if (isElectron) {
      try {
        const result = await selectNativeDirectory();
        if (result.canceled) return;
        if (result.error) {
          alert(`Directory selection error: ${result.error}`);
          return;
        }
        if (result.path) {
          setNativeDirectory(result);
          setSourceDirName(result.name);
          setSelectedImages([]);
        }
      } catch (err) {
        console.error('Aeromorph Desktop: Native folder dialog error:', err);
      }
    } else {
      folderInputRef.current?.click();
    }
  };

  // PLY trigger (Electron native vs Browser input)
  const handleTriggerPly = async () => {
    if (isElectron) {
      try {
        const result = await selectNativePlyFile();
        if (result.canceled) return;
        if (result.error) {
          alert(`PLY file selection error: ${result.error}`);
          return;
        }
        if (result.path) {
          setNativePly(result);
          setSelectedPlyFile(null);
          setOpenDirectlyInStudio(true);
        }
      } catch (err) {
        console.error('Aeromorph Desktop: Native PLY dialog error:', err);
      }
    } else {
      plyInputRef.current?.click();
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    const kb = bytes / 1024;
    return `${kb.toFixed(0)} KB`;
  };

  const handleCreate = (e) => {
    e.preventDefault();
    setTouched(true);

    const validation = validateProjectName(projectName, existingProjects);
    if (!validation.isValid) {
      setNameError(validation.error);
      nameInputRef.current?.focus();
      return;
    }

    const { project, error } = createProject({
      name: projectName,
      sourceDirName: sourceDirName,
      imageFiles: selectedImages,
      modelFile: selectedPlyFile,
      nativeDirectory: nativeDirectory,
      nativePly: nativePly,
    });

    if (error) {
      setNameError(error);
      return;
    }

    onProjectCreated(project, openDirectlyInStudio);
    onClose();
  };

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-project-title"
    >
      <div className="modal-container glass-panel">
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="brand-logo-mark" style={{ width: '22px', height: '22px' }}>
              <FolderPlus size={13} color="#0C0E10" strokeWidth={2.4} />
            </div>
            <div>
              <h2 id="create-project-title" className="modal-title">
                Create Local Project
              </h2>
              <span className="modal-subtitle">
                {isElectron ? 'Sprint 5B: Desktop Local Photogrammetry Workspace' : 'Sprint 5A: Browser-Compatible Project Workspace'}
              </span>
            </div>
          </div>

          <button
            type="button"
            className="btn-ghost"
            style={{ padding: '4px' }}
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body Form */}
        <form onSubmit={handleCreate} className="modal-form">
          {/* Project Name Field */}
          <div className="form-group">
            <label htmlFor="project-name-input" className="form-label required">
              Project Name
            </label>
            <input
              ref={nameInputRef}
              id="project-name-input"
              type="text"
              className={`form-input ${nameError ? 'input-error' : ''}`}
              placeholder="e.g. South Facade Architectural Survey"
              value={projectName}
              onChange={handleNameChange}
              onBlur={handleNameBlur}
              maxLength={60}
              autoComplete="off"
            />
            {nameError ? (
              <div className="form-error-msg">
                <AlertCircle size={12} />
                <span>{nameError}</span>
              </div>
            ) : (
              <span className="form-hint">
                A unique, descriptive title for this photogrammetry reconstruction.
              </span>
            )}
          </div>

          {/* Section: Optional Source Images */}
          <div className="form-group">
            <div className="form-label-row">
              <label className="form-label">
                Source Photographs Reference <span className="label-badge-dim">Optional</span>
              </label>
              {(selectedImages.length > 0 || nativeDirectory) && (
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => {
                    setSelectedImages([]);
                    setNativeDirectory(null);
                    setSourceDirName(null);
                    if (folderInputRef.current) folderInputRef.current.value = '';
                  }}
                >
                  Detach
                </button>
              )}
            </div>

            {/* Hidden Folder Input */}
            <input
              ref={folderInputRef}
              type="file"
              webkitdirectory="true"
              directory="true"
              multiple
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleFolderSelect}
            />

            {nativeDirectory ? (
              <div className="asset-selected-box">
                <div className="asset-info-left">
                  <div className="asset-icon-box">
                    <Monitor size={16} color="var(--accent)" />
                  </div>
                  <div>
                    <div className="asset-title">{nativeDirectory.name}</div>
                    <div className="asset-meta">
                      {nativeDirectory.fileCount} photos • {formatFileSize(nativeDirectory.totalSizeBytes)} • Native Path
                    </div>
                  </div>
                </div>
                <span className="asset-badge-success">
                  <CheckCircle2 size={12} />
                  <span>Referenced</span>
                </span>
              </div>
            ) : selectedImages.length > 0 ? (
              <div className="asset-selected-box">
                <div className="asset-info-left">
                  <div className="asset-icon-box">
                    <ImageIcon size={16} color="var(--accent)" />
                  </div>
                  <div>
                    <div className="asset-title">{sourceDirName}</div>
                    <div className="asset-meta">
                      {selectedImages.length} photographs •{' '}
                      {formatFileSize(
                        selectedImages.reduce((sum, f) => sum + (f.size || 0), 0)
                      )}{' '}
                      • Session Memory
                    </div>
                  </div>
                </div>
                <span className="asset-badge-success">
                  <CheckCircle2 size={12} />
                  <span>Referenced</span>
                </span>
              </div>
            ) : (
              <div className="asset-upload-trigger">
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                  onClick={handleTriggerFolder}
                >
                  <FolderOpen size={14} />
                  <span>{isElectron ? 'Select Windows Photo Directory (Native)...' : 'Select Local Image Directory...'}</span>
                </button>
                <span className="form-hint" style={{ marginTop: '4px' }}>
                  {isElectron
                    ? 'Binds source directory path via Windows folder dialog. Files remain on disk.'
                    : 'Selects an image folder for this browser session. (Permanent path binding requires Electron desktop shell).'}
                </span>
              </div>
            )}
          </div>

          {/* Section: Optional Reconstructed PLY Model */}
          <div className="form-group">
            <div className="form-label-row">
              <label className="form-label">
                Reconstructed PLY Model Reference <span className="label-badge-dim">Optional</span>
              </label>
              {(selectedPlyFile || nativePly) && (
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => {
                    setSelectedPlyFile(null);
                    setNativePly(null);
                    if (plyInputRef.current) plyInputRef.current.value = '';
                  }}
                >
                  Detach
                </button>
              )}
            </div>

            {/* Hidden PLY File Input */}
            <input
              ref={plyInputRef}
              type="file"
              accept=".ply"
              style={{ display: 'none' }}
              onChange={handlePlySelect}
            />

            {nativePly ? (
              <div className="asset-selected-box">
                <div className="asset-info-left">
                  <div className="asset-icon-box">
                    <Box size={16} color="var(--accent)" />
                  </div>
                  <div>
                    <div className="asset-title">{nativePly.name}</div>
                    <div className="asset-meta">
                      {formatFileSize(nativePly.sizeBytes)} • Native PLY Path
                    </div>
                  </div>
                </div>
                <span className="asset-badge-success">
                  <CheckCircle2 size={12} />
                  <span>Ready to Render</span>
                </span>
              </div>
            ) : selectedPlyFile ? (
              <div className="asset-selected-box">
                <div className="asset-info-left">
                  <div className="asset-icon-box">
                    <Box size={16} color="var(--accent)" />
                  </div>
                  <div>
                    <div className="asset-title">{selectedPlyFile.name}</div>
                    <div className="asset-meta">
                      {formatFileSize(selectedPlyFile.size)} • Session File Handle
                    </div>
                  </div>
                </div>
                <span className="asset-badge-success">
                  <CheckCircle2 size={12} />
                  <span>Ready to Render</span>
                </span>
              </div>
            ) : (
              <div className="asset-upload-trigger">
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                  onClick={handleTriggerPly}
                >
                  <Box size={14} />
                  <span>{isElectron ? 'Attach Local .PLY 3D Model (Native)...' : 'Attach Local .PLY 3D Model...'}</span>
                </button>
                <span className="form-hint" style={{ marginTop: '4px' }}>
                  If you already have a reconstructed PLY mesh, associate it to load immediately into the 3D studio.
                </span>
              </div>
            )}
          </div>

          {/* Environment-Aware Shell / Sandbox Notice */}
          {isElectron ? (
            <div className="browser-notice-box" style={{ borderColor: 'rgba(213, 255, 101, 0.25)' }}>
              <div className="notice-icon">
                <Monitor size={14} color="var(--accent)" />
              </div>
              <div className="notice-body">
                <strong style={{ color: 'var(--accent)' }}>Desktop Shell Active:</strong> Real filesystem directory and model paths will be preserved in your project record under context isolation.
              </div>
            </div>
          ) : (
            <div className="browser-notice-box">
              <div className="notice-icon">
                <ShieldAlert size={14} color="var(--color-warning)" />
              </div>
              <div className="notice-body">
                <strong>Browser Sandbox Notice:</strong> Project metadata is saved to local storage. Raw photograph and model file handles are kept in session memory. Native Windows filesystem persistence requires the desktop shell.
              </div>
            </div>
          )}

          {/* Direct Navigation Checkbox */}
          <div className="form-checkbox-row">
            <label className="checkbox-container">
              <input
                type="checkbox"
                checked={openDirectlyInStudio}
                onChange={(e) => setOpenDirectlyInStudio(e.target.checked)}
              />
              <span className="checkbox-label">
                Open directly in Reconstruction Studio after creation
              </span>
            </label>
          </div>

          {/* Modal Footer Actions */}
          <div className="modal-footer">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={!projectName.trim()}
            >
              <FolderPlus size={14} />
              <span>Create Project</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
