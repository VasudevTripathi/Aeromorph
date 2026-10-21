import React, { useState, useEffect, useRef } from 'react';
import { Terminal, ChevronUp, ChevronDown, Trash2, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { subscribeReconstructionLog } from '../services/desktopBridge';

export default function LogPanel({ externalLogs = null, currentStage = null, jobStatus = 'idle' }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [internalLogs, setInternalLogs] = useState([]);
  const logsEndRef = useRef(null);

  // Subscribe to live reconstruction logs if externalLogs not provided
  useEffect(() => {
    if (externalLogs) return;

    const unsubscribe = subscribeReconstructionLog((entry) => {
      setInternalLogs((prev) => {
        const next = [...prev, entry];
        return next.length > 500 ? next.slice(-500) : next;
      });
    });

    return () => {
      unsubscribe();
    };
  }, [externalLogs]);

  const activeLogs = externalLogs || internalLogs;

  // Auto-scroll to bottom on new log line
  useEffect(() => {
    if (isExpanded && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeLogs.length, isExpanded]);

  const filteredLogs = activeLogs.filter((log) => {
    if (!log) return false;
    const stage = (log.stage || '').toLowerCase();
    const msg = (log.msg || '').toLowerCase();

    if (activeTab === 'all') return true;
    if (activeTab === 'colmap') {
      return stage.includes('feature') || stage.includes('match') || stage.includes('mapper') || stage.includes('colmap');
    }
    if (activeTab === 'errors') {
      return stage === 'error' || msg.includes('error') || msg.includes('fail') || msg.includes('fatal');
    }
    return true;
  });

  const handleClearLogs = (e) => {
    e.stopPropagation();
    if (!externalLogs) {
      setInternalLogs([]);
    }
  };

  const getStatusBadge = () => {
    if (jobStatus === 'running') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--accent)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
          <Loader2 size={11} className="animate-spin" />
          <span>RUNNING ({currentStage || 'Processing'})</span>
        </span>
      );
    }
    if (jobStatus === 'completed') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--accent)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
          <CheckCircle2 size={11} />
          <span>SPARSE RECONSTRUCTION COMPLETED</span>
        </span>
      );
    }
    if (jobStatus === 'cancelled') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--color-warning)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
          <AlertTriangle size={11} />
          <span>CANCELLED</span>
        </span>
      );
    }
    if (jobStatus === 'failed') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--color-danger, #ef4444)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
          <AlertTriangle size={11} />
          <span>FAILED</span>
        </span>
      );
    }
    return (
      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        [COLMAP CPU Engine Ready • Sprint 6B]
      </span>
    );
  };

  return (
    <div
      className="bottom-log-panel"
      style={{ height: isExpanded ? '190px' : '34px' }}
      aria-label="Processing Status & Logs"
    >
      {/* Header bar / Click to Toggle */}
      <div
        className="log-panel-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="log-panel-title-group">
          <Terminal size={13} color="var(--accent)" />
          <span className="log-panel-title">Console &amp; Output</span>
          {getStatusBadge()}
        </div>

        <div className="log-panel-tabs" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`log-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All Logs ({activeLogs.length})
          </button>
          <button
            type="button"
            className={`log-tab-btn ${activeTab === 'colmap' ? 'active' : ''}`}
            onClick={() => setActiveTab('colmap')}
          >
            COLMAP (SIFT &amp; SfM)
          </button>
          <button
            type="button"
            className={`log-tab-btn ${activeTab === 'errors' ? 'active' : ''}`}
            onClick={() => setActiveTab('errors')}
          >
            Errors
          </button>

          {activeLogs.length > 0 && !externalLogs && (
            <button
              type="button"
              className="btn-ghost"
              style={{ padding: '2px 5px', fontSize: '10.5px' }}
              onClick={handleClearLogs}
              title="Clear Console Output"
            >
              <Trash2 size={11} />
            </button>
          )}

          <button
            type="button"
            className="btn-ghost"
            style={{ padding: '2px', marginLeft: '4px' }}
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? 'Collapse Console' : 'Expand Console'}
          >
            {isExpanded ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
        </div>
      </div>

      {/* Expanded Logs Body */}
      {isExpanded && (
        <div className="log-content-body">
          {filteredLogs.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '11.5px', fontFamily: 'var(--font-mono)', padding: '12px 14px' }}>
              {activeLogs.length === 0
                ? 'No reconstruction processes active. Launch Sparse Pipeline in the sidebar to stream COLMAP execution logs.'
                : 'No logs matching current filter.'}
            </div>
          ) : (
            filteredLogs.map((log, index) => {
              const isError = log.stage === 'error' || (log.msg && log.msg.toLowerCase().includes('error'));
              const isStage = log.stage === 'setup' || log.stage === 'system' || (log.msg && log.msg.startsWith('---'));

              return (
                <div key={index} className="log-line">
                  <span className="log-time">{log.time || '--:--:--'}</span>
                  <span className={`log-level ${isError ? 'error' : (isStage ? 'stage' : 'info')}`}>
                    [{(log.stage || 'INFO').toUpperCase()}]
                  </span>
                  <span className="log-msg" style={{ color: isError ? 'var(--color-danger, #f87171)' : (isStage ? 'var(--accent)' : 'inherit') }}>
                    {log.msg}
                  </span>
                </div>
              );
            })
          )}
          <div ref={logsEndRef} />
        </div>
      )}
    </div>
  );
}
