/**
 * Aeromorph Project Service & Data Model
 * 
 * Manages local project records, browser-compatible metadata persistence,
 * and in-memory session asset caching for 3D reconstruction workflows.
 * 
 * Storage Boundaries:
 * - Truly Persisted (localStorage): Project metadata records (id, name, createdAt, status,
 *   sourceDirectoryReference summary, modelFileReference summary).
 * - Session-Only (In-Memory Map): Native browser File handles (raw image File objects, PLY File objects).
 *   These cannot be persisted in localStorage due to browser security boundaries.
 */

const STORAGE_KEY_PROJECTS = 'aeromorph_projects_v1';
const STORAGE_KEY_ACTIVE_ID = 'aeromorph_active_project_id';
const STORAGE_KEY_TOOL_PATHS = 'aeromorph_custom_tool_paths_v1';

// Module-level in-memory cache for native File handles during the active browser session
const sessionAssetStore = new Map();

/**
 * Validate a user-supplied project name
 * @param {string} name - The candidate project name
 * @param {Array} existingProjects - Existing project records
 * @param {string|null} currentProjectId - ID of project being edited, if applicable
 * @returns {{ isValid: boolean, error: string | null }}
 */
export function validateProjectName(name, existingProjects = [], currentProjectId = null) {
  if (!name || typeof name !== 'string') {
    return { isValid: false, error: 'Project name is required.' };
  }

  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return { isValid: false, error: 'Project name is required.' };
  }

  if (trimmed.length < 2) {
    return { isValid: false, error: 'Project name must be at least 2 characters long.' };
  }

  if (trimmed.length > 60) {
    return { isValid: false, error: 'Project name cannot exceed 60 characters.' };
  }

  // Disallow forbidden filename/path characters to ensure future desktop filesystem compatibility
  const invalidCharsRegex = /[<>:"/\\|?*\x00-\x1F]/;
  if (invalidCharsRegex.test(trimmed)) {
    return { isValid: false, error: 'Project name cannot contain special characters like < > : " / \\ | ? *' };
  }

  // Check uniqueness (case-insensitive)
  const isDuplicate = existingProjects.some(
    (p) => p && typeof p.name === 'string' && p.id !== currentProjectId && p.name.trim().toLowerCase() === trimmed.toLowerCase()
  );

  if (isDuplicate) {
    return { isValid: false, error: `A project named "${trimmed}" already exists.` };
  }

  return { isValid: true, error: null };
}

/**
 * Retrieve all persisted project records from browser localStorage
 * @returns {Array} Array of project records
 */
export function getStoredProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROJECTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Filter and sanitize to ensure all items are valid project records
    return parsed
      .filter((p) => (
        p &&
        typeof p === 'object' &&
        typeof p.id === 'string' &&
        p.id.trim().length > 0 &&
        typeof p.name === 'string' &&
        p.name.trim().length > 0
      ))
      .map((p) => ({
        id: p.id,
        name: p.name,
        createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
        updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : (typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString()),
        status: typeof p.status === 'string' ? p.status : 'Created',
        sourceDirectoryReference: (p.sourceDirectoryReference && typeof p.sourceDirectoryReference === 'object') ? {
          name: typeof p.sourceDirectoryReference.name === 'string' ? p.sourceDirectoryReference.name : 'Attached Photographs',
          path: typeof p.sourceDirectoryReference.path === 'string' ? p.sourceDirectoryReference.path : null,
          fileCount: Number.isFinite(p.sourceDirectoryReference.fileCount) ? p.sourceDirectoryReference.fileCount : 0,
          totalSizeBytes: Number.isFinite(p.sourceDirectoryReference.totalSizeBytes) ? p.sourceDirectoryReference.totalSizeBytes : 0,
          storageType: p.sourceDirectoryReference.storageType === 'desktop-path' ? 'desktop-path' : 'browser-session',
          updatedAt: typeof p.sourceDirectoryReference.updatedAt === 'string' ? p.sourceDirectoryReference.updatedAt : new Date().toISOString(),
        } : null,
        modelFileReference: (p.modelFileReference && typeof p.modelFileReference === 'object') ? {
          name: typeof p.modelFileReference.name === 'string' ? p.modelFileReference.name : 'model.ply',
          path: typeof p.modelFileReference.path === 'string' ? p.modelFileReference.path : null,
          sizeBytes: Number.isFinite(p.modelFileReference.sizeBytes) ? p.modelFileReference.sizeBytes : 0,
          lastModified: Number.isFinite(p.modelFileReference.lastModified) ? p.modelFileReference.lastModified : null,
          updatedAt: typeof p.modelFileReference.updatedAt === 'string' ? p.modelFileReference.updatedAt : new Date().toISOString(),
        } : null,
        outputDirectoryReference: (p.outputDirectoryReference && typeof p.outputDirectoryReference === 'object') ? {
          name: typeof p.outputDirectoryReference.name === 'string' ? p.outputDirectoryReference.name : 'Workspace',
          path: typeof p.outputDirectoryReference.path === 'string' ? p.outputDirectoryReference.path : null,
          updatedAt: typeof p.outputDirectoryReference.updatedAt === 'string' ? p.outputDirectoryReference.updatedAt : new Date().toISOString(),
        } : null,
      }));
  } catch (err) {
    console.warn('Aeromorph: Failed to read projects from localStorage:', err);
    return [];
  }
}

/**
 * Save project records to browser localStorage
 * @param {Array} projects - Array of project records
 */
export function saveProjects(projects) {
  try {
    // Sanitize to guarantee no circular references or DOM File objects enter localStorage
    const cleanProjects = projects.map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt || p.createdAt,
      status: p.status || 'Created',
      sourceDirectoryReference: p.sourceDirectoryReference
        ? {
            name: p.sourceDirectoryReference.name,
            path: typeof p.sourceDirectoryReference.path === 'string' ? p.sourceDirectoryReference.path : null,
            fileCount: p.sourceDirectoryReference.fileCount || 0,
            totalSizeBytes: p.sourceDirectoryReference.totalSizeBytes || 0,
            storageType: p.sourceDirectoryReference.storageType === 'desktop-path' ? 'desktop-path' : 'browser-session',
            updatedAt: p.sourceDirectoryReference.updatedAt || new Date().toISOString(),
          }
        : null,
      modelFileReference: p.modelFileReference
        ? {
            name: p.modelFileReference.name,
            path: typeof p.modelFileReference.path === 'string' ? p.modelFileReference.path : null,
            sizeBytes: p.modelFileReference.sizeBytes || 0,
            lastModified: p.modelFileReference.lastModified || null,
            updatedAt: p.modelFileReference.updatedAt || new Date().toISOString(),
          }
        : null,
      outputDirectoryReference: p.outputDirectoryReference
        ? {
            name: p.outputDirectoryReference.name || 'Workspace',
            path: typeof p.outputDirectoryReference.path === 'string' ? p.outputDirectoryReference.path : null,
            updatedAt: p.outputDirectoryReference.updatedAt || new Date().toISOString(),
          }
        : null,
    }));

    localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(cleanProjects));
  } catch (err) {
    console.error('Aeromorph: Failed to persist projects to localStorage:', err);
  }
}

/**
 * Get the currently active project ID
 * @returns {string|null}
 */
export function getActiveProjectId() {
  try {
    const val = localStorage.getItem(STORAGE_KEY_ACTIVE_ID);
    return typeof val === 'string' && val.trim().length > 0 ? val : null;
  } catch {
    return null;
  }
}

/**
 * Set the currently active project ID
 * @param {string|null} projectId
 */
export function setActiveProjectId(projectId) {
  try {
    if (projectId) {
      localStorage.setItem(STORAGE_KEY_ACTIVE_ID, projectId);
    } else {
      localStorage.removeItem(STORAGE_KEY_ACTIVE_ID);
    }
  } catch (err) {
    console.warn('Aeromorph: Failed to set active project ID:', err);
  }
}

/**
 * Create a new project record and register any attached session assets
 * @param {Object} params
 * @param {string} params.name - User-supplied project name
 * @param {string|null} params.sourceDirName - Name of the selected folder
 * @param {File[]} [params.imageFiles] - Native File handles for source images
 * @param {File|null} [params.modelFile] - Native File handle for PLY model
 * @returns {{ project: Object, error: string | null }}
 */
export function createProject({
  name,
  sourceDirName = null,
  imageFiles = [],
  modelFile = null,
  nativeDirectory = null,
  nativePly = null,
}) {
  const existingProjects = getStoredProjects();
  const validation = validateProjectName(name, existingProjects);

  if (!validation.isValid) {
    return { project: null, error: validation.error };
  }

  const now = new Date().toISOString();
  const projectId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Determine initial status
  let status = 'Created';
  if (modelFile || (nativePly && nativePly.path)) {
    status = 'Model Ready';
  } else if ((imageFiles && imageFiles.length > 0) || (nativeDirectory && nativeDirectory.fileCount > 0)) {
    status = 'Photos Ready';
  }

  // Create Source Directory Reference
  let sourceDirectoryReference = null;
  if (nativeDirectory && nativeDirectory.path) {
    sourceDirectoryReference = {
      name: nativeDirectory.name || 'Source Directory',
      path: nativeDirectory.path,
      fileCount: nativeDirectory.fileCount || 0,
      totalSizeBytes: nativeDirectory.totalSizeBytes || 0,
      storageType: 'desktop-path',
      updatedAt: now,
    };
  } else if (imageFiles && imageFiles.length > 0) {
    const totalSizeBytes = imageFiles.reduce((acc, f) => acc + (f.size || 0), 0);
    sourceDirectoryReference = {
      name: sourceDirName || 'Attached Photographs',
      fileCount: imageFiles.length,
      totalSizeBytes,
      storageType: 'browser-session',
      updatedAt: now,
    };
  }

  // Create Model File Reference
  let modelFileReference = null;
  if (nativePly && nativePly.path) {
    modelFileReference = {
      name: nativePly.name || 'model.ply',
      path: nativePly.path,
      sizeBytes: nativePly.sizeBytes || 0,
      lastModified: nativePly.lastModified || null,
      updatedAt: now,
    };
  } else if (modelFile) {
    modelFileReference = {
      name: modelFile.name,
      sizeBytes: modelFile.size,
      lastModified: modelFile.lastModified || null,
      updatedAt: now,
    };
  }

  const newProject = {
    id: projectId,
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
    status,
    sourceDirectoryReference,
    modelFileReference,
  };

  // Cache in-memory session File handles and native references
  sessionAssetStore.set(projectId, {
    modelFile: modelFile || null,
    imageFiles: imageFiles || [],
    nativeDirectory: nativeDirectory || null,
    nativePly: nativePly || null,
  });

  // Persist project metadata
  const updatedProjects = [newProject, ...existingProjects];
  saveProjects(updatedProjects);
  setActiveProjectId(projectId);

  return { project: newProject, error: null };
}

/**
 * Retrieve in-memory session assets (native File objects or desktop handles) for a project
 * @param {string} projectId
 * @returns {{ modelFile: File|null, imageFiles: File[], nativeDirectory: Object|null, nativePly: Object|null }}
 */
export function getSessionAssets(projectId) {
  if (!projectId) return { modelFile: null, imageFiles: [], nativeDirectory: null, nativePly: null };
  const assets = sessionAssetStore.get(projectId);
  return assets || { modelFile: null, imageFiles: [], nativeDirectory: null, nativePly: null };
}

/**
 * Attach or update a native local directory reference for a project in Electron desktop mode
 * @param {string} projectId
 * @param {Object} dirInfo - { path: string, name: string, fileCount: number, totalSizeBytes: number, imageFiles?: Array }
 * @returns {Object|null} The updated project record
 */
export function setProjectNativeDirectory(projectId, { path, name, fileCount = 0, totalSizeBytes = 0, imageFiles = [] } = {}) {
  if (!projectId || !path) return null;

  const existingAssets = getSessionAssets(projectId);
  sessionAssetStore.set(projectId, {
    ...existingAssets,
    nativeDirectory: { path, name, fileCount, totalSizeBytes, imageFiles },
  });

  const projects = getStoredProjects();
  const index = projects.findIndex((p) => p.id === projectId);
  if (index === -1) return null;

  const now = new Date().toISOString();
  const updated = {
    ...projects[index],
    updatedAt: now,
    status: projects[index].modelFileReference ? 'Model Ready' : (fileCount > 0 ? 'Photos Ready' : 'Created'),
    sourceDirectoryReference: {
      name: name || 'Source Directory',
      path,
      fileCount,
      totalSizeBytes,
      storageType: 'desktop-path',
      updatedAt: now,
    },
  };

  projects[index] = updated;
  saveProjects(projects);
  return updated;
}

/**
 * Attach or update a native PLY model file reference for a project in Electron desktop mode
 * @param {string} projectId
 * @param {Object} plyInfo - { path: string, name: string, sizeBytes: number, lastModified?: number }
 * @returns {Object|null} The updated project record
 */
export function setProjectNativePly(projectId, { path, name, sizeBytes = 0, lastModified = null } = {}) {
  if (!projectId || !path) return null;

  const existingAssets = getSessionAssets(projectId);
  sessionAssetStore.set(projectId, {
    ...existingAssets,
    nativePly: { path, name, sizeBytes, lastModified },
    modelFile: null, // Clear browser File handle if any
  });

  const projects = getStoredProjects();
  const index = projects.findIndex((p) => p.id === projectId);
  if (index === -1) return null;

  const now = new Date().toISOString();
  const updated = {
    ...projects[index],
    updatedAt: now,
    status: 'Model Ready',
    modelFileReference: {
      name: name || 'model.ply',
      path,
      sizeBytes,
      lastModified,
      updatedAt: now,
    },
  };

  projects[index] = updated;
  saveProjects(projects);
  return updated;
}

/**
 * Attach or update native workspace output directory for a project
 * @param {string} projectId
 * @param {{ path: string, name?: string }} dirInfo
 * @returns {Object|null} The updated project record
 */
export function setProjectOutputDirectory(projectId, dirInfo) {
  if (!projectId) return null;

  const projects = getStoredProjects();
  const index = projects.findIndex((p) => p.id === projectId);
  if (index === -1) return null;

  const now = new Date().toISOString();
  const updated = {
    ...projects[index],
    updatedAt: now,
    outputDirectoryReference: dirInfo && dirInfo.path ? {
      name: dirInfo.name || 'Workspace',
      path: dirInfo.path,
      updatedAt: now,
    } : null,
  };

  projects[index] = updated;
  saveProjects(projects);
  return updated;
}

/**
 * Attach or update a PLY model file for a project in the active session
 * @param {string} projectId
 * @param {File} file - Native PLY File object
 * @returns {Object|null} The updated project record
 */
export function setProjectModelFile(projectId, file) {
  if (!projectId || !file) return null;

  const existingAssets = getSessionAssets(projectId);
  sessionAssetStore.set(projectId, {
    ...existingAssets,
    modelFile: file,
  });

  const projects = getStoredProjects();
  const index = projects.findIndex((p) => p.id === projectId);
  if (index === -1) return null;

  const now = new Date().toISOString();
  const updated = {
    ...projects[index],
    updatedAt: now,
    status: 'Model Ready',
    modelFileReference: {
      name: file.name,
      sizeBytes: file.size,
      lastModified: file.lastModified || null,
      updatedAt: now,
    },
  };

  projects[index] = updated;
  saveProjects(projects);
  return updated;
}

/**
 * Attach or update source images for a project in the active session
 * @param {string} projectId
 * @param {string} dirName - Directory name / label
 * @param {File[]} files - Array of image File objects
 * @returns {Object|null} The updated project record
 */
export function setProjectSourceImages(projectId, dirName, files) {
  if (!projectId) return null;

  const existingAssets = getSessionAssets(projectId);
  sessionAssetStore.set(projectId, {
    ...existingAssets,
    imageFiles: files || [],
  });

  const projects = getStoredProjects();
  const index = projects.findIndex((p) => p.id === projectId);
  if (index === -1) return null;

  const now = new Date().toISOString();
  const totalSizeBytes = (files || []).reduce((acc, f) => acc + (f.size || 0), 0);

  const updated = {
    ...projects[index],
    updatedAt: now,
    status: projects[index].modelFileReference ? 'Model Ready' : (files.length > 0 ? 'Photos Ready' : 'Created'),
    sourceDirectoryReference: files.length > 0 ? {
      name: dirName || 'Attached Images',
      fileCount: files.length,
      totalSizeBytes,
      storageType: 'browser-session',
      updatedAt: now,
    } : null,
  };

  projects[index] = updated;
  saveProjects(projects);
  return updated;
}

/**
 * Delete a project record and remove any session assets
 * @param {string} projectId
 * @returns {Array} Updated list of remaining projects
 */
export function deleteProject(projectId) {
  if (!projectId) return getStoredProjects();

  sessionAssetStore.delete(projectId);

  const projects = getStoredProjects().filter((p) => p.id !== projectId);
  saveProjects(projects);

  const activeId = getActiveProjectId();
  if (activeId === projectId) {
    const nextActive = projects.length > 0 ? projects[0].id : null;
    setActiveProjectId(nextActive);
  }

  return projects;
}

/**
 * Clear in-memory session assets (used when resetting session or detaching)
 * @param {string} projectId
 */
export function clearProjectSessionAssets(projectId) {
  if (!projectId) return;
  sessionAssetStore.delete(projectId);
}

/**
 * Retrieve user-configured custom executable paths from local storage
 * @returns {{ colmapPath: string|null, openmvsPath: string|null, pythonPath: string|null }}
 */
export function getCustomToolPaths() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TOOL_PATHS);
    if (!raw) return { colmapPath: null, openmvsPath: null, pythonPath: null };
    const parsed = JSON.parse(raw);
    return {
      colmapPath: typeof parsed.colmapPath === 'string' ? parsed.colmapPath : null,
      openmvsPath: typeof parsed.openmvsPath === 'string' ? parsed.openmvsPath : null,
      pythonPath: typeof parsed.pythonPath === 'string' ? parsed.pythonPath : null,
    };
  } catch {
    return { colmapPath: null, openmvsPath: null, pythonPath: null };
  }
}

/**
 * Persist user-configured custom executable paths to local storage
 * @param {Object} paths - Candidate paths { colmapPath?: string, openmvsPath?: string, pythonPath?: string }
 * @returns {{ colmapPath: string|null, openmvsPath: string|null, pythonPath: string|null }}
 */
export function saveCustomToolPaths(paths = {}) {
  try {
    const current = getCustomToolPaths();
    const updated = {
      colmapPath: paths.colmapPath !== undefined ? paths.colmapPath : current.colmapPath,
      openmvsPath: paths.openmvsPath !== undefined ? paths.openmvsPath : current.openmvsPath,
      pythonPath: paths.pythonPath !== undefined ? paths.pythonPath : current.pythonPath,
    };
    localStorage.setItem(STORAGE_KEY_TOOL_PATHS, JSON.stringify(updated));
    return updated;
  } catch (err) {
    console.warn('Aeromorph: Failed to save custom tool paths to localStorage:', err);
    return paths;
  }
}

