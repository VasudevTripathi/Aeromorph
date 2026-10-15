import React, { useState } from 'react';
import {
  UploadCloud,
  FolderSearch,
  Image as ImageIcon,
  CheckCircle2,
  Layers,
  Camera,
  ArrowRight,
  RotateCcw,
  Sparkles
} from 'lucide-react';

export default function ImportPhotographs({ onProceedToStudio }) {
  const [dragActive, setDragActive] = useState(false);

  // Representative realistic drone photographs (Sample Dataset)
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.015em' }}>
              Import Photographs
            </h2>
            <span className="sample-indicator-tag">Mock Ingestion Preview</span>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px' }}>
            Aerial drone or ground photo sequences. High visual overlap (60–80%) ensures robust feature triangulation.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="btn-secondary" onClick={() => {}} title="Reset selection">
            <RotateCcw size={12} />
            <span>Reset</span>
          </button>
          <button type="button" className="btn-primary" onClick={onProceedToStudio}>
            <span>Proceed to Studio</span>
            <ArrowRight size={13} />
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
          <UploadCloud size={26} strokeWidth={1.8} />
        </div>
        <div>
          <div className="dropzone-title">
            Drag & drop drone photograph folders or files here
          </div>
          <div className="dropzone-subtitle" style={{ marginTop: '3px' }}>
            Supports JPG, JPEG, and PNG image sets with EXIF camera calibration metadata
          </div>
        </div>

        <button
          type="button"
          className="btn-secondary"
          style={{ marginTop: '4px' }}
          title="File dialog ingestion is not active in this design sprint"
        >
          <FolderSearch size={14} />
          <span>Browse Local Directory (Mock)</span>
        </button>
      </div>

      {/* Validation & Selected Dataset Summary Bar */}
      <div className="validation-bar">
        <div className="validation-tags">
          <div className="val-tag success">
            <CheckCircle2 size={12} />
            <span>Sample Dataset: 48 Photos</span>
          </div>
          <div className="val-tag">
            <Camera size={12} />
            <span>Sample EXIF: FC3582 • 24mm eq.</span>
          </div>
          <div className="val-tag">
            <Layers size={12} />
            <span>Est. Overlap: ~74% (Optimal)</span>
          </div>
        </div>

        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          Output path: <code style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>D:\images_colmap\run_01</code>
        </div>
      </div>

      {/* Representative Image Thumbnail Placeholders */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Sample Previews ({sampleThumbnails.length} of 48 shown)
          </span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            Total sample size: 312 MB • Average: 12.0 MP
          </span>
        </div>

        <div className="thumbnails-grid">
          {sampleThumbnails.map((item, idx) => (
            <div key={item.id} className="image-thumb-card">
              <div className="thumb-preview-placeholder">
                <ImageIcon size={26} strokeWidth={1.2} />
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
