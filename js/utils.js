/* ============================================================
   DEM Explorer — Utilities
   ============================================================ */
window.DEM = window.DEM || {};

DEM.utils = {
  /* --- Toast Notifications --- */
  toast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(10px)';
      el.style.transition = '0.3s ease';
      setTimeout(() => el.remove(), 300);
    }, duration);
  },

  /* --- Area Calculation (Haversine approx) --- */
  computeArea(west, south, east, north) {
    const R = 6371; // km
    const toRad = d => d * Math.PI / 180;
    const latH = Math.abs(north - south);
    const lonW = Math.abs(east - west);
    const midLat = (north + south) / 2;
    const h = latH * 111.32;
    const w = lonW * 111.32 * Math.cos(toRad(midLat));
    return (h * w).toFixed(1);
  },

  /* --- Validate Bounding Box --- */
  validateBBox(west, south, east, north) {
    if (isNaN(west) || isNaN(south) || isNaN(east) || isNaN(north)) {
      return 'All coordinates are required';
    }
    if (west >= east) return 'West must be less than East';
    if (south >= north) return 'South must be less than North';
    if (Math.abs(east - west) > 5 || Math.abs(north - south) > 5) {
      return 'Max bounding box size is 5° × 5°';
    }
    if (south < -90 || north > 90) return 'Latitude must be between -90 and 90';
    if (west < -180 || east > 180) return 'Longitude must be between -180 and 180';
    return null;
  },

  /* --- Statistics from array --- */
  computeStats(data, nodata) {
    const valid = [];
    let nodataCount = 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (nodata !== undefined && nodata !== null && v === nodata) {
        nodataCount++;
        continue;
      }
      if (isNaN(v) || v < -1000 || v > 10000) {
        nodataCount++;
        continue;
      }
      valid.push(v);
    }
    if (valid.length === 0) return null;
    valid.sort((a, b) => a - b);
    const min = valid[0];
    const max = valid[valid.length - 1];
    let sum = 0;
    for (let i = 0; i < valid.length; i++) sum += valid[i];
    const mean = sum / valid.length;
    const median = valid.length % 2 === 0
      ? (valid[valid.length / 2 - 1] + valid[valid.length / 2]) / 2
      : valid[Math.floor(valid.length / 2)];
    let variance = 0;
    for (let i = 0; i < valid.length; i++) variance += (valid[i] - mean) ** 2;
    const stddev = Math.sqrt(variance / valid.length);
    // Histogram (20 bins)
    const binCount = 20;
    const binWidth = (max - min) / binCount || 1;
    const bins = new Array(binCount).fill(0);
    const binEdges = [];
    for (let i = 0; i <= binCount; i++) binEdges.push(min + i * binWidth);
    for (const v of valid) {
      let idx = Math.floor((v - min) / binWidth);
      if (idx >= binCount) idx = binCount - 1;
      if (idx < 0) idx = 0;
      bins[idx]++;
    }
    return {
      min, max, mean, median, stddev,
      count: valid.length,
      nodataPercent: ((nodataCount / data.length) * 100).toFixed(1),
      histogram: { bins, binEdges }
    };
  },

  /* --- Draw Histogram on Canvas --- */
  drawHistogram(canvas, stats) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;
    const { bins, binEdges } = stats.histogram;
    const maxBin = Math.max(...bins);
    const pad = { top: 6, bottom: 16, left: 4, right: 4 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const barW = plotW / bins.length;

    ctx.clearRect(0, 0, w, h);
    // Bars
    for (let i = 0; i < bins.length; i++) {
      const barH = maxBin > 0 ? (bins[i] / maxBin) * plotH : 0;
      const x = pad.left + i * barW;
      const y = pad.top + plotH - barH;
      const gradient = ctx.createLinearGradient(x, y, x, pad.top + plotH);
      gradient.addColorStop(0, 'rgba(0, 212, 170, 0.8)');
      gradient.addColorStop(1, 'rgba(0, 212, 170, 0.2)');
      ctx.fillStyle = gradient;
      ctx.fillRect(x + 1, y, barW - 2, barH);
    }
    // Axis labels
    ctx.fillStyle = '#4a5568';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(Math.round(stats.min) + 'm', pad.left, h - 2);
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(stats.max) + 'm', w - pad.right, h - 2);
  },

  /* --- Format number --- */
  fmt(n, decimals = 0) {
    if (n === undefined || n === null || isNaN(n)) return '—';
    return Number(n).toFixed(decimals);
  },

  /* --- Client-Side Download --- */
  async downloadBlob(blob, filename) {
    DEM.utils.showLoading(`Preparing ${filename}...`);
    try {
      if (window.showSaveFilePicker) {
        // Native File System API - saves directly to local drive
        const opts = {
          suggestedName: filename,
          types: [{
            description: 'File',
            accept: { [blob.type || 'application/octet-stream']: ['.' + filename.split('.').pop()] }
          }]
        };
        const handle = await window.showSaveFilePicker(opts);
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        DEM.utils.toast(`Saved directly to local drive: ${filename}`, 'success');
      } else {
        // Standard Browser Download (with UUID bug fix)
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        
        // Delay revoke to fix Edge/Chrome missing filename (UUID) bug
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 1000);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Download error:', err);
        DEM.utils.toast('Failed to save file.', 'error');
      }
    } finally {
      DEM.utils.hideLoading();
    }
  },

  /* --- Show/hide loading overlay --- */
  showLoading(text) {
    const overlay = document.getElementById('loading-overlay');
    const textEl = document.getElementById('loading-text');
    textEl.textContent = text || 'Processing...';
    overlay.classList.add('visible');
  },
  hideLoading() {
    document.getElementById('loading-overlay').classList.remove('visible');
  },

  /* --- Progress bar --- */
  showProgress(status) {
    const container = document.getElementById('download-progress');
    const fill = document.getElementById('progress-fill');
    const statusEl = document.getElementById('progress-status');
    container.classList.add('visible');
    fill.classList.add('indeterminate');
    fill.style.width = '';
    statusEl.textContent = status || 'Downloading...';
  },
  updateProgress(percent, status) {
    const fill = document.getElementById('progress-fill');
    const statusEl = document.getElementById('progress-status');
    fill.classList.remove('indeterminate');
    fill.style.width = percent + '%';
    if (status) statusEl.textContent = status;
  },
  hideProgress() {
    const container = document.getElementById('download-progress');
    container.classList.remove('visible');
  }
};
