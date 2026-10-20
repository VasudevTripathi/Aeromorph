/**
 * Aeromorph Desktop Bridge Client
 * 
 * Provides a unified, type-safe interface for the React renderer.
 * Automatically detects whether the application is running inside the Electron
 * desktop shell or in an ordinary web browser.
 */

/**
 * Detect whether the application is operating inside the Electron desktop shell
 */
export const isElectron = typeof window !== 'undefined' && Boolean(window.aeromorphAPI?.isElectron);

/**
 * Retrieve desktop runtime and platform information
 * @returns {Promise<{ isElectron: boolean, platform: string, arch: string, electronVersion: string|null }>}
 */
export async function getPlatformInfo() {
  if (isElectron && window.aeromorphAPI?.getPlatformInfo) {
    try {
      const info = await window.aeromorphAPI.getPlatformInfo();
      return {
        ...info,
        isElectron: true,
      };
    } catch (err) {
      console.warn('Aeromorph: Failed to get platform info from desktop bridge:', err);
    }
  }

  return {
    isElectron: false,
    platform: 'browser',
    arch: 'wasm/webgl',
    electronVersion: null,
    chromeVersion: null,
    nodeVersion: null,
  };
}

/**
 * Prompt user to select a source photograph directory via native Windows folder picker
 * @returns {Promise<{ canceled: boolean, path?: string, name?: string, fileCount?: number, totalSizeBytes?: number, imageFiles?: Array<{ name: string, size: number }>, error?: string }>}
 */
export async function selectNativeDirectory() {
  if (isElectron && window.aeromorphAPI?.selectImageDirectory) {
    try {
      return await window.aeromorphAPI.selectImageDirectory();
    } catch (err) {
      console.error('Aeromorph Desktop: Native folder dialog error:', err);
      return { canceled: true, error: err.message };
    }
  }

  return {
    canceled: true,
    error: 'Native folder selection requires the Aeromorph Desktop application.',
    unsupported: true,
  };
}

/**
 * Prompt user to select a local .PLY 3D mesh via native Windows file dialog
 * @returns {Promise<{ canceled: boolean, path?: string, name?: string, sizeBytes?: number, lastModified?: number, error?: string }>}
 */
export async function selectNativePlyFile() {
  if (isElectron && window.aeromorphAPI?.selectPlyFile) {
    try {
      return await window.aeromorphAPI.selectPlyFile();
    } catch (err) {
      console.error('Aeromorph Desktop: Native file dialog error:', err);
      return { canceled: true, error: err.message };
    }
  }

  return {
    canceled: true,
    error: 'Native file selection requires the Aeromorph Desktop application.',
    unsupported: true,
  };
}

/**
 * Load raw binary buffer for a previously selected .PLY file path
 * @param {string} filePath - Absolute path to .ply file
 * @returns {Promise<{ success: boolean, buffer?: ArrayBuffer, sizeBytes?: number, name?: string, error?: string }>}
 */
export async function loadNativePlyBuffer(filePath) {
  if (isElectron && window.aeromorphAPI?.readPlyBuffer) {
    try {
      return await window.aeromorphAPI.readPlyBuffer(filePath);
    } catch (err) {
      console.error('Aeromorph Desktop: Failed to read PLY buffer from path:', err);
      return { success: false, error: err.message };
    }
  }

  return {
    success: false,
    error: 'Native file reading requires the Aeromorph Desktop application.',
  };
}

/**
 * Check read-only existence of user-configured COLMAP and OpenMVS executables
 * @param {Object} paths - Candidate paths { colmapPath?: string, openmvsPath?: string }
 * @returns {Promise<{ colmap: { exists: boolean, path?: string }, openmvs: { exists: boolean, path?: string } }>}
 */
export async function checkExecutablePaths(paths = {}) {
  if (isElectron && window.aeromorphAPI?.checkExecutablePaths) {
    try {
      return await window.aeromorphAPI.checkExecutablePaths(paths);
    } catch (err) {
      console.warn('Aeromorph Desktop: Executable verification error:', err);
    }
  }

  return {
    colmap: { exists: false, path: null },
    openmvs: { exists: false, path: null },
  };
}

/**
 * Detect local COLMAP and OpenMVS executables and query version information (Sprint 6A)
 * @param {Object} options - Optional candidate paths { customColmapPath?: string, customOpenmvsPath?: string }
 * @returns {Promise<{ colmap: Object, openmvs: Object, environmentReady: boolean, isBrowserSandbox?: boolean }>}
 */
export async function detectEnvironment(options = {}) {
  if (isElectron && window.aeromorphAPI?.detectEnvironment) {
    try {
      return await window.aeromorphAPI.detectEnvironment(options);
    } catch (err) {
      console.error('Aeromorph Desktop: Environment detection error:', err);
      return {
        colmap: { detected: false, path: null, version: null, status: 'Detection Error', error: err.message },
        openmvs: { detected: false, path: null, version: null, status: 'Detection Error', error: err.message },
        environmentReady: false,
      };
    }
  }

  return {
    colmap: {
      detected: false,
      path: null,
      version: null,
      status: 'Browser Sandbox',
      error: 'Local tool detection requires the Aeromorph Desktop application.',
    },
    openmvs: {
      detected: false,
      path: null,
      version: null,
      status: 'Browser Sandbox',
      error: 'Local tool detection requires the Aeromorph Desktop application.',
    },
    environmentReady: false,
    isBrowserSandbox: true,
  };
}

/**
 * Prompt user to select COLMAP executable (colmap.exe) via native file dialog
 * @returns {Promise<{ canceled: boolean, path?: string, version?: string, error?: string }>}
 */
export async function selectColmapExecutable() {
  if (isElectron && window.aeromorphAPI?.selectColmapExecutable) {
    try {
      return await window.aeromorphAPI.selectColmapExecutable();
    } catch (err) {
      console.error('Aeromorph Desktop: Error selecting COLMAP executable:', err);
      return { canceled: true, error: err.message };
    }
  }

  return {
    canceled: true,
    error: 'Executable selection requires the Aeromorph Desktop application.',
  };
}

/**
 * Prompt user to select OpenMVS executable via native file dialog
 * @returns {Promise<{ canceled: boolean, path?: string, version?: string, error?: string }>}
 */
export async function selectOpenMvsExecutable() {
  if (isElectron && window.aeromorphAPI?.selectOpenMvsExecutable) {
    try {
      return await window.aeromorphAPI.selectOpenMvsExecutable();
    } catch (err) {
      console.error('Aeromorph Desktop: Error selecting OpenMVS executable:', err);
      return { canceled: true, error: err.message };
    }
  }

  return {
    canceled: true,
    error: 'Executable selection requires the Aeromorph Desktop application.',
  };
}

/**
 * Validate a source photograph directory path non-recursively
 * @param {string} dirPath - Candidate directory path
 * @returns {Promise<{ valid: boolean, accessible: boolean, path?: string, name?: string, fileCount: number, totalSizeBytes: number, imageFiles: Array<{ name: string, size: number }>, error?: string }>}
 */
export async function validateImageDirectory(dirPath) {
  if (isElectron && window.aeromorphAPI?.validateImageDirectory) {
    try {
      return await window.aeromorphAPI.validateImageDirectory(dirPath);
    } catch (err) {
      console.error('Aeromorph Desktop: Directory validation error:', err);
      return { valid: false, accessible: false, error: err.message, fileCount: 0, totalSizeBytes: 0, imageFiles: [] };
    }
  }

  return {
    valid: false,
    accessible: false,
    error: 'Native directory validation requires the Aeromorph Desktop application.',
    fileCount: 0,
    totalSizeBytes: 0,
    imageFiles: [],
  };
}
