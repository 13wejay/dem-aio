/* ============================================================
   DEM Explorer — Main Application Controller
   ============================================================ */
window.DEM = window.DEM || {};

DEM.app = (function () {
  let state = {
    selectedSource: 'copernicus',
    currentViz: 'elevation',
    demLoaded: false,
    bbox: null,
    uploadedBoundary: null
  };

  async function init() {
    // Fetch env config
    try {
      const res = await fetch('/api/env');
      if (res.ok) {
        const config = await res.json();
        if (config.OPENTOPO_API_KEY && !localStorage.getItem('dem_api_key_opentopo')) {
          localStorage.setItem('dem_api_key_opentopo', config.OPENTOPO_API_KEY);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch env config:', e);
    }

    // Initialize map
    DEM.mapModule.init();
    if (DEM.hydro) DEM.hydro.init();

    // Wire up sidebar section collapse
    document.querySelectorAll('.section-header').forEach(header => {
      header.addEventListener('click', () => {
        header.closest('.sidebar-section').classList.toggle('collapsed');
      });
    });

    // Sidebar toggle
    document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('collapsed');
      setTimeout(() => DEM.mapModule.getMap().invalidateSize(), 300);
    });

    // Bbox buttons
    document.getElementById('btn-draw-bbox').addEventListener('click', () => {
      state.uploadedBoundary = null;
      DEM.mapModule.activateDraw();
    });
    document.getElementById('btn-clear-bbox').addEventListener('click', () => {
      state.uploadedBoundary = null;
      DEM.mapModule.clearBBox();
      disableDEM();
      DEM.utils.toast('Bounding box cleared', 'info');
    });
    document.getElementById('btn-apply-bbox').addEventListener('click', () => {
      state.uploadedBoundary = null;
      const bbox = DEM.mapModule.drawBBoxFromInputs();
      if (bbox) {
        state.bbox = bbox;
        onBBoxChanged(bbox);
        DEM.utils.toast('Bounding box applied', 'success');
        console.log('[DEM] BBox applied:', bbox);
      }
    });

    // Upload Boundary
    document.getElementById('btn-upload-boundary').addEventListener('click', () => {
      document.getElementById('file-upload-boundary').click();
    });

    document.getElementById('file-upload-boundary').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        DEM.utils.showLoading('Parsing boundary...');
        let geojson;
        if (file.name.endsWith('.zip') || file.name.endsWith('.shp')) {
          const buffer = await file.arrayBuffer();
          geojson = await shp(buffer);
        } else if (file.name.endsWith('.geojson') || file.name.endsWith('.json')) {
          const text = await file.text();
          geojson = JSON.parse(text);
        } else {
          throw new Error('Unsupported format. Need .zip (Shapefile) or .geojson');
        }

        // Normalize GeoJSON (handle arrays of FeatureCollections from shpjs or multiple polygons)
        let features = [];
        const extractFeatures = (gj) => {
          if (Array.isArray(gj)) gj.forEach(extractFeatures);
          else if (gj.type === 'FeatureCollection') (gj.features || []).forEach(extractFeatures);
          else if (gj.type === 'Feature') features.push(gj);
          else if (gj.type) features.push({ type: 'Feature', properties: {}, geometry: gj });
        };
        extractFeatures(geojson);
        geojson = { type: 'FeatureCollection', features: features };

        const bbox = DEM.mapModule.drawUploadedBoundary(geojson);
        if (bbox) {
          state.bbox = bbox;
          state.uploadedBoundary = geojson; // Store for later DEM masking
          onBBoxChanged(bbox);
          DEM.utils.toast('Boundary uploaded and applied', 'success');
        }
      } catch (err) {
        DEM.utils.toast('Failed to load boundary: ' + err.message, 'error');
        console.error(err);
      } finally {
        DEM.utils.hideLoading();
        e.target.value = ''; // Reset input
      }
    });

    // Coordinate inputs - live update area on change
    ['bbox-west', 'bbox-south', 'bbox-east', 'bbox-north'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => {
        DEM.mapModule.updateAreaBadge();
      });
    });

    // Source selection
    document.querySelectorAll('.source-card').forEach(card => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.source-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        state.selectedSource = card.dataset.source;
      });
    });

    // Download button - remove disabled, validate on click
    document.getElementById('btn-download').disabled = false;
    document.getElementById('btn-download').addEventListener('click', handleDownload);

    // Viz tabs
    document.querySelectorAll('.viz-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        switchViz(tab.dataset.viz);
      });
    });

    // Color ramp select
    document.getElementById('color-ramp').addEventListener('change', (e) => {
      updateRampPreview(e.target.value);
      if (state.demLoaded) {
        const opacity = parseInt(document.getElementById('elevation-opacity').value) / 100;
        DEM.viz.renderElevation(DEM.dem.getCurrent(), e.target.value, opacity);
      }
    });

    // Elevation opacity slider
    bindSlider('elevation-opacity', 'elevation-opacity-val', v => v + '%', (v) => {
      DEM.mapModule.setElevationOpacity(v / 100);
    });

    // Hillshade sliders
    bindSlider('hillshade-azimuth', 'azimuth-val', v => v + '°');
    bindSlider('hillshade-altitude', 'altitude-val', v => v + '°');
    bindSlider('hillshade-zfactor', 'zfactor-val', v => (v / 10).toFixed(1));
    bindSlider('hillshade-blend', 'blend-val', v => v + '%');

    // Contour width slider
    bindSlider('contour-width', 'contour-width-val', v => (v / 10).toFixed(1));

    // Apply hillshade button
    document.getElementById('btn-apply-hillshade').addEventListener('click', () => {
      if (!state.demLoaded) return;
      DEM.utils.showLoading('Computing hillshade...');
      setTimeout(() => {
        try {
          const az = parseInt(document.getElementById('hillshade-azimuth').value);
          const alt = parseInt(document.getElementById('hillshade-altitude').value);
          const zf = parseInt(document.getElementById('hillshade-zfactor').value) / 10;
          const blend = parseInt(document.getElementById('hillshade-blend').value);
          DEM.viz.renderHillshade(DEM.dem.getCurrent(), az, alt, zf, blend);
          document.getElementById('btn-export-hillshade').disabled = false;
          DEM.utils.toast('Hillshade computed', 'success');
        } catch (e) {
          DEM.utils.toast('Hillshade failed: ' + e.message, 'error');
        }
        DEM.utils.hideLoading();
      }, 50);
    });

    // Apply contour button
    document.getElementById('btn-apply-contour').addEventListener('click', () => {
      if (!state.demLoaded) return;
      DEM.utils.showLoading('Generating contours...');
      setTimeout(() => {
        try {
          const interval = parseInt(document.getElementById('contour-interval').value);
          const color = document.getElementById('contour-color').value;
          const width = parseInt(document.getElementById('contour-width').value) / 10;
          const labels = document.getElementById('contour-labels').checked;
          DEM.viz.generateContours(DEM.dem.getCurrent(), interval, color, width, labels);
          document.getElementById('btn-export-contour').disabled = false;
          DEM.utils.toast(`Generated contours at ${interval}m interval`, 'success');
        } catch (e) {
          DEM.utils.toast('Contour generation failed: ' + e.message, 'error');
        }
        DEM.utils.hideLoading();
      }, 50);
    });

    // Export buttons
    document.getElementById('btn-export-dem').addEventListener('click', exportRawDEM);
    document.getElementById('btn-export-hillshade').addEventListener('click', exportHillshade);
    document.getElementById('btn-export-contour').addEventListener('click', exportContour);
    document.getElementById('btn-export-screenshot').addEventListener('click', exportScreenshot);
    
    // Init Satellite
    initSatellite();

    // Init Rainfall
    initRainfall();

    // Initial ramp preview
    updateRampPreview('viridis');
  }

  /* --- Slider binding helper --- */
  function bindSlider(sliderId, displayId, formatter, onChange) {
    const slider = document.getElementById(sliderId);
    const display = document.getElementById(displayId);
    if (!slider || !display) return;
    slider.addEventListener('input', () => {
      display.textContent = formatter(parseFloat(slider.value));
      if (onChange) onChange(parseFloat(slider.value));
    });
  }

  /* --- Satellite & Flood Initialization --- */
  function initSatellite() {
    const today = new Date();
    const lastMonth = new Date(today);
    lastMonth.setMonth(today.getMonth() - 1);
    
    document.getElementById('sat-date-start').valueAsDate = lastMonth;
    document.getElementById('sat-date-end').valueAsDate = today;

    document.getElementById('sat-platform').addEventListener('change', (e) => {
       document.getElementById('sat-s2-options').style.display = e.target.value === 'sentinel-2-l2a' ? 'block' : 'none';
    });

    document.getElementById('btn-search-sat').addEventListener('click', async () => {
       let bbox = DEM.mapModule.getBBox();
       if (!bbox && state.bbox) bbox = state.bbox;
       if (!bbox) { DEM.utils.toast('Please draw a bounding box first', 'error'); return; }
       
       const platform = document.getElementById('sat-platform').value;
       const start = document.getElementById('sat-date-start').value;
       const end = document.getElementById('sat-date-end').value;
       const cloud = document.getElementById('sat-cloud-cover').value;
       
       try {
           const results = await DEM.satellite.search(platform, bbox, start, end, cloud);
           if (!results || results.length === 0) {
              DEM.utils.toast('No scenes found', 'info');
              return;
           }
           const select = document.getElementById('sat-scene-select');
           select.innerHTML = '';
           results.forEach((ft, i) => {
              const opt = document.createElement('option');
              opt.value = i;
              opt.textContent = `${ft.id.substring(0, 25)}... (${new Date(ft.properties.datetime).toLocaleDateString()})`;
              select.appendChild(opt);
           });
           document.getElementById('sat-results-container').style.display = 'block';
       } catch (e) {
           DEM.utils.toast('Search failed', 'error');
           console.error(e);
       }
    });

    document.getElementById('btn-load-sat').addEventListener('click', async () => {
       let bbox = DEM.mapModule.getBBox();
       if (!bbox && state.bbox) bbox = state.bbox;
       const idx = parseInt(document.getElementById('sat-scene-select').value);
       const success = await DEM.satellite.loadScene(idx, bbox);
       if(success) {
           document.getElementById('sat-layer-toggles').style.display = 'block';
           document.getElementById('sat-exports').style.display = 'block';
           
           document.getElementById('sat-derive-container').style.display = 'block';
           const platform = document.getElementById('sat-platform').value;
           document.getElementById('sat-s2-derive').style.display = platform === 'sentinel-2-l2a' ? 'block' : 'none';
           document.getElementById('sat-s1-derive').style.display = platform === 'sentinel-1-grd' ? 'block' : 'none';
       }
    });

    document.getElementById('btn-calc-ndwi').addEventListener('click', () => {
       DEM.satellite.calculateNDWI();
    });
    
    document.getElementById('btn-calc-ndvi').addEventListener('click', () => {
       DEM.satellite.calculateNDVI();
    });
    
    document.getElementById('btn-calc-s1-water').addEventListener('click', () => {
       DEM.satellite.calculateS1Water();
    });

    bindSlider('sat-opacity', 'sat-opacity-val', v => v + '%', v => {
       DEM.mapModule.setSatelliteOpacity(v/100);
    });

    document.getElementById('toggle-sat-image').addEventListener('change', e => {
       DEM.mapModule.toggleSatelliteLayer('image', e.target.checked);
    });
    document.getElementById('toggle-sat-water').addEventListener('change', e => {
       DEM.mapModule.toggleSatelliteLayer('water', e.target.checked);
    });
    document.getElementById('toggle-sat-ndvi').addEventListener('change', e => {
       DEM.mapModule.toggleSatelliteLayer('ndvi', e.target.checked);
    });
    document.getElementById('toggle-flood-inundation').addEventListener('change', e => {
       DEM.mapModule.toggleSatelliteLayer('flood', e.target.checked);
    });

    const floodSlider = document.getElementById('flood-level');
    const floodManual = document.getElementById('flood-level-manual');
    let floodTimeout;

    function triggerFloodUpdate(val) {
       if (!state.demLoaded) return;
       clearTimeout(floodTimeout);
       floodTimeout = setTimeout(() => {
          DEM.flood.runBathtubModel(DEM.dem.getCurrent(), val);
          // Reveal layer toggles & exports on first use
          document.getElementById('sat-layer-toggles').style.display = 'block';
          document.getElementById('sat-exports').style.display = 'block';
       }, 80);
    }

    floodSlider.addEventListener('input', () => {
       const val = parseFloat(floodSlider.value);
       floodManual.value = val.toFixed(1);
       triggerFloodUpdate(val);
    });

    floodManual.addEventListener('input', () => {
       let val = parseFloat(floodManual.value) || 0;
       if (val > parseFloat(floodSlider.max)) {
           floodSlider.max = Math.ceil(val / 10) * 10;
       }
       floodSlider.value = val;
       triggerFloodUpdate(val);
    });

    // Exports
    document.getElementById('btn-export-sat').addEventListener('click', exportSatelliteImage);
    document.getElementById('btn-export-water-mask').addEventListener('click', exportWaterMask);
    document.getElementById('btn-export-flood-mask').addEventListener('click', exportFloodMask);
  }

  /* --- Update color ramp preview --- */
  function updateRampPreview(rampName) {
    const preview = document.getElementById('ramp-preview');
    preview.className = 'ramp-preview ramp-' + rampName;
  }

  /* --- BBox Changed Callback --- */
  function onBBoxChanged(bbox) {
    state.bbox = bbox;
    console.log('[DEM] BBox changed:', bbox);
  }

  /* --- Handle Download --- */
  async function handleDownload() {
    // Try reading from inputs first, fall back to stored state
    let bbox = DEM.mapModule.getBBox();
    if (!bbox && state.bbox) bbox = state.bbox;
    console.log('[DEM] Download requested, bbox:', bbox);
    if (!bbox) {
      DEM.utils.toast('Please define a bounding box first', 'error');
      return;
    }
    const err = DEM.utils.validateBBox(bbox.west, bbox.south, bbox.east, bbox.north);
    if (err) { DEM.utils.toast(err, 'error'); return; }

    const btn = document.getElementById('btn-download');
    btn.disabled = true;
    btn.textContent = '⏳ Downloading...';

    try {
      const demData = await DEM.dem.download(state.selectedSource, bbox, state.uploadedBoundary);
      state.demLoaded = true;

      // Enable UI
      enablePostDownload();

      // Auto-render elevation
      const opacity = parseInt(document.getElementById('elevation-opacity').value) / 100;
      const ramp = document.getElementById('color-ramp').value;
      DEM.viz.renderElevation(demData, ramp, opacity);

      // Compute and display stats
      showStats(demData);

      // Zoom to bbox
      DEM.mapModule.getMap().fitBounds(
        DEM.mapModule.getLeafletBounds(demData.bbox),
        { padding: [30, 30] }
      );

      DEM.utils.toast('DEM downloaded successfully!', 'success');
    } catch (e) {
      DEM.utils.toast('Download failed: ' + e.message, 'error');
      console.error(e);
    }

    btn.disabled = false;
    btn.textContent = '📥 Download DEM';
  }

  /* --- Enable post-download UI --- */
  function enablePostDownload() {
    document.getElementById('viz-toolbar').classList.add('visible');
    document.getElementById('viz-controls').classList.add('visible');
    document.getElementById('viz-empty').style.display = 'none';
    document.getElementById('btn-export-dem').disabled = false;
    document.getElementById('btn-export-screenshot').disabled = false;
    switchViz('elevation');
  }

  function disableDEM() {
    state.demLoaded = false;
    document.getElementById('viz-toolbar').classList.remove('visible');
    document.getElementById('viz-controls').classList.remove('visible');
    document.getElementById('viz-empty').style.display = '';
    document.getElementById('legend-bar').classList.remove('visible');
    document.getElementById('stats-empty').style.display = '';
    document.getElementById('stats-data').style.display = 'none';
    document.querySelectorAll('.export-btn').forEach(b => b.disabled = true);
    DEM.mapModule.removeAllOverlays();
  }

  /* --- Switch Visualization Tab --- */
  function switchViz(vizName) {
    state.currentViz = vizName;

    // Update tabs
    document.querySelectorAll('.viz-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.viz === vizName);
    });

    // Update control panels
    document.querySelectorAll('.viz-control-group').forEach(g => g.classList.remove('active'));
    const ctrlEl = document.getElementById('ctrl-' + vizName);
    if (ctrlEl) ctrlEl.classList.add('active');

    // Show/hide layers
    if (!state.demLoaded) return;
    DEM.mapModule.showElevation(vizName === 'elevation');
    DEM.mapModule.showHillshade(vizName === 'hillshade');
    DEM.mapModule.showContours(vizName === 'contour');

    // Show/hide legend
    const legend = document.getElementById('legend-bar');
    legend.classList.toggle('visible', vizName === 'elevation');
  }

  /* --- Show Statistics --- */
  function showStats(demData) {
    const stats = DEM.utils.computeStats(demData.data, demData.nodata);
    if (!stats) return;

    document.getElementById('stats-empty').style.display = 'none';
    document.getElementById('stats-data').style.display = 'block';

    const grid = document.getElementById('stats-grid');
    grid.innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Min Elevation</div>
        <div class="stat-value">${DEM.utils.fmt(stats.min, 1)} <span class="stat-unit">m</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Max Elevation</div>
        <div class="stat-value">${DEM.utils.fmt(stats.max, 1)} <span class="stat-unit">m</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Mean</div>
        <div class="stat-value">${DEM.utils.fmt(stats.mean, 1)} <span class="stat-unit">m</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Median</div>
        <div class="stat-value">${DEM.utils.fmt(stats.median, 1)} <span class="stat-unit">m</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Std Dev</div>
        <div class="stat-value">${DEM.utils.fmt(stats.stddev, 1)} <span class="stat-unit">m</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">NoData</div>
        <div class="stat-value">${stats.nodataPercent} <span class="stat-unit">%</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Dimensions</div>
        <div class="stat-value">${demData.width} × ${demData.height}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Pixels</div>
        <div class="stat-value">${(stats.count).toLocaleString()}</div>
      </div>
    `;

    // Draw histogram
    const histCanvas = document.getElementById('histogram-canvas');
    setTimeout(() => DEM.utils.drawHistogram(histCanvas, stats), 50);
  }

  /* --- Export Functions --- */
  async function exportRawDEM() {
    const dem = DEM.dem.getCurrent();
    if (!dem) return;

    DEM.utils.showLoading('Generating GeoTIFF...');
    
    try {
      if (typeof GeoTIFF !== 'undefined' && typeof GeoTIFF.writeArrayBuffer === 'function') {
        const metadata = {
          width: dem.width,
          height: dem.height,
          GeographicTypeGeoKey: 4326, // WGS 84
          ModelPixelScale: [Math.abs(dem.transform.pixelWidth), Math.abs(dem.transform.pixelHeight), 0],
          ModelTiepoint: [0, 0, 0, dem.transform.originX, dem.transform.originY, 0]
        };

        const arrayBuffer = await GeoTIFF.writeArrayBuffer(dem.data, metadata);
        const blob = new Blob([arrayBuffer], { type: 'image/tiff' });
        
        DEM.utils.hideLoading();
        DEM.utils.downloadBlob(blob, 'dem_export.tif');
        DEM.utils.toast('DEM exported as GeoTIFF', 'success');
      } else {
        throw new Error('GeoTIFF.writeArrayBuffer not available in runtime');
      }
    } catch (err) {
      console.warn('GeoTIFF export failed or unsupported, falling back to JSON:', err);
      // Fallback: Export elevation data as a JSON
      const exportData = {
        type: 'DEM_Export',
        bbox: dem.bbox,
        width: dem.width,
        height: dem.height,
        resolution: dem.transform.pixelWidth,
        source: dem.source ? dem.source.name : 'Unknown',
        elevations: Array.from(dem.data)
      };
      const blob = new Blob([JSON.stringify(exportData)], { type: 'application/json' });
      
      DEM.utils.hideLoading();
      DEM.utils.downloadBlob(blob, 'dem_export.json');
      DEM.utils.toast('Failed to create TIF. Exported as JSON instead.', 'info');
    }
  }

  function exportHillshade() {
    const blob = DEM.viz.getHillshadeBlob();
    if (!blob) { DEM.utils.toast('Generate hillshade first', 'error'); return; }
    DEM.utils.downloadBlob(blob, 'hillshade.png');
  }

  function exportContour() {
    const geojson = DEM.viz.getContourGeoJSON();
    if (!geojson) { DEM.utils.toast('Generate contours first', 'error'); return; }
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
    DEM.utils.downloadBlob(blob, 'contours.geojson');
  }

  function exportScreenshot() {
    const blob = DEM.viz.getElevationBlob();
    if (!blob) { DEM.utils.toast('No elevation map to export', 'error'); return; }
    DEM.utils.downloadBlob(blob, 'elevation_map.png');
  }

  async function exportSatelliteImage() {
     const canvas = DEM.mapModule.getSatelliteCanvas();
     if (!canvas) { DEM.utils.toast('No satellite image loaded', 'error'); return; }
     canvas.toBlob(blob => {
        DEM.utils.downloadBlob(blob, 'satellite_imagery.png');
     });
  }

  async function exportRasterMask(mask, name) {
     if (!mask) return;
     const dem = DEM.dem.getCurrent();
     if (!dem || !GeoTIFF) return;
     DEM.utils.showLoading(`Exporting ${name}...`);
     try {
         const metadata = {
           width: dem.width,
           height: dem.height,
           GeographicTypeGeoKey: 4326,
           ModelPixelScale: [Math.abs(dem.transform.pixelWidth), Math.abs(dem.transform.pixelHeight), 0],
           ModelTiepoint: [0, 0, 0, dem.transform.originX, dem.transform.originY, 0]
         };
         // GeoTIFF requires float32 or uint arrays typically matching the config, assuming Float32 works mostly:
         const typedMask = new Float32Array(mask.length);
         for(let i=0; i<mask.length; i++) typedMask[i] = mask[i];
         const arrayBuffer = await GeoTIFF.writeArrayBuffer(typedMask, metadata);
         const blob = new Blob([arrayBuffer], { type: 'image/tiff' });
         DEM.utils.hideLoading();
         DEM.utils.downloadBlob(blob, `${name}.tif`);
     } catch (e) {
         DEM.utils.hideLoading();
         DEM.utils.toast('Export failed: ' + e.message, 'error');
     }
  }

  function exportWaterMask() {
     const mask = DEM.satellite.getState().waterMask;
     if (!mask) { DEM.utils.toast('No water mask derived', 'error'); return; }
     exportRasterMask(mask, 'water_mask');
  }

  function exportFloodMask() {
     const mask = DEM.flood.getMask();
     if (!mask) { DEM.utils.toast('No flood mask simulated', 'error'); return; }
     exportRasterMask(mask, 'flood_mask');
  }

  /* --- Rainfall Initialization --- */
  function initRainfall() {
    // Default dates: use Jan 2024 (data known to exist in NASA GPM archive)
    document.getElementById('rain-date-start').value = '2024-01-01';
    document.getElementById('rain-date-end').value = '2024-01-07';

    // Fetch button
    document.getElementById('btn-fetch-rain').addEventListener('click', async () => {
      let bbox = DEM.mapModule.getBBox();
      if (!bbox && state.bbox) bbox = state.bbox;
      if (!bbox) { DEM.utils.toast('Please draw a bounding box first', 'error'); return; }

      const startStr = document.getElementById('rain-date-start').value;
      const endStr = document.getElementById('rain-date-end').value;
      if (!startStr || !endStr) { DEM.utils.toast('Select start and end dates', 'error'); return; }

      const btn = document.getElementById('btn-fetch-rain');
      btn.disabled = true;

      try {
        const data = await DEM.rainfall.fetchRange(startStr, endStr, bbox);
        if (!data || data.length === 0) {
          DEM.utils.toast('No rainfall data retrieved', 'info');
          return;
        }

        // Show viewer panel
        document.getElementById('rain-viewer').style.display = 'block';
        document.getElementById('rain-exports').style.display = 'block';

        // Setup date slider
        const slider = document.getElementById('rain-date-slider');
        slider.max = data.length - 1;
        slider.value = 0;

        // Show first day
        updateRainfallView(0);

        DEM.utils.toast(`Loaded ${data.length} days of GPM rainfall`, 'success');
      } catch (e) {
        DEM.utils.toast('Rainfall fetch failed: ' + e.message, 'error');
        console.error(e);
      } finally {
        btn.disabled = false;
      }
    });

    // Date slider
    document.getElementById('rain-date-slider').addEventListener('input', (e) => {
      updateRainfallView(parseInt(e.target.value));
    });

    // Layer toggle
    document.getElementById('toggle-rain-layer').addEventListener('change', (e) => {
      DEM.mapModule.toggleRainfallLayer(e.target.checked);
      const legendEl = document.getElementById('map-legend-rainfall');
      const floatLegends = document.getElementById('float-map-legends');
      if (e.target.checked && DEM.rainfall.getState().dailyData.length > 0) {
        legendEl.style.display = 'block';
        floatLegends.style.display = 'block';
      } else {
        legendEl.style.display = 'none';
      }
    });

    // Opacity slider
    bindSlider('rain-opacity', 'rain-opacity-val', v => v + '%', v => {
      DEM.mapModule.setRainfallOpacity(v / 100);
    });

    // CSV export (both buttons)
    document.getElementById('btn-export-rain-csv').addEventListener('click', exportRainfallCSV);
    const csvBtn2 = document.getElementById('btn-export-rain-csv-2');
    if (csvBtn2) csvBtn2.addEventListener('click', exportRainfallCSV);

    // NetCDF export
    const ncBtn = document.getElementById('btn-export-rain-nc');
    if (ncBtn) ncBtn.addEventListener('click', () => DEM.rainfall.downloadNetCDF());
  }

  function updateRainfallView(index) {
    const day = DEM.rainfall.showDay(index);
    if (!day) return;

    // Update label
    const dateLabel = day.date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    document.getElementById('rain-date-label').textContent = dateLabel;
    document.getElementById('rain-day-value').textContent = day.mean.toFixed(2) + ' mm/day';

    // Update trend chart
    DEM.rainfall.drawTrendChart(document.getElementById('rain-trend-canvas'));

    // Update legend
    const allData = DEM.rainfall.getState().dailyData;
    let globalMax = 0;
    for (const d of allData) { if (d.max > globalMax) globalMax = d.max; }
    document.getElementById('rain-legend-date').textContent = dateLabel;
    document.getElementById('rain-legend-max').textContent = globalMax.toFixed(1) + ' mm';

    // Show float legend
    const legendEl = document.getElementById('map-legend-rainfall');
    const floatLegends = document.getElementById('float-map-legends');
    legendEl.style.display = 'block';
    floatLegends.style.display = 'block';
  }

  function exportRainfallCSV() {
    const blob = DEM.rainfall.exportCSV();
    if (!blob) { DEM.utils.toast('No rainfall data to export', 'error'); return; }
    DEM.utils.downloadBlob(blob, 'gpm_rainfall_daily.csv');
  }

  return { init, onBBoxChanged, getState: () => state };
})();

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  DEM.app.init();
});
