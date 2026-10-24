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

  /**
   * Prompt user with native Windows folder picker for project workspace output directory
   * @returns {Promise<{ canceled: boolean, path?: string, name?: string, error?: string }>}
   */
  selectWorkspaceDirectory: () => ipcRenderer.invoke('dialog:selectWorkspaceDirectory'),

  /**
   * Launch reconstruction pipeline (Sparse COLMAP, Dense Point Cloud, Mesh Generation)
   * @param {Object} config - { imageDir: string, outputDir: string, customColmapPath?: string, customOpenmvsPath?: string, targetStage?: string, resolutionLevel?: number, maxResolution?: number, numThreads?: number }
   * @returns {Promise<{ success: boolean, jobId?: string, error?: string }>}
   */
  startSparseReconstruction: (config = {}) => {
    if (!config || typeof config !== 'object') {
      return Promise.reject(new Error('Invalid reconstruction configuration argument.'));
    }
    const sanitized = {
      imageDir: typeof config.imageDir === 'string' ? config.imageDir.trim() : '',
      outputDir: typeof config.outputDir === 'string' ? config.outputDir.trim() : '',
      customColmapPath: typeof config.customColmapPath === 'string' ? config.customColmapPath.trim() : null,
      customOpenmvsPath: typeof config.customOpenmvsPath === 'string' ? config.customOpenmvsPath.trim() : null,
      targetStage: typeof config.targetStage === 'string' ? config.targetStage.trim() : 'sparse',
      matcherType: typeof config.matcherType === 'string' ? config.matcherType.trim() : 'sequential',
      overlap: typeof config.overlap === 'number' ? config.overlap : 10,
      maxImageSize: typeof config.maxImageSize === 'number' ? config.maxImageSize : 2000,
      resolutionLevel: typeof config.resolutionLevel === 'number' ? config.resolutionLevel : 2,
      maxResolution: typeof config.maxResolution === 'number' ? config.maxResolution : 1920,
      numThreads: typeof config.numThreads === 'number' ? config.numThreads : undefined,
      resume: Boolean(config.resume),
      pipelinePreset: typeof config.pipelinePreset === 'string' ? config.pipelinePreset : undefined,
    };
    return ipcRenderer.invoke('reconstruction:start', sanitized);
  },

  /**
   * Alias for startSparseReconstruction
   */
  startReconstruction: (config = {}) => {
    if (!config || typeof config !== 'object') {
      return Promise.reject(new Error('Invalid reconstruction configuration argument.'));
    }
    const sanitized = {
      imageDir: typeof config.imageDir === 'string' ? config.imageDir.trim() : '',
      outputDir: typeof config.outputDir === 'string' ? config.outputDir.trim() : '',
      customColmapPath: typeof config.customColmapPath === 'string' ? config.customColmapPath.trim() : null,
      customOpenmvsPath: typeof config.customOpenmvsPath === 'string' ? config.customOpenmvsPath.trim() : null,
      targetStage: typeof config.targetStage === 'string' ? config.targetStage.trim() : 'sparse',
      resolutionLevel: typeof config.resolutionLevel === 'number' ? config.resolutionLevel : 1,
      maxResolution: typeof config.maxResolution === 'number' ? config.maxResolution : 1920,
      numThreads: typeof config.numThreads === 'number' ? config.numThreads : 4,
    };
    return ipcRenderer.invoke('reconstruction:start', sanitized);
  },

  /**
   * Cancel active reconstruction pipeline job
   * @returns {Promise<{ canceled: boolean, message?: string }>}
   */
  cancelSparseReconstruction: () => ipcRenderer.invoke('reconstruction:cancel'),

  /**
   * Get current reconstruction job status, progress, and buffered logs
   * @returns {Promise<{ id?: string, status: string, stage?: string, stageLabel?: string, logs: Array }>}
   */
  getReconstructionStatus: () => ipcRenderer.invoke('reconstruction:getStatus'),

  /**
   * Subscribe to live reconstruction progress events
   * @param {Function} callback - (progressData) => void
   * @returns {Function} Unsubscribe function
   */
  onReconstructionProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('reconstruction:progress', subscription);
    return () => ipcRenderer.removeListener('reconstruction:progress', subscription);
  },

  /**
   * Subscribe to live reconstruction log events
   * @param {Function} callback - (logEntry) => void
   * @returns {Function} Unsubscribe function
   */
  onReconstructionLog: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, entry) => callback(entry);
    ipcRenderer.on('reconstruction:log', subscription);
    return () => ipcRenderer.removeListener('reconstruction:log', subscription);
  },

  /**
   * Detect local Python 3 environment and check for installed CV libraries (Sprint 7)
   * @param {Object} options - Optional { customPythonPath?: string }
   * @returns {Promise<{ detected: boolean, path?: string, version?: string, dependencies?: Object, environmentReady: boolean, status: string, error?: string }>}
   */
  detectPython: (options = {}) => {
    const sanitized = {
      customPythonPath: typeof options?.customPythonPath === 'string' && !options.customPythonPath.includes('\0')
        ? options.customPythonPath.trim()
        : null,
    };
    return ipcRenderer.invoke('system:detectPython', sanitized);
  },

  /**
   * Prompt user with native Windows file picker to locate python.exe or py.exe
   * @returns {Promise<{ canceled: boolean, path?: string, version?: string, error?: string }>}
   */
  selectPythonExecutable: () => ipcRenderer.invoke('dialog:selectPythonExecutable'),

  /**
   * Launch local Python computer vision pre-flight analysis worker (Sprint 7)
   * @param {Object} config - { inputDir: string, reportPath?: string, customPythonPath?: string, maxHamming?: number }
   * @returns {Promise<{ success: boolean, jobId?: string, reportPath?: string, error?: string }>}
   */
  startCvAnalysis: (config = {}) => {
    if (!config || typeof config !== 'object') {
      return Promise.reject(new Error('Invalid analysis configuration argument.'));
    }
    const sanitized = {
      inputDir: typeof config.inputDir === 'string' ? config.inputDir.trim() : '',
      reportPath: typeof config.reportPath === 'string' ? config.reportPath.trim() : null,
      customPythonPath: typeof config.customPythonPath === 'string' ? config.customPythonPath.trim() : null,
      maxHamming: typeof config.maxHamming === 'number' ? config.maxHamming : 8,
    };
    return ipcRenderer.invoke('cv:startAnalysis', sanitized);
  },

  /**
   * Cancel active computer vision analysis worker
   * @returns {Promise<{ canceled: boolean, message?: string }>}
   */
  cancelCvAnalysis: () => ipcRenderer.invoke('cv:cancelAnalysis'),

  /**
   * Get active computer vision analysis worker status, progress, and report
   * @returns {Promise<{ id?: string, status: string, settled?: boolean, progress?: Object, report?: Object, logs: Array }>}
   */
  getCvAnalysisStatus: () => ipcRenderer.invoke('cv:getStatus'),

  /**
   * Read structured Computer Vision JSON report from validated path
   * @param {string} reportPath - Path to generated report JSON
   * @returns {Promise<{ success: boolean, report?: Object, error?: string }>}
   */
  readCvReport: (reportPath) => {
    if (typeof reportPath !== 'string' || !reportPath.trim() || reportPath.includes('\0')) {
      return Promise.reject(new Error('Invalid report path argument'));
    }
    return ipcRenderer.invoke('cv:readReport', reportPath.trim());
  },

  /**
   * Subscribe to live computer vision analysis progress events
   * @param {Function} callback - (progressData) => void
   * @returns {Function} Unsubscribe function
   */
  onCvProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('cv:progress', subscription);
    return () => ipcRenderer.removeListener('cv:progress', subscription);
  },

  /**
   * Subscribe to live computer vision log streaming events
   * @param {Function} callback - (logEntry) => void
   * @returns {Function} Unsubscribe function
   */
  onCvLog: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, entry) => callback(entry);
    ipcRenderer.on('cv:log', subscription);
    return () => ipcRenderer.removeListener('cv:log', subscription);
  },

  /**
   * Prompt user with native Windows file picker for video file (Sprint 8)
   * @returns {Promise<{ canceled: boolean, path?: string, name?: string, sizeBytes?: number, extension?: string, error?: string }>}
   */
  selectVideoFile: () => ipcRenderer.invoke('dialog:selectVideoFile'),

  /**
   * Validate a video file path without launching file picker (Sprint 8)
   * @param {string} videoPath - Path to video file
   * @returns {Promise<{ valid: boolean, accessible: boolean, path?: string, name?: string, sizeBytes?: number, extension?: string, error?: string }>}
   */
  validateVideoFile: (videoPath) => {
    if (typeof videoPath !== 'string' || !videoPath.trim() || videoPath.includes('\0')) {
      return Promise.reject(new Error('Invalid video path argument'));
    }
    return ipcRenderer.invoke('system:validateVideoFile', videoPath.trim());
  },

  /**
   * Launch local Python video frame extraction worker (Sprint 8)
   * @param {Object} config - { videoPath: string, outputDir?: string, reportPath?: string, samplingInterval?: number, maxFrames?: number, minDimension?: number, blurThreshold?: number, maxHamming?: number, enableBlurFilter?: boolean, enableDuplicateFilter?: boolean, customPythonPath?: string }
   * @returns {Promise<{ success: boolean, jobId?: string, videoPath?: string, outputDir?: string, reportPath?: string, error?: string }>}
   */
  startVideoExtraction: (config = {}) => {
    if (!config || typeof config !== 'object') {
      return Promise.reject(new Error('Invalid extraction configuration argument.'));
    }
    const sanitized = {
      videoPath: typeof config.videoPath === 'string' ? config.videoPath.trim() : '',
      outputDir: typeof config.outputDir === 'string' ? config.outputDir.trim() : null,
      reportPath: typeof config.reportPath === 'string' ? config.reportPath.trim() : null,
      customPythonPath: typeof config.customPythonPath === 'string' ? config.customPythonPath.trim() : null,
      samplingInterval: typeof config.samplingInterval === 'number' ? config.samplingInterval : 1.0,
      maxFrames: Number.isInteger(config.maxFrames) ? config.maxFrames : null,
      minDimension: Number.isInteger(config.minDimension) ? config.minDimension : 100,
      blurThreshold: typeof config.blurThreshold === 'number' ? config.blurThreshold : 50.0,
      maxHamming: typeof config.maxHamming === 'number' ? config.maxHamming : 8,
      enableBlurFilter: config.enableBlurFilter !== false,
      enableDuplicateFilter: config.enableDuplicateFilter !== false,
    };
    return ipcRenderer.invoke('video:startExtraction', sanitized);
  },

  /**
   * Cancel active video extraction worker (Sprint 8)
   * @returns {Promise<{ canceled: boolean, message?: string }>}
   */
  cancelVideoExtraction: () => ipcRenderer.invoke('video:cancelExtraction'),

  /**
   * Get active video extraction worker status, progress, and report (Sprint 8)
   * @returns {Promise<{ id?: string, status: string, settled?: boolean, progress?: Object, report?: Object, logs: Array }>}
   */
  getVideoExtractionStatus: () => ipcRenderer.invoke('video:getStatus'),

  /**
   * Read structured Video Extraction JSON report from validated path (Sprint 8)
   * @param {string} reportPath - Path to generated report JSON
   * @returns {Promise<{ success: boolean, report?: Object, error?: string }>}
   */
  readVideoReport: (reportPath) => {
    if (typeof reportPath !== 'string' || !reportPath.trim() || reportPath.includes('\0')) {
      return Promise.reject(new Error('Invalid report path argument'));
    }
    return ipcRenderer.invoke('video:readReport', reportPath.trim());
  },

  /**
   * Subscribe to live video frame extraction progress events (Sprint 8)
   * @param {Function} callback - (progressData) => void
   * @returns {Function} Unsubscribe function
   */
  onVideoProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('video:progress', subscription);
    return () => ipcRenderer.removeListener('video:progress', subscription);
  },

  /**
   * Subscribe to live video frame extraction log streaming events (Sprint 8)
   * @param {Function} callback - (logEntry) => void
   * @returns {Function} Unsubscribe function
   */
  onVideoLog: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const subscription = (_event, entry) => callback(entry);
    ipcRenderer.on('video:log', subscription);
    return () => ipcRenderer.removeListener('video:log', subscription);
  },
});

