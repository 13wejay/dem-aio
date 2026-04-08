// Hydrology and Watershed Delineation Module

window.DEM = window.DEM || {};

DEM.hydro = (function () {
  let hydroState = {
    fillRaster: null, // Float32Array of filled DEM
    dirRaster: null,  // Int8Array of D8 flow directions
    accRaster: null,  // Int32Array of accumulated flow cells
    width: 0,
    height: 0,
    transform: null,
    bbox: null,
    nodata: -9999,
    streamsGeoJSON: null,
    catchmentGeoJSON: null,
    isSelectingPourPoint: false
  };

  const DIR_MAP = [
    [32, 64, 128],
    [16,  0,   1],
    [ 8,  4,   2]
  ]; // Standard D8 directions: 1=E, 2=SE, 4=S, 8=SW, 16=W, 32=NW, 64=N, 128=NE

  const DROW = [-1, -1, -1,  0,  1,  1,  1,  0];
  const DCOL = [ 1,  0, -1, -1, -1,  0,  1,  1];
  const DVAL = [128, 64, 32, 16,  8,  4,  2,  1];

  let btnGenerate, progressContainer, progressFill, progressStatus;
  let toolsRiver, toolsWatershed;

  function init() {
    btnGenerate = document.getElementById('btn-generate-hydro');
    progressContainer = document.getElementById('hydro-progress');
    progressFill = document.getElementById('hydro-progress-fill');
    progressStatus = document.getElementById('hydro-progress-status');
    toolsRiver = document.getElementById('hydro-river-tools');
    toolsWatershed = document.getElementById('hydro-watershed-tools');

    if (btnGenerate) {
      btnGenerate.addEventListener('click', generateRasters);
    }
    
    document.getElementById('btn-extract-streams')?.addEventListener('click', extractStreams);
    document.getElementById('btn-select-pour-point')?.addEventListener('click', togglePourPointMode);

    // Layer Toggles
    document.getElementById('toggle-hydro-fill')?.addEventListener('change', (e) => toggleLayer('fill', e.target.checked));
    document.getElementById('toggle-hydro-dir')?.addEventListener('change', (e) => toggleLayer('dir', e.target.checked));
    document.getElementById('toggle-hydro-acc')?.addEventListener('change', (e) => toggleLayer('acc', e.target.checked));
    document.getElementById('toggle-hydro-stream')?.addEventListener('change', (e) => toggleLayer('stream', e.target.checked));
    document.getElementById('toggle-hydro-catchment')?.addEventListener('change', (e) => toggleLayer('catchment', e.target.checked));

    // Opacity
    document.getElementById('hydro-opacity')?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      document.getElementById('hydro-opacity-val').textContent = val + '%';
      setHydroOpacity(val / 100);
    });

    // Exports
    document.getElementById('btn-export-hydro-fill')?.addEventListener('click', () => exportHydroGeoTIFF('filled_dem', hydroState.fillRaster));
    document.getElementById('btn-export-hydro-dir')?.addEventListener('click', () => exportHydroGeoTIFF('flow_direction', hydroState.dirRaster));
    document.getElementById('btn-export-hydro-acc')?.addEventListener('click', () => exportHydroGeoTIFF('flow_accumulation', hydroState.accRaster));
    document.getElementById('btn-export-hydro-stream')?.addEventListener('click', () => exportHydroGeoJSON('stream_network', hydroState.streamsGeoJSON));
    document.getElementById('btn-export-hydro-catchment')?.addEventListener('click', () => exportHydroGeoJSON('catchment', hydroState.catchmentGeoJSON));
  }

  function setHydroOpacity(opacity) {
    if (hydroState.fillLayer) hydroState.fillLayer.setOpacity(opacity);
    if (hydroState.dirLayer) hydroState.dirLayer.setOpacity(opacity);
    if (hydroState.accLayer) hydroState.accLayer.setOpacity(opacity);
    if (hydroState.catchmentLayer) hydroState.catchmentLayer.setOpacity(opacity);
    if (hydroState.streamLayer) {
      hydroState.streamLayer.setStyle({ opacity: opacity });
    }
  }

  function toggleLayer(type, show) {
    const appMap = DEM.mapModule.getMap();
    let layer = null;
    let legendId = null;

    if (type === 'fill') { layer = hydroState.fillLayer; legendId = 'map-legend-hydro-fill'; }
    if (type === 'dir') { layer = hydroState.dirLayer; legendId = 'map-legend-hydro-dir'; }
    if (type === 'acc') { layer = hydroState.accLayer; legendId = 'map-legend-hydro-acc'; }
    if (type === 'stream') { layer = hydroState.streamLayer; legendId = 'map-legend-hydro-stream'; }
    if (type === 'catchment') layer = hydroState.catchmentLayer;

    if (!layer && type !== 'stream' && type !== 'catchment') return; // Stream and catchment wait for extraction, handle safely gracefully

    const legendsBox = document.getElementById('float-map-legends');
    if (legendsBox) legendsBox.style.display = 'block';

    if (legendId) {
      const legendEl = document.getElementById(legendId);
      if (legendEl) legendEl.style.display = show ? 'block' : 'none';
    }

    if (layer) {
      if (show) {
        if (!appMap.hasLayer(layer)) layer.addTo(appMap);
      } else {
        if (appMap.hasLayer(layer)) appMap.removeLayer(layer);
      }
    }
  }

  function updateProgress(percent, msg) {
    if (percent < 0) {
      progressContainer.style.display = 'none';
    } else {
      progressContainer.style.display = 'block';
      progressFill.style.width = percent + '%';
      if (msg) progressStatus.textContent = msg;
    }
  }

  async function generateRasters() {
    const demData = DEM.dem.getCurrent();
    if (!demData) {
      DEM.utils.toast('Please download a DEM first', 'error');
      return;
    }

    const { data, width, height, transform, bbox } = demData;
    const nodata = isNaN(demData.nodata) ? -9999 : demData.nodata;

    hydroState.width = width;
    hydroState.height = height;
    hydroState.transform = transform;
    hydroState.bbox = bbox;
    hydroState.nodata = nodata;

    btnGenerate.disabled = true;

    // We use setTimeout to yield to the UI thread before heavy blocking operations
    // Ideal production code would use a Web Worker
    
    updateProgress(10, 'Filling sinks (Planchon-Darboux)...');
    await new Promise(r => setTimeout(r, 50));
    hydroState.fillRaster = fillSinks(data, width, height, nodata);
    
    // Distance mode logic
    const mode = document.getElementById('hydro-distance-mode').value;
    let dx = Math.abs(transform.pixelWidth);
    let dy = Math.abs(transform.pixelHeight);
    
    // If approximate, stretch horizontal distance by cos(lat) and convert to pseudo-meters
    if (mode === 'approximate') {
      const midLat = (bbox.north + bbox.south) / 2;
      dx = dx * 111320 * Math.cos(midLat * Math.PI / 180);
      dy = dy * 111320;
    } else {
      // Treat as square simple units (or roughly nearest neighbor)
      dx = 1; dy = 1;
    }

    updateProgress(50, 'Calculating D8 Flow Direction...');
    await new Promise(r => setTimeout(r, 50));
    hydroState.dirRaster = computeFlowDirection(hydroState.fillRaster, width, height, nodata, dx, dy);

    updateProgress(80, 'Accumulating Flow...');
    await new Promise(r => setTimeout(r, 50));
    hydroState.accRaster = computeFlowAccumulation(hydroState.dirRaster, width, height, nodata);

    updateProgress(100, 'Adding map layers...');
    document.getElementById('hydro-layer-toggles').style.display = 'block';
    toolsRiver.style.display = 'block';
    toolsWatershed.style.display = 'block';
    
    // Show hydro exports and enable base grid buttons
    const hydroExports = document.getElementById('hydro-exports');
    if (hydroExports) hydroExports.style.display = 'block';
    
    document.getElementById('btn-export-hydro-fill').disabled = false;
    document.getElementById('btn-export-hydro-dir').disabled = false;
    document.getElementById('btn-export-hydro-acc').disabled = false;

    setTimeout(() => {
      updateProgress(-1);
      btnGenerate.disabled = false;
      DEM.utils.toast('Hydrology rasters generated!', 'success');
      visualizeFillRaster();
      visualizeDirRaster();
      visualizeAccumulation();
      
      // Sync UI toggles
      document.getElementById('toggle-hydro-fill').checked = false;
      document.getElementById('toggle-hydro-dir').checked = false;
      document.getElementById('toggle-hydro-acc').checked = true;
      document.getElementById('toggle-hydro-stream').checked = true;
      document.getElementById('toggle-hydro-catchment').checked = true;
      
      toggleLayer('fill', false);
      toggleLayer('dir', false);
      toggleLayer('acc', true);
    }, 500);
  }

  function visualizeFillRaster() {
    if (!hydroState.fillRaster) return;
    const { fillRaster, width, height, bbox } = hydroState;
    
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < fillRaster.length; i++) {
      let v = fillRaster[i];
      if (v !== hydroState.nodata && v > -500 && v < 9000) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }

    const bounds = [[bbox.south, bbox.west], [bbox.north, bbox.east]];
    const canvas = document.createElement('canvas');
    if (typeof plotty !== 'undefined') {
        const plot = new plotty.plot({
          canvas: canvas, data: fillRaster, width: width, height: height,
          domain: [min, max], colorScale: 'terrain', noDataValue: hydroState.nodata
        });
        plot.render();
    }
    
    if (hydroState.fillLayer) {
        const opacity = parseInt(document.getElementById('hydro-opacity').value) / 100;
        hydroState.fillLayer = L.imageOverlay(canvas.toDataURL(), bounds, { opacity: opacity, zIndex: 298 });
    } else {
        hydroState.fillLayer = L.imageOverlay(canvas.toDataURL(), bounds, { opacity: 0.8, zIndex: 298 });
    }
    // Not added to map initially
  }

  function visualizeDirRaster() {
    if (!hydroState.dirRaster) return;
    const { dirRaster, width, height, bbox } = hydroState;
    
    const bounds = [[bbox.south, bbox.west], [bbox.north, bbox.east]];
    const canvas = document.createElement('canvas');
    if (typeof plotty !== 'undefined') {
        const plot = new plotty.plot({
          canvas: canvas, data: dirRaster, width: width, height: height,
          domain: [0, 128], colorScale: 'jet', noDataValue: 0
        });
        plot.render();
    }
    
    if (hydroState.dirLayer) {
        const opacity = parseInt(document.getElementById('hydro-opacity').value) / 100;
        hydroState.dirLayer = L.imageOverlay(canvas.toDataURL(), bounds, { opacity: opacity, zIndex: 299 });
    } else {
        hydroState.dirLayer = L.imageOverlay(canvas.toDataURL(), bounds, { opacity: 0.8, zIndex: 299 });
    }
    // Not added to map initially
  }

  // Planchon-Darboux sink filling algorithm
  function fillSinks(dem, w, h, nodata) {
    const size = w * h;
    const filled = new Float32Array(size);
    filled.fill(Infinity);
    
    // Boundary initialization
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        let idx = r * w + c;
        if (dem[idx] === nodata || isNaN(dem[idx])) {
          filled[idx] = nodata;
        } else {
          // If cell is on the raster edge OR touches a nodata cell, it's an outlet
          let isBoundary = false;
          if (r === 0 || r === h - 1 || c === 0 || c === w - 1) {
            isBoundary = true;
          } else {
            // Check 8-neighbors
            for (let d = 0; d < 8; d++) {
              let nr = r + DROW[d];
              let nc = c + DCOL[d];
              let nIdx = nr * w + nc;
              if (dem[nIdx] === nodata || isNaN(dem[nIdx])) {
                isBoundary = true;
                break;
              }
            }
          }
          if (isBoundary) {
            filled[idx] = dem[idx];
          }
        }
      }
    }

    let modified = true;
    let iter = 0;
    // Fast O(N) iterative sweep
    while (modified && iter < 100) {
      modified = false;
      iter++;
      // Top-left to Bottom-right
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          let idx = r * w + c;
          if (filled[idx] === nodata) continue;
          
          let centerZ = dem[idx];
          if (centerZ === nodata) continue;

          let minNeighborFilled = Infinity;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              let nr = r + dr;
              let nc = c + dc;
              if (nr >= 0 && nr < h && nc >= 0 && nc < w) {
                let nIdx = nr * w + nc;
                if (filled[nIdx] !== nodata && filled[nIdx] < minNeighborFilled) {
                  minNeighborFilled = filled[nIdx];
                }
              }
            }
          }
          
          let newZ = Math.max(centerZ, minNeighborFilled + 0.0001); // 0.0001 explicit slight gradient
          if (filled[idx] > newZ) {
            filled[idx] = newZ;
            modified = true;
          }
        }
      }

      // Bottom-right to Top-left
      for (let r = h - 1; r >= 0; r--) {
        for (let c = w - 1; c >= 0; c--) {
          let idx = r * w + c;
          if (filled[idx] === nodata) continue;
          
          let centerZ = dem[idx];
          if (centerZ === nodata) continue;

          let minNeighborFilled = Infinity;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              let nr = r + dr;
              let nc = c + dc;
              if (nr >= 0 && nr < h && nc >= 0 && nc < w) {
                let nIdx = nr * w + nc;
                if (filled[nIdx] !== nodata && filled[nIdx] < minNeighborFilled) {
                  minNeighborFilled = filled[nIdx];
                }
              }
            }
          }
          
          let newZ = Math.max(centerZ, minNeighborFilled + 0.0001);
          if (filled[idx] > newZ) {
            filled[idx] = newZ;
            modified = true;
          }
        }
      }
    }
    return filled;
  }

  function computeFlowDirection(dem, w, h, nodata, dx, dy) {
    const size = w * h;
    const dir = new Uint8Array(size); // 0 means undefined/nodata
    
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        let idx = r * w + c;
        let z = dem[idx];
        if (z === nodata || isNaN(z)) {
          dir[idx] = 0;
          continue;
        }

        let maxSlope = 0;
        let bestDir = 0;

        for (let i = 0; i < 8; i++) {
          let nr = r + DROW[i];
          let nc = c + DCOL[i];
          if (nr >= 0 && nr < h && nc >= 0 && nc < w) {
            let nIdx = nr * w + nc;
            let nz = dem[nIdx];
            if (nz !== nodata && !isNaN(nz)) {
              let dist = Math.sqrt(Math.pow(DCOL[i]*dx, 2) + Math.pow(DROW[i]*dy, 2));
              let slope = (z - nz) / dist;
              if (slope > maxSlope) {
                maxSlope = slope;
                bestDir = DVAL[i];
              }
            }
          }
        }
        dir[idx] = bestDir;
      }
    }
    return dir;
  }

  function computeFlowAccumulation(dir, w, h) {
    const size = w * h;
    const acc = new Int32Array(size); // Start at 0

    // Compute in-degrees (number of cells flowing into this one)
    const inDegree = new Int32Array(size);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        let d = dir[r * w + c];
        if (d > 0) {
          let nr = r, nc = c;
          if (d===128) {nr--; nc++;}
          else if (d===64) {nr--;}
          else if (d===32) {nr--; nc--;}
          else if (d===16) {nc--;}
          else if (d===8) {nr++; nc--;}
          else if (d===4) {nr++;}
          else if (d===2) {nr++; nc++;}
          else if (d===1) {nc++;}
          
          if (nr>=0 && nr<h && nc>=0 && nc<w) {
            inDegree[nr * w + nc]++;
          }
        }
      }
    }

    // Topological sort via queue (find cells with 0 in-degree)
    let queue = []; // Consider using an index array for performance on massive rasters
    for (let i = 0; i < size; i++) {
      if (inDegree[i] === 0 && dir[i] !== 0) {
        queue.push(i);
      }
    }

    let head = 0;
    while (head < queue.length) {
      let idx = queue[head++];
      let d = dir[idx];
      if (d > 0) {
        let r = Math.floor(idx / w);
        let c = idx % w;
        let nr = r, nc = c;
        if (d===128) {nr--; nc++;}
        else if (d===64) {nr--;}
        else if (d===32) {nr--; nc--;}
        else if (d===16) {nc--;}
        else if (d===8) {nr++; nc--;}
        else if (d===4) {nr++;}
        else if (d===2) {nr++; nc++;}
        else if (d===1) {nc++;}
        
        if (nr>=0 && nr<h && nc>=0 && nc<w) {
          let nIdx = nr * w + nc;
          acc[nIdx] += acc[idx] + 1; // Accumulate flow + 1 for self
          inDegree[nIdx]--;
          if (inDegree[nIdx] === 0) {
            queue.push(nIdx);
          }
        }
      }
    }
    
    return acc;
  }

  function visualizeAccumulation() {
    // We visualize flow accumulation logarithmically
    if (!hydroState.accRaster) return;
    const { accRaster, width, height, bbox } = hydroState;

    const logAcc = new Float32Array(width * height);
    let maxL = 0;
    for (let i = 0; i < logAcc.length; i++) {
      if (accRaster[i] > 0) {
        logAcc[i] = Math.log10(accRaster[i]);
        if (logAcc[i] > maxL) maxL = logAcc[i];
      } else {
        logAcc[i] = 0;
      }
    }

    const bounds = [[bbox.south, bbox.west], [bbox.north, bbox.east]];
    const canvas = document.createElement('canvas');
    if (typeof plotty !== 'undefined') {
        const plot = new plotty.plot({
        canvas: canvas,
        data: logAcc,
        width: width,
        height: height,
        domain: [0, maxL],
        colorScale: 'jet', // or a blues scale if registered
        noDataValue: 0
        });
        plot.render();
    }
    
    if (hydroState.accLayer) {
        const opacity = parseInt(document.getElementById('hydro-opacity').value) / 100;
        hydroState.accLayer = L.imageOverlay(canvas.toDataURL(), bounds, { opacity: opacity, zIndex: 300 });
    } else {
        hydroState.accLayer = L.imageOverlay(canvas.toDataURL(), bounds, { opacity: 0.8, zIndex: 300 });
    }
    if (document.getElementById('toggle-hydro-acc').checked) {
      hydroState.accLayer.addTo(appMap);
    }
  }

  async function extractStreams() {
    if (!hydroState.accRaster || !hydroState.dirRaster) {
      DEM.utils.toast('Generate hydrology rasters first', 'error');
      return;
    }
    const thresh = parseInt(document.getElementById('hydro-stream-threshold').value);
    const orderMethod = document.getElementById('hydro-stream-order').value;
    
    DEM.utils.showLoading('Extracting network...');
    await new Promise(r => setTimeout(r, 50));

    const { dirRaster, accRaster, width, height, transform } = hydroState;
    const size = width * height;
    
    // 1. Identify stream cells map
    const streamMap = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      if (accRaster[i] >= thresh && dirRaster[i] > 0) {
        streamMap[i] = 1;
      }
    }

    // Helper to get next cell
    const getNext = (r, c, d) => {
      let nr = r, nc = c;
      if (d===128) {nr--; nc++;} else if (d===64) {nr--;} else if (d===32) {nr--; nc--;}
      else if (d===16) {nc--;} else if (d===8) {nr++; nc--;} else if (d===4) {nr++;}
      else if (d===2) {nr++; nc++;} else if (d===1) {nc++;}
      if (nr>=0 && nr<height && nc>=0 && nc<width) return nr * width + nc;
      return -1;
    };

    // 2. Build stream topology and classify order using topological sort
    const inDegree = new Int32Array(size);
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        let idx = r * width + c;
        if (streamMap[idx] === 1) {
          let nIdx = getNext(r, c, dirRaster[idx]);
          if (nIdx !== -1 && streamMap[nIdx] === 1) {
            inDegree[nIdx]++;
          }
        }
      }
    }

    const upstreamMaxOrder = new Int32Array(size);
    const upstreamMaxCount = new Int32Array(size);
    const streamOrder = new Int32Array(size);
    
    let queue = [];
    for (let i = 0; i < size; i++) {
      if (streamMap[i] === 1 && inDegree[i] === 0) {
        queue.push(i);
        streamOrder[i] = 1; // Heads
      }
    }

    let head = 0;
    while (head < queue.length) {
      let idx = queue[head++];
      let currentOrder = streamOrder[idx];
      let r = Math.floor(idx / width), c = idx % width;
      let nIdx = getNext(r, c, dirRaster[idx]);
      
      if (nIdx !== -1 && streamMap[nIdx] === 1) {
        if (orderMethod === 'strahler') {
          if (currentOrder > upstreamMaxOrder[nIdx]) {
            upstreamMaxOrder[nIdx] = currentOrder;
            upstreamMaxCount[nIdx] = 1;
          } else if (currentOrder === upstreamMaxOrder[nIdx]) {
            upstreamMaxCount[nIdx]++;
          }
        } else {
          // Shreve: sum of incoming magnitudes
          streamOrder[nIdx] += currentOrder;
        }

        inDegree[nIdx]--;
        if (inDegree[nIdx] === 0) {
          if (orderMethod === 'strahler') {
            streamOrder[nIdx] = upstreamMaxCount[nIdx] >= 2 ? upstreamMaxOrder[nIdx] + 1 : upstreamMaxOrder[nIdx];
          }
          queue.push(nIdx);
        }
      }
    }

    // 3. Generate GeoJSON segments
    let features = [];
    for (let r = 0; r < height; r++) {
       for(let c = 0; c < width; c++) {
         let idx = r * width + c;
         if (streamMap[idx] === 1) {
           let nIdx = getNext(r, c, dirRaster[idx]);
           if (nIdx !== -1 && streamMap[nIdx] === 1) {
             let r2 = Math.floor(nIdx / width);
             let c2 = nIdx % width;
             let lon1 = transform.originX + c * transform.pixelWidth;
             let lat1 = transform.originY + r * transform.pixelHeight;
             let lon2 = transform.originX + c2 * transform.pixelWidth;
             let lat2 = transform.originY + r2 * transform.pixelHeight;
             
             features.push({
               type: "Feature",
               properties: { "order": streamOrder[idx], "acc": accRaster[idx], "method": orderMethod },
               geometry: {
                 type: "LineString",
                 coordinates: [[lon1, lat1], [lon2, lat2]]
               }
             });
           }
         }
       }
    }

    hydroState.streamsGeoJSON = { type: "FeatureCollection", features: features };

    const appMap = DEM.mapModule.getMap();
    if (hydroState.streamLayer) appMap.removeLayer(hydroState.streamLayer);

    const opacity = document.getElementById('hydro-opacity') ? parseInt(document.getElementById('hydro-opacity').value) / 100 : 0.9;
    
    hydroState.streamLayer = L.geoJSON(hydroState.streamsGeoJSON, {
      style: function(f) {
        let w = 1;
        if (f.properties.method === 'strahler') {
           w = f.properties.order * 1.5;
        } else {
           w = Math.max(1, Math.log2(f.properties.order) * 1.5);
        }
        return { 
          color: '#3388ff', 
          weight: Math.min(6, Math.max(1, w)), 
          opacity: opacity 
        };
      }
    });

    if (document.getElementById('toggle-hydro-stream').checked) {
      hydroState.streamLayer.addTo(appMap);
      toggleLayer('stream', true); // Force legend refresh
    }
    
    
    DEM.utils.hideLoading();
    document.getElementById('btn-export-hydro-stream').disabled = false;
    DEM.utils.toast(`Stream network generated (${orderMethod === 'shreve' ? 'Shreve' : 'Strahler'})`, 'success');
  }

  function togglePourPointMode() {
    const btn = document.getElementById('btn-select-pour-point');
    const info = document.getElementById('hydro-pour-point-info');
    
    hydroState.isSelectingPourPoint = !hydroState.isSelectingPourPoint;
    
    const appMap = DEM.mapModule.getMap();
    if (hydroState.isSelectingPourPoint) {
      btn.classList.replace('btn-secondary', 'btn-primary');
      btn.innerHTML = `<i data-lucide="crosshair" style="width:14px;height:14px"></i> Click on Map...`;
      info.style.display = 'block';
      document.getElementById('map').style.cursor = 'crosshair';
      appMap.on('click', handleMapClickPourPoint);
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } else {
      disablePourPointMode();
    }
  }

  function disablePourPointMode() {
    hydroState.isSelectingPourPoint = false;
    const btn = document.getElementById('btn-select-pour-point');
    const info = document.getElementById('hydro-pour-point-info');
    btn.classList.replace('btn-primary', 'btn-secondary');
    btn.innerHTML = `<i data-lucide="map-pin" style="width:14px;height:14px"></i> Select Pour Point on Map`;
    info.style.display = 'none';
    document.getElementById('map').style.cursor = '';
    DEM.mapModule.getMap().off('click', handleMapClickPourPoint);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  async function handleMapClickPourPoint(e) {
    if (!hydroState.dirRaster) return;
    disablePourPointMode();
    
    const { lat, lng } = e.latlng;
    const { transform, width, height, bbox } = hydroState;
    
    if (lng < bbox.west || lng > bbox.east || lat < bbox.south || lat > bbox.north) {
      DEM.utils.toast('Outside bounds', 'error');
      return;
    }

    let c = Math.floor((lng - transform.originX) / transform.pixelWidth);
    let r = Math.floor((lat - transform.originY) / transform.pixelHeight);

    if (c < 0 || c >= width || r < 0 || r >= height) return;

    // Snap to nearest high accumulation pixel
    let maxAcc = -1;
    let bestR = r, bestC = c;
    for(let dr=-2; dr<=2; dr++) {
      for(let dc=-2; dc<=2; dc++) {
        let nr = r + dr; let nc = c + dc;
        if(nr>=0 && nr<height && nc>=0 && nc<width) {
          let idx = nr*width + nc;
          if(hydroState.accRaster[idx] > maxAcc) {
            maxAcc = hydroState.accRaster[idx];
            bestR = nr; bestC = nc;
          }
        }
      }
    }
    r = bestR; c = bestC;

    DEM.utils.showLoading('Delineating Catchment...');
    await new Promise(res => setTimeout(res, 50));

    // Trace upstream
    const size = width * height;
    const catchmentMap = new Uint8Array(size); // defaults 0
    let stack = [r * width + c];
    catchmentMap[r * width + c] = 1;
    let areaCells = 1;

    while(stack.length > 0) {
      let curr = stack.pop();
      let cr = Math.floor(curr / width);
      let cc = curr % width;

      // Check all 8 neighbors. If they flow into 'curr', add to stack
      for(let d=0; d<8; d++) {
         let nr = cr + DROW[d]; let nc = cc + DCOL[d];
         if(nr>=0 && nr<height && nc>=0 && nc<width) {
           let nIdx = nr * width + nc;
           if(catchmentMap[nIdx] === 0) { // Not visited
             let nDir = hydroState.dirRaster[nIdx];
             if(nDir > 0) {
               let nToR = nr, nToC = nc;
               if (nDir===128) {nToR--; nToC++;} else if (nDir===64) {nToR--;} else if (nDir===32) {nToR--; nToC--;}
               else if (nDir===16) {nToC--;} else if (nDir===8) {nToR++; nToC--;} else if (nDir===4) {nToR++;}
               else if (nDir===2) {nToR++; nToC++;} else if (nDir===1) {nToC++;}
               
               if(nToR === cr && nToC === cc) {
                 catchmentMap[nIdx] = 1;
                 areaCells++;
                 stack.push(nIdx);
               }
             }
           }
         }
      }
    }

    DEM.utils.hideLoading();
    
    // Draw polygon from mask
    renderCatchmentPolygon(catchmentMap, width, height, transform, areaCells);
  }

  function renderCatchmentPolygon(mask, width, height, transform, areaCells) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);
    
    // Generate simple GeoJSON MultiPolygon representation for export
    let geojsonPolys = [];
    
    for(let i=0; i<mask.length; i++) {
        if(mask[i] === 1) {
            imgData.data[i*4 + 0] = 50;
            imgData.data[i*4 + 1] = 150;
            imgData.data[i*4 + 2] = 255;
            imgData.data[i*4 + 3] = 100; // Alpha
            
            let r = Math.floor(i / width);
            let c = i % width;
            let wLng = transform.originX + c*transform.pixelWidth;
            let eLng = transform.originX + (c+1)*transform.pixelWidth;
            let nLat = transform.originY + r*transform.pixelHeight;
            let sLat = transform.originY + (r+1)*transform.pixelHeight;
            geojsonPolys.push([[[wLng, nLat], [eLng, nLat], [eLng, sLat], [wLng, sLat], [wLng, nLat]]]);
        }
    }
    ctx.putImageData(imgData, 0, 0);

    hydroState.catchmentGeoJSON = {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { "areaCells": areaCells },
        geometry: { type: "MultiPolygon", coordinates: geojsonPolys }
      }]
    };

    const bounds = [[hydroState.bbox.south, hydroState.bbox.west], [hydroState.bbox.north, hydroState.bbox.east]];
    const appMap = DEM.mapModule.getMap();
    if(hydroState.catchmentLayer) appMap.removeLayer(hydroState.catchmentLayer);
    
    const currentOpacity = parseInt(document.getElementById('hydro-opacity').value) / 100;
    hydroState.catchmentLayer = L.imageOverlay(canvas.toDataURL(), bounds, { opacity: currentOpacity, zIndex: 302, interactive:false });
    
    if (document.getElementById('toggle-hydro-catchment').checked) {
      hydroState.catchmentLayer.addTo(appMap);
    }
    
    const approxKm2 = (areaCells * Math.abs(transform.pixelWidth * 111) * Math.abs(transform.pixelHeight * 111)).toFixed(2);
    document.getElementById('btn-export-hydro-catchment').disabled = false;
    DEM.utils.toast(`Catchment Delineated (approx ${approxKm2} km²)`, 'success');
  }

  async function exportHydroGeoTIFF(name, arrayData) {
    if (!arrayData) {
      DEM.utils.toast(`No data available for ${name}. Generate first!`, 'error');
      return;
    }
    
    DEM.utils.showLoading(`Exporting ${name}...`);
    try {
      const { width, height, bbox } = hydroState;
      const dx = (bbox.east - bbox.west) / width;
      const dy = (bbox.north - bbox.south) / height;

      const metadata = {
        width: width,
        height: height,
        GeographicTypeGeoKey: 4326,
        ModelPixelScale: [dx, Math.abs(dy), 0],
        ModelTiepoint: [0, 0, 0, bbox.west, bbox.north, 0],
        GDAL_NODATA: String(hydroState.nodata)
      };

      const arrayBuffer = await GeoTIFF.writeArrayBuffer(arrayData, metadata);
      const blob = new Blob([arrayBuffer], { type: 'image/tiff' });
      
      DEM.utils.hideLoading();
      DEM.utils.downloadBlob(blob, `dem_${name}.tif`);
      DEM.utils.toast(`Exported ${name}.tif`, 'success');
    } catch (err) {
      console.error(err);
      DEM.utils.hideLoading();
      DEM.utils.toast(`Failed to export ${name}: ${err.message}`, 'error');
    }
  }

  function exportHydroGeoJSON(name, geojsonData) {
    if (!geojsonData) {
      DEM.utils.toast(`No vector generated for ${name}`, 'error');
      return;
    }
    const str = JSON.stringify(geojsonData);
    const blob = new Blob([str], { type: 'application/json' });
    DEM.utils.downloadBlob(blob, `dem_${name}.geojson`);
    DEM.utils.toast(`Exported ${name}.geojson`, 'success');
  }

  return { init };
})();
