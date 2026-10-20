/**
 * Aeromorph Desktop Main Process
 * 
 * Manages the Electron application lifecycle, native Windows desktop shell,
 * and secure IPC handlers for file dialogs and model ingestion.
 */

const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

// Single instance lock to prevent duplicate desktop processes
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
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
    execFile(
      executablePath,
      ['-h'],
      { shell: false, timeout: 4000, maxBuffer: 256 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err && err.code === 'ETIMEDOUT') {
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
      tempDir = os.tmpdir();
    }

    execFile(
      executablePath,
      ['-h'],
      { cwd: tempDir, shell: false, timeout: 4000, maxBuffer: 256 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
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
                  fs.unlinkSync(logPath);
                } catch {}
              }
            }
            try { fs.rmdirSync(tempDir); } catch {}
          } catch {}
        }

        if (err && err.code === 'ETIMEDOUT') {
          return resolve({
            detected: false,
            path: executablePath,
            name: path.basename(executablePath),
            version: null,
            status: 'Timeout',
            error: 'Process timed out querying version.',
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
 * Perform safe detection of COLMAP
 */
async function detectColmapTool(customPath) {
  const candidates = getColmapCandidates(customPath);
  for (const candidate of candidates) {
    const valid = validateBinaryExecutable(candidate, ALLOWED_COLMAP_NAMES);
    if (valid) {
      return await queryColmapVersion(valid);
    }
  }
  return {
    detected: false,
    path: null,
    name: null,
    version: null,
    status: 'Not Detected',
    error: 'COLMAP executable (colmap.exe) was not found in standard paths or PATH. Please configure path.',
  };
}

/**
 * Perform safe detection of OpenMVS
 */
async function detectOpenMvsTool(customPath) {
  const candidates = getOpenMvsCandidates(customPath);
  for (const candidate of candidates) {
    const valid = validateBinaryExecutable(candidate, ALLOWED_OPENMVS_NAMES);
    if (valid) {
      return await queryOpenMvsVersion(valid);
    }
  }
  return {
    detected: false,
    path: null,
    name: null,
    version: null,
    status: 'Not Detected',
    error: 'OpenMVS executable (InterfaceCOLMAP.exe) was not found in standard paths or PATH. Please configure path.',
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
      capped: entries.length > MAX_DIRECTORY_SCAN_ENTRIES,
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
    capped: entries.length > MAX_DIRECTORY_SCAN_ENTRIES,
    error: null,
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
app.on('web-contents-created', (event, contents) => {
  contents.on('will-attach-webview', (webviewEvent) => {
    webviewEvent.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

// ------------------------------------------------------------------------------
// Secure IPC Handlers
// ------------------------------------------------------------------------------

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
    return {
      canceled: false,
      ...queryResult,
    };
  } catch (err) {
    console.error('Aeromorph Desktop: Error selecting OpenMVS executable:', err);
    return { canceled: true, error: err.message };
  }
});

// ------------------------------------------------------------------------------
// App Lifecycle
// ------------------------------------------------------------------------------

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
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
