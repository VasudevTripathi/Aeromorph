/**
 * Aeromorph Sprint 7 — Computer Vision Worker Integration Test Suite
 * 
 * Verifies:
 * - Python executable validation and allowlisting
 * - Argument safety (shell: false, injection prevention, null byte rejection)
 * - Python toolchain detection and dependency query parsing
 * - Subprocess execution against controlled synthetic image fixtures
 * - Structured JSON report parsing and output validation
 * - Incremental progress streaming and event handling
 * - Worker cancellation, process cleanup, and termination safety
 * - Stale-job isolation and rejection of concurrent jobs
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

const {
  validateBinaryExecutable,
  ALLOWED_PYTHON_NAMES,
  getPythonCandidates,
  queryPythonInfo,
  detectPythonTool,
  buildCvWorkerArgs,
  startCvAnalysisJob,
  cancelCvAnalysisJob,
  getCvAnalysisStatusJob,
  readCvReport,
  _resetActiveCvJobForTest,
} = require('../electron/main.cjs');

// Helper to create synthetic 24-bit uncompressed BMP image file
function createSyntheticBmp(filePath, width = 64, height = 64, color = [100, 150, 200]) {
  const rowBytes = width * 3;
  const rowPadding = (4 - (rowBytes % 4)) % 4;
  const paddedRowBytes = rowBytes + rowPadding;
  const imageSize = paddedRowBytes * height;
  const fileSize = 54 + imageSize;

  const buf = Buffer.alloc(fileSize, 0);

  // BMP Header
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10); // pixel data offset

  // DIB Header
  buf.writeUInt32LE(40, 14); // DIB header size
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);  // color planes
  buf.writeUInt16LE(24, 28); // bits per pixel
  buf.writeUInt32LE(0, 30);  // BI_RGB uncompressed
  buf.writeUInt32LE(imageSize, 34);

  // Write pixel data (BGR)
  let offset = 54;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      buf[offset] = color[0];     // Blue
      buf[offset + 1] = color[1]; // Green
      buf[offset + 2] = color[2]; // Red
      offset += 3;
    }
    offset += rowPadding;
  }

  fs.writeFileSync(filePath, buf);
}

describe('Sprint 7: Computer Vision Worker Integration', () => {
  let tempDirs = [];

  function makeTempDir(prefix = 'aeromorph-cv-test-') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  beforeEach(() => {
    _resetActiveCvJobForTest();
  });

  afterEach(async () => {
    await cancelCvAnalysisJob();
    _resetActiveCvJobForTest();

    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
    tempDirs = [];
  });

  // ---------------------------------------------------------------------------
  // 1. Executable Validation & Allowlisting
  // ---------------------------------------------------------------------------
  test('1. Python executable validation allows valid python binaries and rejects unapproved files', () => {
    const testDir = makeTempDir();

    // Create fake files
    const fakePython = path.join(testDir, 'python.exe');
    fs.writeFileSync(fakePython, 'dummy binary');

    const fakePy = path.join(testDir, 'py.exe');
    fs.writeFileSync(fakePy, 'dummy binary');

    const fakeBat = path.join(testDir, 'script.bat');
    fs.writeFileSync(fakeBat, 'echo dangerous');

    const fakeMalicious = path.join(testDir, 'malicious.exe');
    fs.writeFileSync(fakeMalicious, 'dummy');

    // Approved filenames pass
    assert.ok(validateBinaryExecutable(fakePython, ALLOWED_PYTHON_NAMES));
    assert.ok(validateBinaryExecutable(fakePy, ALLOWED_PYTHON_NAMES));

    // Unapproved filenames are rejected
    assert.strictEqual(validateBinaryExecutable(fakeBat, ALLOWED_PYTHON_NAMES), null);
    assert.strictEqual(validateBinaryExecutable(fakeMalicious, ALLOWED_PYTHON_NAMES), null);

    // Null bytes and empty paths rejected
    assert.strictEqual(validateBinaryExecutable('', ALLOWED_PYTHON_NAMES), null);
    assert.strictEqual(validateBinaryExecutable('python.exe\0--evil', ALLOWED_PYTHON_NAMES), null);
  });

  // ---------------------------------------------------------------------------
  // 2. Argument Safety & Injection Prevention
  // ---------------------------------------------------------------------------
  test('2. buildCvWorkerArgs produces safe argument arrays with shell: false guarantees', () => {
    const inputDir = 'D:\\Dataset Photos\\Set A';
    const reportPath = 'D:\\Dataset Photos\\Set A\\report.json';
    const jobId = 'test_job_123';

    const args = buildCvWorkerArgs({
      inputDir,
      reportPath,
      jobId,
      maxHamming: 8,
    });

    assert.ok(Array.isArray(args));
    assert.strictEqual(args[0], '-m');
    assert.strictEqual(args[1], 'aeromorph_cv.pipeline');
    assert.ok(args.includes('--input-dir'));
    assert.ok(args.includes('--output-report'));
    assert.ok(args.includes('--job-id'));
    assert.ok(args.includes('--max-hamming'));

    // Verify values are sanitized paths without shell quoting or metacharacters
    const inputIdx = args.indexOf('--input-dir');
    assert.strictEqual(args[inputIdx + 1], path.normalize(path.resolve(inputDir)));

    // Rejection of null bytes
    assert.throws(() => {
      buildCvWorkerArgs({ inputDir: 'C:\\bad\0dir', reportPath: 'C:\\rep.json' });
    }, /Invalid input directory path/);

    assert.throws(() => {
      buildCvWorkerArgs({ inputDir: 'C:\\good', reportPath: 'C:\\bad\0rep.json' });
    }, /Invalid report path/);
  });

  // ---------------------------------------------------------------------------
  // 3. Python Toolchain Detection
  // ---------------------------------------------------------------------------
  test('3. detectPythonTool discovers real Python 3 and parses dependencies', async () => {
    const res = await detectPythonTool();

    // Verify detection structure
    assert.ok(typeof res === 'object');
    if (res.detected) {
      assert.ok(typeof res.path === 'string');
      assert.ok(res.path.length > 0);
      assert.strictEqual(typeof res.major, 'number');
      assert.ok(res.major >= 3);
      assert.strictEqual(typeof res.dependencies, 'object');
      assert.ok('numpy' in res.dependencies);
      assert.ok('pillow' in res.dependencies);
      assert.ok('opencv' in res.dependencies);
      assert.strictEqual(res.status, 'Ready');
    } else {
      assert.strictEqual(res.status, 'Not Detected');
      assert.ok(res.error);
    }
  });

  test('3b. detectPythonTool handles stale custom path gracefully', async () => {
    const res = await detectPythonTool('C:\\NonExistentPath\\python.exe');

    if (res.detected) {
      // Fallen back to auto-detected system python with a clear warning
      assert.ok(res.warning);
      assert.ok(res.warning.includes('is invalid or no longer exists'));
    } else {
      assert.strictEqual(res.detected, false);
      assert.ok(res.error.includes('was not found or is invalid'));
    }
  });

  // ---------------------------------------------------------------------------
  // 4. Controlled Execution on Synthetic Dataset
  // ---------------------------------------------------------------------------
  test('4. startCvAnalysisJob executes successfully on synthetic dataset and generates report', async () => {
    const pyDetection = await detectPythonTool();
    if (!pyDetection.detected) {
      console.log('Skipping live test: Python not detected in environment');
      return;
    }

    const testDir = makeTempDir();
    const reportPath = path.join(testDir, 'cv_report.json');

    // Create 3 synthetic BMP images (two distinct, one duplicate)
    createSyntheticBmp(path.join(testDir, 'frame_01.bmp'), 64, 64, [50, 80, 120]);
    createSyntheticBmp(path.join(testDir, 'frame_02.bmp'), 64, 64, [200, 220, 240]);
    createSyntheticBmp(path.join(testDir, 'frame_03.bmp'), 64, 64, [50, 80, 120]); // duplicate of frame_01

    const progressEvents = [];
    const result = await startCvAnalysisJob({
      inputDir: testDir,
      reportPath,
      customPythonPath: pyDetection.path,
      jobId: 'int_test_run',
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.jobId, 'int_test_run');

    // Wait for job to settle
    let status = getCvAnalysisStatusJob();
    const maxWaitMs = 15000;
    const start = Date.now();
    while (status.status === 'running' && Date.now() - start < maxWaitMs) {
      await new Promise((r) => setTimeout(r, 100));
      status = getCvAnalysisStatusJob();
    }

    assert.strictEqual(status.status, 'completed');
    assert.strictEqual(status.settled, true);
    assert.ok(fs.existsSync(reportPath));

    // Verify structured report output
    const reportRead = readCvReport(reportPath);
    assert.strictEqual(reportRead.success, true);
    const report = reportRead.report;

    assert.ok(report.schema_version.startsWith('1.0'));
    assert.strictEqual(report.dataset_summary.total_images_scanned, 3);
    assert.strictEqual(report.dataset_summary.unreadable_images_count, 0);
    assert.ok(report.dataset_summary.likely_duplicate_pairs_count >= 1);
    assert.ok(report.dataset_readiness.recommendation);
    assert.ok(Array.isArray(report.image_findings));
    assert.strictEqual(report.image_findings.length, 3);
  });

  // ---------------------------------------------------------------------------
  // 5. Unreadable / Corrupted Directory Handling
  // ---------------------------------------------------------------------------
  test('5. startCvAnalysisJob rejects empty directory or non-existent paths cleanly', async () => {
    const emptyDir = makeTempDir();

    const res = await startCvAnalysisJob({
      inputDir: emptyDir,
    });

    assert.strictEqual(res.success, false);
    assert.ok(res.error.includes('No supported photographs'));

    const badDirRes = await startCvAnalysisJob({
      inputDir: 'C:\\NonExistentDirectory_12345',
    });

    assert.strictEqual(badDirRes.success, false);
    assert.ok(badDirRes.error);
  });

  // ---------------------------------------------------------------------------
  // 6. Mock Worker: Progress Streaming, Cancellation & Termination
  // ---------------------------------------------------------------------------
  test('6. Mock worker: incremental progress parsing, cancellation, and process cleanup', async () => {
    const testDir = makeTempDir();
    createSyntheticBmp(path.join(testDir, 'img1.bmp'), 32, 32);

    // Mock ChildProcess that streams progress and stays alive until killed
    class MockChildProcess extends EventEmitter {
      constructor() {
        super();
        this.pid = 99991;
        this.stdout = new EventEmitter();
        this.stderr = new EventEmitter();
        this.killed = false;
      }
      kill(signal) {
        this.killed = true;
        this.emit('close', signal === 'SIGKILL' ? null : 0, signal);
      }
    }

    let mockProc = null;
    const customSpawn = () => {
      mockProc = new MockChildProcess();
      return mockProc;
    };

    const res = await startCvAnalysisJob({
      inputDir: testDir,
      spawnProcess: customSpawn,
      pythonExe: 'C:\\fake\\python.exe',
      jobId: 'mock_job_stream',
    });

    assert.strictEqual(res.success, true);
    assert.ok(mockProc);

    // Emit streaming progress from stdout
    mockProc.stdout.emit('data', Buffer.from('[PROGRESS] 1/10 (10.0%) img_01.jpg\n'));

    let status = getCvAnalysisStatusJob();
    assert.strictEqual(status.status, 'running');
    assert.strictEqual(status.progress.current, 1);
    assert.strictEqual(status.progress.total, 10);
    assert.strictEqual(status.progress.percent, 10);
    assert.strictEqual(status.progress.currentFile, 'img_01.jpg');

    // Cancel job
    const cancelRes = await cancelCvAnalysisJob();
    assert.strictEqual(cancelRes.canceled, true);

    status = getCvAnalysisStatusJob();
    assert.strictEqual(status.status, 'cancelled');
    assert.strictEqual(status.settled, true);
  });

  // ---------------------------------------------------------------------------
  // 7. Stale Job Isolation
  // ---------------------------------------------------------------------------
  test('7. Stale-job isolation prevents starting a second job while one is running', async () => {
    const testDir = makeTempDir();
    createSyntheticBmp(path.join(testDir, 'img1.bmp'), 32, 32);

    class LongRunningMockChildProcess extends EventEmitter {
      constructor() {
        super();
        this.pid = 99992;
        this.stdout = new EventEmitter();
        this.stderr = new EventEmitter();
      }
      kill() {
        this.emit('close', 0, 'SIGKILL');
      }
    }

    const customSpawn = () => new LongRunningMockChildProcess();

    const job1 = await startCvAnalysisJob({
      inputDir: testDir,
      spawnProcess: customSpawn,
      pythonExe: 'C:\\fake\\python.exe',
      jobId: 'job_active_1',
    });
    assert.strictEqual(job1.success, true);

    // Attempt to start a second job while job 1 is running
    const job2 = await startCvAnalysisJob({
      inputDir: testDir,
      spawnProcess: customSpawn,
      pythonExe: 'C:\\fake\\python.exe',
      jobId: 'job_active_2',
    });

    assert.strictEqual(job2.success, false);
    assert.ok(job2.error.includes('already in progress'));

    // Cancel job 1
    await cancelCvAnalysisJob();

    // Now starting job 3 succeeds
    const job3 = await startCvAnalysisJob({
      inputDir: testDir,
      spawnProcess: customSpawn,
      pythonExe: 'C:\\fake\\python.exe',
      jobId: 'job_active_3',
    });
    assert.strictEqual(job3.success, true);
    await cancelCvAnalysisJob();
  });
});
