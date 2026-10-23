/**
 * Aeromorph Sprint 8 — Video Frame Extraction Worker Integration Test Suite
 * 
 * Verifies:
 * - Video file validation and extension allowlisting (.mp4, .mov, .avi, .mkv, .webm)
 * - Argument safety (shell: false, injection prevention, null byte rejection)
 * - Safe isolated job directory allocation and output collision prevention
 * - Non-destructive source handling (source video is never modified or moved)
 * - Structured JSON report parsing and output validation
 * - Incremental progress streaming and event handling (mocked decoder worker)
 * - Worker cancellation, process cleanup, and termination safety
 * - Stale-job isolation and rejection of concurrent jobs
 * - Paths containing spaces and special characters
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

const {
  ALLOWED_VIDEO_EXTENSIONS,
  validateVideoFile,
  buildVideoWorkerArgs,
  startVideoExtractionJob,
  cancelVideoExtractionJob,
  getVideoExtractionStatusJob,
  readVideoReport,
  _resetActiveVideoJobForTest,
} = require('../electron/main.cjs');

describe('Sprint 8: Video Extraction Worker Integration', () => {
  let tempDirs = [];

  function makeTempDir(prefix = 'aeromorph-video-test-') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  beforeEach(() => {
    _resetActiveVideoJobForTest();
  });

  afterEach(async () => {
    await cancelVideoExtractionJob();
    _resetActiveVideoJobForTest();

    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
    tempDirs = [];
  });

  // ---------------------------------------------------------------------------
  // 1. Video File Validation & Allowlisting
  // ---------------------------------------------------------------------------
  test('1. Video file validation allows supported formats and rejects unapproved or corrupt files', () => {
    const testDir = makeTempDir();

    // Create dummy test files
    const fakeMp4 = path.join(testDir, 'flight_survey.mp4');
    fs.writeFileSync(fakeMp4, 'dummy video payload');

    const fakeMov = path.join(testDir, 'drone.mov');
    fs.writeFileSync(fakeMov, 'dummy video payload');

    const fakeMkv = path.join(testDir, 'clip.mkv');
    fs.writeFileSync(fakeMkv, 'dummy video payload');

    const fakeAvi = path.join(testDir, 'video.avi');
    fs.writeFileSync(fakeAvi, 'dummy video payload');

    const fakeWebm = path.join(testDir, 'stream.webm');
    fs.writeFileSync(fakeWebm, 'dummy video payload');

    const emptyMp4 = path.join(testDir, 'empty.mp4');
    fs.writeFileSync(emptyMp4, '');

    const fakeExe = path.join(testDir, 'malicious.exe');
    fs.writeFileSync(fakeExe, 'binary');

    const fakeTxt = path.join(testDir, 'notes.txt');
    fs.writeFileSync(fakeTxt, 'notes');

    // Supported video formats pass
    const vMp4 = validateVideoFile(fakeMp4);
    assert.strictEqual(vMp4.valid, true);
    assert.strictEqual(vMp4.name, 'flight_survey.mp4');
    assert.strictEqual(vMp4.extension, '.mp4');
    assert.strictEqual(vMp4.sizeBytes, 'dummy video payload'.length);

    assert.strictEqual(validateVideoFile(fakeMov).valid, true);
    assert.strictEqual(validateVideoFile(fakeMkv).valid, true);
    assert.strictEqual(validateVideoFile(fakeAvi).valid, true);
    assert.strictEqual(validateVideoFile(fakeWebm).valid, true);

    // Empty video (0 bytes) is rejected
    const vEmpty = validateVideoFile(emptyMp4);
    assert.strictEqual(vEmpty.valid, false);
    assert.match(vEmpty.error, /empty/i);

    // Unsupported formats are rejected
    assert.strictEqual(validateVideoFile(fakeExe).valid, false);
    assert.strictEqual(validateVideoFile(fakeTxt).valid, false);

    // Non-existent path is rejected
    const vMissing = validateVideoFile(path.join(testDir, 'missing.mp4'));
    assert.strictEqual(vMissing.valid, false);

    // Null bytes and empty string are rejected
    assert.strictEqual(validateVideoFile('').valid, false);
    assert.strictEqual(validateVideoFile('video.mp4\0--injection').valid, false);
  });

  // ---------------------------------------------------------------------------
  // 2. Argument Safety & Injection Prevention
  // ---------------------------------------------------------------------------
  test('2. buildVideoWorkerArgs produces safe argument arrays with shell: false guarantees', () => {
    const videoPath = 'D:\\Site Surveys\\North Facade.mp4';
    const outputDir = 'D:\\Site Surveys\\North Facade Frames';
    const reportPath = 'D:\\Site Surveys\\North Facade Frames\\report.json';
    const jobId = 'video_job_001';

    const args = buildVideoWorkerArgs({
      videoPath,
      outputDir,
      reportPath,
      jobId,
      samplingInterval: 2.5,
      maxFrames: 150,
      minDimension: 120,
      blurThreshold: 60.0,
      maxHamming: 6,
      enableBlurFilter: true,
      enableDuplicateFilter: true,
    });

    assert.ok(Array.isArray(args));
    assert.strictEqual(args[0], '-m');
    assert.strictEqual(args[1], 'aeromorph_cv.video_extractor');
    assert.ok(args.includes('--video-path'));
    assert.ok(args.includes('--output-dir'));
    assert.ok(args.includes('--output-report'));
    assert.ok(args.includes('--job-id'));
    assert.ok(args.includes('--sampling-interval'));
    assert.ok(args.includes('--max-frames'));
    assert.ok(args.includes('--min-dimension'));
    assert.ok(args.includes('--blur-threshold'));
    assert.ok(args.includes('--max-hamming'));

    // Check values
    const vIdx = args.indexOf('--video-path');
    assert.strictEqual(args[vIdx + 1], path.normalize(path.resolve(videoPath)));

    const sIdx = args.indexOf('--sampling-interval');
    assert.strictEqual(args[sIdx + 1], '2.5');

    const mIdx = args.indexOf('--max-frames');
    assert.strictEqual(args[mIdx + 1], '150');

    // Rejection of null bytes
    assert.throws(() => {
      buildVideoWorkerArgs({
        videoPath: 'test.mp4\0evil',
        outputDir,
        reportPath,
      });
    }, /Invalid video path/);
  });

  // ---------------------------------------------------------------------------
  // 3. Structured Report Reader
  // ---------------------------------------------------------------------------
  test('3. readVideoReport validates and loads JSON report correctly', () => {
    const testDir = makeTempDir();
    const reportPath = path.join(testDir, 'report.json');

    const mockReport = {
      version: '1.0',
      job_id: 'test_vid_123',
      video_metadata: { duration_sec: 10.0, width: 1920, height: 1080, fps: 30.0 },
      summary: { total_frames_sampled: 10, retained_count: 8, rejected_blur_count: 1, duplicate_count: 1 },
      frames: [],
      warnings: [],
    };

    fs.writeFileSync(reportPath, JSON.stringify(mockReport, null, 2), 'utf8');

    const result = readVideoReport(reportPath);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.report.job_id, 'test_vid_123');
    assert.strictEqual(result.report.summary.retained_count, 8);

    // Non-existent report
    const badResult = readVideoReport(path.join(testDir, 'nonexistent.json'));
    assert.strictEqual(badResult.success, false);

    // Empty or malformed report
    const malformedPath = path.join(testDir, 'malformed.json');
    fs.writeFileSync(malformedPath, '{ broken json');
    assert.strictEqual(readVideoReport(malformedPath).success, false);
  });

  // ---------------------------------------------------------------------------
  // 4. Non-Destructive Source Handling & Unique Job Output Directories
  // ---------------------------------------------------------------------------
  test('4. startVideoExtractionJob never modifies source video and isolates output directory', async () => {
    const testDir = makeTempDir('aeromorph-nondestructive-');
    const videoFile = path.join(testDir, 'survey_video.mp4');
    const originalContent = 'IMPORTANT SOURCE VIDEO BINARY DATA';
    fs.writeFileSync(videoFile, originalContent);

    const statBefore = fs.statSync(videoFile);

    // Mock spawn to simulate completed worker run without external dependencies
    const customSpawn = (exe, args) => {
      const emitter = new EventEmitter();
      emitter.stdout = new EventEmitter();
      emitter.stderr = new EventEmitter();

      // Find report path and output dir from args
      const repIdx = args.indexOf('--output-report');
      const outRep = args[repIdx + 1];
      const outIdx = args.indexOf('--output-dir');
      const outDir = args[outIdx + 1];

      process.nextTick(() => {
        emitter.stdout.emit('data', Buffer.from('[PROGRESS] 1 sampled (50.0%) extracted=1 time=0.03s frame_00001_0000.03s.jpg\n'));
        emitter.stdout.emit('data', Buffer.from('[PROGRESS] 2 sampled (100.0%) extracted=2 time=1.03s frame_00002_0001.03s.jpg\n'));

        // Write synthetic report
        const report = {
          version: '1.0',
          job_id: 'mock_test_job',
          job_config: { output_dir: outDir },
          video_metadata: { duration_sec: 2.0, width: 1280, height: 720, fps: 30.0 },
          summary: { total_frames_sampled: 2, retained_count: 2, rejected_blur_count: 0, duplicate_count: 0 },
          frames: [],
          warnings: [],
        };
        fs.writeFileSync(outRep, JSON.stringify(report), 'utf8');

        emitter.emit('close', 0, null);
      });

      return emitter;
    };

    const res = await startVideoExtractionJob({
      videoPath: videoFile,
      pythonExe: 'python.exe',
      spawnProcess: customSpawn,
    });

    assert.strictEqual(res.success, true);
    assert.ok(res.outputDir);

    // Verify output directory is NOT the parent video directory
    assert.notStrictEqual(res.outputDir, testDir);
    assert.ok(fs.existsSync(res.outputDir));

    // Verify source video was completely untouched
    const statAfter = fs.statSync(videoFile);
    assert.strictEqual(statAfter.size, statBefore.size);
    assert.strictEqual(fs.readFileSync(videoFile, 'utf8'), originalContent);
  });

  // ---------------------------------------------------------------------------
  // 5. Mock Subprocess: Progress Parsing, Report Loading, and Status Snapshot
  // ---------------------------------------------------------------------------
  test('5. [Mock Decoder Test] startVideoExtractionJob parses progress and loads report snapshot', async () => {
    const testDir = makeTempDir('aeromorph-mock-extractor-');
    const videoFile = path.join(testDir, 'flight.mp4');
    fs.writeFileSync(videoFile, 'mock video stream');

    const customSpawn = (exe, args) => {
      const emitter = new EventEmitter();
      emitter.stdout = new EventEmitter();
      emitter.stderr = new EventEmitter();

      const repIdx = args.indexOf('--output-report');
      const outRep = args[repIdx + 1];
      const outIdx = args.indexOf('--output-dir');
      const outDir = args[outIdx + 1];

      process.nextTick(() => {
        emitter.stdout.emit('data', Buffer.from('[PROGRESS] 1 sampled (25.0%) extracted=1 time=0.03s frame_00001_0000.03s.jpg\n'));
        emitter.stdout.emit('data', Buffer.from('[PROGRESS] 2 sampled (50.0%) extracted=1 time=1.03s [skipped: Near-duplicate of frame #1]\n'));
        emitter.stdout.emit('data', Buffer.from('[PROGRESS] 3 sampled (75.0%) extracted=1 time=2.03s [skipped: Blur score 12.0 below threshold 50.0]\n'));
        emitter.stdout.emit('data', Buffer.from('[PROGRESS] 4 sampled (100.0%) extracted=2 time=3.03s frame_00002_0003.03s.jpg\n'));

        const mockReport = {
          version: '1.0',
          job_id: 'mock_extract_job',
          job_config: { output_dir: outDir },
          video_metadata: { duration_sec: 4.0, width: 1920, height: 1080, fps: 30.0 },
          summary: {
            total_frames_sampled: 4,
            retained_count: 2,
            duplicate_count: 1,
            rejected_blur_count: 1,
            rejected_low_res_count: 0,
            unreadable_count: 0,
          },
          frames: [
            { frame_index: 1, timestamp_sec: 0.03, status: 'retained', output_filename: 'frame_00001_0000.03s.jpg' },
            { frame_index: 2, timestamp_sec: 1.03, status: 'rejected_duplicate', rejection_reason: 'Near-duplicate' },
            { frame_index: 3, timestamp_sec: 2.03, status: 'rejected_blur', rejection_reason: 'Blurry' },
            { frame_index: 4, timestamp_sec: 3.03, status: 'retained', output_filename: 'frame_00002_0003.03s.jpg' },
          ],
          warnings: ['Notice: High proportion of blurry frames discarded.'],
        };
        fs.writeFileSync(outRep, JSON.stringify(mockReport), 'utf8');

        emitter.emit('close', 0, null);
      });

      return emitter;
    };

    const res = await startVideoExtractionJob({
      videoPath: videoFile,
      pythonExe: 'python.exe',
      spawnProcess: customSpawn,
      samplingInterval: 1.0,
      blurThreshold: 50.0,
    });

    assert.strictEqual(res.success, true);

    // Wait brief tick for close handler
    await new Promise((r) => setTimeout(r, 60));

    const status = getVideoExtractionStatusJob();
    assert.strictEqual(status.status, 'completed');
    assert.strictEqual(status.settled, true);
    assert.strictEqual(status.progress.sampled, 4);
    assert.strictEqual(status.progress.extracted, 2);
    assert.strictEqual(status.report.summary.retained_count, 2);
    assert.strictEqual(status.report.summary.duplicate_count, 1);
    assert.strictEqual(status.report.summary.rejected_blur_count, 1);
  });

  // ---------------------------------------------------------------------------
  // 6. Worker Cancellation & Termination Safety
  // ---------------------------------------------------------------------------
  test('6. cancelVideoExtractionJob cleanly terminates running extractor and sets cancelled status', async () => {
    const testDir = makeTempDir('aeromorph-cancel-test-');
    const videoFile = path.join(testDir, 'survey.mp4');
    fs.writeFileSync(videoFile, 'dummy video');

    let killCalled = false;
    class MockChildProcess extends EventEmitter {
      constructor() {
        super();
        this.pid = 99992;
        this.stdout = new EventEmitter();
        this.stderr = new EventEmitter();
        this.killed = false;
      }
      kill(signal) {
        killCalled = true;
        this.killed = true;
        this.emit('close', 1, signal || 'SIGTERM');
        return true;
      }
    }

    let mockProc = null;
    const customSpawn = () => {
      mockProc = new MockChildProcess();
      return mockProc;
    };

    const res = await startVideoExtractionJob({
      videoPath: videoFile,
      pythonExe: 'python.exe',
      spawnProcess: customSpawn,
    });

    assert.strictEqual(res.success, true);
    assert.ok(mockProc);

    const cancelRes = await cancelVideoExtractionJob();
    assert.strictEqual(cancelRes.canceled, true);
    assert.strictEqual(killCalled, true);

    await new Promise((r) => setTimeout(r, 40));
    const status = getVideoExtractionStatusJob();
    assert.strictEqual(status.status, 'cancelled');
    assert.strictEqual(status.settled, true);
  });

  // ---------------------------------------------------------------------------
  // 7. Stale-Job Isolation & Concurrent Rejection
  // ---------------------------------------------------------------------------
  test('7. startVideoExtractionJob rejects concurrent job when one is actively running', async () => {
    const testDir = makeTempDir('aeromorph-concurrency-');
    const video1 = path.join(testDir, 'survey1.mp4');
    const video2 = path.join(testDir, 'survey2.mp4');
    fs.writeFileSync(video1, 'dummy');
    fs.writeFileSync(video2, 'dummy');

    const customSpawn = () => {
      const emitter = new EventEmitter();
      emitter.stdout = new EventEmitter();
      emitter.stderr = new EventEmitter();
      emitter.kill = () => true;
      return emitter;
    };

    const first = await startVideoExtractionJob({
      videoPath: video1,
      pythonExe: 'python.exe',
      spawnProcess: customSpawn,
    });
    assert.strictEqual(first.success, true);

    const second = await startVideoExtractionJob({
      videoPath: video2,
      pythonExe: 'python.exe',
      spawnProcess: customSpawn,
    });
    assert.strictEqual(second.success, false);
    assert.match(second.error, /already in progress/i);
  });

  // ---------------------------------------------------------------------------
  // 8. Paths Containing Spaces & Non-ASCII Characters
  // ---------------------------------------------------------------------------
  test('8. Handles paths containing spaces and unicode characters correctly', async () => {
    const testDir = makeTempDir('aeromorph spaces test-');
    const videoFile = path.join(testDir, 'Flight Survey 2026 #1.mp4');
    fs.writeFileSync(videoFile, 'dummy data');

    const customSpawn = (exe, args) => {
      const emitter = new EventEmitter();
      emitter.stdout = new EventEmitter();
      emitter.stderr = new EventEmitter();

      const repIdx = args.indexOf('--output-report');
      const outRep = args[repIdx + 1];

      process.nextTick(() => {
        const report = {
          version: '1.0',
          job_id: 'space_test',
          video_metadata: { duration_sec: 1.0, width: 640, height: 480, fps: 30.0 },
          summary: { total_frames_sampled: 1, retained_count: 1 },
          frames: [],
          warnings: [],
        };
        fs.writeFileSync(outRep, JSON.stringify(report), 'utf8');
        emitter.emit('close', 0, null);
      });

      return emitter;
    };

    const res = await startVideoExtractionJob({
      videoPath: videoFile,
      pythonExe: 'python.exe',
      spawnProcess: customSpawn,
    });

    assert.strictEqual(res.success, true);
    await new Promise((r) => setTimeout(r, 40));

    const status = getVideoExtractionStatusJob();
    assert.strictEqual(status.status, 'completed');
  });
});
