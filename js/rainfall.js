/* ============================================================
   DEM Explorer — GPM IMERG Rainfall Data Module
   Fetches daily precipitation from NASA GPM IMERG Late (V07)
   via OPeNDAP ASCII subsetting, using Earthdata Bearer auth.
   ============================================================ */
window.DEM = window.DEM || {};

DEM.rainfall = (function () {
  /* ---------- state ---------- */
  let state = {
    dailyData: [],      // [{ date, grid: Float32Array, width, height, bbox, mean, max, total }]
    currentIndex: 0,
    bbox: null,
    fetching: false,
  };

  /* ---------- constants ---------- */
  const OPENDAP_BASE =
    'https://gpm1.gesdisc.eosdis.nasa.gov/opendap/GPM_L3/GPM_3IMERGDL.07';

  // IMERG grid: 0.1° resolution
  // Longitude: -180 to 180 → 3600 cells, index 0 = -179.95, index 3599 = 179.95
  // Latitude:  -90 to 90   → 1800 cells, index 0 = -89.95, index 1799 = 89.95
  const LON_MIN = -180, LON_RES = 0.1, LON_COUNT = 3600;
  const LAT_MIN = -90,  LAT_RES = 0.1, LAT_COUNT = 1800;

  /* ---------- helpers ---------- */

  /** Convert lon/lat bbox to IMERG grid index ranges */
  function bboxToIndices(bbox) {
    let lonStart = Math.floor((bbox.west  - LON_MIN) / LON_RES);
    let lonEnd   = Math.ceil ((bbox.east  - LON_MIN) / LON_RES) - 1;
    let latStart = Math.floor((bbox.south - LAT_MIN) / LAT_RES);
    let latEnd   = Math.ceil ((bbox.north - LAT_MIN) / LAT_RES) - 1;

    // Clamp
    lonStart = Math.max(0, Math.min(LON_COUNT - 1, lonStart));
    lonEnd   = Math.max(0, Math.min(LON_COUNT - 1, lonEnd));
    latStart = Math.max(0, Math.min(LAT_COUNT - 1, latStart));
    latEnd   = Math.max(0, Math.min(LAT_COUNT - 1, latEnd));

    return { lonStart, lonEnd, latStart, latEnd };
  }

  /** Convert grid indices back to actual geographic bounds (cell edges) */
  function indicesToBbox(lonStart, lonEnd, latStart, latEnd) {
    return {
      west:  LON_MIN + lonStart * LON_RES,
      east:  LON_MIN + (lonEnd + 1) * LON_RES,
      south: LAT_MIN + latStart * LAT_RES,
      north: LAT_MIN + (latEnd + 1) * LAT_RES,
    };
  }

  /** Day-of-year (1-based, zero-padded to 3 chars) */
  function dayOfYear(d) {
    const start = new Date(d.getFullYear(), 0, 0);
    const diff = d - start;
    const oneDay = 86400000;
    return String(Math.floor(diff / oneDay)).padStart(3, '0');
  }

  /** Format date as YYYYMMDD */
  function yyyymmdd(d) {
    return d.getFullYear().toString()
      + String(d.getMonth() + 1).padStart(2, '0')
      + String(d.getDate()).padStart(2, '0');
  }

  /** Build OPeNDAP ASCII URL for one day + bbox subset */
  function buildUrl(date, bbox) {
    const yr   = date.getFullYear();
    const mm   = String(date.getMonth() + 1).padStart(2, '0');
    const ymd  = yyyymmdd(date);
    const { lonStart, lonEnd, latStart, latEnd } = bboxToIndices(bbox);

    // File path on GES DISC — directory is YYYY/MM/
    const filename = `3B-DAY-L.MS.MRG.3IMERG.${ymd}-S000000-E235959.V07B.nc4`;

    // OPeNDAP ASCII subset with coordinate variables:
    // precipitation[time][lon][lat], time, lon[subset], lat[subset]
    const subset = `precipitation[0:0][${lonStart}:${lonEnd}][${latStart}:${latEnd}]`
      + `,time,lon[${lonStart}:${lonEnd}],lat[${latStart}:${latEnd}]`;

    return `${OPENDAP_BASE}/${yr}/${mm}/${filename}.ascii?${subset}`;
  }

  /** Parse OPeNDAP DAP2 ASCII response into a Float32Array grid.
   *  The ASCII format looks like:
   *    Dataset { ... } ...;
   *    precipitation.precipitation[1][lonCount][latCount]
   *    [0][0], value, value, ...
   *    [0][1], value, value, ...
   *    ...
   */
  function parseAsciiResponse(text, lonCount, latCount) {
    const grid = new Float32Array(lonCount * latCount);
    grid.fill(-9999.9);

    // Find the data block: starts after the line containing the array header
    const lines = text.split('\n');
    let dataStarted = false;
    let pixelIdx = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Data lines look like: "[0][0], 0.123, 0.456, ..." or just numbers
      if (!dataStarted) {
        // The data block starts after a line like "precipitation.precipitation[1][N][M]"
        if (line.match(/precipitation\.\w*\[/) || line.match(/^precipitation\[/)) {
          dataStarted = true;
        }
        continue;
      }

      // Stop if we hit coordinate variable sections (time, lon, lat)
      if (line.startsWith('time') || line.startsWith('lon') || line.startsWith('lat')) break;

      // Skip empty lines and metadata
      if (!line || line.startsWith('Dataset') || line.startsWith('}') || line.endsWith(';')) continue;

      // Parse data lines — format: "[lonIdx][latIdx], val, val, val, ..."
      // or just "[lonIdx], val, val, ..."
      const match = line.match(/^(\[\d+\])+,?\s*(.*)/);
      if (match) {
        const valuesStr = match[2];
        const values = valuesStr.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
        for (const val of values) {
          if (pixelIdx < grid.length) {
            grid[pixelIdx++] = val;
          }
        }
      } else {
        // Try parsing as plain comma-separated values
        const values = line.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
        if (values.length > 0) {
          for (const val of values) {
            if (pixelIdx < grid.length) {
              grid[pixelIdx++] = val;
            }
          }
        }
      }
    }

    return grid;
  }

  /** Compute stats for one day's grid */
  function computeDayStats(grid) {
    let sum = 0, count = 0, max = -Infinity, min = Infinity;
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i];
      if (v < 0 || v >= 9999 || isNaN(v)) continue; // nodata
      sum += v;
      count++;
      if (v > max) max = v;
      if (v < min) min = v;
    }
    return {
      mean: count > 0 ? sum / count : 0,
      max: count > 0 ? max : 0,
      min: count > 0 ? min : 0,
      total: sum,
      validPixels: count,
    };
  }

  /* ---------- public API ---------- */

  /** Fetch daily IMERG rainfall data for a date range and bounding box */
  async function fetchRange(startDate, endDate, bbox) {
    state.dailyData = [];
    state.bbox = bbox;
    state.fetching = true;

    const { lonStart, lonEnd, latStart, latEnd } = bboxToIndices(bbox);
    const lonCount = lonEnd - lonStart + 1;
    const latCount = latEnd - latStart + 1;

    // Compute actual data bounds from grid indices (not user bbox)
    const dataBbox = indicesToBbox(lonStart, lonEnd, latStart, latEnd);

    // Build date list
    const dates = [];
    const d = new Date(startDate);
    const end = new Date(endDate);
    while (d <= end) {
      dates.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }

    if (dates.length === 0) throw new Error('No dates in range');
    if (dates.length > 90) throw new Error('Max 90 days supported per fetch');

    // Store dates & bbox for NetCDF download
    state.bbox = bbox;
    state.dataBbox = dataBbox;
    state.dateList = dates;

    DEM.utils.showLocalProgress('rain-progress', 'Fetching GPM IMERG...');

    let completed = 0;
    const errors = [];

    for (const date of dates) {
      try {
        const url = buildUrl(date, bbox);
        const proxyUrl = '/api/earthdata?url=' + encodeURIComponent(url);

        DEM.utils.updateLocalProgress(
          'rain-progress',
          Math.round((completed / dates.length) * 100),
          `Fetching ${yyyymmdd(date)} (${completed + 1}/${dates.length})...`
        );

        const res = await fetch(proxyUrl);
        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          console.warn(`[GPM] ${yyyymmdd(date)} HTTP ${res.status}:`, errBody.substring(0, 300));
          errors.push(`${yyyymmdd(date)}: HTTP ${res.status}`);
          completed++;
          continue;
        }

        const text = await res.text();
        const grid = parseAsciiResponse(text, lonCount, latCount);
        const stats = computeDayStats(grid);

        state.dailyData.push({
          date: date,
          dateStr: yyyymmdd(date),
          grid: grid,
          width: lonCount,   // IMERG: lon is the "column" dimension
          height: latCount,  // IMERG: lat is the "row" dimension
          bbox: dataBbox,    // Use actual data bounds, not user bbox
          ...stats,
        });
      } catch (e) {
        errors.push(`${yyyymmdd(date)}: ${e.message}`);
      }
      completed++;
    }

    state.fetching = false;
    DEM.utils.hideLocalProgress('rain-progress');

    if (errors.length > 0 && state.dailyData.length === 0) {
      throw new Error('All fetches failed. First error: ' + errors[0]);
    }
    if (errors.length > 0) {
      DEM.utils.toast(`${errors.length} day(s) failed to fetch`, 'info');
    }

    // Sort by date
    state.dailyData.sort((a, b) => a.date - b.date);
    state.currentIndex = 0;

    return state.dailyData;
  }

  /** Render the rainfall grid for the day at `index` on the map */
  function showDay(index) {
    if (index < 0 || index >= state.dailyData.length) return;
    state.currentIndex = index;
    const day = state.dailyData[index];

    // Find the global max across all days for consistent color scale
    let globalMax = 0;
    for (const d of state.dailyData) {
      if (d.max > globalMax) globalMax = d.max;
    }
    if (globalMax <= 0) globalMax = 1;

    if (DEM.mapModule && DEM.mapModule.renderRainfall) {
      // IMERG grid is stored as [lon][lat] — we need to transpose to [row=lat][col=lon]
      const transposed = transposeGrid(day.grid, day.width, day.height);
      DEM.mapModule.renderRainfall(transposed, day.width, day.height, day.bbox, globalMax, state.bbox);
    }

    return day;
  }

  /** Transpose from [lon][lat] → [lat][lon] for image rendering (row-major: lat=rows, lon=cols) */
  function transposeGrid(grid, lonCount, latCount) {
    const out = new Float32Array(lonCount * latCount);
    for (let lonIdx = 0; lonIdx < lonCount; lonIdx++) {
      for (let latIdx = 0; latIdx < latCount; latIdx++) {
        // Input index: lonIdx * latCount + latIdx
        // Output index: (latCount - 1 - latIdx) * lonCount + lonIdx  (flip lat for top-down image)
        const srcIdx = lonIdx * latCount + latIdx;
        const dstIdx = (latCount - 1 - latIdx) * lonCount + lonIdx;
        out[dstIdx] = grid[srcIdx];
      }
    }
    return out;
  }

  /** Draw trend chart on a canvas element */
  function drawTrendChart(canvas) {
    if (!canvas || state.dailyData.length === 0) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    const pad = { top: 8, bottom: 22, left: 6, right: 6 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    const data = state.dailyData;
    const n = data.length;
    const maxVal = Math.max(...data.map(d => d.mean), 0.1);
    const barW = Math.max(2, plotW / n - 1);

    // Draw bars
    for (let i = 0; i < n; i++) {
      const barH = (data[i].mean / maxVal) * plotH;
      const x = pad.left + (i / n) * plotW;
      const y = pad.top + plotH - barH;

      // Gradient from teal-blue to purple
      const gradient = ctx.createLinearGradient(x, y, x, pad.top + plotH);
      gradient.addColorStop(0, 'rgba(59, 130, 246, 0.9)');
      gradient.addColorStop(1, 'rgba(59, 130, 246, 0.2)');
      ctx.fillStyle = gradient;

      // Highlight current day
      if (i === state.currentIndex) {
        ctx.fillStyle = 'rgba(0, 212, 170, 0.9)';
      }

      ctx.fillRect(x, y, Math.max(barW, 2), barH);
    }

    // X-axis labels (first and last date)
    ctx.fillStyle = '#4a5568';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(formatDateShort(data[0].date), pad.left, h - 3);
    ctx.textAlign = 'right';
    ctx.fillText(formatDateShort(data[n - 1].date), w - pad.right, h - 3);

    // Y-axis label
    ctx.textAlign = 'right';
    ctx.fillText(maxVal.toFixed(1) + ' mm', w - pad.right, pad.top + 8);
  }

  function formatDateShort(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  /** Export daily rainfall summary as CSV */
  function exportCSV() {
    if (state.dailyData.length === 0) return null;

    const header = 'date,mean_rainfall_mm,max_rainfall_mm,min_rainfall_mm,total_rainfall_mm,valid_pixels';
    const rows = state.dailyData.map(d => {
      return [
        d.dateStr,
        d.mean.toFixed(3),
        d.max.toFixed(3),
        d.min.toFixed(3),
        d.total.toFixed(3),
        d.validPixels,
      ].join(',');
    });

    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    return blob;
  }

  /** Download raw NetCDF4 files for the selected date range as a ZIP */
  async function downloadNetCDF() {
    if (!state.dateList || state.dateList.length === 0 || !state.bbox) {
      DEM.utils.toast('Fetch rainfall data first', 'error');
      return;
    }

    if (typeof JSZip === 'undefined') {
      DEM.utils.toast('JSZip library not loaded', 'error');
      return;
    }

    const zip = new JSZip();
    const dates = state.dateList;
    const bbox = state.bbox;
    const { lonStart, lonEnd, latStart, latEnd } = bboxToIndices(bbox);

    DEM.utils.showLocalProgress('rain-progress', 'Downloading NetCDF files...');
    let completed = 0;
    const errors = [];

    for (const date of dates) {
      const yr  = date.getFullYear();
      const mm  = String(date.getMonth() + 1).padStart(2, '0');
      const ymd = yyyymmdd(date);
      const filename = `3B-DAY-L.MS.MRG.3IMERG.${ymd}-S000000-E235959.V07B.nc4`;

      // Request subsetted NetCDF4 binary (.nc4 extension)
      const subset = `precipitation[0:0][${lonStart}:${lonEnd}][${latStart}:${latEnd}]`
        + `,time,lon[${lonStart}:${lonEnd}],lat[${latStart}:${latEnd}]`;
      const url = `${OPENDAP_BASE}/${yr}/${mm}/${filename}.nc4?${subset}`;
      const proxyUrl = '/api/earthdata?url=' + encodeURIComponent(url);

      DEM.utils.updateLocalProgress(
        'rain-progress',
        Math.round((completed / dates.length) * 100),
        `Downloading ${ymd} (${completed + 1}/${dates.length})...`
      );

      try {
        const res = await fetch(proxyUrl);
        if (!res.ok) {
          errors.push(`${ymd}: HTTP ${res.status}`);
          completed++;
          continue;
        }
        const blob = await res.blob();
        const ncFilename = `IMERG_${ymd}.nc4`;
        zip.file(ncFilename, blob);
      } catch (e) {
        errors.push(`${ymd}: ${e.message}`);
      }
      completed++;
    }

    DEM.utils.updateLocalProgress('rain-progress', 95, 'Compressing ZIP...');

    if (Object.keys(zip.files).length === 0) {
      DEM.utils.hideLocalProgress('rain-progress');
      DEM.utils.toast('No files downloaded. ' + (errors[0] || ''), 'error');
      return;
    }

    try {
      const content = await zip.generateAsync({ type: 'blob' });
      const startStr = yyyymmdd(dates[0]);
      const endStr = yyyymmdd(dates[dates.length - 1]);
      DEM.utils.downloadBlob(content, `GPM_IMERG_${startStr}_${endStr}.zip`);
      DEM.utils.toast(`Downloaded ${Object.keys(zip.files).length} NetCDF files`, 'success');
    } catch (e) {
      DEM.utils.toast('ZIP generation failed: ' + e.message, 'error');
    }

    DEM.utils.hideLocalProgress('rain-progress');
    if (errors.length > 0) {
      DEM.utils.toast(`${errors.length} file(s) failed to download`, 'info');
    }
  }

  /** Get state for external reads */
  function getState() {
    return state;
  }

  return {
    fetchRange,
    showDay,
    drawTrendChart,
    exportCSV,
    downloadNetCDF,
    getState,
  };
})();
