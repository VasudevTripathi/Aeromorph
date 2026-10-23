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

const ALLOWED_PYTHON_NAMES = new Set([
  'python.exe',
  'python3.exe',
  'py.exe',
  'python',
  'python3',
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
 * Generate conservative list of candidate installation paths for Python
 */
function getPythonCandidates(customPath) {
  const candidates = [];
  if (customPath && typeof customPath === 'string') {
    candidates.push(customPath);
  }

  const fromPython = findBinaryInPath('python.exe') || findBinaryInPath('python');
  const fromPy = findBinaryInPath('py.exe') || findBinaryInPath('py');
  const fromPython3 = findBinaryInPath('python3.exe') || findBinaryInPath('python3');
  if (fromPython) candidates.push(fromPython);
  if (fromPy) candidates.push(fromPy);
  if (fromPython3) candidates.push(fromPython3);

  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const windir = process.env.WINDIR || 'C:\\Windows';

  const pythonVersions = ['Python312', 'Python311', 'Python310', 'Python313', 'Python314', 'Python39'];

  for (const ver of pythonVersions) {
    candidates.push(path.join(localAppData, 'Programs', 'Python', ver, 'python.exe'));
    candidates.push(`C:\\${ver}\\python.exe`);
    candidates.push(path.join(progFiles, ver, 'python.exe'));
  }

  candidates.push(path.join(windir, 'py.exe'));
  candidates.push(path.join(localAppData, 'Programs', 'Python', 'Launcher', 'py.exe'));

  return candidates;
}

/**
 * Query Python version banner and installed dependencies via safe bounded execution (shell: false)
 */
function queryPythonInfo(executablePath, { args = null } = {}) {
  return new Promise((resolve) => {
    let resolved = false;
    const probeScript = 'import sys, json; deps = {"numpy": False, "pillow": False, "opencv": False};\n' +
      'try:\n  import numpy; deps["numpy"] = str(numpy.__version__)\nexcept: pass\n' +
      'try:\n  import PIL; deps["pillow"] = str(PIL.__version__)\nexcept: pass\n' +
      'try:\n  import cv2; deps["opencv"] = str(cv2.__version__)\nexcept: pass\n' +
      'print(json.dumps({"version": sys.version.split()[0], "major": sys.version_info[0], "minor": sys.version_info[1], "dependencies": deps}))';

    const execArgs = Array.isArray(args) ? [...args, '-c', probeScript] : ['-c', probeScript];

    const child = execFile(
      executablePath,
      execArgs,
      { shell: false, timeout: 5000, maxBuffer: 128 * 1024, windowsHide: true },
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
            error: 'Process timed out querying Python interpreter.',
            dependencies: { numpy: false, pillow: false, opencv: false },
            environmentReady: false,
          });
        }

        const output = (stdout || '').trim();
        try {
          const parsed = JSON.parse(output);
          const hasNumpy = Boolean(parsed.dependencies?.numpy);
          const hasPillow = Boolean(parsed.dependencies?.pillow);
          const hasCv = Boolean(parsed.dependencies?.opencv);
          return resolve({
            detected: true,
            path: executablePath,
            name: path.basename(executablePath),
            version: parsed.version,
            major: parsed.major,
            minor: parsed.minor,
            dependencies: parsed.dependencies || {},
            hasNumpy,
            hasPillow,
            hasCv,
            environmentReady: parsed.major >= 3 && parsed.minor >= 8,
            status: 'Ready',
            error: null,
          });
        } catch {
          if (err) {
            return resolve({
              detected: false,
              path: executablePath,
              name: path.basename(executablePath),
              version: null,
              status: 'Execution Error',
              error: `Failed to execute python: ${err.message}`,
              dependencies: { numpy: false, pillow: false, opencv: false },
              environmentReady: false,
            });
          }
          return resolve({
            detected: false,
            path: executablePath,
            name: path.basename(executablePath),
            version: null,
            status: 'Parse Error',
            error: 'Unexpected output from Python probe.',
            dependencies: { numpy: false, pillow: false, opencv: false },
            environmentReady: false,
          });
        }
      }
    );
  });
}

/**
 * Perform safe detection of Python toolchain and select the best candidate interpreter
 */
async function detectPythonTool(customPath) {
  let customPathStale = false;
  if (customPath && typeof customPath === 'string' && customPath.trim()) {
    if (!validateBinaryExecutable(customPath, ALLOWED_PYTHON_NAMES)) {
      customPathStale = true;
    }
  }

  const candidatePaths = getPythonCandidates(customPath);
  const evaluated = [];
  const visitedPaths = new Set();

  for (const candidate of candidatePaths) {
    const valid = validateBinaryExecutable(candidate, ALLOWED_PYTHON_NAMES);
    if (!valid) continue;
    const norm = toCanonicalPath(valid);
    if (visitedPaths.has(norm)) continue;
    visitedPaths.add(norm);

    const info = await queryPythonInfo(valid);
    if (info.detected && info.environmentReady) {
      let score = 10;
      if (info.hasNumpy) score += 20;
      if (info.hasPillow) score += 10;
      if (info.hasCv) score += 10;
      if (info.name.toLowerCase() !== 'py.exe') score += 5;
      if (info.major === 3 && (info.minor === 10 || info.minor === 11 || info.minor === 12)) score += 5;

      evaluated.push({ ...info, score, isCustom: customPath && norm === toCanonicalPath(customPath) });
    }
  }

  if (customPath && !customPathStale) {
    const customMatch = evaluated.find((e) => e.isCustom);
    if (customMatch) {
      return customMatch;
    }
  }

  if (evaluated.length > 0) {
    evaluated.sort((a, b) => b.score - a.score);
    const best = evaluated[0];
    if (customPathStale) {
      best.warning = `Configured custom Python path "${customPath}" is invalid or no longer exists. Fallen back to auto-detected binary.`;
    }
    return best;
  }

  return {
    detected: false,
    path: null,
    name: null,
    version: null,
    dependencies: { numpy: false, pillow: false, opencv: false },
    environmentReady: false,
    status: 'Not Detected',
    error: customPathStale
      ? `Configured Python path "${customPath}" was not found or is invalid.`
      : 'Python 3 interpreter was not found in standard paths or PATH. Please configure path.',
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
 * Parse COLMAP points3D binary file.
 * Format:
 * uint64 num_points
 * for each point:
 *   uint64 point3D_id
 *   double x, y, z
 *   uint8 r, g, b
 *   double error
 *   uint64 track_len
 *   (uint32 image_id, uint32 point2D_idx) * track_len
 */
function parseColmapPoints3dBin(filePath, { maxPointsToCheck = 2000 } = {}) {
  const stat = fs.statSync(filePath);
  if (stat.size < 8) {
    return { valid: false, pointsCount: 0, error: 'points3D.bin is truncated (less than 8 bytes).' };
  }
  const fd = fs.openSync(filePath, 'r');
  try {
    const headerBuf = Buffer.alloc(8);
    fs.readSync(fd, headerBuf, 0, 8, 0);
    const numPointsBig = headerBuf.readBigUInt64LE(0);
    if (numPointsBig > BigInt(Number.MAX_SAFE_INTEGER)) {
      return { valid: false, pointsCount: 0, error: 'points3D count exceeds safe integer limit.' };
    }
    const numPoints = Number(numPointsBig);
    if (numPoints === 0) {
      return { valid: false, pointsCount: 0, error: 'points3D.bin contains 0 points.' };
    }

    // Inspect first N points for coordinate validity
    const checkCount = Math.min(numPoints, maxPointsToCheck);
    let offset = 8;
    for (let i = 0; i < checkCount; i++) {
      // Fixed 51 bytes: 8 (id) + 24 (x,y,z) + 3 (rgb) + 8 (err) + 8 (track_len)
      if (offset + 51 > stat.size) {
        return { valid: false, pointsCount: numPoints, error: `points3D.bin truncated at point record ${i}.` };
      }
      const recordHeader = Buffer.alloc(51);
      const bytesRead = fs.readSync(fd, recordHeader, 0, 51, offset);
      if (bytesRead < 51) {
        return { valid: false, pointsCount: numPoints, error: `points3D.bin truncated during record read ${i}.` };
      }
      const x = recordHeader.readDoubleLE(8);
      const y = recordHeader.readDoubleLE(16);
      const z = recordHeader.readDoubleLE(24);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return { valid: false, pointsCount: numPoints, error: `points3D.bin contains non-finite coordinates at point ${i}.` };
      }
      const trackLenBig = recordHeader.readBigUInt64LE(43);
      const trackBytes = Number(trackLenBig) * 8;
      offset += 51 + trackBytes;
      if (offset > stat.size && i < numPoints - 1) {
        return { valid: false, pointsCount: numPoints, error: `points3D.bin track length extends beyond file bounds at point ${i}.` };
      }
    }

    return { valid: true, pointsCount: numPoints, error: null };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Parse COLMAP points3D text file.
 */
function parseColmapPoints3dTxt(filePath, { maxPointsToCheck = 2000 } = {}) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  let count = 0;
  let nonFiniteFound = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    count++;
    if (count <= maxPointsToCheck) {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 4) {
        const x = parseFloat(parts[1]);
        const y = parseFloat(parts[2]);
        const z = parseFloat(parts[3]);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          nonFiniteFound = true;
        }
      }
    }
  }

  if (count === 0) {
    return { valid: false, pointsCount: 0, error: 'points3D.txt contains 0 points.' };
  }
  if (nonFiniteFound) {
    return { valid: false, pointsCount: count, error: 'points3D.txt contains non-finite coordinates.' };
  }
  return { valid: true, pointsCount: count, error: null };
}

/**
 * Parse COLMAP images binary file.
 * uint64 num_reg_images
 */
function parseColmapImagesBin(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size < 8) {
    return { valid: false, registeredImages: 0, error: 'images.bin is truncated (less than 8 bytes).' };
  }
  const fd = fs.openSync(filePath, 'r');
  try {
    const headerBuf = Buffer.alloc(8);
    fs.readSync(fd, headerBuf, 0, 8, 0);
    const numImagesBig = headerBuf.readBigUInt64LE(0);
    const numImages = Number(numImagesBig);
    return {
      valid: numImages >= 2,
      registeredImages: numImages,
      error: numImages < 2 ? `Only ${numImages} image(s) registered (minimum 2 required for 3D triangulation).` : null,
    };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Parse COLMAP images text file.
 */
function parseColmapImagesTxt(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  let imageCount = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 10 && !isNaN(parseInt(parts[0], 10)) && !isNaN(parseFloat(parts[1]))) {
      imageCount++;
    }
  }
  return {
    valid: imageCount >= 2,
    registeredImages: imageCount,
    error: imageCount < 2 ? `Only ${imageCount} image(s) registered (minimum 2 required).` : null,
  };
}

/**
 * Parse COLMAP cameras binary file.
 */
function parseColmapCamerasBin(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size < 8) return { camerasCount: 0 };
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    return { camerasCount: Number(buf.readBigUInt64LE(0)) };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Parse COLMAP cameras text file.
 */
function parseColmapCamerasTxt(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  let count = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) count++;
  }
  return { camerasCount: count };
}

/**
 * Validate an exported PLY file.
 * Inspects header without loading entire multi-megabyte payload into memory.
 */
function validateExportedPly(plyPath) {
  if (!fs.existsSync(plyPath)) {
    return { valid: false, error: 'Exported PLY file does not exist.' };
  }
  const stat = fs.statSync(plyPath);
  if (stat.size < 30) {
    return { valid: false, error: 'Exported PLY file is empty or corrupted.' };
  }

  const readSize = Math.min(stat.size, 8192);
  const fd = fs.openSync(plyPath, 'r');
  let headerText = '';
  try {
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, 0);
    headerText = buf.toString('latin1');
  } finally {
    fs.closeSync(fd);
  }

  const endHeaderIdx = headerText.indexOf('end_header');
  if (!headerText.startsWith('ply') || endHeaderIdx === -1) {
    return { valid: false, error: 'File is not a valid PLY file (missing PLY header).' };
  }

  const header = headerText.slice(0, endHeaderIdx);
  const vertexMatch = header.match(/element\s+vertex\s+(\d+)/);
  if (!vertexMatch) {
    return { valid: false, error: 'PLY header contains no vertex element declaration.' };
  }
  const vertexCount = parseInt(vertexMatch[1], 10);
  if (vertexCount <= 0) {
    return { valid: false, error: 'Exported PLY contains 0 vertices. Reconstruction produced an empty model.' };
  }

  const faceMatch = header.match(/element\s+face\s+(\d+)/);
  const faceCount = faceMatch ? parseInt(faceMatch[1], 10) : 0;
  const isMesh = faceCount > 0;

  return {
    valid: true,
    vertexCount,
    faceCount,
    isMesh,
    isPointCloud: !isMesh,
    fileSizeBytes: stat.size,
    error: null,
  };
}

/**
 * Distinguish a valid model from quality issues.
 */
function evaluateModelQuality(pointsCount, registeredImages, totalInputImages) {
  const coverageRatio = totalInputImages > 0 ? registeredImages / totalInputImages : 1.0;
  let status = 'good';
  let warning = null;

  if (registeredImages < 2 || pointsCount <= 0) {
    return { status: 'failed', warning: 'Reconstruction failed: insufficient registered images or points.' };
  }

  if (coverageRatio < 0.5 || pointsCount < 50) {
    status = 'warning';
    warning = `Low coverage reconstruction: ${registeredImages} of ${totalInputImages} photographs registered (${pointsCount} 3D points). Visual overlap may be low.`;
  } else if (coverageRatio < 0.8 || pointsCount < 200) {
    status = 'acceptable';
    warning = `Partial reconstruction: ${registeredImages} of ${totalInputImages} photographs registered (${pointsCount} 3D points).`;
  }

  return { status, warning, coverageRatio };
}

/**
 * Verify whether a valid sparse reconstruction model was produced
 * Inspects all numbered directories (0, 1, 2...) created by COLMAP mapper.
 * Validates actual binary or text files for points and registered images.
 */
function verifySparseReconstructionOutput(sparseDir, totalInputImages = 0) {
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
      error: 'Reconstruction failed: COLMAP did not reconstruct any sparse model (0/). Check image overlap and visual feature contrast.',
    };
  }

  const candidateModels = [];
  const modelErrors = [];

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

    if (!hasPoints || !hasCameras || !hasImages) {
      modelErrors.push(`Model ${m.dirName}: missing one or more required COLMAP model files (points3D, cameras, images).`);
      continue;
    }

    // Parse points3D
    let pointsResult;
    try {
      if (fs.existsSync(pointsBin)) {
        pointsResult = parseColmapPoints3dBin(pointsBin);
      } else {
        pointsResult = parseColmapPoints3dTxt(pointsTxt);
      }
    } catch (err) {
      pointsResult = { valid: false, pointsCount: 0, error: err.message };
    }

    if (!pointsResult.valid || pointsResult.pointsCount <= 0) {
      modelErrors.push(`Model ${m.dirName}: ${pointsResult.error || '0 points'}`);
      continue;
    }

    // Parse images
    let imagesResult;
    try {
      if (fs.existsSync(imagesBin)) {
        imagesResult = parseColmapImagesBin(imagesBin);
      } else {
        imagesResult = parseColmapImagesTxt(imagesTxt);
      }
    } catch (err) {
      imagesResult = { valid: false, registeredImages: 0, error: err.message };
    }

    if (!imagesResult.valid || imagesResult.registeredImages < 2) {
      modelErrors.push(`Model ${m.dirName}: ${imagesResult.error || 'fewer than 2 registered images'}`);
      continue;
    }

    // Parse cameras
    let camerasCount = 1;
    try {
      if (fs.existsSync(camerasBin)) {
        camerasCount = parseColmapCamerasBin(camerasBin).camerasCount;
      } else if (fs.existsSync(camerasTxt)) {
        camerasCount = parseColmapCamerasTxt(camerasTxt).camerasCount;
      }
    } catch {}

    let pointsSize = 0;
    try {
      const pStat = fs.statSync(fs.existsSync(pointsBin) ? pointsBin : pointsTxt);
      pointsSize = pStat.size;
    } catch {}

    const quality = evaluateModelQuality(pointsResult.pointsCount, imagesResult.registeredImages, totalInputImages);

    candidateModels.push({
      modelDir: m.fullPath,
      modelName: m.dirName,
      modelIndex: m.index,
      pointsSize,
      pointsCount: pointsResult.pointsCount,
      registeredImages: imagesResult.registeredImages,
      camerasCount,
      totalInputImages,
      qualityStatus: quality.status,
      warning: quality.warning,
      isBinary: fs.existsSync(pointsBin),
    });
  }

  if (candidateModels.length === 0) {
    const detail = modelErrors.length > 0 ? ` Details: ${modelErrors.join('; ')}` : '';
    return {
      valid: false,
      error: `Reconstruction failed: COLMAP could not find an initial image pair or triangulate any 3D points.${detail} Ensure photographs have sufficient visual overlap (>= 60%), consistent lighting, and varied viewpoints.`,
    };
  }

  // Rank candidate models:
  // 1. Registered images count (highest first)
  // 2. Points count (highest first)
  // 3. Lower index (0 preferred over 1 if equal)
  candidateModels.sort((a, b) => {
    if (b.registeredImages !== a.registeredImages) {
      return b.registeredImages - a.registeredImages;
    }
    if (b.pointsCount !== a.pointsCount) {
      return b.pointsCount - a.pointsCount;
    }
    return a.modelIndex - b.modelIndex;
  });

  const bestModel = candidateModels[0];
  return {
    valid: true,
    modelDir: bestModel.modelDir,
    modelIndex: bestModel.modelIndex,
    pointsSize: bestModel.pointsSize,
    pointsCount: bestModel.pointsCount,
    registeredImages: bestModel.registeredImages,
    camerasCount: bestModel.camerasCount,
    totalInputImages: bestModel.totalInputImages,
    qualityStatus: bestModel.qualityStatus,
    warning: bestModel.warning,
    isBinary: bestModel.isBinary,
    totalModelsFound: candidateModels.length,
    candidateModels,
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

      // Verify sparse model output against COLMAP models
      appendJobLog('mapper', 'Verifying sparse reconstruction model output...');
      const verifyRes = verifySparseReconstructionOutput(sparseDir, dirCheck.imageCount);
      if (!verifyRes.valid) {
        throw new Error(verifyRes.error);
      }

      appendJobLog(
        'mapper',
        `Sparse reconstruction verified: Model in ${verifyRes.modelDir} (${verifyRes.pointsCount.toLocaleString()} 3D points, ${verifyRes.registeredImages}/${dirCheck.imageCount} images registered, quality: ${verifyRes.qualityStatus})`
      );

      if (verifyRes.warning) {
        appendJobLog('mapper', `Quality notice: ${verifyRes.warning}`);
      }

      // Cancellation check before model converter
      if (activeReconstructionJob.status === 'cancelled') {
        cleanupTemporaryJobArtifacts(runDir, { jobId });
        return;
      }

      // Export model to PLY for 3D Viewport
      const expectedPly = path.join(runDir, 'sparse.ply');
      // Always remove any pre-existing PLY to prevent serving stale files from previous attempts
      if (fs.existsSync(expectedPly)) {
        try {
          fs.unlinkSync(expectedPly);
        } catch {}
      }

      appendJobLog('export', 'Converting sparse model to PLY for 3D viewport preview...');
      const convArgs = buildColmapStageArgs('model_converter', {
        databasePath: dbPath,
        imagePath: dirCheck.imageDir,
        sparseOutputPath: sparseDir,
        inputModelPath: verifyRes.modelDir,
      });

      const conversionSuccess = await new Promise((resolve) => {
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
        } catch (convSpawnErr) {
          appendJobLog('export', `Failed to start model_converter: ${convSpawnErr.message}`);
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
        convProc.on('error', (err) => {
          if (activeReconstructionJob) {
            activeReconstructionJob.currentProcess = null;
          }
          appendJobLog('export', `model_converter process error: ${err.message}`);
          resolve(false);
        });
      });

      if (activeReconstructionJob && activeReconstructionJob.status === 'cancelled') {
        cleanupTemporaryJobArtifacts(runDir, { jobId });
        activeReconstructionJob.settled = true;
        return;
      }

      if (!conversionSuccess || !fs.existsSync(expectedPly)) {
        throw new Error('COLMAP model_converter failed to export sparse.ply from the reconstructed model.');
      }

      // Validate exported PLY content (must contain vertices, valid format)
      const plyValidation = validateExportedPly(expectedPly);
      if (!plyValidation.valid) {
        throw new Error(`Exported PLY validation failed: ${plyValidation.error}`);
      }

      const plyPath = path.normalize(path.resolve(expectedPly));
      authorizedPlyPaths.add(toCanonicalPath(plyPath));
      appendJobLog(
        'export',
        `Exported sparse point cloud to PLY: ${plyPath} (${plyValidation.vertexCount.toLocaleString()} vertices, ${plyValidation.fileSizeBytes} bytes)`
      );

      if (activeReconstructionJob && activeReconstructionJob.status === 'cancelled') {
        cleanupTemporaryJobArtifacts(runDir, { jobId });
        activeReconstructionJob.settled = true;
        return;
      }

      const modelStats = {
        modelDir: verifyRes.modelDir,
        modelIndex: verifyRes.modelIndex,
        pointsCount: verifyRes.pointsCount,
        registeredImages: verifyRes.registeredImages,
        totalInputImages: dirCheck.imageCount,
        qualityStatus: verifyRes.qualityStatus,
        warning: verifyRes.warning,
        vertexCount: plyValidation.vertexCount,
        isPointCloud: plyValidation.isPointCloud,
        isMesh: plyValidation.isMesh,
        plyPath,
      };

      if (activeReconstructionJob) {
        activeReconstructionJob.status = 'completed';
        activeReconstructionJob.settled = true;
        activeReconstructionJob.endTime = Date.now();
        activeReconstructionJob.plyPath = plyPath;
        activeReconstructionJob.modelStats = modelStats;
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
        modelStats,
        warning: verifyRes.warning,
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
// Sprint 7: Local Python Computer Vision Worker (Safe Subprocess, Incremental)
// ------------------------------------------------------------------------------

let activeCvJob = null;

function emitCvProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('cv:progress', payload);
    } catch {}
  }
}

function emitCvLog(entry) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('cv:log', entry);
    } catch {}
  }
}

/**
 * Build fixed argument array for the Python CV analysis worker (shell: false)
 */
function buildCvWorkerArgs({ inputDir, reportPath, jobId, maxHamming = 8 }) {
  if (typeof inputDir !== 'string' || !inputDir.trim() || inputDir.includes('\0')) {
    throw new Error('Invalid input directory path.');
  }
  if (typeof reportPath !== 'string' || !reportPath.trim() || reportPath.includes('\0')) {
    throw new Error('Invalid report path.');
  }

  const args = [
    '-m',
    'aeromorph_cv.pipeline',
    '--input-dir',
    path.normalize(path.resolve(inputDir.trim())),
    '--output-report',
    path.normalize(path.resolve(reportPath.trim())),
  ];

  if (jobId && typeof jobId === 'string' && jobId.trim() && !jobId.includes('\0')) {
    args.push('--job-id', jobId.trim());
  }

  const maxH = Number.isInteger(maxHamming) && maxHamming >= 0 && maxHamming <= 64 ? maxHamming : 8;
  args.push('--max-hamming', String(maxH));

  return args;
}

/**
 * Launch Python Computer Vision Pre-flight Analysis Job
 */
async function startCvAnalysisJob(config = {}) {
  if (activeCvJob && activeCvJob.status === 'running') {
    return {
      success: false,
      error: 'A computer vision analysis job is already in progress. Wait for it to finish or cancel it first.',
    };
  }

  const {
    inputDir,
    reportPath: explicitReportPath,
    customPythonPath,
    maxHamming = 8,
    spawnProcess: customSpawn,
    pythonExe: customPythonExe,
  } = config;

  if (typeof inputDir !== 'string' || !inputDir.trim() || inputDir.includes('\0')) {
    return { success: false, error: 'Invalid input image directory path argument.' };
  }

  const resolvedInputDir = path.normalize(path.resolve(inputDir.trim()));

  // 1. Verify input directory exists, is a directory, and is not a symlink
  try {
    const stat = fs.lstatSync(resolvedInputDir);
    if (stat.isSymbolicLink()) {
      return { success: false, error: 'Input directory cannot be a symbolic link for security reasons.' };
    }
    if (!stat.isDirectory()) {
      return { success: false, error: 'Specified input directory path is not a directory.' };
    }
  } catch (err) {
    return { success: false, error: `Cannot access input directory: ${err.message}` };
  }

  // 2. Count image files
  let imageFiles = [];
  try {
    const entries = fs.readdirSync(resolvedInputDir);
    imageFiles = entries.filter((name) => {
      const ext = path.extname(name).toLowerCase();
      return SUPPORTED_IMAGE_EXTENSIONS.has(ext);
    });
  } catch (err) {
    return { success: false, error: `Failed to read input directory: ${err.message}` };
  }

  if (imageFiles.length === 0) {
    return {
      success: false,
      error: 'No supported photographs (.jpg, .jpeg, .png, .webp, .bmp, .tif) found in directory.',
    };
  }

  const jobId = typeof config.jobId === 'string' && config.jobId.trim()
    ? config.jobId.trim()
    : `cv_${Date.now()}`;

  // 3. Resolve report path
  let resolvedReportPath = null;
  if (explicitReportPath && typeof explicitReportPath === 'string' && explicitReportPath.trim() && !explicitReportPath.includes('\0')) {
    resolvedReportPath = path.normalize(path.resolve(explicitReportPath.trim()));
    const reportDir = path.dirname(resolvedReportPath);
    try {
      fs.mkdirSync(reportDir, { recursive: true });
    } catch (err) {
      return { success: false, error: `Cannot create report directory: ${err.message}` };
    }
  } else {
    resolvedReportPath = path.join(os.tmpdir(), `aeromorph_cv_report_${jobId}.json`);
  }

  // 4. Resolve Python executable
  let resolvedPythonExe = customPythonExe || null;
  let pyVersion = null;

  if (!resolvedPythonExe) {
    if (customPythonPath && typeof customPythonPath === 'string' && customPythonPath.trim()) {
      const validCustom = validateBinaryExecutable(customPythonPath, ALLOWED_PYTHON_NAMES);
      if (!validCustom) {
        return { success: false, error: `Configured Python executable "${customPythonPath}" was not found or is invalid.` };
      }
    }

    const pyDetection = await detectPythonTool(customPythonPath);
    if (!pyDetection.detected || !pyDetection.path) {
      return {
        success: false,
        error: pyDetection.error || 'Python 3 interpreter was not detected. Please install Python 3.8+ or configure path.',
      };
    }
    resolvedPythonExe = pyDetection.path;
    pyVersion = pyDetection.version;
  }

  const pythonRoot = path.join(__dirname, '..', 'python');
  let args;
  try {
    args = buildCvWorkerArgs({
      inputDir: resolvedInputDir,
      reportPath: resolvedReportPath,
      jobId,
      maxHamming,
    });
  } catch (argErr) {
    return { success: false, error: argErr.message };
  }

  const spawnFn = typeof customSpawn === 'function' ? customSpawn : spawn;

  activeCvJob = {
    id: jobId,
    status: 'running',
    settled: false,
    startTime: Date.now(),
    endTime: null,
    imageDir: resolvedInputDir,
    reportPath: resolvedReportPath,
    pythonExe: resolvedPythonExe,
    currentProcess: null,
    progress: { current: 0, total: imageFiles.length, percent: 0, currentFile: '' },
    logs: [],
    report: null,
    error: null,
  };

  const logBuffer = activeCvJob.logs;

  const appendCvLog = (category, msg) => {
    const timeStr = new Date().toLocaleTimeString();
    const entry = { time: timeStr, category, msg: msg.trim() };
    logBuffer.push(entry);
    if (logBuffer.length > 300) logBuffer.shift();
    emitCvLog(entry);
  };

  appendCvLog('setup', `Starting Computer Vision Analysis for ${imageFiles.length} photos`);
  appendCvLog('setup', `Python: ${resolvedPythonExe} (version: ${pyVersion || 'detected'})`);
  appendCvLog('setup', `Report Destination: ${resolvedReportPath}`);

  emitCvProgress({
    jobId,
    status: 'running',
    settled: false,
    progress: activeCvJob.progress,
    elapsedMs: 0,
    reportPath: resolvedReportPath,
  });

  let proc;
  try {
    proc = spawnFn(resolvedPythonExe, args, {
      cwd: pythonRoot,
      env: {
        ...process.env,
        PYTHONPATH: pythonRoot + (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : ''),
        PYTHONIOENCODING: 'utf-8',
      },
      shell: false,
      windowsHide: true,
    });
  } catch (spawnErr) {
    activeCvJob.status = 'failed';
    activeCvJob.settled = true;
    activeCvJob.error = `Failed to spawn Python process: ${spawnErr.message}`;
    return { success: false, error: activeCvJob.error };
  }

  activeCvJob.currentProcess = proc;

  proc.stdout?.on('data', (chunk) => {
    const lines = chunk.toString().split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      const progressMatch = line.match(/^\[PROGRESS\]\s+(\d+)\/(\d+)\s+\(([\d.]+)%\)\s*(.*)$/);
      if (progressMatch) {
        const current = parseInt(progressMatch[1], 10);
        const total = parseInt(progressMatch[2], 10);
        const percent = parseFloat(progressMatch[3]);
        const currentFile = progressMatch[4].trim();

        if (activeCvJob) {
          activeCvJob.progress = { current, total, percent, currentFile };
          emitCvProgress({
            jobId,
            status: activeCvJob.status,
            settled: false,
            progress: activeCvJob.progress,
            elapsedMs: Date.now() - activeCvJob.startTime,
          });
        }
      }
      appendCvLog('worker', line);
    }
  });

  proc.stderr?.on('data', (chunk) => {
    const lines = chunk.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line.trim()) {
        appendCvLog('stderr', line);
      }
    }
  });

  proc.on('error', (err) => {
    if (activeCvJob) {
      activeCvJob.currentProcess = null;
      activeCvJob.status = 'failed';
      activeCvJob.settled = true;
      activeCvJob.endTime = Date.now();
      activeCvJob.error = `Process error: ${err.message}`;
      appendCvLog('error', activeCvJob.error);
      emitCvProgress({
        jobId,
        status: 'failed',
        settled: true,
        error: activeCvJob.error,
        elapsedMs: activeCvJob.endTime - activeCvJob.startTime,
      });
    }
  });

  proc.on('close', (code, signal) => {
    if (!activeCvJob) return;
    activeCvJob.currentProcess = null;
    activeCvJob.endTime = Date.now();
    activeCvJob.settled = true;

    if (activeCvJob.status === 'cancelled') {
      appendCvLog('system', 'Analysis job was cancelled by user.');
      emitCvProgress({
        jobId,
        status: 'cancelled',
        settled: true,
        error: 'Analysis cancelled by user.',
        elapsedMs: activeCvJob.endTime - activeCvJob.startTime,
      });
      return;
    }

    if (code === 0) {
      try {
        const rawReport = fs.readFileSync(resolvedReportPath, 'utf8');
        const parsedReport = JSON.parse(rawReport);
        activeCvJob.status = 'completed';
        activeCvJob.report = parsedReport;
        activeCvJob.progress = {
          current: activeCvJob.progress.total || imageFiles.length,
          total: activeCvJob.progress.total || imageFiles.length,
          percent: 100,
          currentFile: '',
        };
        appendCvLog('system', '✓ Quality analysis completed. Report loaded successfully.');
        emitCvProgress({
          jobId,
          status: 'completed',
          settled: true,
          report: parsedReport,
          progress: activeCvJob.progress,
          elapsedMs: activeCvJob.endTime - activeCvJob.startTime,
          reportPath: resolvedReportPath,
        });
      } catch (readErr) {
        activeCvJob.status = 'failed';
        activeCvJob.error = `Analysis completed but failed to read report: ${readErr.message}`;
        appendCvLog('error', activeCvJob.error);
        emitCvProgress({
          jobId,
          status: 'failed',
          settled: true,
          error: activeCvJob.error,
          elapsedMs: activeCvJob.endTime - activeCvJob.startTime,
        });
      }
    } else {
      activeCvJob.status = 'failed';
      activeCvJob.error = `Computer vision worker exited with code ${code}${signal ? ` (${signal})` : ''}`;
      appendCvLog('error', activeCvJob.error);
      emitCvProgress({
        jobId,
        status: 'failed',
        settled: true,
        error: activeCvJob.error,
        elapsedMs: activeCvJob.endTime - activeCvJob.startTime,
      });
    }
  });

  return {
    success: true,
    jobId,
    imageDir: resolvedInputDir,
    reportPath: resolvedReportPath,
  };
}

/**
 * Cancel active computer vision analysis job
 */
async function cancelCvAnalysisJob() {
  if (!activeCvJob || activeCvJob.status !== 'running') {
    return { canceled: false, message: 'No active computer vision job to cancel.' };
  }

  activeCvJob.status = 'cancelled';
  activeCvJob.endTime = Date.now();
  if (activeCvJob.currentProcess) {
    terminateProcessTree(activeCvJob.currentProcess);
  }

  return { canceled: true };
}

/**
 * Query active computer vision analysis job status snapshot
 */
function getCvAnalysisStatusJob() {
  if (!activeCvJob) {
    return { status: 'idle', settled: true, progress: null, report: null, logs: [] };
  }

  return {
    id: activeCvJob.id,
    status: activeCvJob.status,
    settled: Boolean(activeCvJob.settled),
    startTime: activeCvJob.startTime,
    endTime: activeCvJob.endTime,
    elapsedMs: activeCvJob.endTime
      ? activeCvJob.endTime - activeCvJob.startTime
      : Date.now() - activeCvJob.startTime,
    imageDir: activeCvJob.imageDir,
    reportPath: activeCvJob.reportPath,
    progress: activeCvJob.progress,
    report: activeCvJob.report,
    error: activeCvJob.error,
    logs: activeCvJob.logs.slice(-150),
  };
}

/**
 * Read and validate structured Computer Vision report from file
 */
function readCvReport(rawReportPath) {
  if (typeof rawReportPath !== 'string' || !rawReportPath.trim() || rawReportPath.includes('\0')) {
    return { success: false, error: 'Invalid report path argument.' };
  }
  const resolved = path.normalize(path.resolve(rawReportPath.trim()));
  try {
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return { success: false, error: 'Report path does not point to a regular file.' };
    }
    if (stat.size > 20 * 1024 * 1024) {
      return { success: false, error: 'Report file exceeds maximum allowed size (20 MB).' };
    }
    const raw = fs.readFileSync(resolved, 'utf8');
    const parsed = JSON.parse(raw);
    return { success: true, report: parsed, path: resolved };
  } catch (err) {
    return { success: false, error: `Failed to read report: ${err.message}` };
  }
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

  /**
   * 13. Sprint 7: Detect Python Toolchain
   */
  ipcMain.handle('system:detectPython', async (event, options = {}) => {
    const customPath = typeof options?.customPythonPath === 'string' && !options.customPythonPath.includes('\0')
      ? options.customPythonPath.trim()
      : null;
    return await detectPythonTool(customPath);
  });

  /**
   * 14. Sprint 7: Select Python Executable Dialog
   */
  ipcMain.handle('dialog:selectPythonExecutable', async () => {
    if (!mainWindow) return { canceled: true };
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Python Executable (python.exe or py.exe)',
        properties: ['openFile', 'dontAddToRecent'],
        filters: [
          { name: 'Python Executable (python.exe; py.exe)', extensions: ['exe'] },
          { name: 'All Executables (*.exe)', extensions: ['exe'] },
        ],
      });

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { canceled: true };
      }

      const selected = result.filePaths[0];
      const valid = validateBinaryExecutable(selected, ALLOWED_PYTHON_NAMES);
      if (!valid) {
        return {
          canceled: true,
          error: 'Selected file is not an allowed Python executable (expected python.exe or py.exe).',
        };
      }

      const queryResult = await queryPythonInfo(valid);
      return {
        canceled: false,
        ...queryResult,
      };
    } catch (err) {
      console.error('Aeromorph Desktop: Error selecting Python executable:', err);
      return { canceled: true, error: err.message };
    }
  });

  /**
   * 15. Sprint 7: Start Computer Vision Analysis Job
   */
  ipcMain.handle('cv:startAnalysis', async (event, config = {}) => {
    if (activeCvJob && activeCvJob.status === 'running') {
      return {
        success: false,
        error: 'A computer vision analysis job is already in progress. Wait for it to finish or cancel it first.',
      };
    }

    const sanitized = {
      inputDir: typeof config?.inputDir === 'string' ? config.inputDir.trim() : '',
      reportPath: typeof config?.reportPath === 'string' ? config.reportPath.trim() : null,
      customPythonPath: typeof config?.customPythonPath === 'string' ? config.customPythonPath.trim() : null,
      jobId: typeof config?.jobId === 'string' ? config.jobId.trim() : null,
      maxHamming: typeof config?.maxHamming === 'number' ? config.maxHamming : 8,
    };

    return await startCvAnalysisJob(sanitized);
  });

  /**
   * 16. Sprint 7: Cancel Active Computer Vision Job
   */
  ipcMain.handle('cv:cancelAnalysis', async () => {
    return await cancelCvAnalysisJob();
  });

  /**
   * 17. Sprint 7: Get Computer Vision Job Status
   */
  ipcMain.handle('cv:getStatus', async () => {
    return getCvAnalysisStatusJob();
  });

  /**
   * 18. Sprint 7: Read Computer Vision Report
   */
  ipcMain.handle('cv:readReport', async (event, reportPath) => {
    return readCvReport(reportPath);
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
  parseColmapPoints3dBin,
  parseColmapPoints3dTxt,
  parseColmapImagesBin,
  parseColmapImagesTxt,
  parseColmapCamerasBin,
  parseColmapCamerasTxt,
  validateExportedPly,
  evaluateModelQuality,
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
  ALLOWED_PYTHON_NAMES,
  getPythonCandidates,
  queryPythonInfo,
  detectPythonTool,
  buildCvWorkerArgs,
  startCvAnalysisJob,
  cancelCvAnalysisJob,
  getCvAnalysisStatusJob,
  readCvReport,
  _resetActiveCvJobForTest: () => {
    activeCvJob = null;
  },
};
