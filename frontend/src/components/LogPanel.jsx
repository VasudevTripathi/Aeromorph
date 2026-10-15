import React, { useState } from 'react';
import { Terminal, ChevronUp, ChevronDown } from 'lucide-react';

export default function LogPanel() {
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState('all');

  const mockLogs = [
    { time: '14:20:04', level: 'info', engine: 'OpenMVS', msg: 'OpenMVS x64 v2.4.0 (Windows 11 x64, 12th Gen Intel i3-1220P)' },
    { time: '14:20:04', level: 'info', engine: 'OpenMVS', msg: 'Command: ReconstructMesh --input-file scene_dense.mvs --max-threads 4' },
    { time: '14:20:06', level: 'stage', engine: 'OpenMVS', msg: "Point-cloud 'scene_dense.ply' loaded: 7,845,251 points (2s636ms)" },
    { time: '14:21:38', level: 'info', engine: 'OpenMVS', msg: 'Delaunay tetrahedralization completed: 6,723,052 vertices, 42,874,275 cells (1m24s)' },
    { time: '14:25:43', level: 'info', engine: 'OpenMVS', msg: 'Delaunay tetrahedras weighting completed: 85,748,706 faces (3m54s)' },
    { time: '15:33:18', level: 'stage', engine: 'OpenMVS', msg: 'Delaunay tetrahedras graph-cut completed (9.42e+06 flow): 3,417,679 vertices' },
    { time: '15:33:21', level: 'stage', engine: 'OpenMVS', msg: 'Mesh reconstruction completed: 3,418,455 vertices, 6,834,707 faces' },
    { time: '15:35:04', level: 'info', engine: 'OpenMVS', msg: 'Mesh cleaning iterations complete: 3,411,172 vertices, 6,818,166 faces' },
    { time: '15:35:05', level: 'info', engine: 'OpenMVS', msg: "Saved mesh to 'scene_mesh.ply' (129.5 MB). Pipeline stage 5 finished." },
  ];

  const filteredLogs = mockLogs.filter((log) => {
    if (activeTab === 'all') return true;
    if (activeTab === 'openmvs') return log.engine === 'OpenMVS';
    if (activeTab === 'colmap') return log.engine === 'COLMAP';
    return true;
  });

  return (
    <div
      className="bottom-log-panel"
      style={{ height: isExpanded ? '180px' : '34px' }}
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
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            [Sample ReconstructMesh Log • 100% Finished]
          </span>
        </div>

        <div className="log-panel-tabs" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`log-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All Logs
          </button>
          <button
            type="button"
            className={`log-tab-btn ${activeTab === 'openmvs' ? 'active' : ''}`}
            onClick={() => setActiveTab('openmvs')}
          >
            OpenMVS
          </button>
          <button
            type="button"
            className={`log-tab-btn ${activeTab === 'colmap' ? 'active' : ''}`}
            onClick={() => setActiveTab('colmap')}
          >
            COLMAP
          </button>

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
          {filteredLogs.map((log, index) => (
            <div key={index} className="log-line">
              <span className="log-time">{log.time}</span>
              <span className={`log-level ${log.level}`}>[{log.level.toUpperCase()}]</span>
              <span className="log-msg">{log.msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
