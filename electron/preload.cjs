/**
 * Aeromorph Desktop Preload Bridge
 * 
 * Secure context bridge exposing strictly scoped desktop capabilities
 * to the React renderer under context isolation.
 * 
 * Security Guarantees:
 * - Raw `ipcRenderer` is NEVER exposed to window.
 * - No Node.js built-ins (fs, child_process, path) are leaked to renderer.
 * - Input parameters are strictly validated prior to IPC invocation.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aeromorphAPI', {
  /**
   * Boolean flag indicating app is running in Electron desktop shell
   */
  isElectron: true,

  /**
   * Retrieve platform runtime telemetry
   * @returns {Promise<{ platform: string, arch: string, electronVersion: string, chromeVersion: string, nodeVersion: string }>}
   */
  getPlatformInfo: () => ipcRenderer.invoke('desktop:getPlatformInfo'),

  /**
   * Prompt user with native Windows folder picker for source photographs directory
   * @returns {Promise<{ canceled: boolean, path?: string, name?: string, fileCount?: number, totalSizeBytes?: number, imageFiles?: Array<{ name: string, size: number }> }>}
   */
  selectImageDirectory: () => ipcRenderer.invoke('dialog:selectImageDirectory'),

  /**
   * Prompt user with native Windows file picker for a local .PLY 3D model file
   * @returns {Promise<{ canceled: boolean, path?: string, name?: string, sizeBytes?: number, lastModified?: number }>}
   */
  selectPlyFile: () => ipcRenderer.invoke('dialog:selectPlyFile'),

  /**
   * Read PLY binary buffer from a validated local path
   * @param {string} filePath - Path to a .ply file previously selected by user
   * @returns {Promise<{ success: boolean, buffer?: ArrayBuffer, error?: string }>}
   */
  readPlyBuffer: (filePath) => {
    if (typeof filePath !== 'string' || !filePath.trim() || filePath.includes('\0')) {
      return Promise.reject(new Error('Invalid file path argument'));
    }
    return ipcRenderer.invoke('file:readPlyBuffer', filePath.trim());
  },

  /**
   * Check read-only existence of user-configured COLMAP and OpenMVS executable binaries
   * @param {Object} paths - Optional candidate paths { colmapPath?: string, openmvsPath?: string }
   * @returns {Promise<{ colmap: { exists: boolean, path?: string }, openmvs: { exists: boolean, path?: string } }>}
   */
  checkExecutablePaths: (paths = {}) => {
    const sanitized = {
      colmapPath: typeof paths.colmapPath === 'string' ? paths.colmapPath.trim() : null,
      openmvsPath: typeof paths.openmvsPath === 'string' ? paths.openmvsPath.trim() : null,
    };
    return ipcRenderer.invoke('system:checkExecutablePaths', sanitized);
  },

  /**
   * Run read-only local environment detection for COLMAP and OpenMVS (Sprint 6A)
   * @param {Object} options - Optional custom paths { customColmapPath?: string, customOpenmvsPath?: string }
   * @returns {Promise<{ colmap: Object, openmvs: Object, environmentReady: boolean }>}
   */
  detectEnvironment: (options = {}) => {
    const sanitized = {
      customColmapPath: typeof options.customColmapPath === 'string' && !options.customColmapPath.includes('\0')
        ? options.customColmapPath.trim()
        : null,
      customOpenmvsPath: typeof options.customOpenmvsPath === 'string' && !options.customOpenmvsPath.includes('\0')
        ? options.customOpenmvsPath.trim()
        : null,
    };
    return ipcRenderer.invoke('system:detectEnvironment', sanitized);
  },

  /**
   * Prompt user with native Windows file picker to locate colmap.exe
   * @returns {Promise<{ canceled: boolean, path?: string, version?: string, error?: string }>}
   */
  selectColmapExecutable: () => ipcRenderer.invoke('dialog:selectColmapExecutable'),

  /**
   * Prompt user with native Windows file picker to locate OpenMVS executable
   * @returns {Promise<{ canceled: boolean, path?: string, version?: string, error?: string }>}
   */
  selectOpenMvsExecutable: () => ipcRenderer.invoke('dialog:selectOpenMvsExecutable'),

  /**
   * Validate a source photograph directory path without launching file picker
   * @param {string} dirPath - Candidate directory path
   * @returns {Promise<{ valid: boolean, accessible: boolean, path?: string, name?: string, fileCount: number, totalSizeBytes: number, imageFiles: Array<{ name: string, size: number }>, error?: string }>}
   */
  validateImageDirectory: (dirPath) => {
    if (typeof dirPath !== 'string' || !dirPath.trim() || dirPath.includes('\0')) {
      return Promise.reject(new Error('Invalid directory path argument'));
    }
    return ipcRenderer.invoke('system:validateImageDirectory', dirPath.trim());
  },
});
