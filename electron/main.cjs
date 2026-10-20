/**
 * Aeromorph Desktop Main Process
 * 
 * Manages the Electron application lifecycle, native Windows desktop shell,
 * and secure IPC handlers for file dialogs and model ingestion.
 */

const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

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

    const rawPath = result.filePaths[0];
    if (typeof rawPath !== 'string' || rawPath.includes('\0')) {
      return { canceled: true, error: 'Invalid directory path.' };
    }

    const dirPath = path.normalize(path.resolve(rawPath));

    const lstat = await fs.promises.lstat(dirPath);
    if (lstat.isSymbolicLink()) {
      return { canceled: true, error: 'Symbolic link directories are not supported for security reasons.' };
    }
    if (!lstat.isDirectory()) {
      return { canceled: true, error: 'Selected path is not a directory.' };
    }

    // Shallow non-recursive read of directory entries (bounded to first 5,000 files to avoid locking thread)
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.bmp']);

    const imageFiles = [];
    let totalSizeBytes = 0;
    const maxEntries = Math.min(entries.length, 5000);

    for (let i = 0; i < maxEntries; i++) {
      const entry = entries[i];
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (imageExtensions.has(ext)) {
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

    return {
      canceled: false,
      path: dirPath,
      name: path.basename(dirPath),
      fileCount: imageFiles.length,
      totalSizeBytes,
      // Provide bounded metadata array (first 100 max) to keep IPC payload lightweight
      imageFiles: imageFiles.slice(0, 100),
    };
  } catch (err) {
    console.error('Aeromorph Desktop: Error selecting directory:', err);
    return { canceled: true, error: err.message };
  }
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
