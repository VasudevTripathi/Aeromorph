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

/**
 * Prompt user to select project workspace output directory via native dialog
 * @returns {Promise<{ canceled: boolean, path?: string, name?: string, error?: string }>}
 */
export async function selectWorkspaceDirectory() {
  if (isElectron && window.aeromorphAPI?.selectWorkspaceDirectory) {
    try {
      return await window.aeromorphAPI.selectWorkspaceDirectory();
    } catch (err) {
      console.error('Aeromorph Desktop: Error selecting workspace directory:', err);
      return { canceled: true, error: err.message };
    }
  }

  return {
    canceled: true,
    error: 'Workspace folder selection requires the Aeromorph Desktop application.',
  };
}

/**
 * Launch reconstruction job (Sprint 6B & Sprint 9: Sparse, Dense, Mesh)
 * @param {Object} config - { imageDir: string, outputDir: string, customColmapPath?: string, customOpenmvsPath?: string, targetStage?: string, resolutionLevel?: number, maxResolution?: number, numThreads?: number }
 * @returns {Promise<{ success: boolean, jobId?: string, error?: string }>}
 */
export async function startSparseReconstruction(config) {
  if (isElectron && window.aeromorphAPI?.startSparseReconstruction) {
    try {
      return await window.aeromorphAPI.startSparseReconstruction(config);
    } catch (err) {
      console.error('Aeromorph Desktop: Failed to start reconstruction:', err);
      return { success: false, error: err.message };
    }
  }

  return {
    success: false,
    error: 'Reconstruction pipeline execution requires the Aeromorph Desktop application.',
  };
}

export const startReconstruction = startSparseReconstruction;

/**
 * Cancel active reconstruction job
 * @returns {Promise<{ canceled: boolean, message?: string }>}
 */
export async function cancelSparseReconstruction() {
  if (isElectron && window.aeromorphAPI?.cancelSparseReconstruction) {
    try {
      return await window.aeromorphAPI.cancelSparseReconstruction();
    } catch (err) {
      console.error('Aeromorph Desktop: Failed to cancel reconstruction:', err);
      return { canceled: false, error: err.message };
    }
  }

  return { canceled: false, error: 'Reconstruction cancellation requires the Aeromorph Desktop application.' };
}

/**
 * Query current reconstruction job status
 * @returns {Promise<{ id?: string, status: string, stage?: string, stageLabel?: string, logs: Array }>}
 */
export async function getReconstructionStatus() {
  if (isElectron && window.aeromorphAPI?.getReconstructionStatus) {
    try {
      return await window.aeromorphAPI.getReconstructionStatus();
    } catch (err) {
      console.error('Aeromorph Desktop: Failed to get reconstruction status:', err);
      return { status: 'idle', logs: [] };
    }
  }

  return { status: 'idle', logs: [] };
}

/**
 * Subscribe to reconstruction progress events
 * @param {Function} callback - (progressData) => void
 * @returns {Function} Unsubscribe function
 */
export function subscribeReconstructionProgress(callback) {
  if (isElectron && window.aeromorphAPI?.onReconstructionProgress) {
    return window.aeromorphAPI.onReconstructionProgress(callback);
  }
  return () => {};
}

/**
 * Subscribe to reconstruction log streaming events
 * @param {Function} callback - (logEntry) => void
 * @returns {Function} Unsubscribe function
 */
export function subscribeReconstructionLog(callback) {
  if (isElectron && window.aeromorphAPI?.onReconstructionLog) {
    return window.aeromorphAPI.onReconstructionLog(callback);
  }
  return () => {};
}

/**
 * Detect local Python 3 environment and verify CV dependencies (Sprint 7)
 * @param {Object} options - Optional { customPythonPath?: string }
 * @returns {Promise<{ detected: boolean, path?: string, version?: string, dependencies?: Object, environmentReady: boolean, status: string, error?: string }>}
 */
export async function detectPython(options = {}) {
  if (isElectron && window.aeromorphAPI?.detectPython) {
    try {
      return await window.aeromorphAPI.detectPython(options);
    } catch (err) {
      console.error('Aeromorph Desktop: Python detection error:', err);
      return {
        detected: false,
        path: null,
        version: null,
        dependencies: { numpy: false, pillow: false, opencv: false },
        environmentReady: false,
        status: 'Detection Error',
        error: err.message,
      };
    }
  }

  return {
    detected: false,
    path: null,
    version: null,
    dependencies: { numpy: false, pillow: false, opencv: false },
    environmentReady: false,
    status: 'Browser Sandbox',
    error: 'Python environment detection requires the Aeromorph Desktop application.',
  };
}

/**
 * Prompt user to select Python executable via native file dialog
 * @returns {Promise<{ canceled: boolean, path?: string, version?: string, error?: string }>}
 */
export async function selectPythonExecutable() {
  if (isElectron && window.aeromorphAPI?.selectPythonExecutable) {
    try {
      return await window.aeromorphAPI.selectPythonExecutable();
    } catch (err) {
      console.error('Aeromorph Desktop: Error selecting Python executable:', err);
      return { canceled: true, error: err.message };
    }
  }

  return {
    canceled: true,
    error: 'Executable selection requires the Aeromorph Desktop application.',
  };
}

/**
 * Start Computer Vision Image Quality Analysis Worker (Sprint 7)
 * @param {Object} config - { inputDir: string, reportPath?: string, customPythonPath?: string, maxHamming?: number }
 * @returns {Promise<{ success: boolean, jobId?: string, reportPath?: string, error?: string }>}
 */
export async function startCvAnalysis(config) {
  if (isElectron && window.aeromorphAPI?.startCvAnalysis) {
    try {
      return await window.aeromorphAPI.startCvAnalysis(config);
    } catch (err) {
      console.error('Aeromorph Desktop: Failed to start computer vision analysis:', err);
      return { success: false, error: err.message };
    }
  }

  return {
    success: false,
    error: 'Computer vision analysis requires the Aeromorph Desktop application.',
  };
}

/**
 * Cancel active Computer Vision Analysis Worker
 * @returns {Promise<{ canceled: boolean, message?: string }>}
 */
export async function cancelCvAnalysis() {
  if (isElectron && window.aeromorphAPI?.cancelCvAnalysis) {
    try {
      return await window.aeromorphAPI.cancelCvAnalysis();
    } catch (err) {
      console.error('Aeromorph Desktop: Failed to cancel computer vision analysis:', err);
      return { canceled: false, error: err.message };
    }
  }

  return { canceled: false, error: 'Analysis cancellation requires the Aeromorph Desktop application.' };
}

/**
 * Get active Computer Vision Analysis Worker status, progress, and report
 * @returns {Promise<{ id?: string, status: string, settled?: boolean, progress?: Object, report?: Object, logs: Array }>}
 */
export async function getCvAnalysisStatus() {
  if (isElectron && window.aeromorphAPI?.getCvAnalysisStatus) {
    try {
      return await window.aeromorphAPI.getCvAnalysisStatus();
    } catch (err) {
      console.error('Aeromorph Desktop: Failed to get analysis status:', err);
      return { status: 'idle', logs: [] };
    }
  }

  return { status: 'idle', logs: [] };
}

/**
 * Read structured Computer Vision JSON report from validated path
 * @param {string} reportPath - Path to report file
 * @returns {Promise<{ success: boolean, report?: Object, error?: string }>}
 */
export async function readCvReport(reportPath) {
  if (isElectron && window.aeromorphAPI?.readCvReport) {
    try {
      return await window.aeromorphAPI.readCvReport(reportPath);
    } catch (err) {
      console.error('Aeromorph Desktop: Failed to read report:', err);
      return { success: false, error: err.message };
    }
  }

  return { success: false, error: 'Report reading requires the Aeromorph Desktop application.' };
}

/**
 * Subscribe to computer vision progress events
 * @param {Function} callback - (progressData) => void
 * @returns {Function} Unsubscribe function
 */
export function subscribeCvProgress(callback) {
  if (isElectron && window.aeromorphAPI?.onCvProgress) {
    return window.aeromorphAPI.onCvProgress(callback);
  }
  return () => {};
}

/**
 * Subscribe to computer vision log streaming events
 * @param {Function} callback - (logEntry) => void
 * @returns {Function} Unsubscribe function
 */
export function subscribeCvLog(callback) {
  if (isElectron && window.aeromorphAPI?.onCvLog) {
    return window.aeromorphAPI.onCvLog(callback);
  }
  return () => {};
}

// ------------------------------------------------------------------------------
// Sprint 8: Video Import & Frame Extraction Bridge Functions
// ------------------------------------------------------------------------------

/**
 * Prompt user to select an input video file via native file dialog (Sprint 8)
 * @returns {Promise<{ canceled: boolean, path?: string, name?: string, sizeBytes?: number, extension?: string, error?: string }>}
 */
export async function selectVideoFile() {
  if (isElectron && window.aeromorphAPI?.selectVideoFile) {
    try {
      return await window.aeromorphAPI.selectVideoFile();
    } catch (err) {
      console.error('Aeromorph Desktop: Error selecting video file:', err);
      return { canceled: true, error: err.message };
    }
  }

  return {
    canceled: true,
    error: 'Native video selection requires the Aeromorph Desktop application.',
  };
}

/**
 * Validate candidate video file path
 * @param {string} videoPath
 * @returns {Promise<{ valid: boolean, accessible: boolean, path?: string, name?: string, sizeBytes?: number, extension?: string, error?: string }>}
 */
export async function validateVideoFile(videoPath) {
  if (isElectron && window.aeromorphAPI?.validateVideoFile) {
    try {
      return await window.aeromorphAPI.validateVideoFile(videoPath);
    } catch (err) {
      console.error('Aeromorph Desktop: Error validating video file:', err);
      return { valid: false, accessible: false, error: err.message };
    }
  }

  return { valid: false, accessible: false, error: 'Video validation requires the Aeromorph Desktop application.' };
}

/**
 * Start Video Frame Extraction Worker (Sprint 8)
 * @param {Object} config - { videoPath: string, outputDir?: string, samplingInterval?: number, maxFrames?: number, minDimension?: number, blurThreshold?: number, maxHamming?: number, enableBlurFilter?: boolean, enableDuplicateFilter?: boolean, customPythonPath?: string }
 * @returns {Promise<{ success: boolean, jobId?: string, videoPath?: string, outputDir?: string, reportPath?: string, error?: string }>}
 */
export async function startVideoExtraction(config) {
  if (isElectron && window.aeromorphAPI?.startVideoExtraction) {
    try {
      return await window.aeromorphAPI.startVideoExtraction(config);
    } catch (err) {
      console.error('Aeromorph Desktop: Failed to start video extraction:', err);
      return { success: false, error: err.message };
    }
  }

  return {
    success: false,
    error: 'Video extraction requires the Aeromorph Desktop application.',
  };
}

/**
 * Cancel active Video Extraction Worker
 * @returns {Promise<{ canceled: boolean, message?: string }>}
 */
export async function cancelVideoExtraction() {
  if (isElectron && window.aeromorphAPI?.cancelVideoExtraction) {
    try {
      return await window.aeromorphAPI.cancelVideoExtraction();
    } catch (err) {
      console.error('Aeromorph Desktop: Failed to cancel video extraction:', err);
      return { canceled: false, error: err.message };
    }
  }

  return { canceled: false, error: 'Video extraction cancellation requires the Aeromorph Desktop application.' };
}

/**
 * Get active Video Extraction Worker status, progress, and report
 * @returns {Promise<{ id?: string, status: string, settled?: boolean, progress?: Object, report?: Object, logs: Array }>}
 */
export async function getVideoExtractionStatus() {
  if (isElectron && window.aeromorphAPI?.getVideoExtractionStatus) {
    try {
      return await window.aeromorphAPI.getVideoExtractionStatus();
    } catch (err) {
      console.error('Aeromorph Desktop: Failed to get video extraction status:', err);
      return { status: 'idle', logs: [] };
    }
  }

  return { status: 'idle', logs: [] };
}

/**
 * Read structured Video Extraction JSON report from validated path
 * @param {string} reportPath - Path to report file
 * @returns {Promise<{ success: boolean, report?: Object, error?: string }>}
 */
export async function readVideoReport(reportPath) {
  if (isElectron && window.aeromorphAPI?.readVideoReport) {
    try {
      return await window.aeromorphAPI.readVideoReport(reportPath);
    } catch (err) {
      console.error('Aeromorph Desktop: Failed to read video report:', err);
      return { success: false, error: err.message };
    }
  }

  return { success: false, error: 'Report reading requires the Aeromorph Desktop application.' };
}

/**
 * Subscribe to video extraction progress events
 * @param {Function} callback - (progressData) => void
 * @returns {Function} Unsubscribe function
 */
export function subscribeVideoProgress(callback) {
  if (isElectron && window.aeromorphAPI?.onVideoProgress) {
    return window.aeromorphAPI.onVideoProgress(callback);
  }
  return () => {};
}

/**
 * Subscribe to video extraction log streaming events
 * @param {Function} callback - (logEntry) => void
 * @returns {Function} Unsubscribe function
 */
export function subscribeVideoLog(callback) {
  if (isElectron && window.aeromorphAPI?.onVideoLog) {
    return window.aeromorphAPI.onVideoLog(callback);
  }
  return () => {};
}

