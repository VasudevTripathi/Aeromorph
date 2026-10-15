import React, { useState } from 'react';
import {
  UploadCloud,
  FolderSearch,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Layers,
  Camera,
  Info,
  ArrowRight,
  RotateCcw
} from 'lucide-react';

export default function ImportPhotographs({ onProceedToStudio }) {
  const [dragActive, setDragActive] = useState(false);

  // Representative realistic drone photographs
  const sampleThumbnails = [
    { id: 1, name: 'DJI_0041.JPG', res: '4000x3000', focal: '24mm eq.', iso: '100', size: '6.4 MB' },
    { id: 2, name: 'DJI_0042.JPG', res: '4000x3000', focal: '24mm eq.', iso: '100', size: '6.5 MB' },
    { id: 3, name: 'DJI_0043.JPG', res: '4000x3000', focal: '24mm eq.', iso: '100', size: '6.3 MB' },
    { id: 4, name: 'DJI_0044.JPG', res: '4000x3000', focal: '24mm eq.', iso: '100', size: '6.8 MB' },
    { id: 5, name: 'DJI_0045.JPG', res: '4000x3000', focal: '24mm eq.', iso: '120', size: '6.6 MB' },
    { id: 6, name: 'DJI_0046.JPG', res: '4000x3000', focal: '24mm eq.', iso: '100', size: '6.7 MB' },
    { id: 7, name: 'DJI_0047.JPG', res: '4000x3000', focal: '24mm eq.', iso: '100', size: '6.4 MB' },
    { id: 8, name: 'DJI_0048.JPG', res: '4000x3000', focal: '24mm eq.', iso: '100', size: '6.5 MB' },
    { id: 9, name: 'DJI_0049.JPG', res: '4000x3000', focal: '24mm eq.', iso: '110', size: '6.9 MB' },
    { id: 10, name: 'DJI_0050.JPG', res: '4000x3000', focal: '24mm eq.', iso: '100', size: '6.3 MB' },
  ];

  return (
    <div className="import-screen-container">
      {/* Header Info */}
      <div className="import-header">
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Import Photographs
          </h2>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Provide aerial drone or ground photo sequences. High visual overlap (60–80%) ensures optimal feature triangulation.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="btn-secondary" onClick={() => {}}>
            <RotateCcw size={13} />
            <span>Clear Selection</span>
          </button>
          <button type="button" className="btn-primary" onClick={onProceedToStudio}>
            <span>Proceed to Studio</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {/* Drag & Drop Visual Zone */}
      <div
        className={`import-dropzone ${dragActive ? 'active' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => { e.preventDefault(); setDragActive(false); }}
      >
        <div className="dropzone-icon-box">
          <UploadCloud size={28} strokeWidth={1.8} />
        </div>
        <div>
          <div className="dropzone-title">
            Drag & drop drone photograph folders or files here
          </div>
          <div className="dropzone-subtitle" style={{ marginTop: '4px' }}>
            Supports JPG, JPEG, and PNG image sets with EXIF camera calibration metadata
          </div>
        </div>

        <button type="button" className="btn-secondary" style={{ marginTop: '8px' }}>
          <FolderSearch size={15} />
          <span>Browse Local Directory...</span>
        </button>
      </div>

      {/* Validation & Selected Dataset Summary Bar */}
      <div className="validation-bar">
        <div className="validation-tags">
          <div className="val-tag success">
            <CheckCircle2 size={13} />
            <span>48 Photographs Detected</span>
          </div>
          <div className="val-tag">
            <Camera size={13} />
            <span>EXIF Metadata Verified (FC3582 / 24mm)</span>
          </div>
          <div className="val-tag">
            <Layers size={13} />
            <span>Avg Overlap: ~74% (Optimal)</span>
          </div>
        </div>

        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          Output target: <code style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>D:\images_colmap\run_01</code>
        </div>
      </div>

      {/* Representative Image Thumbnail Placeholders */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Dataset Previews ({sampleThumbnails.length} of 48 shown)
          </span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Total size: 312 MB • Average: 12.0 MP
          </span>
        </div>

        <div className="thumbnails-grid">
          {sampleThumbnails.map((item, idx) => (
            <div key={item.id} className="image-thumb-card">
              <div className="thumb-preview-placeholder">
                <ImageIcon size={28} strokeWidth={1.2} />
                <span className="thumb-index-tag">#{idx + 1}</span>
              </div>
              <div className="thumb-details">
                <span className="thumb-filename" title={item.name}>{item.name}</span>
                <span className="thumb-meta">{item.res} • {item.focal}</span>
                <span className="thumb-meta" style={{ color: 'var(--accent)' }}>ISO {item.iso} • {item.size}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
