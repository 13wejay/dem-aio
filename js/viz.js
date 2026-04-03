/* ============================================================
   DEM Explorer — Visualization Module
   ============================================================ */
window.DEM = window.DEM || {};

DEM.viz = (function () {
  let elevationCanvas = null;
  let hillshadeCanvas = null;
  let contourGeoJSON = null;
  let rawTiffBlob = null; // for export

  /* --- Color Ramp Definitions --- */
  const colorRamps = {
    viridis: ['#440154','#482878','#3e4989','#31688e','#26838f','#1f9d8a','#6cce5a','#b6de2b','#fee825'],
    terrain: ['#333399','#0077ff','#2d8f2d','#7ab648','#a6782b','#c49755','#f5f5dc','#ffffff'],
    jet:     ['#000080','#0000ff','#00bfff','#00ff80','#80ff00','#ffff00','#ff8000','#ff0000','#800000'],
    grayscale: ['#000000','#ffffff']
  };

  /* --- Render Elevation Map --- */
  function renderElevation(demData, colorRampName, opacity) {
    const { data, width, height, bbox } = demData;
    if (!elevationCanvas) elevationCanvas = document.createElement('canvas');
    elevationCanvas.width = width;
    elevationCanvas.height = height;

    // Find valid min/max
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < data.length; i++) {
      if (isNaN(data[i])) continue;
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }
    if (!isFinite(min)) { min = 0; max = 100; }

    const ramp = colorRampName || 'viridis';

    // Use plotty if available, else manual rendering
    if (typeof plotty !== 'undefined') {
      try {
        // Replace NaN with min-1 for plotty
        const cleanData = new Float32Array(data.length);
        for (let i = 0; i < data.length; i++) {
          cleanData[i] = isNaN(data[i]) ? min - 1 : data[i];
        }
        const plot = new plotty.plot({
          canvas: elevationCanvas,
          data: cleanData,
          width: width,
          height: height,
          domain: [min, max],
          colorScale: ramp
        });
        plot.render();
      } catch (e) {
        console.warn('Plotty failed, using manual rendering:', e);
        manualColorRender(elevationCanvas, data, width, height, min, max, ramp);
      }
    } else {
      manualColorRender(elevationCanvas, data, width, height, min, max, ramp);
    }

    // Create image overlay on map
    const imageUrl = elevationCanvas.toDataURL('image/png');
    const bounds = DEM.mapModule.getLeafletBounds(bbox);
    DEM.mapModule.setElevationOverlay(imageUrl, bounds, opacity !== undefined ? opacity : 0.8);

    // Update legend
    updateLegend(min, max, ramp);

    return { min, max, imageUrl };
  }

  /* --- Manual Color Ramp Rendering (fallback) --- */
  function manualColorRender(canvas, data, width, height, min, max, rampName) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);
    const rampColors = colorRamps[rampName] || colorRamps.viridis;
    const range = max - min || 1;

    for (let i = 0; i < data.length; i++) {
      const px = i * 4;
      if (isNaN(data[i])) {
        imgData.data[px] = 0;
        imgData.data[px + 1] = 0;
        imgData.data[px + 2] = 0;
        imgData.data[px + 3] = 0;
        continue;
      }
      const t = Math.max(0, Math.min(1, (data[i] - min) / range));
      const [r, g, b] = interpolateRamp(rampColors, t);
      imgData.data[px] = r;
      imgData.data[px + 1] = g;
      imgData.data[px + 2] = b;
      imgData.data[px + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function interpolateRamp(colors, t) {
    const n = colors.length - 1;
    const idx = t * n;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, n);
    const frac = idx - lo;
    const c1 = hexToRgb(colors[lo]);
    const c2 = hexToRgb(colors[hi]);
    return [
      Math.round(c1[0] + (c2[0] - c1[0]) * frac),
      Math.round(c1[1] + (c2[1] - c1[1]) * frac),
      Math.round(c1[2] + (c2[2] - c1[2]) * frac)
    ];
  }

  function hexToRgb(hex) {
    const v = parseInt(hex.replace('#', ''), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  /* --- Update Legend --- */
  function updateLegend(min, max, rampName) {
    const legend = document.getElementById('legend-bar');
    const gradient = document.getElementById('legend-gradient');
    const minEl = document.getElementById('legend-min');
    const maxEl = document.getElementById('legend-max');

    const rampColors = colorRamps[rampName] || colorRamps.viridis;
    const stops = rampColors.map((c, i) => `${c} ${(i / (rampColors.length - 1) * 100).toFixed(0)}%`);
    gradient.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
    minEl.textContent = Math.round(min) + ' m';
    maxEl.textContent = Math.round(max) + ' m';
    legend.classList.add('visible');
  }

  /* --- Compute Hillshade --- */
  function computeHillshade(demData, azimuth, altitude, zFactor) {
    const { data, width, height, transform } = demData;
    const cellSize = Math.abs(transform.pixelWidth) * 111320; // approx meters per degree
    const result = new Uint8Array(width * height);
    const az = ((360 - azimuth + 90) % 360) * Math.PI / 180;
    const alt = altitude * Math.PI / 180;
    const zf = zFactor || 1;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        // Get 8 neighbors, handle NaN
        const tl = val(data, idx - width - 1);
        const tc = val(data, idx - width);
        const tr = val(data, idx - width + 1);
        const ml = val(data, idx - 1);
        const mr = val(data, idx + 1);
        const bl = val(data, idx + width - 1);
        const bc = val(data, idx + width);
        const br = val(data, idx + width + 1);

        const dzdx = ((tr + 2 * mr + br) - (tl + 2 * ml + bl)) / (8 * cellSize) * zf;
        const dzdy = ((tl + 2 * tc + tr) - (bl + 2 * bc + br)) / (8 * cellSize) * zf;

        const slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
        const aspect = Math.atan2(dzdy, -dzdx);

        let hs = Math.cos(alt) * Math.cos(slope) +
                 Math.sin(alt) * Math.sin(slope) * Math.cos(az - aspect);

        result[idx] = Math.max(0, Math.min(255, Math.round(hs * 255)));
      }
    }
    // Fill edges
    for (let x = 0; x < width; x++) {
      result[x] = result[width + x];
      result[(height - 1) * width + x] = result[(height - 2) * width + x];
    }
    for (let y = 0; y < height; y++) {
      result[y * width] = result[y * width + 1];
      result[y * width + width - 1] = result[y * width + width - 2];
    }
    return result;
  }

  function val(data, idx) {
    const v = data[idx];
    return isNaN(v) ? 0 : v;
  }

  /* --- Render Hillshade --- */
  function renderHillshade(demData, azimuth, altitude, zFactor, blend) {
    const { width, height, bbox, data } = demData;
    const hsData = computeHillshade(demData, azimuth, altitude, zFactor);

    if (!hillshadeCanvas) hillshadeCanvas = document.createElement('canvas');
    hillshadeCanvas.width = width;
    hillshadeCanvas.height = height;
    const ctx = hillshadeCanvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);

    if (blend > 0) {
      // Blend with elevation color ramp
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < data.length; i++) {
        if (!isNaN(data[i])) { min = Math.min(min, data[i]); max = Math.max(max, data[i]); }
      }
      const range = max - min || 1;
      const rampName = document.getElementById('color-ramp').value || 'viridis';
      const rampColors = colorRamps[rampName] || colorRamps.viridis;

      for (let i = 0; i < data.length; i++) {
        const px = i * 4;
        if (isNaN(data[i])) {
          imgData.data[px] = imgData.data[px+1] = imgData.data[px+2] = 0;
          imgData.data[px+3] = 0;
          continue;
        }
        const t = Math.max(0, Math.min(1, (data[i] - min) / range));
        const [cr, cg, cb] = interpolateRamp(rampColors, t);
        const hs = hsData[i] / 255;
        const b = blend / 100;
        imgData.data[px]     = Math.round(cr * b * hs + (1-b) * hsData[i]);
        imgData.data[px + 1] = Math.round(cg * b * hs + (1-b) * hsData[i]);
        imgData.data[px + 2] = Math.round(cb * b * hs + (1-b) * hsData[i]);
        imgData.data[px + 3] = 255;
      }
    } else {
      // Pure grayscale hillshade
      for (let i = 0; i < hsData.length; i++) {
        const px = i * 4;
        imgData.data[px] = hsData[i];
        imgData.data[px + 1] = hsData[i];
        imgData.data[px + 2] = hsData[i];
        imgData.data[px + 3] = isNaN(data[i]) ? 0 : 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    const imageUrl = hillshadeCanvas.toDataURL('image/png');
    const bounds = DEM.mapModule.getLeafletBounds(bbox);
    DEM.mapModule.setHillshadeOverlay(imageUrl, bounds, 0.85);
    return imageUrl;
  }

  /* --- Generate Contours (Marching Squares) --- */
  function generateContours(demData, interval, color, lineWidth, showLabels) {
    const { data, width, height, transform, bbox } = demData;

    // Find valid range
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < data.length; i++) {
      if (!isNaN(data[i])) { min = Math.min(min, data[i]); max = Math.max(max, data[i]); }
    }

    const startLevel = Math.ceil(min / interval) * interval;
    const features = [];

    for (let level = startLevel; level <= max; level += interval) {
      const segments = marchingSquares(data, width, height, level);
      const lines = chainSegments(segments);

      for (const line of lines) {
        if (line.length < 2) continue;
        const coords = line.map(([px, py]) => {
          const lon = transform.originX + px * transform.pixelWidth;
          const lat = transform.originY + py * transform.pixelHeight;
          return [lon, lat];
        });
        // Simplify (remove near-duplicate points)
        const simplified = simplifyLine(coords, Math.abs(transform.pixelWidth) * 0.3);
        if (simplified.length >= 2) {
          features.push({
            type: 'Feature',
            properties: { elevation: level, interval: interval },
            geometry: { type: 'LineString', coordinates: simplified }
          });
        }
      }
    }

    contourGeoJSON = { type: 'FeatureCollection', features };
    DEM.mapModule.setContourLayer(contourGeoJSON, color, lineWidth, showLabels);
    return contourGeoJSON;
  }

  /* --- Marching Squares --- */
  function marchingSquares(data, width, height, threshold) {
    const segments = [];

    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const tl = data[y * width + x];
        const tr = data[y * width + x + 1];
        const br = data[(y + 1) * width + x + 1];
        const bl = data[(y + 1) * width + x];

        if (isNaN(tl) || isNaN(tr) || isNaN(br) || isNaN(bl)) continue;

        let caseIdx = 0;
        if (tl >= threshold) caseIdx |= 8;
        if (tr >= threshold) caseIdx |= 4;
        if (br >= threshold) caseIdx |= 2;
        if (bl >= threshold) caseIdx |= 1;

        if (caseIdx === 0 || caseIdx === 15) continue;

        const lerp = (a, b) => {
          const d = b - a;
          return d === 0 ? 0.5 : (threshold - a) / d;
        };

        const top    = [x + lerp(tl, tr), y];
        const right  = [x + 1, y + lerp(tr, br)];
        const bottom = [x + lerp(bl, br), y + 1];
        const left   = [x, y + lerp(tl, bl)];

        switch (caseIdx) {
          case 1:  segments.push([left, bottom]); break;
          case 2:  segments.push([bottom, right]); break;
          case 3:  segments.push([left, right]); break;
          case 4:  segments.push([top, right]); break;
          case 5:  segments.push([top, right]); segments.push([left, bottom]); break;
          case 6:  segments.push([top, bottom]); break;
          case 7:  segments.push([top, left]); break;
          case 8:  segments.push([top, left]); break;
          case 9:  segments.push([top, bottom]); break;
          case 10: segments.push([top, left]); segments.push([bottom, right]); break;
          case 11: segments.push([top, right]); break;
          case 12: segments.push([left, right]); break;
          case 13: segments.push([bottom, right]); break;
          case 14: segments.push([left, bottom]); break;
        }
      }
    }
    return segments;
  }

  /* --- Chain segments into polylines --- */
  function chainSegments(segments) {
    if (segments.length === 0) return [];
    const eps = 0.001;
    const lines = [];
    const used = new Uint8Array(segments.length);

    function ptEq(a, b) {
      return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
    }

    for (let i = 0; i < segments.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const line = [segments[i][0], segments[i][1]];
      let changed = true;

      while (changed) {
        changed = false;
        for (let j = 0; j < segments.length; j++) {
          if (used[j]) continue;
          const [a, b] = segments[j];
          if (ptEq(line[line.length - 1], a)) {
            line.push(b); used[j] = 1; changed = true;
          } else if (ptEq(line[line.length - 1], b)) {
            line.push(a); used[j] = 1; changed = true;
          } else if (ptEq(line[0], b)) {
            line.unshift(a); used[j] = 1; changed = true;
          } else if (ptEq(line[0], a)) {
            line.unshift(b); used[j] = 1; changed = true;
          }
        }
      }
      lines.push(line);
    }
    return lines;
  }

  /* --- Simplify line (Douglas-Peucker-lite) --- */
  function simplifyLine(coords, tolerance) {
    if (coords.length <= 2) return coords;
    const result = [coords[0]];
    for (let i = 1; i < coords.length; i++) {
      const prev = result[result.length - 1];
      const dx = coords[i][0] - prev[0];
      const dy = coords[i][1] - prev[1];
      if (Math.sqrt(dx * dx + dy * dy) > tolerance || i === coords.length - 1) {
        result.push(coords[i]);
      }
    }
    return result;
  }

  /* --- Get canvases for export --- */
  function getElevationCanvas() { return elevationCanvas; }
  function getHillshadeCanvas() { return hillshadeCanvas; }
  function getContourGeoJSON() { return contourGeoJSON; }

  return {
    renderElevation, renderHillshade, generateContours,
    getElevationCanvas, getHillshadeCanvas, getContourGeoJSON,
    colorRamps
  };
})();
