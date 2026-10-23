/**
 * Sprint 6B.1: Workspace Isolation and Cleanup Safety Test Suite
 * 
 * Verifies:
 * - Run-directory ownership and isolation from project workspace
 * - Safeguards preventing deletion/overwriting of pre-existing user files
 * - Rejection of non-empty run directories
 * - Ownership verification on cleanup
 * - Consistent path resolution for database, sparse model, logs, and PLY
 * - PLY allowlist authorization consistency
 * - Preservation of sentinel files across success, failure, and cancellation
 * - Concurrent/repeated cancellation handling
 * - Repeated jobs within the same project workspace
 * - Sprint 6A / 6B regressions
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

const {
  validateBinaryExecutable,
  validateAndCountImageDirectory,
  validateReconstructionDirectories,
  buildColmapStageArgs,
  verifySparseReconstructionOutput,
  startSparseReconstructionJob,
  cancelSparseReconstructionJob,
  getReconstructionStatusJob,
  cleanupTemporaryJobArtifacts,
  isApplicationOwnedRunDir,
  toCanonicalPath,
  authorizedPlyPaths,
  RUN_MANIFEST_FILENAME,
  _resetActiveReconstructionJobForTest,
} = require('../electron/main.cjs');

// Helper to create synthetic test directories
function createTempDir(prefix = 'aeromorph-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Helper to create synthetic image files
function createSyntheticImages(dir, count = 3) {
  const fileNames = [];
  for (let i = 1; i <= count; i++) {
    const fileName = `photo_${i}.jpg`;
    const filePath = path.join(dir, fileName);
    // Write valid JPEG header signature to satisfy validation
    const dummyJpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00]);
    fs.writeFileSync(filePath, dummyJpeg);
    fileNames.push(filePath);
  }
  return fileNames;
}

// Helper to create a synthetic mock child process for COLMAP
function createMockProcess(behavior = {}) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.pid = 99999;
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
      // Keep process running until killed (for cancellation tests)
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

// Helper to create a synthetic valid COLMAP sparse model directory
function createSyntheticValidModel(modelDir, targetPointsSize = 500) {
  fs.mkdirSync(modelDir, { recursive: true });
  const numPoints = 2;
  const recordSize = 51;
  const allocBytes = Math.max(8 + numPoints * recordSize, targetPointsSize);
  const pointsBuf = Buffer.alloc(allocBytes, 0);
  pointsBuf.writeBigUInt64LE(BigInt(numPoints), 0);
  for (let i = 0; i < numPoints; i++) {
    const offset = 8 + i * recordSize;
    pointsBuf.writeBigUInt64LE(BigInt(i + 1), offset);
    pointsBuf.writeDoubleLE(i * 1.5, offset + 8);
    pointsBuf.writeDoubleLE(i * -0.5, offset + 16);
    pointsBuf.writeDoubleLE(5.0 + i, offset + 24);
    pointsBuf.writeUInt8(200, offset + 32);
    pointsBuf.writeUInt8(220, offset + 33);
    pointsBuf.writeUInt8(240, offset + 34);
    pointsBuf.writeDoubleLE(0.1, offset + 35);
    pointsBuf.writeBigUInt64LE(0n, offset + 43);
  }
  fs.writeFileSync(path.join(modelDir, 'points3D.bin'), pointsBuf);

  const camBuf = Buffer.alloc(64, 0);
  camBuf.writeBigUInt64LE(1n, 0);
  fs.writeFileSync(path.join(modelDir, 'cameras.bin'), camBuf);

  const imgBuf = Buffer.alloc(128, 0);
  imgBuf.writeBigUInt64LE(2n, 0);
  fs.writeFileSync(path.join(modelDir, 'images.bin'), imgBuf);
}

describe('Sprint 6B.1: Workspace Isolation and Cleanup Safety', () => {
  let rootTempDir = null;
  let imageDir = null;
  let workspaceDir = null;

  beforeEach(() => {
    _resetActiveReconstructionJobForTest();
    rootTempDir = createTempDir('aeromorph-sprint6b1-');
    imageDir = path.join(rootTempDir, 'images');
    workspaceDir = path.join(rootTempDir, 'workspace');
    fs.mkdirSync(imageDir, { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });
    createSyntheticImages(imageDir, 3);
  });

  afterEach(() => {
    _resetActiveReconstructionJobForTest();
    if (rootTempDir && fs.existsSync(rootTempDir)) {
      try {
        fs.rmSync(rootTempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  test('1. Directory collision and nesting validation', async () => {
    // Exact same directory
    const checkSame = await validateReconstructionDirectories(imageDir, imageDir);
    assert.equal(checkSame.valid, false);
    assert.match(checkSame.error, /Output project directory must be separate/i);

    // Workspace inside image directory
    const nestedWorkspace = path.join(imageDir, 'nested_workspace');
    const checkNested = await validateReconstructionDirectories(imageDir, nestedWorkspace);
    assert.equal(checkNested.valid, false);
    assert.match(checkNested.error, /Output workspace cannot be located inside/i);

    // Image directory inside workspace
    const nestedImage = path.join(workspaceDir, 'nested_images');
    fs.mkdirSync(nestedImage, { recursive: true });
    createSyntheticImages(nestedImage, 2);
    const checkImageNested = await validateReconstructionDirectories(nestedImage, workspaceDir);
    assert.equal(checkImageNested.valid, false);
    assert.match(checkImageNested.error, /Input photographs directory cannot be located inside/i);

    // Insufficient photographs (< 2 supported photographs)
    const singleImageDir = path.join(rootTempDir, 'single_image');
    fs.mkdirSync(singleImageDir, { recursive: true });
    createSyntheticImages(singleImageDir, 1);
    const checkSingle = await validateReconstructionDirectories(singleImageDir, workspaceDir);
    assert.equal(checkSingle.valid, false);
    assert.match(checkSingle.error, /At least 2 supported photographs are required/i);
  });

  test('2. Rejection of non-empty run directory preserves pre-existing user files', async () => {
    const customRunDir = path.join(workspaceDir, 'custom_run');
    fs.mkdirSync(customRunDir, { recursive: true });

    // Place pre-existing user sentinel files
    const sentinelFile = path.join(customRunDir, 'user_document.txt');
    const sentinelContent = 'CRITICAL USER DATA - DO NOT OVERWRITE';
    fs.writeFileSync(sentinelFile, sentinelContent, 'utf8');

    const result = await validateReconstructionDirectories(imageDir, workspaceDir, {
      runDir: customRunDir,
    });

    assert.equal(result.valid, false);
    assert.match(result.error, /is not empty/i);
    assert.match(result.error, /prevent overwriting or deleting user files/i);

    // Sentinel file must remain completely untouched
    assert.equal(fs.existsSync(sentinelFile), true);
    assert.equal(fs.readFileSync(sentinelFile, 'utf8'), sentinelContent);
  });

  test('3. Application-owned run directory allocation and ownership manifest', async () => {
    const result = await validateReconstructionDirectories(imageDir, workspaceDir);
    assert.equal(result.valid, true);
    assert.equal(result.workspaceDir, path.normalize(workspaceDir));
    assert.ok(result.runDir);
    assert.notEqual(result.runDir, result.workspaceDir);
    assert.ok(result.runDir.startsWith(path.join(result.workspaceDir, 'runs')));

    // Verify manifest exists in runDir
    const manifestPath = path.join(result.runDir, RUN_MANIFEST_FILENAME);
    assert.equal(fs.existsSync(manifestPath), true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.app, 'Aeromorph');
    assert.equal(manifest.appOwned, true);
    assert.equal(manifest.workspaceDir, result.workspaceDir);

    // Verify ownership helpers
    assert.equal(isApplicationOwnedRunDir(result.runDir), true);
    assert.equal(isApplicationOwnedRunDir(result.runDir, result.jobId), true);
    assert.equal(isApplicationOwnedRunDir(result.runDir, 'wrong_job_id'), false);
    assert.equal(isApplicationOwnedRunDir(result.workspaceDir), false);
  });

  test('4. Ownership-safe cleanup refuses deletion on unverified or workspace directories', async () => {
    // Create sentinel files in workspace directory with database journal names
    const journalInWorkspace = path.join(workspaceDir, 'database.db-journal');
    const walInWorkspace = path.join(workspaceDir, 'database.db-wal');
    const shmInWorkspace = path.join(workspaceDir, 'database.db-shm');
    const normalSentinel = path.join(workspaceDir, 'important_sentinel.txt');

    fs.writeFileSync(journalInWorkspace, 'fake-journal-data');
    fs.writeFileSync(walInWorkspace, 'fake-wal-data');
    fs.writeFileSync(shmInWorkspace, 'fake-shm-data');
    fs.writeFileSync(normalSentinel, 'user-data');

    // Attempt cleanup on workspace directory directly (not an app-owned run dir)
    const cleanupResult = cleanupTemporaryJobArtifacts(workspaceDir);
    assert.equal(cleanupResult.cleaned, false);
    assert.match(cleanupResult.reason, /not a verified application-owned run directory/i);

    // Verify ALL files in workspace are completely preserved
    assert.equal(fs.existsSync(journalInWorkspace), true);
    assert.equal(fs.existsSync(walInWorkspace), true);
    assert.equal(fs.existsSync(shmInWorkspace), true);
    assert.equal(fs.existsSync(normalSentinel), true);
  });

  test('5. Successful job executes in isolated runDir, preserves workspace sentinels, and authorizes PLY', async () => {
    // Create pre-existing sentinel files in workspace
    const workspaceSentinel = path.join(workspaceDir, 'sentinel_workspace.txt');
    const workspaceJournalSentinel = path.join(workspaceDir, 'database.db-journal');
    fs.writeFileSync(workspaceSentinel, 'SENTINEL_WORKSPACE_INITIAL');
    fs.writeFileSync(workspaceJournalSentinel, 'SENTINEL_JOURNAL_INITIAL');

    let capturedRunDir = null;

    const mockSpawn = (exe, args, opts) => {
      const stage = args[0];
      return createMockProcess({
        stdoutLines: [`Stage ${stage} progress 100%`],
        onSpawn: () => {
          capturedRunDir = opts.cwd;
          // In mapper stage, synthesize COLMAP sparse model output
          if (stage === 'mapper') {
            createSyntheticValidModel(path.join(opts.cwd, 'sparse', '0'), 1024);
          }
          // In model_converter stage, synthesize sparse.ply
          if (stage === 'model_converter') {
            fs.writeFileSync(path.join(opts.cwd, 'sparse.ply'), 'ply\nformat ascii 1.0\nelement vertex 10\nend_header\n');
          }
        },
      });
    };

    const startRes = await startSparseReconstructionJob({
      imageDir,
      outputDir: workspaceDir,
      colmapExe: 'mock_colmap.exe',
      spawnProcess: mockSpawn,
      numThreads: 4,
    });

    assert.equal(startRes.success, true);
    assert.ok(startRes.runDir);
    assert.equal(startRes.outputDir, workspaceDir);

    // Wait for async pipeline execution to complete
    let attempts = 0;
    while (attempts++ < 50) {
      const status = getReconstructionStatusJob();
      if (status.status === 'completed' || status.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const finalStatus = getReconstructionStatusJob();
    assert.equal(finalStatus.status, 'completed');
    assert.equal(finalStatus.error, null);

    // Verify all stages ran inside isolated runDir
    assert.equal(capturedRunDir, startRes.runDir);

    // Verify database, sparse, and log paths resolve within runDir
    assert.equal(fs.existsSync(path.join(startRes.runDir, 'database.db')), false); // COLMAP would create it, mock didn't write it
    assert.equal(fs.existsSync(path.join(startRes.runDir, 'sparse', '0', 'points3D.bin')), true);
    assert.equal(fs.existsSync(path.join(startRes.runDir, 'aeromorph_colmap.log')), true);

    // Verify PLY path authorization and exact delivery match
    const expectedPlyPath = path.normalize(path.resolve(path.join(startRes.runDir, 'sparse.ply')));
    assert.equal(fs.existsSync(expectedPlyPath), true);
    assert.equal(finalStatus.plyPath, expectedPlyPath);
    assert.equal(authorizedPlyPaths.has(toCanonicalPath(expectedPlyPath)), true);

    // Verify workspace sentinels are completely untouched
    assert.equal(fs.existsSync(workspaceSentinel), true);
    assert.equal(fs.readFileSync(workspaceSentinel, 'utf8'), 'SENTINEL_WORKSPACE_INITIAL');
    assert.equal(fs.existsSync(workspaceJournalSentinel), true);
    assert.equal(fs.readFileSync(workspaceJournalSentinel, 'utf8'), 'SENTINEL_JOURNAL_INITIAL');
  });

  test('6. Failed job cleans only current run temporary files, preserves sentinels & logs', async () => {
    // Place sentinel in workspace
    const workspaceSentinel = path.join(workspaceDir, 'failure_sentinel.txt');
    fs.writeFileSync(workspaceSentinel, 'PERSIST_ACROSS_FAILURE');

    let runDirCreated = null;

    const mockFailingSpawn = (exe, args, opts) => {
      runDirCreated = opts.cwd;
      const stage = args[0];
      if (stage === 'exhaustive_matcher') {
        // Create temporary journal file inside runDir to test its cleanup
        fs.writeFileSync(path.join(opts.cwd, 'database.db-journal'), 'ephemeral_journal');
        fs.writeFileSync(path.join(opts.cwd, 'database.db-wal'), 'ephemeral_wal');
        // Fail this stage
        return createMockProcess({
          exitCode: 1,
          stderrLines: ['Simulated CUDA/CPU feature matching crash'],
        });
      }
      return createMockProcess({ exitCode: 0 });
    };

    const startRes = await startSparseReconstructionJob({
      imageDir,
      outputDir: workspaceDir,
      colmapExe: 'mock_colmap.exe',
      spawnProcess: mockFailingSpawn,
    });

    assert.equal(startRes.success, true);

    // Wait for failure
    let attempts = 0;
    while (attempts++ < 50) {
      const status = getReconstructionStatusJob();
      if (status.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const finalStatus = getReconstructionStatusJob();
    assert.equal(finalStatus.status, 'failed');
    assert.match(finalStatus.error, /failed with exit code 1/i);

    // Ephemeral database journal/wal files in runDir must be cleaned up
    assert.equal(fs.existsSync(path.join(runDirCreated, 'database.db-journal')), false);
    assert.equal(fs.existsSync(path.join(runDirCreated, 'database.db-wal')), false);

    // Diagnostics log must remain for user inspection
    assert.equal(fs.existsSync(path.join(runDirCreated, 'aeromorph_colmap.log')), true);

    // Workspace sentinel must remain untouched
    assert.equal(fs.existsSync(workspaceSentinel), true);
    assert.equal(fs.readFileSync(workspaceSentinel, 'utf8'), 'PERSIST_ACROSS_FAILURE');
  });

  test('7. Cancellation terminates process tree, cleans run temp files, and preserves sentinels', async () => {
    const workspaceSentinel = path.join(workspaceDir, 'cancel_sentinel.txt');
    fs.writeFileSync(workspaceSentinel, 'PERSIST_ACROSS_CANCEL');

    let runDirCreated = null;

    const mockHangingSpawn = (exe, args, opts) => {
      runDirCreated = opts.cwd;
      // Write temporary database journal in runDir
      fs.writeFileSync(path.join(opts.cwd, 'database.db-journal'), 'ephemeral_cancel_journal');
      return createMockProcess({
        hang: true,
        stdoutLines: ['Stage feature_extractor started...'],
      });
    };

    const startRes = await startSparseReconstructionJob({
      imageDir,
      outputDir: workspaceDir,
      colmapExe: 'mock_colmap.exe',
      spawnProcess: mockHangingSpawn,
    });

    assert.equal(startRes.success, true);
    await new Promise((r) => setTimeout(r, 30));

    // Cancel job
    const cancelRes = await cancelSparseReconstructionJob();
    assert.equal(cancelRes.canceled, true);

    // Wait for cancellation to settle
    let attempts = 0;
    while (attempts++ < 50) {
      const status = getReconstructionStatusJob();
      if (status.status === 'cancelled' && status.settled) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const finalStatus = getReconstructionStatusJob();
    assert.equal(finalStatus.status, 'cancelled');

    // Ephemeral database journal in runDir must be cleaned up
    assert.equal(fs.existsSync(path.join(runDirCreated, 'database.db-journal')), false);

    // Diagnostics log in runDir is preserved
    assert.equal(fs.existsSync(path.join(runDirCreated, 'aeromorph_colmap.log')), true);

    // Workspace sentinel is preserved
    assert.equal(fs.existsSync(workspaceSentinel), true);
    assert.equal(fs.readFileSync(workspaceSentinel, 'utf8'), 'PERSIST_ACROSS_CANCEL');
  });

  test('8. Concurrent and repeated cancellation is safe and idempotent', async () => {
    // 1. Cancel when idle
    const cancelIdle = await cancelSparseReconstructionJob();
    assert.equal(cancelIdle.canceled, false);
    assert.match(cancelIdle.message, /No active reconstruction job/i);

    // 2. Start hanging job
    await startSparseReconstructionJob({
      imageDir,
      outputDir: workspaceDir,
      colmapExe: 'mock_colmap.exe',
      spawnProcess: () => createMockProcess({ hang: true }),
    });

    await new Promise((r) => setTimeout(r, 30));

    // First cancel while running
    const cancel1 = await cancelSparseReconstructionJob();
    assert.equal(cancel1.canceled, true);

    // Immediate second cancel
    const cancel2 = await cancelSparseReconstructionJob();
    assert.equal(cancel2.canceled, false);

    // Wait for cancellation to settle
    let attempts = 0;
    while (attempts++ < 50) {
      const status = getReconstructionStatusJob();
      if (status.status === 'cancelled' && status.settled) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    // Third cancel after delay
    const cancel3 = await cancelSparseReconstructionJob();
    assert.equal(cancel3.canceled, false);
  });

  test('9. Repeated jobs in same project workspace create distinct runs without collisions', async () => {
    const makeSuccessSpawn = (runTag) => (exe, args, opts) => {
      return createMockProcess({
        onSpawn: () => {
          if (args[0] === 'mapper') {
            createSyntheticValidModel(path.join(opts.cwd, 'sparse', '0'), 500);
          }
          if (args[0] === 'model_converter') {
            fs.writeFileSync(
              path.join(opts.cwd, 'sparse.ply'),
              `ply\nformat ascii 1.0\nelement vertex 10\n# Tag: ${runTag}\nend_header\n`
            );
          }
        },
      });
    };

    // Run 1
    const run1 = await startSparseReconstructionJob({
      imageDir,
      outputDir: workspaceDir,
      jobId: 'job_alpha',
      colmapExe: 'mock_colmap.exe',
      spawnProcess: makeSuccessSpawn('RUN_1'),
    });
    assert.equal(run1.success, true);

    while (getReconstructionStatusJob().status === 'running') {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(getReconstructionStatusJob().status, 'completed');

    // Add sentinel inside Run 1 directory
    const run1Sentinel = path.join(run1.runDir, 'run1_sentinel.txt');
    fs.writeFileSync(run1Sentinel, 'RUN_1_SENTINEL_CONTENT');

    // Run 2 in same workspace
    const run2 = await startSparseReconstructionJob({
      imageDir,
      outputDir: workspaceDir,
      jobId: 'job_beta',
      colmapExe: 'mock_colmap.exe',
      spawnProcess: makeSuccessSpawn('RUN_2'),
    });
    assert.equal(run2.success, true);
    assert.notEqual(run1.runDir, run2.runDir);

    while (getReconstructionStatusJob().status === 'running') {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(getReconstructionStatusJob().status, 'completed');

    // Run 1 sentinel and model files must be completely intact
    assert.equal(fs.existsSync(run1Sentinel), true);
    assert.equal(fs.readFileSync(run1Sentinel, 'utf8'), 'RUN_1_SENTINEL_CONTENT');
    assert.match(fs.readFileSync(path.join(run1.runDir, 'sparse.ply'), 'utf8'), /RUN_1/);
    assert.match(fs.readFileSync(path.join(run2.runDir, 'sparse.ply'), 'utf8'), /RUN_2/);
  });

  test('10. Sprint 6A / 6B Regressions: executable validator, stage arg builder, output verifier', () => {
    // 10a. validateBinaryExecutable
    const fakeColmap = path.join(rootTempDir, process.platform === 'win32' ? 'colmap.exe' : 'colmap');
    fs.writeFileSync(fakeColmap, 'binary-content');
    const validResult = validateBinaryExecutable(fakeColmap, new Set(['colmap.exe', 'colmap']));
    assert.equal(validResult, path.normalize(fakeColmap));

    const invalidExt = path.join(rootTempDir, 'colmap.bat');
    fs.writeFileSync(invalidExt, 'batch-content');
    assert.equal(validateBinaryExecutable(invalidExt, new Set(['colmap.exe', 'colmap'])), null);

    // 10b. buildColmapStageArgs
    const stageArgs = buildColmapStageArgs('feature_extractor', {
      databasePath: 'D:\\db.db',
      imagePath: 'D:\\images',
      sparseOutputPath: 'D:\\sparse',
      numThreads: 4,
    });
    assert.deepEqual(stageArgs, [
      'feature_extractor',
      '--database_path', 'D:\\db.db',
      '--image_path', 'D:\\images',
      '--FeatureExtraction.use_gpu', '0',
      '--FeatureExtraction.num_threads', '4',
    ]);

    const convArgs = buildColmapStageArgs('model_converter', {
      databasePath: 'D:\\run\\database.db',
      imagePath: 'D:\\images',
      sparseOutputPath: 'D:\\run\\sparse',
      inputModelPath: 'D:\\run\\sparse\\0',
    });
    assert.deepEqual(convArgs, [
      'model_converter',
      '--input_path', 'D:\\run\\sparse\\0',
      '--output_path', path.join('D:\\run', 'sparse.ply'),
      '--output_type', 'PLY',
    ]);

    // 10c. verifySparseReconstructionOutput
    const tempSparseDir = path.join(rootTempDir, 'sparse_verify');
    const model0 = path.join(tempSparseDir, '0');
    createSyntheticValidModel(model0, 500);

    const verifyRes = verifySparseReconstructionOutput(tempSparseDir);
    assert.equal(verifyRes.valid, true);
    assert.equal(verifyRes.modelIndex, 0);
    assert.equal(verifyRes.pointsSize, 500);
    assert.equal(verifyRes.isBinary, true);
  });
});
