/**
 * Aeromorph Desktop Main Process
 * 
 * Manages the Electron application lifecycle, native Windows desktop shell,
 * and secure IPC handlers for file dialogs and model ingestion.
 */

const electron = require('electron');
const { app, BrowserWindow, dialog, ipcMain } =
  electron && typeof electron === 'object' ? electron : {};
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn, spawnSync } = require('child_process');

// Single instance lock to prevent duplicate desktop processes
if (app && typeof app.requestSingleInstanceLock === 'function') {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
  }
}

let mainWindow = null;
const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

// Bounded memory threshold for 8 GB RAM target profile (Intel integrated graphics).
// Configurable via AEROMORPH_MAX_PLY_MB environment variable; defaults to 100 MB.
// Enforces a strict upper ceiling of 1000 MB (1 GB) to prevent process crash or V8/WebGL exhaustion.
// Invalid, non-numeric, zero, negative, or excessively large values safely fall back to 100 MB.
const DEFAULT_MAX_PLY_MB = 100;
const MAX_ALLOWED_PLY_MB = 1000;

const rawEnvLimit = process.env.AEROMORPH_MAX_PLY_MB;
const parsedLimitMb = rawEnvLimit && /^\d+$/.test(rawEnvLimit.trim()) ? parseInt(rawEnvLimit.trim(), 10) : NaN;
const MAX_PLY_MB =
  Number.isInteger(parsedLimitMb) && parsedLimitMb > 0 && parsedLimitMb <= MAX_ALLOWED_PLY_MB
    ? parsedLimitMb
    : DEFAULT_MAX_PLY_MB;
const MAX_PLY_BYTES = MAX_PLY_MB * 1024 * 1024;

// Helper to produce a canonical, OS-appropriate key for authorization allowlist
const toCanonicalPath = (p) => {
  const normalized = path.normalize(path.resolve(p));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

// In-memory allowlist of paths explicitly authorized through native user dialogs
const authorizedPlyPaths = new Set();

// ------------------------------------------------------------------------------
// Sprint 6A: Environment Detection & Image Directory Validation
// ------------------------------------------------------------------------------

// Allowlisted executable names (case-insensitive check)
const ALLOWED_COLMAP_NAMES = new Set(['colmap.exe', 'colmap']);
const ALLOWED_OPENMVS_NAMES = new Set([
  'interfacecolmap.exe',
  'densifypointcloud.exe',
  'reconstructmesh.exe',
  'refinemesh.exe',
  'texturemesh.exe',
  'interfacecolmap',
  'densifypointcloud',
  'reconstructmesh',
  'refinemesh',
  'texturemesh',
]);

const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.bmp']);
const MAX_DIRECTORY_SCAN_ENTRIES = 5000;

/**
 * Validate candidate binary executable against an allowlist of approved filenames.
 * Enforces regular file check, symlink rejection, and Windows .exe extension check.
 */
function validateBinaryExecutable(candidatePath, allowedBaseNames) {
  if (typeof candidatePath !== 'string' || !candidatePath.trim() || candidatePath.includes('\0')) {
    return null;
  }
  const resolved = path.normalize(path.resolve(candidatePath.trim()));
  const ext = path.extname(resolved).toLowerCase();
  if (process.platform === 'win32' && ext !== '.exe') {
    return null;
  }
  const baseName = path.basename(resolved).toLowerCase();
  if (!allowedBaseNames.has(baseName)) {
    return null;
  }
  try {
    const lstat = fs.lstatSync(resolved);
    if (!lstat.isSymbolicLink() && lstat.isFile()) {
      return resolved;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Find exact binary name within system PATH without executing arbitrary files
 */
function findBinaryInPath(binaryName) {
  const pathEnv = process.env.PATH || '';
  const dirs = pathEnv.split(path.delimiter);
  for (const dir of dirs) {
    if (!dir || !dir.trim()) continue;
    try {
      const candidate = path.join(dir.trim(), binaryName);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {}
  }
  return null;
}

/**
 * Generate conservative list of known candidate installation paths for COLMAP
 */
function getColmapCandidates(customPath) {
  const candidates = [];
  if (customPath && typeof customPath === 'string') {
    candidates.push(customPath);
  }
  const fromPath = findBinaryInPath('colmap.exe') || findBinaryInPath('colmap');
  if (fromPath) candidates.push(fromPath);

  const home = os.homedir();
  const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  candidates.push(
    path.join(progFiles, 'COLMAP', 'bin', 'colmap.exe'),
    path.join(progFiles, 'COLMAP', 'colmap.exe'),
    path.join(progFilesX86, 'COLMAP', 'bin', 'colmap.exe'),
    'C:\\COLMAP\\bin\\colmap.exe',
    'C:\\COLMAP\\colmap.exe',
    'C:\\tools\\colmap\\bin\\colmap.exe',
    'C:\\tools\\colmap\\colmap.exe',
    path.join(home, 'Downloads', 'colmap-x64-windows-nocuda', 'bin', 'colmap.exe'),
    path.join(home, 'Downloads', 'colmap-x64-windows-cuda', 'bin', 'colmap.exe'),
    path.join(home, 'Downloads', 'COLMAP', 'bin', 'colmap.exe'),
    path.join(home, 'Downloads', 'COLMAP', 'colmap.exe'),
    path.join(home, 'scoop', 'apps', 'colmap', 'current', 'colmap.exe'),
    path.join(home, 'colmap', 'bin', 'colmap.exe'),
    'C:\\ProgramData\\chocolatey\\bin\\colmap.exe'
  );

  return candidates;
}

/**
 * Generate conservative list of known candidate installation paths for OpenMVS
 */
function getOpenMvsCandidates(customPath) {
  const candidates = [];
  if (customPath && typeof customPath === 'string') {
    candidates.push(customPath);
  }
  const fromPath = findBinaryInPath('InterfaceCOLMAP.exe') || findBinaryInPath('DensifyPointCloud.exe');
  if (fromPath) candidates.push(fromPath);

  const home = os.homedir();
  const progFiles = process.env.ProgramFiles || 'C:\\Program Files';

  candidates.push(
    path.join(progFiles, 'OpenMVS', 'bin', 'InterfaceCOLMAP.exe'),
    path.join(progFiles, 'OpenMVS', 'InterfaceCOLMAP.exe'),
    path.join(progFiles, 'openMVS', 'InterfaceCOLMAP.exe'),
    'C:\\OpenMVS\\bin\\InterfaceCOLMAP.exe',
    'C:\\OpenMVS\\InterfaceCOLMAP.exe',
    'C:\\openMVS\\InterfaceCOLMAP.exe',
    'C:\\tools\\OpenMVS\\InterfaceCOLMAP.exe',
    path.join(home, 'Downloads', 'OpenMVS_Windows_x64', 'vc17', 'x64', 'Release', 'InterfaceCOLMAP.exe'),
    path.join(home, 'Downloads', 'OpenMVS_Windows_x64', 'InterfaceCOLMAP.exe'),
    path.join(home, 'Downloads', 'OpenMVS', 'bin', 'InterfaceCOLMAP.exe'),
    path.join(home, 'Downloads', 'OpenMVS', 'InterfaceCOLMAP.exe'),
    path.join(home, 'openmvs', 'bin', 'InterfaceCOLMAP.exe')
  );

  return candidates;
}

/**
 * Query version banner from COLMAP executable with bounded timeout and no shell
 */
function queryColmapVersion(executablePath) {
  return new Promise((resolve) => {
    let resolved = false;
    const child = execFile(
      executablePath,
      ['-h'],
      { shell: false, timeout: 4000, maxBuffer: 256 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (resolved) return;
        resolved = true;

        if (err && err.code === 'ETIMEDOUT') {
          try { child.kill('SIGKILL'); } catch {}
          return resolve({
            detected: false,
            path: executablePath,
            name: path.basename(executablePath),
            version: null,
            status: 'Timeout',
            error: 'Process timed out querying version.',
          });
        }

        const output = (stdout || '') + (stderr || '');
        const match = output.match(/COLMAP\s+([\d.]+)/i);
        const version = match ? match[1] : null;

        if (err && !version && !output.trim()) {
          return resolve({
            detected: false,
            path: executablePath,
            name: path.basename(executablePath),
            version: null,
            status: 'Execution Error',
            error: `Failed to execute binary: ${err.message}`,
          });
        }

        resolve({
          detected: true,
          path: executablePath,
          name: path.basename(executablePath),
          version,
          rawBanner: output.split('\n')[0].trim() || 'COLMAP Executable',
          status: 'Ready',
          error: null,
        });
      }
    );
  });
}

/**
 * Query version banner from OpenMVS executable in isolated temp dir with bounded timeout
 */
function queryOpenMvsVersion(executablePath) {
  return new Promise((resolve) => {
    let tempDir = null;
    try {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeromorph-omvs-'));
    } catch {
      tempDir = null;
    }

    const cleanupTemp = () => {
      if (tempDir) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {}
      }
    };

    let resolved = false;
    const child = execFile(
      executablePath,
      ['-h'],
      { cwd: tempDir || os.tmpdir(), shell: false, timeout: 4000, maxBuffer: 256 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (resolved) return;
        resolved = true;

        let output = (stdout || '') + (stderr || '');
        if (tempDir) {
          try {
            const files = fs.readdirSync(tempDir);
            for (const f of files) {
              if (f.endsWith('.log')) {
                const logPath = path.join(tempDir, f);
                try {
                  const logContent = fs.readFileSync(logPath, 'utf8');
                  output += '\n' + logContent;
                } catch {}
              }
            }
          } catch {}
          cleanupTemp();
        }

        if (err && err.code === 'ETIMEDOUT') {
          try { child.kill('SIGKILL'); } catch {}
          return resolve({
            detected: false,
            path: executablePath,
            name: path.basename(executablePath),
            version: null,
            status: 'Timeout',
            error: 'Process timed out querying version.',
          });
        }

        if (err && !output.trim()) {
          return resolve({
            detected: false,
            path: executablePath,
            name: path.basename(executablePath),
            version: null,
            status: 'Execution Error',
            error: `Failed to execute binary: ${err.message}`,
          });
        }

        const match = output.match(/OpenMVS\s+.*v([\d.]+)/i) || output.match(/OpenMVS\s+.*v?([\d.]+)/i);
        const version = match ? match[1] : null;
        const bannerMatch = output.match(/OpenMVS[^\r\n]+/i);
        resolve({
          detected: true,
          path: executablePath,
          name: path.basename(executablePath),
          version,
          rawBanner: bannerMatch ? bannerMatch[0].trim() : 'OpenMVS Executable',
          status: 'Ready',
          error: null,
        });
      }
    );
  });
}

/**
 * Check for required Sprint 6B OpenMVS companion tools without launching them
 */
function inspectOpenMvsModules(executablePath) {
  if (!executablePath) return null;
  const binDir = path.dirname(executablePath);
  const toolDefinitions = {
    interfaceColmap: 'InterfaceCOLMAP.exe',
    densifyPointCloud: 'DensifyPointCloud.exe',
    reconstructMesh: 'ReconstructMesh.exe',
    refineMesh: 'RefineMesh.exe',
    textureMesh: 'TextureMesh.exe',
  };

  const modules = {};
  for (const [key, exeName] of Object.entries(toolDefinitions)) {
    const candidate = path.join(binDir, exeName);
    const valid = validateBinaryExecutable(candidate, ALLOWED_OPENMVS_NAMES);
    modules[key] = {
      name: exeName,
      available: Boolean(valid),
      path: valid || null,
    };
  }
  return modules;
}

/**
 * Perform safe detection of COLMAP
 */
async function detectColmapTool(customPath) {
  let customPathStale = false;
  if (customPath && typeof customPath === 'string' && customPath.trim()) {
    if (!validateBinaryExecutable(customPath, ALLOWED_COLMAP_NAMES)) {
      customPathStale = true;
    }
  }

  const candidates = getColmapCandidates(customPath);
  for (const candidate of candidates) {
    const valid = validateBinaryExecutable(candidate, ALLOWED_COLMAP_NAMES);
    if (valid) {
      const res = await queryColmapVersion(valid);
      if (res.detected) {
        if (customPathStale) {
          res.warning = `Configured custom path "${customPath}" is invalid or no longer exists. Fallen back to auto-detected binary.`;
        }
        return res;
      }
    }
  }
  return {
    detected: false,
    path: null,
    name: null,
    version: null,
    status: 'Not Detected',
    error: customPathStale
      ? `Configured COLMAP path "${customPath}" was not found or is invalid.`
      : 'COLMAP executable (colmap.exe) was not found in standard paths or PATH. Please configure path.',
  };
}

/**
 * Perform safe detection of OpenMVS and inspect companion tools without launching them
 */
async function detectOpenMvsTool(customPath) {
  let customPathStale = false;
  if (customPath && typeof customPath === 'string' && customPath.trim()) {
    if (!validateBinaryExecutable(customPath, ALLOWED_OPENMVS_NAMES)) {
      customPathStale = true;
    }
  }

  const candidates = getOpenMvsCandidates(customPath);
  for (const candidate of candidates) {
    const valid = validateBinaryExecutable(candidate, ALLOWED_OPENMVS_NAMES);
    if (valid) {
      const res = await queryOpenMvsVersion(valid);
      if (res.detected) {
        res.pipelineModules = inspectOpenMvsModules(valid);
        if (customPathStale) {
          res.warning = `Configured custom path "${customPath}" is invalid or no longer exists. Fallen back to auto-detected binary.`;
        }
        return res;
      }
    }
  }
  return {
    detected: false,
    path: null,
    name: null,
    version: null,
    pipelineModules: null,
    status: 'Not Detected',
    error: customPathStale
      ? `Configured OpenMVS path "${customPath}" was not found or is invalid.`
      : 'OpenMVS executable (InterfaceCOLMAP.exe) was not found in standard paths or PATH. Please configure path.',
  };
}

/**
 * Validate and count source photograph directory entries non-recursively
 */
async function validateAndCountImageDirectory(rawDirPath) {
  if (typeof rawDirPath !== 'string' || !rawDirPath.trim() || rawDirPath.includes('\0')) {
    return {
      valid: false,
      accessible: false,
      path: null,
      fileCount: 0,
      totalSizeBytes: 0,
      imageFiles: [],
      error: 'Invalid directory path argument.',
    };
  }

  const dirPath = path.normalize(path.resolve(rawDirPath.trim()));

  let lstat;
  try {
    lstat = await fs.promises.lstat(dirPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {
        valid: false,
        accessible: false,
        path: dirPath,
        fileCount: 0,
        totalSizeBytes: 0,
        imageFiles: [],
        error: 'Directory does not exist or has been moved.',
      };
    }
    return {
      valid: false,
      accessible: false,
      path: dirPath,
      fileCount: 0,
      totalSizeBytes: 0,
      imageFiles: [],
      error: `Directory access error: ${err.message}`,
    };
  }

  if (lstat.isSymbolicLink()) {
    return {
      valid: false,
      accessible: false,
      path: dirPath,
      fileCount: 0,
      totalSizeBytes: 0,
      imageFiles: [],
      error: 'Symbolic link directories are not supported for security reasons.',
    };
  }

  if (!lstat.isDirectory()) {
    return {
      valid: false,
      accessible: false,
      path: dirPath,
      fileCount: 0,
      totalSizeBytes: 0,
      imageFiles: [],
      error: 'Selected path is not a directory.',
    };
  }

  // Shallow non-recursive read of directory entries
  let entries;
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    return {
      valid: false,
      accessible: false,
      path: dirPath,
      fileCount: 0,
      totalSizeBytes: 0,
      imageFiles: [],
      error: `Failed to read directory contents: ${err.message}`,
    };
  }

  const imageFiles = [];
  let totalSizeBytes = 0;
  const scanLimit = Math.min(entries.length, MAX_DIRECTORY_SCAN_ENTRIES);

  for (let i = 0; i < scanLimit; i++) {
    const entry = entries[i];
    // Ignore subdirectories and non-files
    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
        try {
          const entryPath = path.join(dirPath, entry.name);
          const fileLstat = await fs.promises.lstat(entryPath);
          if (!fileLstat.isSymbolicLink()) {
            totalSizeBytes += fileLstat.size;
            imageFiles.push({
              name: entry.name,
              size: fileLstat.size,
            });
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  const isCapped = entries.length > MAX_DIRECTORY_SCAN_ENTRIES;
  const capWarning = isCapped
    ? `Directory entry cap (${MAX_DIRECTORY_SCAN_ENTRIES}) reached. Count reflects only the first ${MAX_DIRECTORY_SCAN_ENTRIES} entries and may be incomplete.`
    : null;

  if (imageFiles.length === 0) {
    return {
      valid: false,
      accessible: true,
      path: dirPath,
      name: path.basename(dirPath),
      fileCount: 0,
      totalSizeBytes: 0,
      imageFiles: [],
      error: 'Selected folder contains no supported photographs (.jpg, .jpeg, .png, .webp, .tif, .tiff, .bmp).',
      capped: isCapped,
      warning: capWarning,
    };
  }

  return {
    valid: true,
    accessible: true,
    path: dirPath,
    name: path.basename(dirPath),
    fileCount: imageFiles.length,
    totalSizeBytes,
    imageFiles: imageFiles.slice(0, 100),
    capped: isCapped,
    warning: capWarning,
    error: null,
  };
}

// ------------------------------------------------------------------------------
// Sprint 6B: COLMAP Sparse Reconstruction Engine (CPU-only, Cancellable)
// ------------------------------------------------------------------------------

let activeReconstructionJob = null;

function emitReconstructionProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('reconstruction:progress', payload);
    } catch {}
  }
}

function emitReconstructionLog(entry) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('reconstruction:log', entry);
    } catch {}
  }
}

function terminateProcessTree(child) {
  if (!child) return;
  const pid = child.pid;
  if (!pid) return;

  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
        windowsHide: true,
        timeout: 5000,
      });
    } catch {}
  }

  try {
    child.kill('SIGKILL');
  } catch {}
}

const RUN_MANIFEST_FILENAME = '.aeromorph_run.json';

/**
 * Check if a directory is a verified application-owned run directory.
 * Must contain .aeromorph_run.json written by Aeromorph matching the expected jobId if provided.
 */
function isApplicationOwnedRunDir(targetDir, expectedJobId = null) {
  if (!targetDir || typeof targetDir !== 'string' || targetDir.includes('\0')) {
    return false;
  }
  try {
    const resolved = path.normalize(path.resolve(targetDir));
    const markerPath = path.join(resolved, RUN_MANIFEST_FILENAME);
    if (!fs.existsSync(markerPath)) {
      return false;
    }
    const raw = fs.readFileSync(markerPath, 'utf8');
    const marker = JSON.parse(raw);
    if (!marker || marker.app !== 'Aeromorph' || !marker.appOwned) {
      return false;
    }
    if (expectedJobId && marker.jobId !== expectedJobId) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Write application ownership marker to run directory
 */
function writeRunDirectoryManifest(runDir, { jobId, workspaceDir }) {
  const markerPath = path.join(runDir, RUN_MANIFEST_FILENAME);
  const manifest = {
    app: 'Aeromorph',
    version: 1,
    jobId,
    createdAt: Date.now(),
    workspaceDir,
    runDir,
    appOwned: true,
  };
  fs.writeFileSync(markerPath, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

/**
 * Validate input image folder, project workspace folder, and allocate or validate an isolated run directory.
 * @param {string} rawImageDir - Path to input photographs directory
 * @param {string} rawOutputDir - Path to user-selected project workspace directory
 * @param {Object} [options] - Optional run configuration { runDir?: string, jobId?: string }
 */
async function validateReconstructionDirectories(rawImageDir, rawOutputDir, options = {}) {
  if (typeof rawImageDir !== 'string' || !rawImageDir.trim() || rawImageDir.includes('\0')) {
    return { valid: false, error: 'Invalid input image directory path argument.' };
  }
  if (typeof rawOutputDir !== 'string' || !rawOutputDir.trim() || rawOutputDir.includes('\0')) {
    return { valid: false, error: 'Invalid output workspace directory path argument.' };
  }

  const resolvedImageDir = path.normalize(path.resolve(rawImageDir.trim()));
  const resolvedWorkspaceDir = path.normalize(path.resolve(rawOutputDir.trim()));

  // 1. Validate input image folder non-recursively
  const imageValidation = await validateAndCountImageDirectory(resolvedImageDir);
  if (!imageValidation.valid) {
    return { valid: false, error: `Input photographs error: ${imageValidation.error}` };
  }
  if (imageValidation.fileCount < 2) {
    return { valid: false, error: 'At least 2 supported photographs are required for sparse reconstruction.' };
  }

  // 2. Reject symbolic link output workspace directory
  if (fs.existsSync(resolvedWorkspaceDir)) {
    try {
      const outStat = fs.lstatSync(resolvedWorkspaceDir);
      if (outStat.isSymbolicLink()) {
        return { valid: false, error: 'Output workspace directory cannot be a symbolic link for security reasons.' };
      }
      if (!outStat.isDirectory()) {
        return { valid: false, error: 'Output workspace path exists but is not a directory.' };
      }
    } catch (err) {
      return { valid: false, error: `Output directory error: ${err.message}` };
    }
  }

  // 3. Collision and nesting checks between imageDir and workspaceDir
  const lowerImg = resolvedImageDir.toLowerCase();
  const lowerWork = resolvedWorkspaceDir.toLowerCase();

  if (lowerImg === lowerWork) {
    return { valid: false, error: 'Output project directory must be separate from the input photographs directory.' };
  }

  const relWorkToImg = path.relative(resolvedImageDir, resolvedWorkspaceDir);
  if (!relWorkToImg.startsWith('..') && !path.isAbsolute(relWorkToImg)) {
    return { valid: false, error: 'Output workspace cannot be located inside the input photographs directory.' };
  }

  const relImgToWork = path.relative(resolvedWorkspaceDir, resolvedImageDir);
  if (!relImgToWork.startsWith('..') && !path.isAbsolute(relImgToWork)) {
    return { valid: false, error: 'Input photographs directory cannot be located inside the output workspace.' };
  }

  // 4. Ensure output workspace exists and is writeable
  try {
    fs.mkdirSync(resolvedWorkspaceDir, { recursive: true });
    const probe = path.join(resolvedWorkspaceDir, `.aeromorph_probe_${Date.now()}`);
    fs.writeFileSync(probe, 'write_test');
    fs.unlinkSync(probe);
  } catch (err) {
    return { valid: false, error: `Cannot write to output workspace directory: ${err.message}` };
  }

  // 5. Establish and isolate per-run output directory
  const runJobId = typeof options?.jobId === 'string' && options.jobId.trim()
    ? options.jobId.trim()
    : `job_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

  let resolvedRunDir = null;

  if (options && typeof options.runDir === 'string' && options.runDir.trim()) {
    // Explicit runDir specified
    resolvedRunDir = path.normalize(path.resolve(options.runDir.trim()));

    // Collision check between runDir and imageDir
    const lowerRun = resolvedRunDir.toLowerCase();
    if (lowerRun === lowerImg) {
      return { valid: false, error: 'Run directory must be separate from the input photographs directory.' };
    }
    const relRunToImg = path.relative(resolvedImageDir, resolvedRunDir);
    if (!relRunToImg.startsWith('..') && !path.isAbsolute(relRunToImg)) {
      return { valid: false, error: 'Run directory cannot be located inside the input photographs directory.' };
    }
    const relImgToRun = path.relative(resolvedRunDir, resolvedImageDir);
    if (!relImgToRun.startsWith('..') && !path.isAbsolute(relImgToRun)) {
      return { valid: false, error: 'Input photographs directory cannot be located inside the run directory.' };
    }

    if (fs.existsSync(resolvedRunDir)) {
      const runStat = fs.lstatSync(resolvedRunDir);
      if (runStat.isSymbolicLink()) {
        return { valid: false, error: 'Run directory cannot be a symbolic link for security reasons.' };
      }
      if (!runStat.isDirectory()) {
        return { valid: false, error: 'Specified run directory path exists but is not a directory.' };
      }

      // Safeguard: Never overwrite pre-existing user files. Reject non-empty run directory.
      const entries = fs.readdirSync(resolvedRunDir);
      const nonManifestEntries = entries.filter((e) => e !== RUN_MANIFEST_FILENAME);
      if (nonManifestEntries.length > 0) {
        return {
          valid: false,
          error: `Output run directory "${resolvedRunDir}" is not empty (${nonManifestEntries.length} items found). A clean or application-allocated run directory is required to prevent overwriting or deleting user files.`,
        };
      }
    } else {
      try {
        fs.mkdirSync(resolvedRunDir, { recursive: true });
      } catch (err) {
        return { valid: false, error: `Cannot create run directory: ${err.message}` };
      }
    }
  } else {
    // Automatically allocate unique application-owned run directory inside workspace 'runs' subfolder
    const runsBaseDir = path.join(resolvedWorkspaceDir, 'runs');
    try {
      fs.mkdirSync(runsBaseDir, { recursive: true });
    } catch (err) {
      return { valid: false, error: `Cannot create runs folder in workspace: ${err.message}` };
    }

    resolvedRunDir = path.join(runsBaseDir, runJobId);
    let counter = 1;
    while (fs.existsSync(resolvedRunDir)) {
      resolvedRunDir = path.join(runsBaseDir, `${runJobId}_${counter++}`);
    }

    try {
      fs.mkdirSync(resolvedRunDir, { recursive: true });
    } catch (err) {
      return { valid: false, error: `Cannot create isolated run directory: ${err.message}` };
    }
  }

  // Ensure run directory is writeable and mark as application-owned
  try {
    const probe = path.join(resolvedRunDir, `.aeromorph_run_probe_${Date.now()}`);
    fs.writeFileSync(probe, 'write_test');
    fs.unlinkSync(probe);
    writeRunDirectoryManifest(resolvedRunDir, {
      jobId: runJobId,
      workspaceDir: resolvedWorkspaceDir,
    });
  } catch (err) {
    return { valid: false, error: `Cannot initialize application-owned run directory: ${err.message}` };
  }

  return {
    valid: true,
    imageDir: resolvedImageDir,
    outputDir: resolvedWorkspaceDir,
    workspaceDir: resolvedWorkspaceDir,
    runDir: resolvedRunDir,
    imageCount: imageValidation.fileCount,
    jobId: runJobId,
  };
}

/**
 * Clean up ephemeral job artifacts upon cancellation or failure.
 * Strict ownership safety guarantees:
 * - Refuses to delete anything if targetDir is not a verified application-owned run directory.
 * - Never deletes database journal/WAL/SHM files merely because names match outside verified run dirs.
 * - Never touches user files, workspace files, or artifacts belonging to other processes.
 *
 * @param {string} targetRunDir - Directory containing the job run
 * @param {Object|string} [options] - Options or jobId string
 * @returns {{ cleaned: boolean, removed: string[], reason?: string }}
 */
function cleanupTemporaryJobArtifacts(targetRunDir, options = {}) {
  if (!targetRunDir || typeof targetRunDir !== 'string' || targetRunDir.includes('\0')) {
    return { cleaned: false, removed: [], reason: 'Invalid run directory path.' };
  }

  const resolved = path.normalize(path.resolve(targetRunDir));
  const expectedJobId = typeof options === 'string' ? options : options?.jobId || null;

  // Ownership verification check: MUST be a verified application-owned run directory
  if (!isApplicationOwnedRunDir(resolved, expectedJobId)) {
    return {
      cleaned: false,
      removed: [],
      reason: 'Directory is not a verified application-owned run directory. Cleanup skipped for safety.',
    };
  }

  // Only remove temporary SQLite rollback/WAL journal files created within this verified runDir
  const candidateNames = ['database.db-journal', 'database.db-wal', 'database.db-shm'];
  const removed = [];

  for (const name of candidateNames) {
    const filePath = path.join(resolved, name);
    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.lstatSync(filePath);
        if (!stat.isSymbolicLink() && stat.isFile()) {
          fs.unlinkSync(filePath);
          removed.push(filePath);
        }
      }
    } catch {}
  }

  return { cleaned: true, removed };
}

/**
 * Build fixed argument arrays for COLMAP sparse stages (shell: false)
 * Targets Intel i3-1220P CPU-only execution without CUDA.
 */
function buildColmapStageArgs(stage, { databasePath, imagePath, sparseOutputPath, inputModelPath, numThreads = 4 }) {
  const threadsStr = String(numThreads);
  switch (stage) {
    case 'feature_extractor':
      return [
        'feature_extractor',
        '--database_path', databasePath,
        '--image_path', imagePath,
        '--FeatureExtraction.use_gpu', '0',
        '--FeatureExtraction.num_threads', threadsStr,
      ];
    case 'exhaustive_matcher':
      return [
        'exhaustive_matcher',
        '--database_path', databasePath,
        '--FeatureMatching.use_gpu', '0',
        '--FeatureMatching.num_threads', threadsStr,
      ];
    case 'mapper':
      return [
        'mapper',
        '--database_path', databasePath,
        '--image_path', imagePath,
        '--output_path', sparseOutputPath,
        '--Mapper.ba_use_gpu', '0',
        '--Mapper.num_threads', threadsStr,
      ];
    case 'model_converter':
      return [
        'model_converter',
        '--input_path', inputModelPath || path.join(sparseOutputPath, '0'),
        '--output_path', path.join(path.dirname(sparseOutputPath), 'sparse.ply'),
        '--output_type', 'PLY',
      ];
    default:
      throw new Error(`Unknown COLMAP pipeline stage: ${stage}`);
  }
}

/**
 * Verify whether a valid sparse reconstruction model was produced
 * Inspects all numbered directories (0, 1, 2...) created by COLMAP mapper.
 */
function verifySparseReconstructionOutput(sparseDir) {
  if (!fs.existsSync(sparseDir)) {
    return { valid: false, error: 'Sparse output directory was not created by mapper.' };
  }

  let entries;
  try {
    entries = fs.readdirSync(sparseDir, { withFileTypes: true });
  } catch (err) {
    return { valid: false, error: `Failed to read sparse output directory: ${err.message}` };
  }

  const modelDirs = entries
    .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
    .map((e) => ({
      index: parseInt(e.name, 10),
      dirName: e.name,
      fullPath: path.join(sparseDir, e.name),
    }))
    .sort((a, b) => a.index - b.index);

  if (modelDirs.length === 0) {
    return {
      valid: false,
      error: 'COLMAP finished, but no sparse model (0/) was reconstructed. Check visual overlap across images.',
    };
  }

  const candidateModels = [];
  for (const m of modelDirs) {
    const pointsBin = path.join(m.fullPath, 'points3D.bin');
    const pointsTxt = path.join(m.fullPath, 'points3D.txt');
    const camerasBin = path.join(m.fullPath, 'cameras.bin');
    const camerasTxt = path.join(m.fullPath, 'cameras.txt');
    const imagesBin = path.join(m.fullPath, 'images.bin');
    const imagesTxt = path.join(m.fullPath, 'images.txt');

    const hasPoints = fs.existsSync(pointsBin) || fs.existsSync(pointsTxt);
    const hasCameras = fs.existsSync(camerasBin) || fs.existsSync(camerasTxt);
    const hasImages = fs.existsSync(imagesBin) || fs.existsSync(imagesTxt);

    if (hasPoints && hasCameras && hasImages) {
      let pointsSize = 0;
      try {
        const stat = fs.statSync(fs.existsSync(pointsBin) ? pointsBin : pointsTxt);
        pointsSize = stat.size;
      } catch {}

      if (pointsSize > 0) {
        candidateModels.push({
          modelDir: m.fullPath,
          modelName: m.dirName,
          modelIndex: m.index,
          pointsSize,
          isBinary: fs.existsSync(pointsBin),
        });
      }
    }
  }

  if (candidateModels.length === 0) {
    return { valid: false, error: 'Reconstructed sparse model contains 0 3D points.' };
  }

  // Model 0 is preferred if present and valid; otherwise pick model with largest point file
  candidateModels.sort((a, b) => {
    if (a.modelIndex === 0) return -1;
    if (b.modelIndex === 0) return 1;
    return b.pointsSize - a.pointsSize;
  });

  const bestModel = candidateModels[0];
  return {
    valid: true,
    modelDir: bestModel.modelDir,
    modelIndex: bestModel.modelIndex,
    pointsSize: bestModel.pointsSize,
    isBinary: bestModel.isBinary,
    totalModelsFound: candidateModels.length,
  };
}

/**
 * Run asynchronous sparse reconstruction sequence
 */
async function startSparseReconstructionJob(config = {}) {
  const {
    imageDir,
    outputDir,
    runDir: explicitRunDir,
    customColmapPath,
    numThreads = 4,
    spawnProcess: customSpawn,
    colmapExe: customColmapExe,
  } = config;

  const jobId = typeof config.jobId === 'string' && config.jobId.trim()
    ? config.jobId.trim()
    : `job_${Date.now()}`;

  // 1. Validate directories and establish isolated application-owned run directory
  const dirCheck = await validateReconstructionDirectories(imageDir, outputDir, {
    runDir: explicitRunDir,
    jobId,
  });
  if (!dirCheck.valid) {
    return { success: false, error: dirCheck.error };
  }

  // 2. Validate COLMAP executable
  let colmapExe = customColmapExe || null;
  let colmapVersion = null;

  if (!colmapExe) {
    if (customColmapPath && typeof customColmapPath === 'string' && customColmapPath.trim()) {
      const validCustom = validateBinaryExecutable(customColmapPath, ALLOWED_COLMAP_NAMES);
      if (!validCustom) {
        return { success: false, error: `Configured COLMAP executable "${customColmapPath}" was not found or is invalid.` };
      }
    }

    const colmapDetection = await detectColmapTool(customColmapPath);
    if (!colmapDetection.detected || !colmapDetection.path) {
      return { success: false, error: colmapDetection.error || 'COLMAP executable was not detected.' };
    }
    colmapExe = colmapDetection.path;
    colmapVersion = colmapDetection.version;
  }

  const runDir = dirCheck.runDir;
  const dbPath = path.join(runDir, 'database.db');
  const sparseDir = path.join(runDir, 'sparse');
  fs.mkdirSync(sparseDir, { recursive: true });

  const logFilePath = path.join(runDir, 'aeromorph_colmap.log');
  const spawnFn = typeof customSpawn === 'function' ? customSpawn : spawn;

  activeReconstructionJob = {
    id: jobId,
    status: 'running',
    stage: 'feature_extractor',
    stageLabel: 'Feature Extraction (SIFT)',
    stageIndex: 1,
    totalStages: 3,
    startTime: Date.now(),
    endTime: null,
    imageDir: dirCheck.imageDir,
    outputDir: dirCheck.workspaceDir,
    runDir: runDir,
    databasePath: dbPath,
    sparseDir: sparseDir,
    colmapPath: colmapExe,
    currentProcess: null,
    logs: [],
    error: null,
    modelStats: null,
    plyPath: null,
  };

  const logBuffer = activeReconstructionJob.logs;

  const appendJobLog = (stage, msg) => {
    const timeStr = new Date().toLocaleTimeString();
    const entry = { time: timeStr, stage, msg: msg.trim() };
    logBuffer.push(entry);
    if (logBuffer.length > 500) logBuffer.shift();
    emitReconstructionLog(entry);

    try {
      fs.appendFileSync(logFilePath, `[${timeStr}] [${stage.toUpperCase()}] ${msg.trim()}\n`);
    } catch {}
  };

  appendJobLog('setup', `Starting Sparse Reconstruction: ${dirCheck.imageCount} photographs`);
  appendJobLog('setup', `COLMAP: ${colmapExe} (version: ${colmapVersion || 'detected'})`);
  appendJobLog('setup', `Workspace: ${dirCheck.workspaceDir}`);
  appendJobLog('setup', `Isolated Run Directory: ${runDir}`);

  emitReconstructionProgress({
    jobId,
    status: 'running',
    stage: 'feature_extractor',
    stageLabel: 'Feature Extraction (SIFT)',
    stageIndex: 1,
    totalStages: 3,
    elapsedMs: 0,
    runDir,
  });

  // Run stages asynchronously in background
  (async () => {
    const stages = [
      { key: 'feature_extractor', label: 'Feature Extraction (SIFT)', num: '01' },
      { key: 'exhaustive_matcher', label: 'Feature Matching (Exhaustive)', num: '02' },
      { key: 'mapper', label: 'Sparse Point Cloud (Mapper)', num: '03' },
    ];

    try {
      for (let i = 0; i < stages.length; i++) {
        if (activeReconstructionJob.status === 'cancelled') {
          appendJobLog('system', 'Job was cancelled before stage execution.');
          break;
        }

        const currentStage = stages[i];
        activeReconstructionJob.stage = currentStage.key;
        activeReconstructionJob.stageLabel = currentStage.label;
        activeReconstructionJob.stageIndex = i + 1;

        emitReconstructionProgress({
          jobId,
          status: 'running',
          stage: currentStage.key,
          stageLabel: currentStage.label,
          stageIndex: i + 1,
          totalStages: 3,
          elapsedMs: Date.now() - activeReconstructionJob.startTime,
          runDir,
        });

        appendJobLog(currentStage.key, `--- Starting Stage ${currentStage.num}: ${currentStage.label} ---`);

        const args = buildColmapStageArgs(currentStage.key, {
          databasePath: dbPath,
          imagePath: dirCheck.imageDir,
          sparseOutputPath: sparseDir,
          numThreads,
        });

        await new Promise((resolve, reject) => {
          let proc;
          try {
            proc = spawnFn(colmapExe, args, {
              cwd: runDir,
              shell: false,
              windowsHide: true,
            });
          } catch (spawnErr) {
            return reject(new Error(`Failed to start ${currentStage.key}: ${spawnErr.message}`));
          }

          if (activeReconstructionJob) {
            activeReconstructionJob.currentProcess = proc;
          }

          proc.stdout?.on('data', (chunk) => {
            const lines = chunk.toString().split(/\r?\n/);
            for (const l of lines) {
              if (l.trim()) appendJobLog(currentStage.key, l);
            }
          });

          proc.stderr?.on('data', (chunk) => {
            const lines = chunk.toString().split(/\r?\n/);
            for (const l of lines) {
              if (l.trim()) appendJobLog(currentStage.key, l);
            }
          });

          proc.on('error', (err) => {
            if (activeReconstructionJob) {
              activeReconstructionJob.currentProcess = null;
            }
            reject(err);
          });

          proc.on('close', (code, signal) => {
            if (activeReconstructionJob) {
              activeReconstructionJob.currentProcess = null;
            }
            if (activeReconstructionJob && activeReconstructionJob.status === 'cancelled') {
              return resolve({ cancelled: true });
            }
            if (code === 0) {
              appendJobLog(currentStage.key, `Stage ${currentStage.num} finished successfully.`);
              return resolve({ code });
            }
            reject(new Error(`Stage ${currentStage.key} failed with exit code ${code}${signal ? ` (${signal})` : ''}`));
          });
        });
      }

      if (activeReconstructionJob && activeReconstructionJob.status === 'cancelled') {
        cleanupTemporaryJobArtifacts(runDir, { jobId });
        activeReconstructionJob.settled = true;
        appendJobLog('system', 'Sparse reconstruction was cancelled by user.');
        emitReconstructionProgress({
          jobId,
          status: 'cancelled',
          settled: true,
          stage: activeReconstructionJob.stage,
          stageLabel: activeReconstructionJob.stageLabel,
          stageIndex: activeReconstructionJob.stageIndex,
          totalStages: 3,
          elapsedMs: (activeReconstructionJob.endTime || Date.now()) - activeReconstructionJob.startTime,
          error: 'Pipeline cancelled by user.',
          runDir,
        });
        return;
      }

      // Verify sparse model output
      appendJobLog('mapper', 'Verifying sparse reconstruction model output...');
      const verifyRes = verifySparseReconstructionOutput(sparseDir);
      if (!verifyRes.valid) {
        throw new Error(verifyRes.error);
      }

      appendJobLog('mapper', `Sparse reconstruction verified: Model in ${verifyRes.modelDir} (${verifyRes.pointsSize} bytes points3D, total models: ${verifyRes.totalModelsFound || 1})`);

      // Cancellation check before model converter
      if (activeReconstructionJob.status === 'cancelled') {
        cleanupTemporaryJobArtifacts(runDir, { jobId });
        return;
      }

      // Attempt model conversion to PLY for 3D Viewport
      let plyPath = null;
      try {
        appendJobLog('export', 'Converting sparse model to PLY for 3D viewport preview...');
        const convArgs = buildColmapStageArgs('model_converter', {
          databasePath: dbPath,
          imagePath: dirCheck.imageDir,
          sparseOutputPath: sparseDir,
          inputModelPath: verifyRes.modelDir,
        });

        await new Promise((resolve) => {
          if (activeReconstructionJob && activeReconstructionJob.status === 'cancelled') {
            return resolve(false);
          }
          let convProc;
          try {
            convProc = spawnFn(colmapExe, convArgs, {
              cwd: runDir,
              shell: false,
              windowsHide: true,
            });
            if (activeReconstructionJob) {
              activeReconstructionJob.currentProcess = convProc;
            }
          } catch {
            return resolve(false);
          }

          convProc.stdout?.on('data', (chunk) => {
            const lines = chunk.toString().split(/\r?\n/);
            for (const l of lines) {
              if (l.trim()) appendJobLog('export', l);
            }
          });

          convProc.stderr?.on('data', (chunk) => {
            const lines = chunk.toString().split(/\r?\n/);
            for (const l of lines) {
              if (l.trim()) appendJobLog('export', l);
            }
          });

          convProc.on('close', (c) => {
            if (activeReconstructionJob) {
              activeReconstructionJob.currentProcess = null;
            }
            resolve(c === 0 && (!activeReconstructionJob || activeReconstructionJob.status !== 'cancelled'));
          });
          convProc.on('error', () => {
            if (activeReconstructionJob) {
              activeReconstructionJob.currentProcess = null;
            }
            resolve(false);
          });
        });

        if (activeReconstructionJob && activeReconstructionJob.status === 'cancelled') {
          cleanupTemporaryJobArtifacts(runDir, { jobId });
          activeReconstructionJob.settled = true;
          return;
        }

        const expectedPly = path.join(runDir, 'sparse.ply');
        if (fs.existsSync(expectedPly) && fs.statSync(expectedPly).size > 0) {
          plyPath = path.normalize(path.resolve(expectedPly));
          authorizedPlyPaths.add(toCanonicalPath(plyPath));
          appendJobLog('export', `Exported sparse point cloud to PLY: ${plyPath}`);
        }
      } catch (convErr) {
        appendJobLog('export', `Note: PLY conversion skipped: ${convErr.message}`);
      }

      if (activeReconstructionJob && activeReconstructionJob.status === 'cancelled') {
        cleanupTemporaryJobArtifacts(runDir, { jobId });
        activeReconstructionJob.settled = true;
        return;
      }

      if (activeReconstructionJob) {
        activeReconstructionJob.status = 'completed';
        activeReconstructionJob.settled = true;
        activeReconstructionJob.endTime = Date.now();
        activeReconstructionJob.plyPath = plyPath;
        activeReconstructionJob.modelStats = {
          modelDir: verifyRes.modelDir,
          pointsSize: verifyRes.pointsSize,
          plyPath,
        };
      }

      appendJobLog('system', '✓ Sparse Reconstruction Pipeline completed successfully!');

      emitReconstructionProgress({
        jobId,
        status: 'completed',
        settled: true,
        stage: 'mapper',
        stageLabel: 'Completed',
        stageIndex: 3,
        totalStages: 3,
        elapsedMs: activeReconstructionJob ? activeReconstructionJob.endTime - activeReconstructionJob.startTime : 0,
        modelStats: activeReconstructionJob ? activeReconstructionJob.modelStats : null,
        plyPath,
        runDir,
      });
    } catch (err) {
      cleanupTemporaryJobArtifacts(runDir, { jobId });
      if (activeReconstructionJob && activeReconstructionJob.status !== 'cancelled') {
        activeReconstructionJob.status = 'failed';
        activeReconstructionJob.settled = true;
        activeReconstructionJob.endTime = Date.now();
        activeReconstructionJob.currentProcess = null;
        activeReconstructionJob.error = err.message;
        appendJobLog('error', `Pipeline Failure: ${err.message}`);

        emitReconstructionProgress({
          jobId,
          status: 'failed',
          settled: true,
          stage: activeReconstructionJob.stage,
          stageLabel: activeReconstructionJob.stageLabel,
          stageIndex: activeReconstructionJob.stageIndex,
          totalStages: 3,
          elapsedMs: activeReconstructionJob.endTime - activeReconstructionJob.startTime,
          error: err.message,
          runDir,
        });
      }
    }
  })();

  return {
    success: true,
    jobId,
    imageDir: dirCheck.imageDir,
    outputDir: dirCheck.workspaceDir,
    runDir: dirCheck.runDir,
  };
}

/**
 * Create the primary desktop application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 980,
    minHeight: 660,
    title: 'Aeromorph — 3D Reconstruction Studio',
    backgroundColor: '#0C0E10',
    show: false, // Show once ready-to-show to prevent visual flash
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Reveal window smoothly when content is drawn
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Deny permission requests (no camera, microphone, or geolocation needed)
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(false);
  });

  // Prevent navigation to unapproved external URLs
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  const isApprovedUrl = (urlStr) => {
    try {
      const parsed = new URL(urlStr);
      if (isDev) {
        return parsed.origin === 'http://localhost:3000';
      }
      return parsed.protocol === 'file:';
    } catch {
      return false;
    }
  };

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isApprovedUrl(navigationUrl)) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on('will-redirect', (event, navigationUrl) => {
    if (!isApprovedUrl(navigationUrl)) {
      event.preventDefault();
    }
  });

  // Load appropriate target based on environment
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    const prodIndex = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
    mainWindow.loadFile(prodIndex);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Global WebContents hardening
if (app && typeof app.on === 'function') {
  app.on('web-contents-created', (event, contents) => {
    contents.on('will-attach-webview', (webviewEvent) => {
      webviewEvent.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}

/**
 * Cancel active reconstruction job helper
 */
async function cancelSparseReconstructionJob() {
  if (!activeReconstructionJob || activeReconstructionJob.status !== 'running') {
    return { canceled: false, message: 'No active reconstruction job to cancel.' };
  }

  activeReconstructionJob.status = 'cancelled';
  activeReconstructionJob.endTime = Date.now();
  if (activeReconstructionJob.currentProcess) {
    terminateProcessTree(activeReconstructionJob.currentProcess);
  }

  return { canceled: true };
}

/**
 * Get active reconstruction job status snapshot
 */
function getReconstructionStatusJob() {
  if (!activeReconstructionJob) {
    return { status: 'idle', settled: true, stage: null, logs: [] };
  }

  return {
    id: activeReconstructionJob.id,
    status: activeReconstructionJob.status,
    settled: Boolean(activeReconstructionJob.settled),
    stage: activeReconstructionJob.stage,
    stageLabel: activeReconstructionJob.stageLabel,
    stageIndex: activeReconstructionJob.stageIndex,
    totalStages: activeReconstructionJob.totalStages,
    startTime: activeReconstructionJob.startTime,
    endTime: activeReconstructionJob.endTime,
    elapsedMs: activeReconstructionJob.endTime
      ? activeReconstructionJob.endTime - activeReconstructionJob.startTime
      : Date.now() - activeReconstructionJob.startTime,
    imageDir: activeReconstructionJob.imageDir,
    outputDir: activeReconstructionJob.outputDir,
    runDir: activeReconstructionJob.runDir,
    error: activeReconstructionJob.error,
    modelStats: activeReconstructionJob.modelStats,
    plyPath: activeReconstructionJob.plyPath,
    logs: activeReconstructionJob.logs.slice(-150),
  };
}

// ------------------------------------------------------------------------------
// Secure IPC Handlers
// ------------------------------------------------------------------------------

if (ipcMain && typeof ipcMain.handle === 'function') {
  /**
   * 1. Platform Info Handler
   */
  ipcMain.handle('desktop:getPlatformInfo', async () => {
  return {
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
  };
});

/**
 * 2. Native Folder Picker for Source Photographs
 */
ipcMain.handle('dialog:selectImageDirectory', async () => {
  if (!mainWindow) return { canceled: true };

  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Source Photographs Directory',
      properties: ['openDirectory', 'dontAddToRecent'],
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const validation = await validateAndCountImageDirectory(result.filePaths[0]);
    if (!validation.accessible) {
      return { canceled: true, error: validation.error };
    }

    return {
      canceled: false,
      ...validation,
    };
  } catch (err) {
    console.error('Aeromorph Desktop: Error selecting directory:', err);
    return { canceled: true, error: err.message };
  }
});

/**
 * 2b. Direct Source Directory Validation without Native Dialog
 */
ipcMain.handle('system:validateImageDirectory', async (event, directoryPath) => {
  return await validateAndCountImageDirectory(directoryPath);
});

/**
 * 3. Native File Picker for Reconstructed PLY Model
 * Reads the user-selected file directly and registers path in the authorized allowlist.
 */
ipcMain.handle('dialog:selectPlyFile', async () => {
  if (!mainWindow) return { canceled: true };

  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Reconstructed 3D PLY Model',
      properties: ['openFile', 'dontAddToRecent'],
      filters: [
        { name: 'Polygon File Format (*.ply)', extensions: ['ply'] },
      ],
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const rawPath = result.filePaths[0];
    if (typeof rawPath !== 'string' || rawPath.includes('\0')) {
      return { canceled: true, error: 'Invalid file path.' };
    }

    const filePath = path.normalize(path.resolve(rawPath));
    if (path.extname(filePath).toLowerCase() !== '.ply') {
      return { canceled: true, error: 'Selected file is not a .ply mesh.' };
    }

    const lstat = await fs.promises.lstat(filePath);
    if (lstat.isSymbolicLink()) {
      return { canceled: true, error: 'Symbolic links are not supported for security reasons.' };
    }
    if (!lstat.isFile()) {
      return { canceled: true, error: 'Selected path is not a regular file.' };
    }

    if (lstat.size > MAX_PLY_BYTES) {
      return {
        canceled: true,
        error: `PLY file exceeds safe memory threshold of ${MAX_PLY_MB} MB for this hardware profile (Selected file: ${(lstat.size / (1024 * 1024)).toFixed(1)} MB). To proceed, please decimate the mesh in CloudCompare or MeshLab to under ${MAX_PLY_MB} MB before importing, or set AEROMORPH_MAX_PLY_MB to override (up to ${MAX_ALLOWED_PLY_MB} MB).`,
      };
    }

    // Read buffer directly in main process upon user dialog selection
    const buffer = await fs.promises.readFile(filePath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    // Register path in authorized allowlist using canonical OS path key
    authorizedPlyPaths.add(toCanonicalPath(filePath));

    return {
      canceled: false,
      path: filePath,
      name: path.basename(filePath),
      sizeBytes: lstat.size,
      lastModified: lstat.mtimeMs,
      buffer: arrayBuffer,
    };
  } catch (err) {
    console.error('Aeromorph Desktop: Error selecting PLY file:', err);
    return { canceled: true, error: err.message };
  }
});

/**
 * 4. Read PLY Binary Buffer
 * Restricted: Only permits reading paths explicitly authorized through native dialogs.
 * Enforces extension check, regular file check, symlink rejection, and configurable memory limit.
 */
ipcMain.handle('file:readPlyBuffer', async (event, filePath) => {
  try {
    if (typeof filePath !== 'string' || !filePath.trim() || filePath.includes('\0')) {
      return { success: false, error: 'Path must be a valid non-empty string.' };
    }

    const resolvedPath = path.normalize(path.resolve(filePath.trim()));
    const canonicalKey = toCanonicalPath(resolvedPath);

    // CRITICAL SECURITY CHECK: Reject arbitrary unselected filesystem paths
    if (!authorizedPlyPaths.has(canonicalKey)) {
      return {
        success: false,
        error: 'Access denied: File was not authorized through the native dialog. Please select the file via the file dialog.',
      };
    }

    if (path.extname(resolvedPath).toLowerCase() !== '.ply') {
      return { success: false, error: 'Path must point to a valid .ply file.' };
    }

    const lstat = await fs.promises.lstat(resolvedPath);
    if (lstat.isSymbolicLink()) {
      return { success: false, error: 'Symbolic links are not allowed for security reasons.' };
    }
    if (!lstat.isFile()) {
      return { success: false, error: 'Path is not a regular file.' };
    }

    if (lstat.size > MAX_PLY_BYTES) {
      return {
        success: false,
        error: `PLY file exceeds safe memory threshold of ${MAX_PLY_MB} MB (File size: ${(lstat.size / (1024 * 1024)).toFixed(1)} MB). Please decimate the mesh in CloudCompare or MeshLab before importing, or set AEROMORPH_MAX_PLY_MB to override (up to ${MAX_ALLOWED_PLY_MB} MB).`,
      };
    }

    const buffer = await fs.promises.readFile(resolvedPath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    return {
      success: true,
      buffer: arrayBuffer,
      sizeBytes: lstat.size,
      name: path.basename(resolvedPath),
    };
  } catch (err) {
    console.error('Aeromorph Desktop: Error reading PLY buffer:', err);
    return { success: false, error: err.message };
  }
});

/**
 * 5. Read-only detection of user-configured COLMAP and OpenMVS executables
 * Validates existence without invoking binary or scanning arbitrary disks.
 */
ipcMain.handle('system:checkExecutablePaths', async (event, { colmapPath, openmvsPath } = {}) => {
  const result = {
    colmap: { exists: false, path: null },
    openmvs: { exists: false, path: null },
  };

  const validateBinaryPath = (p) => {
    if (typeof p !== 'string' || !p.trim() || p.includes('\0')) return null;
    const resolved = path.normalize(path.resolve(p.trim()));
    try {
      const lstat = fs.lstatSync(resolved);
      if (!lstat.isSymbolicLink() && lstat.isFile()) {
        return resolved;
      }
    } catch {
      // Ignored
    }
    return null;
  };

  if (colmapPath) {
    const valid = validateBinaryPath(colmapPath);
    if (valid) result.colmap = { exists: true, path: valid };
  }

  if (openmvsPath) {
    const valid = validateBinaryPath(openmvsPath);
    if (valid) result.openmvs = { exists: true, path: valid };
  }

  return result;
});

/**
 * 6. Sprint 6A: Full Environment & Toolchain Detection
 * Queries version information using bounded read-only subprocess invocations.
 */
ipcMain.handle('system:detectEnvironment', async (event, { customColmapPath, customOpenmvsPath } = {}) => {
  const colmap = await detectColmapTool(customColmapPath);
  const openmvs = await detectOpenMvsTool(customOpenmvsPath);

  return {
    colmap,
    openmvs,
    environmentReady: Boolean(colmap.detected && openmvs.detected),
  };
});

/**
 * 7. Native File Picker for user-configured COLMAP executable
 */
ipcMain.handle('dialog:selectColmapExecutable', async () => {
  if (!mainWindow) return { canceled: true };
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select COLMAP Executable (colmap.exe)',
      properties: ['openFile', 'dontAddToRecent'],
      filters: [
        { name: 'COLMAP Executable (colmap.exe)', extensions: ['exe'] },
        { name: 'All Executables (*.exe)', extensions: ['exe'] },
      ],
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const selected = result.filePaths[0];
    const valid = validateBinaryExecutable(selected, ALLOWED_COLMAP_NAMES);
    if (!valid) {
      return {
        canceled: true,
        error: 'Selected file is not an allowed COLMAP executable (expected colmap.exe).',
      };
    }

    const queryResult = await queryColmapVersion(valid);
    return {
      canceled: false,
      ...queryResult,
    };
  } catch (err) {
    console.error('Aeromorph Desktop: Error selecting COLMAP executable:', err);
    return { canceled: true, error: err.message };
  }
});

/**
 * 8. Native File Picker for user-configured OpenMVS executable
 */
ipcMain.handle('dialog:selectOpenMvsExecutable', async () => {
  if (!mainWindow) return { canceled: true };
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select OpenMVS Executable (InterfaceCOLMAP.exe or DensifyPointCloud.exe)',
      properties: ['openFile', 'dontAddToRecent'],
      filters: [
        { name: 'OpenMVS Executable (*.exe)', extensions: ['exe'] },
      ],
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const selected = result.filePaths[0];
    const valid = validateBinaryExecutable(selected, ALLOWED_OPENMVS_NAMES);
    if (!valid) {
      return {
        canceled: true,
        error: 'Selected file is not an allowed OpenMVS executable (expected InterfaceCOLMAP.exe or DensifyPointCloud.exe).',
      };
    }

    const queryResult = await queryOpenMvsVersion(valid);
    if (queryResult.detected) {
      queryResult.pipelineModules = inspectOpenMvsModules(valid);
    }
    return {
      canceled: false,
      ...queryResult,
    };
  } catch (err) {
    console.error('Aeromorph Desktop: Error selecting OpenMVS executable:', err);
    return { canceled: true, error: err.message };
  }
});

/**
 * 9. Sprint 6B: Select Workspace Output Directory
 */
ipcMain.handle('dialog:selectWorkspaceDirectory', async () => {
  if (!mainWindow) return { canceled: true };
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Project Output Workspace Directory',
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const selected = path.normalize(path.resolve(result.filePaths[0]));
    return {
      canceled: false,
      path: selected,
      name: path.basename(selected),
    };
  } catch (err) {
    console.error('Aeromorph Desktop: Error selecting workspace directory:', err);
    return { canceled: true, error: err.message };
  }
});

  /**
   * 10. Sprint 6B: Start Sparse Reconstruction Pipeline
   */
  ipcMain.handle('reconstruction:start', async (event, config = {}) => {
    if (activeReconstructionJob && activeReconstructionJob.status === 'running') {
      return {
        success: false,
        error: 'A reconstruction job is already in progress. Wait for it to finish or cancel it first.',
      };
    }

    const sanitized = {
      imageDir: typeof config.imageDir === 'string' ? config.imageDir.trim() : '',
      outputDir: typeof config.outputDir === 'string' ? config.outputDir.trim() : '',
      runDir: typeof config.runDir === 'string' ? config.runDir.trim() : null,
      customColmapPath: typeof config.customColmapPath === 'string' ? config.customColmapPath.trim() : null,
      numThreads: Number.isInteger(config.numThreads) && config.numThreads >= 1 && config.numThreads <= 8 ? config.numThreads : 4,
    };

    return await startSparseReconstructionJob(sanitized);
  });

  /**
   * 11. Sprint 6B: Cancel Active Reconstruction Pipeline
   */
  ipcMain.handle('reconstruction:cancel', async () => {
    return await cancelSparseReconstructionJob();
  });

  /**
   * 12. Sprint 6B: Get Reconstruction Job Status
   */
  ipcMain.handle('reconstruction:getStatus', async () => {
    return getReconstructionStatusJob();
  });
}

// ------------------------------------------------------------------------------
// App Lifecycle
// ------------------------------------------------------------------------------

if (app && typeof app.whenReady === 'function') {
  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow && BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

module.exports = {
  validateBinaryExecutable,
  validateAndCountImageDirectory,
  validateReconstructionDirectories,
  buildColmapStageArgs,
  verifySparseReconstructionOutput,
  startSparseReconstructionJob,
  cancelSparseReconstructionJob,
  getReconstructionStatusJob,
  terminateProcessTree,
  cleanupTemporaryJobArtifacts,
  isApplicationOwnedRunDir,
  detectColmapTool,
  detectOpenMvsTool,
  inspectOpenMvsModules,
  toCanonicalPath,
  authorizedPlyPaths,
  RUN_MANIFEST_FILENAME,
  _resetActiveReconstructionJobForTest: () => {
    activeReconstructionJob = null;
  },
};
