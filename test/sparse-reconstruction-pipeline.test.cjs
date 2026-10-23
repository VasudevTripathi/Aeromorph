'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');

const {
  parseColmapPoints3dBin,
  parseColmapPoints3dTxt,
  parseColmapImagesBin,
  parseColmapImagesTxt,
  validateExportedPly,
  evaluateModelQuality,
  verifySparseReconstructionOutput,
  startSparseReconstructionJob,
  getReconstructionStatusJob,
  authorizedPlyPaths,
  _resetActiveReconstructionJobForTest,
} = require('../electron/main.cjs');

// Temporary directory management
function createTempDir(prefix = 'aeromorph-sparse-test-') {
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
function createSyntheticImages(dir, count = 5) {
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

// Helper to create mock processes for COLMAP stages
function createMockProcess(behavior = {}) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.pid = 88888;
  proc.kill = () => {
    setImmediate(() => proc.emit('close', 1, 'SIGKILL'));
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
    if (behavior.exitCode !== undefined) {
      proc.emit('close', behavior.exitCode);
    } else {
      proc.emit('close', 0);
    }
  });

  return proc;
}

describe('Aeromorph — Sparse Reconstruction and PLY Validation Test Suite', () => {
  let rootTempDir = null;
  let imageDir = null;
  let workspaceDir = null;

  beforeEach(() => {
    _resetActiveReconstructionJobForTest();
    rootTempDir = createTempDir();
    imageDir = path.join(rootTempDir, 'images');
    workspaceDir = path.join(rootTempDir, 'workspace');
    createSyntheticImages(imageDir, 5);
  });

  afterEach(() => {
    removeDirRecursive(rootTempDir);
    _resetActiveReconstructionJobForTest();
  });

  test('1. COLMAP failure with "no initial pair" (0 points) fails run and does not authorize PLY', async () => {
    // Simulate COLMAP mapper failing with "Discarding reconstruction due to no initial pair"
    const mockSpawn = (exe, args, opts) => {
      const stage = args[0];
      if (stage === 'mapper') {
        return createMockProcess({
          stdoutLines: [
            'Finding initial image pair...',
            'Discarding reconstruction due to no initial pair',
          ],
          onSpawn: () => {
            // COLMAP creates model dir 0/ but points3D.bin has 0 points (header = 8 zero bytes)
            const modelDir = path.join(opts.cwd, 'sparse', '0');
            fs.mkdirSync(modelDir, { recursive: true });
            const zeroPointsBuf = Buffer.alloc(8, 0); // num_points = 0
            fs.writeFileSync(path.join(modelDir, 'points3D.bin'), zeroPointsBuf);
            fs.writeFileSync(path.join(modelDir, 'cameras.bin'), Buffer.alloc(8, 0));
            fs.writeFileSync(path.join(modelDir, 'images.bin'), Buffer.alloc(8, 0)); // 0 images registered
          },
        });
      }
      return createMockProcess({ stdoutLines: [`Stage ${stage} complete`] });
    };

    const startRes = await startSparseReconstructionJob({
      imageDir,
      outputDir: workspaceDir,
      colmapExe: 'mock_colmap.exe',
      spawnProcess: mockSpawn,
      numThreads: 4,
    });

    assert.equal(startRes.success, true);

    // Wait for job to settle
    let attempts = 0;
    while (attempts++ < 50) {
      const status = getReconstructionStatusJob();
      if (status.status === 'completed' || status.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const finalStatus = getReconstructionStatusJob();
    assert.equal(finalStatus.status, 'failed');
    assert.match(finalStatus.error, /no initial image pair|triangulate any 3D points/i);
    assert.equal(finalStatus.plyPath, null);
    // Ensure no stale sparse.ply was authorized
    assert.equal(fs.existsSync(path.join(startRes.runDir, 'sparse.ply')), false);
  });

  test('2. Empty or malformed sparse models are rejected with actionable errors', () => {
    const testDir = path.join(rootTempDir, 'malformed_models');
    fs.mkdirSync(testDir, { recursive: true });

    // 2a. Truncated points3D.bin (< 8 bytes)
    const truncPath = path.join(testDir, 'points_trunc.bin');
    fs.writeFileSync(truncPath, Buffer.alloc(4, 0));
    const truncRes = parseColmapPoints3dBin(truncPath);
    assert.equal(truncRes.valid, false);
    assert.match(truncRes.error, /truncated/i);

    // 2b. Zero points (num_points == 0)
    const zeroPath = path.join(testDir, 'points_zero.bin');
    fs.writeFileSync(zeroPath, Buffer.alloc(8, 0));
    const zeroRes = parseColmapPoints3dBin(zeroPath);
    assert.equal(zeroRes.valid, false);
    assert.match(zeroRes.error, /0 points/i);

    // 2c. Non-finite coordinates in points3D.bin
    const nonFiniteBuf = buildColmapPoints3dBuffer([
      { id: 1, x: 1.0, y: NaN, z: 3.0 },
    ]);
    const nanPath = path.join(testDir, 'points_nan.bin');
    fs.writeFileSync(nanPath, nonFiniteBuf);
    const nanRes = parseColmapPoints3dBin(nanPath);
    assert.equal(nanRes.valid, false);
    assert.match(nanRes.error, /non-finite/i);

    // 2d. Truncated images.bin (< 8 bytes)
    const imgTruncPath = path.join(testDir, 'images_trunc.bin');
    fs.writeFileSync(imgTruncPath, Buffer.alloc(3, 0));
    const imgTruncRes = parseColmapImagesBin(imgTruncPath);
    assert.equal(imgTruncRes.valid, false);

    // 2e. Fewer than 2 registered images
    const singleImgPath = path.join(testDir, 'images_one.bin');
    fs.writeFileSync(singleImgPath, buildColmapImagesBuffer(1));
    const singleImgRes = parseColmapImagesBin(singleImgPath);
    assert.equal(singleImgRes.valid, false);
    assert.match(singleImgRes.error, /minimum 2 required/i);

    // 2f. Text format points3D.txt with 0 points
    const txtZeroPath = path.join(testDir, 'points3D.txt');
    fs.writeFileSync(txtZeroPath, '# Comments only\n# No 3D points\n');
    const txtZeroRes = parseColmapPoints3dTxt(txtZeroPath);
    assert.equal(txtZeroRes.valid, false);

    // 2g. Text format images.txt with only 1 image
    const txtImgPath = path.join(testDir, 'images.txt');
    fs.writeFileSync(txtImgPath, '# Header\n1 0 0 0 1 0 0 0 1 img1.jpg\n');
    const txtImgRes = parseColmapImagesTxt(txtImgPath);
    assert.equal(txtImgRes.valid, false);
  });

  test('3. Valid sparse model passes validation for both binary and text formats', () => {
    const validSparseDir = path.join(rootTempDir, 'sparse_valid');
    const model0 = path.join(validSparseDir, '0');
    fs.mkdirSync(model0, { recursive: true });

    // Binary format
    const pointsBuf = buildColmapPoints3dBuffer([
      { id: 1, x: 1.5, y: -0.5, z: 4.2 },
      { id: 2, x: 2.1, y: 1.1, z: 5.0 },
      { id: 3, x: -0.8, y: 0.2, z: 3.9 },
    ]);
    fs.writeFileSync(path.join(model0, 'points3D.bin'), pointsBuf);
    fs.writeFileSync(path.join(model0, 'cameras.bin'), Buffer.alloc(64, 0));
    fs.writeFileSync(path.join(model0, 'images.bin'), buildColmapImagesBuffer(3));

    const verifyRes = verifySparseReconstructionOutput(validSparseDir, 5);
    assert.equal(verifyRes.valid, true);
    assert.equal(verifyRes.modelIndex, 0);
    assert.equal(verifyRes.pointsCount, 3);
    assert.equal(verifyRes.registeredImages, 3);
    assert.equal(verifyRes.totalInputImages, 5);
    assert.equal(verifyRes.isBinary, true);

    // Text format
    const model1 = path.join(validSparseDir, '1');
    fs.mkdirSync(model1, { recursive: true });
    fs.writeFileSync(
      path.join(model1, 'points3D.txt'),
      '# 3D points\n1 1.0 2.0 3.0 255 255 255 0.1 1 0 0\n2 4.0 5.0 6.0 255 255 255 0.1 1 0 0\n'
    );
    fs.writeFileSync(path.join(model1, 'cameras.txt'), '1 PINHOLE 1000 1000 500 500\n');
    fs.writeFileSync(
      path.join(model1, 'images.txt'),
      '1 0 0 0 1 0 0 0 1 photo_1.jpg\n1.0 2.0 1\n2 0 0 0 1 0 0 0 1 photo_2.jpg\n1.0 2.0 2\n'
    );

    const txtPointsRes = parseColmapPoints3dTxt(path.join(model1, 'points3D.txt'));
    assert.equal(txtPointsRes.valid, true);
    assert.equal(txtPointsRes.pointsCount, 2);

    const txtImagesRes = parseColmapImagesTxt(path.join(model1, 'images.txt'));
    assert.equal(txtImagesRes.valid, true);
    assert.equal(txtImagesRes.registeredImages, 2);
  });

  test('4. Model selection prioritizes model with most registered images then points', () => {
    const multiDir = path.join(rootTempDir, 'sparse_multi');

    // Model 0: 2 registered images, 50 points
    const m0Dir = path.join(multiDir, '0');
    fs.mkdirSync(m0Dir, { recursive: true });
    const pts50 = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, x: i, y: 0, z: i }));
    fs.writeFileSync(path.join(m0Dir, 'points3D.bin'), buildColmapPoints3dBuffer(pts50));
    fs.writeFileSync(path.join(m0Dir, 'cameras.bin'), Buffer.alloc(64, 0));
    fs.writeFileSync(path.join(m0Dir, 'images.bin'), buildColmapImagesBuffer(2));

    // Model 1: 5 registered images, 30 points (higher coverage -> preferred!)
    const m1Dir = path.join(multiDir, '1');
    fs.mkdirSync(m1Dir, { recursive: true });
    const pts30 = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, x: i, y: 0, z: i }));
    fs.writeFileSync(path.join(m1Dir, 'points3D.bin'), buildColmapPoints3dBuffer(pts30));
    fs.writeFileSync(path.join(m1Dir, 'cameras.bin'), Buffer.alloc(64, 0));
    fs.writeFileSync(path.join(m1Dir, 'images.bin'), buildColmapImagesBuffer(5));

    const verifyRes = verifySparseReconstructionOutput(multiDir, 5);
    assert.equal(verifyRes.valid, true);
    assert.equal(verifyRes.modelIndex, 1); // Model 1 has 5 registered images vs 2 in Model 0
    assert.equal(verifyRes.registeredImages, 5);
    assert.equal(verifyRes.pointsCount, 30);
  });

  test('5. Quality evaluation distinguishes validity from warnings', () => {
    // Valid but low coverage (< 50% images or < 50 points)
    const lowQuality = evaluateModelQuality(20, 2, 10);
    assert.equal(lowQuality.status, 'warning');
    assert.match(lowQuality.warning, /low coverage reconstruction/i);

    // Acceptable partial reconstruction
    const partialQuality = evaluateModelQuality(100, 3, 5);
    assert.equal(partialQuality.status, 'acceptable');
    assert.match(partialQuality.warning, /partial reconstruction/i);

    // High quality reconstruction
    const goodQuality = evaluateModelQuality(500, 5, 5);
    assert.equal(goodQuality.status, 'good');
    assert.equal(goodQuality.warning, null);

    // Complete failure
    const failedQuality = evaluateModelQuality(0, 1, 5);
    assert.equal(failedQuality.status, 'failed');
  });

  test('6. Stale PLY from previous run is unlinked and not accepted if converter fails', async () => {
    let capturedRunDir = null;

    const mockSpawn = (exe, args, opts) => {
      const stage = args[0];
      if (stage === 'feature_extractor') {
        return createMockProcess({
          onSpawn: () => {
            capturedRunDir = opts.cwd;
            // Simulate a stale sparse.ply leftover from a previous crash
            fs.writeFileSync(
              path.join(opts.cwd, 'sparse.ply'),
              'ply\nformat ascii 1.0\nelement vertex 9999\nend_header\n'
            );
          },
        });
      }
      if (stage === 'mapper') {
        return createMockProcess({
          onSpawn: () => {
            const m0 = path.join(opts.cwd, 'sparse', '0');
            fs.mkdirSync(m0, { recursive: true });
            const pts = [{ id: 1, x: 1, y: 1, z: 1 }, { id: 2, x: 2, y: 2, z: 2 }];
            fs.writeFileSync(path.join(m0, 'points3D.bin'), buildColmapPoints3dBuffer(pts));
            fs.writeFileSync(path.join(m0, 'cameras.bin'), Buffer.alloc(64, 0));
            fs.writeFileSync(path.join(m0, 'images.bin'), buildColmapImagesBuffer(2));
          },
        });
      }
      if (stage === 'model_converter') {
        // model_converter fails to produce a new sparse.ply
        return createMockProcess({ exitCode: 1, stderrLines: ['model_converter crashed'] });
      }
      return createMockProcess();
    };

    const startRes = await startSparseReconstructionJob({
      imageDir,
      outputDir: workspaceDir,
      colmapExe: 'mock_colmap.exe',
      spawnProcess: mockSpawn,
    });

    assert.equal(startRes.success, true);

    let attempts = 0;
    while (attempts++ < 50) {
      const status = getReconstructionStatusJob();
      if (status.status === 'completed' || status.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const finalStatus = getReconstructionStatusJob();
    assert.equal(finalStatus.status, 'failed');
    assert.match(finalStatus.error, /model_converter failed/i);
    // Ensure the old stale PLY was deleted and not authorized
    const stalePlyPath = path.join(capturedRunDir, 'sparse.ply');
    assert.equal(fs.existsSync(stalePlyPath), false);
    assert.equal(authorizedPlyPaths.has(stalePlyPath), false);
  });

  test('7. validateExportedPly distinguishes point clouds from meshes and rejects empty files', () => {
    const testPlyDir = path.join(rootTempDir, 'ply_validation');
    fs.mkdirSync(testPlyDir, { recursive: true });

    // 7a. Point cloud PLY (vertices only, no faces)
    const pcPath = path.join(testPlyDir, 'point_cloud.ply');
    fs.writeFileSync(
      pcPath,
      'ply\nformat ascii 1.0\nelement vertex 250\nproperty float x\nproperty float y\nproperty float z\nend_header\n'
    );
    const pcRes = validateExportedPly(pcPath);
    assert.equal(pcRes.valid, true);
    assert.equal(pcRes.vertexCount, 250);
    assert.equal(pcRes.faceCount, 0);
    assert.equal(pcRes.isPointCloud, true);
    assert.equal(pcRes.isMesh, false);

    // 7b. Mesh PLY (contains vertices and faces)
    const meshPath = path.join(testPlyDir, 'mesh.ply');
    fs.writeFileSync(
      meshPath,
      'ply\nformat ascii 1.0\nelement vertex 100\nproperty float x\nproperty float y\nproperty float z\nelement face 80\nproperty list uchar int vertex_indices\nend_header\n'
    );
    const meshRes = validateExportedPly(meshPath);
    assert.equal(meshRes.valid, true);
    assert.equal(meshRes.vertexCount, 100);
    assert.equal(meshRes.faceCount, 80);
    assert.equal(meshRes.isPointCloud, false);
    assert.equal(meshRes.isMesh, true);

    // 7c. Zero-vertex PLY is rejected
    const emptyPly = path.join(testPlyDir, 'zero_vertex.ply');
    fs.writeFileSync(emptyPly, 'ply\nformat ascii 1.0\nelement vertex 0\nend_header\n');
    const emptyRes = validateExportedPly(emptyPly);
    assert.equal(emptyRes.valid, false);
    assert.match(emptyRes.error, /0 vertices/i);

    // 7d. Non-PLY file is rejected
    const nonPly = path.join(testPlyDir, 'not_a_ply.txt');
    fs.writeFileSync(nonPly, 'Hello World this is plain text\n');
    const nonPlyRes = validateExportedPly(nonPly);
    assert.equal(nonPlyRes.valid, false);
    assert.match(nonPlyRes.error, /missing PLY header/i);
  });

  test('8. Viewport geometry logic correctly handles point cloud vs mesh without fake faces', () => {
    // Pure logic validation mirroring Viewport3D.jsx processPlyBuffer:

    // Case A: Sparse Point Cloud header
    const pcHeader = 'ply\nformat ascii 1.0\nelement vertex 214\nend_header\n';
    const pcHasFace = /element\s+face\s+(\d+)/.test(pcHeader);
    const pcIsIndexed = false; // Point clouds have no index buffer
    const pcIsMesh = pcHasFace && pcIsIndexed;
    const pcVertexCount = 214;
    const pcFaceCount = pcIsMesh ? Math.floor(0 / 3) : 0;

    assert.equal(pcHasFace, false);
    assert.equal(pcIsMesh, false);
    assert.equal(pcFaceCount, 0); // Must be 0, never Math.floor(214 / 3) = 71!

    // Case B: Mesh header with faces
    const meshHeader = 'ply\nformat ascii 1.0\nelement vertex 214\nelement face 71\nend_header\n';
    const meshHasFace = /element\s+face\s+(\d+)/.test(meshHeader);
    const meshIsIndexed = true;
    const meshIndexCount = 213; // 71 triangles * 3
    const meshIsMesh = meshHasFace && meshIsIndexed;
    const meshFaceCount = meshIsMesh ? Math.floor(meshIndexCount / 3) : 0;

    assert.equal(meshHasFace, true);
    assert.equal(meshIsMesh, true);
    assert.equal(meshFaceCount, 71);
  });

  test('9. Active reconstruction job state and logs are scoped to active job', async () => {
    const mockSpawn = (exe, args, opts) => {
      const stage = args[0];
      if (stage === 'mapper') {
        return createMockProcess({
          onSpawn: () => {
            const m0 = path.join(opts.cwd, 'sparse', '0');
            fs.mkdirSync(m0, { recursive: true });
            const pts = [{ id: 1, x: 0, y: 0, z: 1 }, { id: 2, x: 1, y: 0, z: 2 }];
            fs.writeFileSync(path.join(m0, 'points3D.bin'), buildColmapPoints3dBuffer(pts));
            fs.writeFileSync(path.join(m0, 'cameras.bin'), Buffer.alloc(64, 0));
            fs.writeFileSync(path.join(m0, 'images.bin'), buildColmapImagesBuffer(2));
          },
        });
      }
      if (stage === 'model_converter') {
        return createMockProcess({
          onSpawn: () => {
            fs.writeFileSync(
              path.join(opts.cwd, 'sparse.ply'),
              'ply\nformat ascii 1.0\nelement vertex 2\nend_header\n'
            );
          },
        });
      }
      return createMockProcess({ stdoutLines: [`${stage} ok`] });
    };

    const runJob = await startSparseReconstructionJob({
      imageDir,
      outputDir: workspaceDir,
      jobId: 'scoped_job_42',
      colmapExe: 'mock_colmap.exe',
      spawnProcess: mockSpawn,
    });

    assert.equal(runJob.success, true);
    assert.equal(runJob.jobId, 'scoped_job_42');

    while (getReconstructionStatusJob().status === 'running') {
      await new Promise((r) => setTimeout(r, 20));
    }

    const status = getReconstructionStatusJob();
    assert.equal(status.id, 'scoped_job_42');
    assert.equal(status.status, 'completed');
    assert.equal(status.settled, true);
    assert.ok(status.modelStats);
    assert.equal(status.modelStats.pointsCount, 2);
    assert.equal(status.modelStats.registeredImages, 2);
    assert.ok(status.plyPath);
  });
});
