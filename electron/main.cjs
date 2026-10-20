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

  // Prevent navigation to unapproved external URLs
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsed = new URL(navigationUrl);
      if (isDev) {
        if (parsed.origin !== 'http://localhost:3000') {
          event.preventDefault();
        }
      } else {
        if (parsed.protocol !== 'file:') {
          event.preventDefault();
        }
      }
    } catch {
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

    const dirPath = result.filePaths[0];
    const stat = await fs.promises.stat(dirPath);
    if (!stat.isDirectory()) {
      return { canceled: true, error: 'Selected path is not a directory.' };
    }

    // Shallow non-recursive read of directory entries
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.bmp']);

    const imageFiles = [];
    let totalSizeBytes = 0;

    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (imageExtensions.has(ext)) {
          try {
            const fileStat = await fs.promises.stat(path.join(dirPath, entry.name));
            totalSizeBytes += fileStat.size;
            imageFiles.push({
              name: entry.name,
              size: fileStat.size,
            });
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

    const filePath = result.filePaths[0];
    if (path.extname(filePath).toLowerCase() !== '.ply') {
      return { canceled: true, error: 'Selected file is not a .ply mesh.' };
    }

    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) {
      return { canceled: true, error: 'Selected path is not a valid file.' };
    }

    return {
      canceled: false,
      path: filePath,
      name: path.basename(filePath),
      sizeBytes: stat.size,
      lastModified: stat.mtimeMs,
    };
  } catch (err) {
    console.error('Aeromorph Desktop: Error selecting PLY file:', err);
    return { canceled: true, error: err.message };
  }
});

/**
 * 4. Read PLY Binary Buffer
 * Strictly checks that path exists, has .ply extension, and is within safe memory limits (max 500 MB).
 */
ipcMain.handle('file:readPlyBuffer', async (event, filePath) => {
  try {
    if (typeof filePath !== 'string' || path.extname(filePath).toLowerCase() !== '.ply') {
      return { success: false, error: 'Path must point to a valid .ply file.' };
    }

    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) {
      return { success: false, error: 'Path is not a regular file.' };
    }

    // Enforce 500 MB safety limit for 8 GB RAM target machine
    const MAX_PLY_BYTES = 500 * 1024 * 1024;
    if (stat.size > MAX_PLY_BYTES) {
      return {
        success: false,
        error: `PLY file exceeds safe memory threshold of 500 MB (File size: ${(stat.size / (1024 * 1024)).toFixed(1)} MB).`,
      };
    }

    const buffer = await fs.promises.readFile(filePath);
    // Convert Node Buffer to isolated ArrayBuffer for Three.js PLYLoader
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    return {
      success: true,
      buffer: arrayBuffer,
      sizeBytes: stat.size,
      name: path.basename(filePath),
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

  if (colmapPath && typeof colmapPath === 'string') {
    try {
      if (fs.existsSync(colmapPath) && fs.statSync(colmapPath).isFile()) {
        result.colmap = { exists: true, path: colmapPath };
      }
    } catch {
      // Ignored
    }
  }

  if (openmvsPath && typeof openmvsPath === 'string') {
    try {
      if (fs.existsSync(openmvsPath) && fs.statSync(openmvsPath).isFile()) {
        result.openmvs = { exists: true, path: openmvsPath };
      }
    } catch {
      // Ignored
    }
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
