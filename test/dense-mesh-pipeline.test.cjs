'use strict';

/**
 * Sprint 9: Dense Reconstruction and Mesh Generation Automated Test Suite
 *
 * Verifies:
 * - Safe OpenMVS stage argument construction (InterfaceCOLMAP, DensifyPointCloud, ReconstructMesh)
 * - Strict omission and prohibition of TextureMesh
 * - OpenMVS scene verification (InterfaceCOLMAP)
 * - Dense point-cloud output verification and point-cloud vs mesh classification
 * - Polygonal mesh output verification and polygon face requirement
 * - Free disk space safeguard
 * - Pre-flight detection of missing OpenMVS tools when dense or mesh is targeted
 * - Multi-stage pipeline execution targeting Dense Point Cloud
 * - Multi-stage pipeline execution targeting Polygonal Mesh
 * - Error handling for nonzero exit codes in OpenMVS stages
 * - Cancellation and process cleanup during OpenMVS stages
 * - Workspace isolation and sentinel-file preservation
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');

const {
  buildOpenMvsStageArgs,
  buildColmapStageArgs,
  ensurePinholeCameras,
  verifyOpenMvsScene,
  verifyOpenMvsDenseOutput,
  verifyOpenMvsMeshOutput,
  checkFreeDiskSpace,
  startSparseReconstructionJob,
  cancelSparseReconstructionJob,
  getReconstructionStatusJob,
  authorizedPlyPaths,
  toCanonicalPath,
  validateExportedPly,
  _resetActiveReconstructionJobForTest,
} = require('../electron/main.cjs');

// Temporary directory management
function createTempDir(prefix = 'aeromorph-sprint9-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeDirRecursive(dirPath) {
  if (dirPath && fs.existsSync(dirPath)) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
    } catch {}
  }
}

// Helper to create synthetic dummy photographs
function createSyntheticImages(dir, count = 3) {
  fs.mkdirSync(dir, { recursive: true });
  const dummyJpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00]);
  for (let i = 0; i < count; i++) {
    fs.writeFileSync(path.join(dir, `photo_${i}.jpg`), dummyJpeg);
  }
}

// Helper to build a valid binary COLMAP points3D buffer
function buildColmapPoints3dBuffer(points = []) {
  const numPoints = points.length;
  const recordSize = 51;
  const buf = Buffer.alloc(8 + numPoints * recordSize);
  buf.writeBigUInt64LE(BigInt(numPoints), 0);

  for (let i = 0; i < numPoints; i++) {
    const p = points[i];
    const offset = 8 + i * recordSize;
    buf.writeBigUInt64LE(BigInt(p.id || i + 1), offset);
    buf.writeDoubleLE(p.x, offset + 8);
    buf.writeDoubleLE(p.y, offset + 16);
    buf.writeDoubleLE(p.z, offset + 24);
    buf.writeUInt8(p.r ?? 255, offset + 32);
    buf.writeUInt8(p.g ?? 255, offset + 33);
    buf.writeUInt8(p.b ?? 255, offset + 34);
    buf.writeDoubleLE(p.error ?? 0.5, offset + 35);
    buf.writeBigUInt64LE(0n, offset + 43); // track_len = 0
  }
  return buf;
}

// Helper to build a valid binary COLMAP images buffer
function buildColmapImagesBuffer(numImages = 2) {
  const buf = Buffer.alloc(128, 0);
  buf.writeBigUInt64LE(BigInt(numImages), 0);
  return buf;
}

// Helper to create a valid ASCII PLY point cloud buffer
function createPlyPointCloud(vertexCount = 100) {
  let content = 'ply\nformat ascii 1.0\n';
  content += `element vertex ${vertexCount}\n`;
  content += 'property float x\nproperty float y\nproperty float z\n';
  content += 'property uchar red\nproperty uchar green\nproperty uchar blue\n';
  content += 'end_header\n';
  for (let i = 0; i < vertexCount; i++) {
    content += `${(i * 0.1).toFixed(2)} ${(i * 0.2).toFixed(2)} ${(i * 0.3).toFixed(2)} 200 200 200\n`;
  }
  return content;
}

// Helper to create a valid ASCII PLY polygonal mesh buffer
function createPlyMesh(vertexCount = 8, faceCount = 6) {
  let content = 'ply\nformat ascii 1.0\n';
  content += `element vertex ${vertexCount}\n`;
  content += 'property float x\nproperty float y\nproperty float z\n';
  content += `element face ${faceCount}\n`;
  content += 'property list uchar int vertex_indices\n';
  content += 'end_header\n';
  for (let i = 0; i < vertexCount; i++) {
    content += `${(i * 0.5).toFixed(2)} ${(i * 0.5).toFixed(2)} ${(i * 0.5).toFixed(2)}\n`;
  }
  for (let f = 0; f < faceCount; f++) {
    content += `3 0 1 2\n`;
  }
  return content;
}

// Helper to create synthetic mock child process
function createMockProcess(behavior = {}) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.pid = 77777;
  proc.kill = (sig) => {
    proc.killedWith = sig;
    setImmediate(() => {
      proc.emit('close', 1, 'SIGKILL');
    });
  };

  setImmediate(() => {
    if (behavior.stdoutLines) {
      for (const line of behavior.stdoutLines) {
        proc.stdout.emit('data', Buffer.from(line + '\n'));
      }
    }
    if (behavior.stderrLines) {
      for (const line of behavior.stderrLines) {
        proc.stderr.emit('data', Buffer.from(line + '\n'));
      }
    }
    if (behavior.onSpawn) {
      behavior.onSpawn();
    }
    if (behavior.hang) {
      return;
    }
    if (behavior.exitCode !== undefined) {
      proc.emit('close', behavior.exitCode);
    } else {
      proc.emit('close', 0);
    }
  });

  return proc;
}

describe('Sprint 9: OpenMVS Dense Reconstruction and Mesh Generation', () => {
  let tempDir;
  let imageDir;
  let workspaceDir;

  beforeEach(() => {
    _resetActiveReconstructionJobForTest();
    tempDir = createTempDir();
    imageDir = path.join(tempDir, 'images');
    workspaceDir = path.join(tempDir, 'workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });
    createSyntheticImages(imageDir, 3);
  });

  afterEach(() => {
    _resetActiveReconstructionJobForTest();
    removeDirRecursive(tempDir);
  });

  test('1. buildOpenMvsStageArgs constructs safe argument arrays with shell: false guarantees and resource bounds', () => {
    const colmapModelDir = path.join(tempDir, 'sparse', '0');
    const scenePath = path.join(tempDir, 'scene.mvs');
    const denseScenePath = path.join(tempDir, 'scene_dense.mvs');
    const meshPlyPath = path.join(tempDir, 'scene_mesh.ply');

    // 1a. InterfaceCOLMAP args
    const interfaceArgs = buildOpenMvsStageArgs('interface_colmap', {
      colmapModelDir,
      scenePath,
      imageDir,
      numThreads: 4,
    });
    assert.deepEqual(interfaceArgs, [
      '-i', path.normalize(colmapModelDir),
      '-o', path.normalize(scenePath),
      '--image-folder', path.normalize(imageDir),
      '--max-threads', '4',
      '-v', '2',
    ]);

    // 1b. DensifyPointCloud args (conservative memory & resolution levels)
    const densifyArgs = buildOpenMvsStageArgs('densify_point_cloud', {
      scenePath,
      denseScenePath,
      resolutionLevel: 1,
      maxResolution: 1920,
      numThreads: 3,
    });
    assert.deepEqual(densifyArgs, [
      '-i', path.normalize(scenePath),
      '-o', path.normalize(denseScenePath),
      '--resolution-level', '1',
      '--max-resolution', '1920',
      '--max-threads', '3',
      '-v', '2',
    ]);

    // 1c. ReconstructMesh args (polygonal mesh export)
    const meshArgs = buildOpenMvsStageArgs('reconstruct_mesh', {
      denseScenePath,
      meshPlyPath,
      numThreads: 2,
    });
    assert.deepEqual(meshArgs, [
      '-i', path.normalize(denseScenePath),
      '-o', path.normalize(meshPlyPath),
      '--export-type', 'ply',
      '--max-threads', '2',
      '-v', '2',
    ]);

    // 1d. Resource clamping for 8 GB profile: thread cap clamped to 1..4
    const clampedArgs = buildOpenMvsStageArgs('densify_point_cloud', {
      scenePath,
      denseScenePath,
      resolutionLevel: 99, // clamped to 1
      maxResolution: 99999, // clamped to 1920
      numThreads: 16, // clamped to 4
    });
    assert.ok(clampedArgs.includes('--max-threads'));
    assert.equal(clampedArgs[clampedArgs.indexOf('--max-threads') + 1], '4');
    assert.equal(clampedArgs[clampedArgs.indexOf('--resolution-level') + 1], '1');
    assert.equal(clampedArgs[clampedArgs.indexOf('--max-resolution') + 1], '1920');

    // 1e. TextureMesh is strictly absent and unknown
    assert.throws(() => {
      buildOpenMvsStageArgs('texture_mesh', { denseScenePath, meshPlyPath });
    }, /Unknown OpenMVS pipeline stage/);

    // 1f. Missing required paths throws error
    assert.throws(() => {
      buildOpenMvsStageArgs('interface_colmap', { colmapModelDir: null, scenePath, imageDir });
    }, /colmapModelDir must be a valid directory path/);
  });

  test('2. verifyOpenMvsScene validates valid MVS file and rejects missing or empty files', () => {
    const scenePath = path.join(tempDir, 'test_scene.mvs');

    // Non-existent file
    const missing = verifyOpenMvsScene(scenePath);
    assert.equal(missing.valid, false);
    assert.match(missing.error, /was not created/);

    // Empty file (< 64 bytes)
    fs.writeFileSync(scenePath, 'small');
    const empty = verifyOpenMvsScene(scenePath);
    assert.equal(empty.valid, false);
    assert.match(empty.error, /empty or corrupted/);

    // Valid dummy MVS file
    const dummyMvsHeader = Buffer.alloc(256, 0xAB);
    fs.writeFileSync(scenePath, dummyMvsHeader);
    const valid = verifyOpenMvsScene(scenePath);
    assert.equal(valid.valid, true);
    assert.equal(valid.sizeBytes, 256);
  });

  test('3. verifyOpenMvsDenseOutput validates dense point cloud and rejects meshes with face elements', () => {
    const denseScene = path.join(tempDir, 'scene_dense.mvs');
    const densePly = path.join(tempDir, 'scene_dense.ply');

    fs.writeFileSync(denseScene, Buffer.alloc(256, 0x01));

    // Valid dense point cloud (vertices > 0, faceCount === 0)
    fs.writeFileSync(densePly, createPlyPointCloud(250));
    const valid = verifyOpenMvsDenseOutput(denseScene, densePly);
    assert.equal(valid.valid, true);
    assert.equal(valid.vertexCount, 250);
    assert.equal(valid.isPointCloud, true);
    assert.equal(valid.isMesh, false);

    // PLY containing polygon faces is rejected as a point cloud
    fs.writeFileSync(densePly, createPlyMesh(20, 10));
    const invalidMeshAsDense = verifyOpenMvsDenseOutput(denseScene, densePly);
    assert.equal(invalidMeshAsDense.valid, false);
    assert.match(invalidMeshAsDense.error, /face elements; expected point cloud without polygon faces/);
  });

  test('4. verifyOpenMvsMeshOutput validates genuine mesh with faces and rejects point clouds', () => {
    const meshPly = path.join(tempDir, 'scene_mesh.ply');

    // Valid polygonal mesh (faces > 0, vertices > 0)
    fs.writeFileSync(meshPly, createPlyMesh(24, 12));
    const validMesh = verifyOpenMvsMeshOutput(meshPly);
    assert.equal(validMesh.valid, true);
    assert.equal(validMesh.vertexCount, 24);
    assert.equal(validMesh.faceCount, 12);
    assert.equal(validMesh.isMesh, true);
    assert.equal(validMesh.isPointCloud, false);

    // Point cloud without faces is rejected as a mesh
    fs.writeFileSync(meshPly, createPlyPointCloud(500));
    const invalidPointAsMesh = verifyOpenMvsMeshOutput(meshPly);
    assert.equal(invalidPointAsMesh.valid, false);
    assert.match(invalidPointAsMesh.error, /0 face elements/);
  });

  test('5. checkFreeDiskSpace verifies filesystem free space and reports error when below threshold', () => {
    const okCheck = checkFreeDiskSpace(tempDir, 1);
    assert.equal(okCheck.ok, true);

    const failCheck = checkFreeDiskSpace(tempDir, 100000000); // 100 TB
    assert.equal(failCheck.ok, false);
    assert.match(failCheck.error, /Insufficient disk space/);
  });

  test('6. Missing OpenMVS executables fail early when targetStage is dense or mesh', async () => {
    const fakeColmap = path.join(tempDir, 'colmap.exe');
    fs.writeFileSync(fakeColmap, '');

    // Attempting dense reconstruction without valid OpenMVS tools fails before execution
    const res = await startSparseReconstructionJob({
      imageDir,
      outputDir: workspaceDir,
      targetStage: 'dense',
      colmapExe: fakeColmap,
      customOpenmvsPath: path.join(tempDir, 'non_existent_openmvs.exe'),
    });

    assert.equal(res.success, false);
    assert.match(res.error, /OpenMVS executable.*was not found/i);
  });

  test('7. Mock pipeline targeting Dense Point Cloud executes through DensifyPointCloud and authorizes scene_dense.ply', async () => {
    const fakeColmap = path.join(tempDir, 'colmap.exe');
    const fakeInterface = path.join(tempDir, 'InterfaceCOLMAP.exe');
    const fakeDensify = path.join(tempDir, 'DensifyPointCloud.exe');
    const fakeMesh = path.join(tempDir, 'ReconstructMesh.exe');
    fs.writeFileSync(fakeColmap, '');
    fs.writeFileSync(fakeInterface, '');
    fs.writeFileSync(fakeDensify, '');
    fs.writeFileSync(fakeMesh, '');

    const executedStages = [];

    const mockSpawn = (exe, args, opts) => {
      const stageName = args[0] || path.basename(exe);
      executedStages.push({ exe: path.basename(exe), args, cwd: opts.cwd });

      return createMockProcess({
        onSpawn: () => {
          // COLMAP mapper produces model in sparse/0
          if (args[0] === 'mapper') {
            const m0 = path.join(opts.cwd, 'sparse', '0');
            fs.mkdirSync(m0, { recursive: true });
            fs.writeFileSync(path.join(m0, 'points3D.bin'), buildColmapPoints3dBuffer([{ x: 1, y: 2, z: 3 }]));
            fs.writeFileSync(path.join(m0, 'images.bin'), buildColmapImagesBuffer(2));
            fs.writeFileSync(path.join(m0, 'cameras.bin'), Buffer.alloc(32));
          }
          // COLMAP model_converter produces sparse.ply
          if (args[0] === 'model_converter') {
            fs.writeFileSync(path.join(opts.cwd, 'sparse.ply'), createPlyPointCloud(50));
          }
          // OpenMVS InterfaceCOLMAP produces scene.mvs
          if (path.basename(exe).toLowerCase().includes('interfacecolmap')) {
            fs.writeFileSync(path.join(opts.cwd, 'scene.mvs'), Buffer.alloc(256, 0xAA));
          }
          // OpenMVS DensifyPointCloud produces scene_dense.mvs and scene_dense.ply
          if (path.basename(exe).toLowerCase().includes('densifypointcloud')) {
            fs.writeFileSync(path.join(opts.cwd, 'scene_dense.mvs'), Buffer.alloc(256, 0xBB));
            fs.writeFileSync(path.join(opts.cwd, 'scene_dense.ply'), createPlyPointCloud(600));
          }
        },
      });
    };

    const res = await startSparseReconstructionJob({
      imageDir,
      outputDir: workspaceDir,
      targetStage: 'dense',
      numThreads: 4,
      colmapExe: fakeColmap,
      customInterfaceColmapExe: fakeInterface,
      customDensifyExe: fakeDensify,
      customMeshExe: fakeMesh,
      spawnProcess: mockSpawn,
    });

    assert.equal(res.success, true);
    assert.equal(res.targetStage, 'dense');

    // Wait for pipeline to finish
    await new Promise((resolve) => {
      const check = setInterval(() => {
        const st = getReconstructionStatusJob();
        if (st.status === 'completed' || st.status === 'failed') {
          clearInterval(check);
          resolve(st);
        }
      }, 25);
    });

    const status = getReconstructionStatusJob();
    assert.equal(status.status, 'completed');
    assert.equal(status.stage, 'densify_point_cloud');
    assert.ok(status.plyPath.endsWith('scene_dense.ply'));

    // ReconstructMesh was NOT called
    const meshInvocations = executedStages.filter((s) => s.exe.toLowerCase().includes('reconstructmesh'));
    assert.equal(meshInvocations.length, 0);

    // Verify authorized PLYs
    assert.ok(authorizedPlyPaths.has(toCanonicalPath(status.plyPath)));

    // Verify metadata classification
    assert.equal(status.modelStats.isPointCloud, true);
    assert.equal(status.modelStats.isMesh, false);
    assert.equal(status.modelStats.faceCount, 0);
    assert.equal(status.modelStats.vertexCount, 600);
    assert.equal(status.modelStats.plyType, 'point_cloud');
  });

  test('8. Mock pipeline targeting Polygonal Mesh executes through ReconstructMesh and authorizes scene_mesh.ply', async () => {
    const fakeColmap = path.join(tempDir, 'colmap.exe');
    const fakeInterface = path.join(tempDir, 'InterfaceCOLMAP.exe');
    const fakeDensify = path.join(tempDir, 'DensifyPointCloud.exe');
    const fakeMesh = path.join(tempDir, 'ReconstructMesh.exe');
    fs.writeFileSync(fakeColmap, '');
    fs.writeFileSync(fakeInterface, '');
    fs.writeFileSync(fakeDensify, '');
    fs.writeFileSync(fakeMesh, '');

    const executedStages = [];

    const mockSpawn = (exe, args, opts) => {
      executedStages.push({ exe: path.basename(exe), args, cwd: opts.cwd });

      return createMockProcess({
        onSpawn: () => {
          if (args[0] === 'mapper') {
            const m0 = path.join(opts.cwd, 'sparse', '0');
            fs.mkdirSync(m0, { recursive: true });
            fs.writeFileSync(path.join(m0, 'points3D.bin'), buildColmapPoints3dBuffer([{ x: 1, y: 2, z: 3 }]));
            fs.writeFileSync(path.join(m0, 'images.bin'), buildColmapImagesBuffer(2));
            fs.writeFileSync(path.join(m0, 'cameras.bin'), Buffer.alloc(32));
          }
          if (args[0] === 'model_converter') {
            fs.writeFileSync(path.join(opts.cwd, 'sparse.ply'), createPlyPointCloud(50));
          }
          if (path.basename(exe).toLowerCase().includes('interfacecolmap')) {
            fs.writeFileSync(path.join(opts.cwd, 'scene.mvs'), Buffer.alloc(256, 0xAA));
          }
          if (path.basename(exe).toLowerCase().includes('densifypointcloud')) {
            fs.writeFileSync(path.join(opts.cwd, 'scene_dense.mvs'), Buffer.alloc(256, 0xBB));
            fs.writeFileSync(path.join(opts.cwd, 'scene_dense.ply'), createPlyPointCloud(800));
          }
          if (path.basename(exe).toLowerCase().includes('reconstructmesh')) {
            fs.writeFileSync(path.join(opts.cwd, 'scene_mesh.ply'), createPlyMesh(80, 40));
          }
        },
      });
    };

    const res = await startSparseReconstructionJob({
      imageDir,
      outputDir: workspaceDir,
      targetStage: 'mesh',
      numThreads: 4,
      colmapExe: fakeColmap,
      customInterfaceColmapExe: fakeInterface,
      customDensifyExe: fakeDensify,
      customMeshExe: fakeMesh,
      spawnProcess: mockSpawn,
    });

    assert.equal(res.success, true);
    assert.equal(res.targetStage, 'mesh');

    // Wait for pipeline to finish
    await new Promise((resolve) => {
      const check = setInterval(() => {
        const st = getReconstructionStatusJob();
        if (st.status === 'completed' || st.status === 'failed') {
          clearInterval(check);
          resolve(st);
        }
      }, 25);
    });

    const status = getReconstructionStatusJob();
    assert.equal(status.status, 'completed');
    assert.equal(status.stage, 'reconstruct_mesh');
    assert.ok(status.plyPath.endsWith('scene_mesh.ply'));

    // ReconstructMesh was called
    const meshInvocations = executedStages.filter((s) => s.exe.toLowerCase().includes('reconstructmesh'));
    assert.equal(meshInvocations.length, 1);

    // Verify authorized PLYs
    assert.ok(authorizedPlyPaths.has(toCanonicalPath(status.plyPath)));

    // Verify metadata classification: Genuine Polygonal Mesh
    assert.equal(status.modelStats.isPointCloud, false);
    assert.equal(status.modelStats.isMesh, true);
    assert.equal(status.modelStats.vertexCount, 80);
    assert.equal(status.modelStats.faceCount, 40);
    assert.equal(status.modelStats.plyType, 'mesh');
  });

  test('9. Cancellation during OpenMVS Densify stage terminates process and preserves workspace sentinel files', async () => {
    const fakeColmap = path.join(tempDir, 'colmap.exe');
    const fakeInterface = path.join(tempDir, 'InterfaceCOLMAP.exe');
    const fakeDensify = path.join(tempDir, 'DensifyPointCloud.exe');
    fs.writeFileSync(fakeColmap, '');
    fs.writeFileSync(fakeInterface, '');
    fs.writeFileSync(fakeDensify, '');

    // Write a sentinel file in workspace
    const sentinelFile = path.join(workspaceDir, 'important_user_sentinel.txt');
    fs.writeFileSync(sentinelFile, 'DO_NOT_DELETE');

    let densifyProc = null;

    const mockSpawn = (exe, args, opts) => {
      if (path.basename(exe).toLowerCase().includes('densifypointcloud')) {
        densifyProc = createMockProcess({ hang: true });
        return densifyProc;
      }

      return createMockProcess({
        onSpawn: () => {
          if (args[0] === 'mapper') {
            const m0 = path.join(opts.cwd, 'sparse', '0');
            fs.mkdirSync(m0, { recursive: true });
            fs.writeFileSync(path.join(m0, 'points3D.bin'), buildColmapPoints3dBuffer([{ x: 1, y: 2, z: 3 }]));
            fs.writeFileSync(path.join(m0, 'images.bin'), buildColmapImagesBuffer(2));
            fs.writeFileSync(path.join(m0, 'cameras.bin'), Buffer.alloc(32));
          }
          if (args[0] === 'model_converter') {
            fs.writeFileSync(path.join(opts.cwd, 'sparse.ply'), createPlyPointCloud(50));
          }
          if (path.basename(exe).toLowerCase().includes('interfacecolmap')) {
            fs.writeFileSync(path.join(opts.cwd, 'scene.mvs'), Buffer.alloc(256, 0xAA));
          }
        },
      });
    };

    await startSparseReconstructionJob({
      imageDir,
      outputDir: workspaceDir,
      targetStage: 'dense',
      colmapExe: fakeColmap,
      customInterfaceColmapExe: fakeInterface,
      customDensifyExe: fakeDensify,
      spawnProcess: mockSpawn,
    });

    // Wait until densify_point_cloud is running
    await new Promise((resolve) => {
      const check = setInterval(() => {
        const st = getReconstructionStatusJob();
        if (st.stage === 'densify_point_cloud') {
          clearInterval(check);
          resolve();
        }
      }, 20);
    });

    // Cancel job
    const cancelRes = await cancelSparseReconstructionJob();
    assert.equal(cancelRes.canceled, true);

    // Wait for job to settle
    await new Promise((resolve) => {
      const check = setInterval(() => {
        const st = getReconstructionStatusJob();
        if (st.settled) {
          clearInterval(check);
          resolve();
        }
      }, 20);
    });

    const status = getReconstructionStatusJob();
    assert.equal(status.status, 'cancelled');

    // Sentinel file in workspace must remain completely untouched
    assert.ok(fs.existsSync(sentinelFile));
    assert.equal(fs.readFileSync(sentinelFile, 'utf8'), 'DO_NOT_DELETE');
  });

  test('10. Nonzero exit code in OpenMVS InterfaceCOLMAP fails job cleanly with actionable message', async () => {
    const fakeColmap = path.join(tempDir, 'colmap.exe');
    const fakeInterface = path.join(tempDir, 'InterfaceCOLMAP.exe');
    fs.writeFileSync(fakeColmap, '');
    fs.writeFileSync(fakeInterface, '');

    const mockSpawn = (exe, args, opts) => {
      if (path.basename(exe).toLowerCase().includes('interfacecolmap')) {
        return createMockProcess({ exitCode: 1 });
      }

      return createMockProcess({
        onSpawn: () => {
          if (args[0] === 'mapper') {
            const m0 = path.join(opts.cwd, 'sparse', '0');
            fs.mkdirSync(m0, { recursive: true });
            fs.writeFileSync(path.join(m0, 'points3D.bin'), buildColmapPoints3dBuffer([{ x: 1, y: 2, z: 3 }]));
            fs.writeFileSync(path.join(m0, 'images.bin'), buildColmapImagesBuffer(2));
            fs.writeFileSync(path.join(m0, 'cameras.bin'), Buffer.alloc(32));
          }
          if (args[0] === 'model_converter') {
            fs.writeFileSync(path.join(opts.cwd, 'sparse.ply'), createPlyPointCloud(50));
          }
        },
      });
    };

    await startSparseReconstructionJob({
      imageDir,
      outputDir: workspaceDir,
      targetStage: 'dense',
      colmapExe: fakeColmap,
      customInterfaceColmapExe: fakeInterface,
      customDensifyExe: fakeInterface,
      spawnProcess: mockSpawn,
    });

    // Wait for failure
    await new Promise((resolve) => {
      const check = setInterval(() => {
        const st = getReconstructionStatusJob();
        if (st.status === 'failed') {
          clearInterval(check);
          resolve();
        }
      }, 20);
    });

    const status = getReconstructionStatusJob();
    assert.equal(status.status, 'failed');
    assert.match(status.error, /Stage interface_colmap failed with exit code 1/);
  });

  test('11. InterfaceCOLMAP stages sparse model files in omvs_input/sparse and surfaces log error details', async () => {
    const fakeColmap = path.join(tempDir, 'colmap.exe');
    const fakeInterface = path.join(tempDir, 'InterfaceCOLMAP.exe');
    fs.writeFileSync(fakeColmap, '');
    fs.writeFileSync(fakeInterface, '');

    let stagedSparseChecked = false;

    const mockSpawn = (exe, args, opts) => {
      if (path.basename(exe).toLowerCase().includes('interfacecolmap')) {
        // Verify that omvs_input/sparse was created and staged with model files
        const stagedSparse = path.join(opts.cwd, 'omvs_input', 'sparse');
        if (fs.existsSync(path.join(stagedSparse, 'cameras.bin')) &&
            fs.existsSync(path.join(stagedSparse, 'images.bin')) &&
            fs.existsSync(path.join(stagedSparse, 'points3D.bin'))) {
          stagedSparseChecked = true;
        }

        // Write OpenMVS log file with diagnostic error
        fs.writeFileSync(
          path.join(opts.cwd, 'InterfaceCOLMAP-test.log'),
          '18:00:00 [App] OpenMVS v2.4\n18:00:00 [App] error: no valid cameras (make sure they are in PINHOLE model)\n'
        );
        return createMockProcess({ exitCode: 1 });
      }

      return createMockProcess({
        onSpawn: () => {
          if (args[0] === 'mapper') {
            const m0 = path.join(opts.cwd, 'sparse', '0');
            fs.mkdirSync(m0, { recursive: true });
            fs.writeFileSync(path.join(m0, 'points3D.bin'), buildColmapPoints3dBuffer([{ x: 1, y: 2, z: 3 }]));
            fs.writeFileSync(path.join(m0, 'images.bin'), buildColmapImagesBuffer(2));
            fs.writeFileSync(path.join(m0, 'cameras.bin'), Buffer.alloc(32));
          }
          if (args[0] === 'model_converter') {
            fs.writeFileSync(path.join(opts.cwd, 'sparse.ply'), createPlyPointCloud(50));
          }
        },
      });
    };

    await startSparseReconstructionJob({
      imageDir,
      outputDir: workspaceDir,
      targetStage: 'dense',
      colmapExe: fakeColmap,
      customInterfaceColmapExe: fakeInterface,
      customDensifyExe: fakeInterface,
      spawnProcess: mockSpawn,
    });

    await new Promise((resolve) => {
      const check = setInterval(() => {
        const st = getReconstructionStatusJob();
        if (st.status === 'failed') {
          clearInterval(check);
          resolve();
        }
      }, 20);
    });

    const status = getReconstructionStatusJob();
    assert.equal(status.status, 'failed');
    assert.ok(stagedSparseChecked, 'omvs_input/sparse must contain staged model files');
    assert.match(status.error, /no valid cameras/);
  });

  test('12. High-performance pipeline options: sequential matcher, max_image_size, and thread scaling', async () => {
    // 12a. Verify buildColmapStageArgs generates sequential_matcher and max_image_size correctly
    const seqArgs = buildColmapStageArgs('sequential_matcher', {
      databasePath: path.join(tempDir, 'db.db'),
      overlap: 8,
      numThreads: 8,
    });
    assert.deepEqual(seqArgs, [
      'sequential_matcher',
      '--database_path', path.join(tempDir, 'db.db'),
      '--SequentialMatching.overlap', '8',
      '--SequentialMatching.quadratic_overlap', '1',
      '--FeatureMatching.use_gpu', '0',
      '--FeatureMatching.num_threads', '8',
    ]);

    const extArgs = buildColmapStageArgs('feature_extractor', {
      databasePath: path.join(tempDir, 'db.db'),
      imagePath: imageDir,
      numThreads: 8,
      maxImageSize: 1600,
    });
    assert.ok(extArgs.includes('--FeatureExtraction.max_image_size'));
    assert.equal(extArgs[extArgs.indexOf('--FeatureExtraction.max_image_size') + 1], '1600');

    // 12b. Verify startSparseReconstructionJob executes with sequential matcher
    let executedSequential = false;
    const fakeColmap = path.join(tempDir, 'colmap_fast.exe');
    fs.writeFileSync(fakeColmap, '');

    const mockSpawn = (exe, args, opts) => {
      if (args[0] === 'sequential_matcher') {
        executedSequential = true;
      }
      return createMockProcess({
        exitCode: 0,
        onSpawn: () => {
          if (args[0] === 'mapper') {
            const m0 = path.join(opts.cwd, 'sparse', '0');
            fs.mkdirSync(m0, { recursive: true });
            fs.writeFileSync(path.join(m0, 'points3D.bin'), buildColmapPoints3dBuffer([{ x: 1, y: 2, z: 3 }]));
            fs.writeFileSync(path.join(m0, 'images.bin'), buildColmapImagesBuffer(2));
            fs.writeFileSync(path.join(m0, 'cameras.bin'), Buffer.alloc(32));
          }
          if (args[0] === 'model_converter') {
            fs.writeFileSync(path.join(opts.cwd, 'sparse.ply'), createPlyPointCloud(50));
          }
        },
      });
    };

    const res = await startSparseReconstructionJob({
      imageDir,
      outputDir: workspaceDir,
      targetStage: 'sparse',
      matcherType: 'sequential',
      maxImageSize: 1600,
      numThreads: 8,
      colmapExe: fakeColmap,
      spawnProcess: mockSpawn,
    });
    assert.equal(res.success, true);

    await new Promise((resolve) => {
      const check = setInterval(() => {
        const st = getReconstructionStatusJob();
        if (st.status === 'completed') {
          clearInterval(check);
          resolve();
        }
      }, 20);
    });

    assert.ok(executedSequential, 'sequential_matcher must be invoked when matcherType is sequential');
  });

  test('13. ensurePinholeCameras converts SIMPLE_RADIAL and RADIAL models to PINHOLE for OpenMVS compatibility', () => {
    const testDir = path.join(tempDir, 'pinhole_test');
    fs.mkdirSync(testDir, { recursive: true });

    // 13a. Binary cameras.bin conversion
    const binPath = path.join(testDir, 'cameras.bin');
    const buf = Buffer.alloc(8 + 24 + 32);
    buf.writeBigUInt64LE(1n, 0); // 1 camera
    buf.writeUInt32LE(1, 8); // camera_id = 1
    buf.writeInt32LE(2, 12); // model_id = 2 (SIMPLE_RADIAL)
    buf.writeBigUInt64LE(1920n, 16); // width
    buf.writeBigUInt64LE(1080n, 24); // height
    buf.writeDoubleLE(1200.0, 32); // f
    buf.writeDoubleLE(960.0, 40); // cx
    buf.writeDoubleLE(540.0, 48); // cy
    buf.writeDoubleLE(0.05, 56); // k (distortion)
    fs.writeFileSync(binPath, buf);

    // 13b. Text cameras.txt conversion
    const txtPath = path.join(testDir, 'cameras.txt');
    fs.writeFileSync(txtPath, '# Header\n1 SIMPLE_RADIAL 1920 1080 1200.0 960.0 540.0 0.05\n');

    const modified = ensurePinholeCameras(testDir);
    assert.equal(modified, true);

    // Verify binary conversion to PINHOLE (model_id = 1)
    const convertedBin = fs.readFileSync(binPath);
    assert.equal(convertedBin.readInt32LE(12), 1, 'model_id must be converted to 1 (PINHOLE)');
    assert.equal(convertedBin.readDoubleLE(32), 1200.0, 'fx must equal f');
    assert.equal(convertedBin.readDoubleLE(40), 1200.0, 'fy must equal f');
    assert.equal(convertedBin.readDoubleLE(48), 960.0, 'cx must be preserved');
    assert.equal(convertedBin.readDoubleLE(56), 540.0, 'cy must be preserved');

    // Verify text conversion to PINHOLE
    const convertedTxt = fs.readFileSync(txtPath, 'utf8');
    assert.ok(convertedTxt.includes('1 PINHOLE 1920 1080 1200.0 1200.0 960.0 540.0'));
  });

  test('14. Pipeline resume reuses existing verified sparse reconstruction and skips colmap stages', async () => {
    const fakeColmap = path.join(tempDir, 'colmap_res.exe');
    const fakeInterface = path.join(tempDir, 'InterfaceCOLMAP_res.exe');
    const fakeDensify = path.join(tempDir, 'DensifyPointCloud_res.exe');
    fs.writeFileSync(fakeColmap, '');
    fs.writeFileSync(fakeInterface, '');
    fs.writeFileSync(fakeDensify, '');

    // Pre-create an application-owned run with verified sparse model
    const runsBase = path.join(workspaceDir, 'runs');
    const existingRun = path.join(runsBase, 'job_existing');
    const sparseM0 = path.join(existingRun, 'sparse', '0');
    fs.mkdirSync(sparseM0, { recursive: true });
    fs.writeFileSync(path.join(existingRun, '.aeromorph_run.json'), JSON.stringify({ jobId: 'job_existing' }));
    fs.writeFileSync(path.join(sparseM0, 'points3D.bin'), buildColmapPoints3dBuffer([{ x: 1, y: 2, z: 3 }]));
    fs.writeFileSync(path.join(sparseM0, 'images.bin'), buildColmapImagesBuffer(2));
    fs.writeFileSync(path.join(sparseM0, 'cameras.bin'), Buffer.alloc(32));

    const invokedStages = [];
    const mockSpawn = (exe, args, opts) => {
      invokedStages.push({ exe: path.basename(exe), stage: args[0] });
      return createMockProcess({
        exitCode: 0,
        onSpawn: () => {
          if (args[0] === 'model_converter') {
            fs.writeFileSync(path.join(opts.cwd, 'sparse.ply'), createPlyPointCloud(50));
          }
          if (path.basename(exe).toLowerCase().includes('interfacecolmap')) {
            fs.writeFileSync(path.join(opts.cwd, 'scene.mvs'), Buffer.alloc(256, 0xAA));
          }
          if (path.basename(exe).toLowerCase().includes('densifypointcloud')) {
            fs.writeFileSync(path.join(opts.cwd, 'scene_dense.mvs'), Buffer.alloc(256, 0xBB));
            fs.writeFileSync(path.join(opts.cwd, 'scene_dense.ply'), createPlyPointCloud(500));
          }
        },
      });
    };

    const res = await startSparseReconstructionJob({
      imageDir,
      outputDir: workspaceDir,
      runDir: existingRun,
      targetStage: 'dense',
      resume: true,
      colmapExe: fakeColmap,
      customInterfaceColmapExe: fakeInterface,
      customDensifyExe: fakeDensify,
      spawnProcess: mockSpawn,
    });
    assert.equal(res.success, true);

    await new Promise((resolve, reject) => {
      const check = setInterval(() => {
        const st = getReconstructionStatusJob();
        if (st.status === 'completed') {
          clearInterval(check);
          resolve();
        } else if (st.status === 'failed') {
          clearInterval(check);
          reject(new Error(st.error || 'Job failed'));
        }
      }, 20);
    });

    // Verify COLMAP stages (feature_extractor, matcher, mapper) were completely skipped
    const stagesCalled = invokedStages.map((s) => s.stage);
    assert.ok(!stagesCalled.includes('feature_extractor'), 'feature_extractor must be skipped on resume');
    assert.ok(!stagesCalled.includes('mapper'), 'mapper must be skipped on resume');
    // Verify InterfaceCOLMAP and DensifyPointCloud executed
    assert.ok(invokedStages.some((s) => s.exe.toLowerCase().includes('interfacecolmap')), 'InterfaceCOLMAP must execute');
    assert.ok(invokedStages.some((s) => s.exe.toLowerCase().includes('densifypointcloud')), 'DensifyPointCloud must execute');
  });
});
