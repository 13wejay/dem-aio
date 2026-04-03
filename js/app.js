/* ============================================================
   DEM Explorer — Main Application Controller
   ============================================================ */
window.DEM = window.DEM || {};

DEM.app = (function () {
  let state = {
    selectedSource: 'copernicus',
    currentViz: 'elevation',
    demLoaded: false,
    bbox: null
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
      DEM.mapModule.activateDraw();
    });
    document.getElementById('btn-clear-bbox').addEventListener('click', () => {
      DEM.mapModule.clearBBox();
      disableDEM();
      DEM.utils.toast('Bounding box cleared', 'info');
    });
    document.getElementById('btn-apply-bbox').addEventListener('click', () => {
      const bbox = DEM.mapModule.drawBBoxFromInputs();
      if (bbox) {
        state.bbox = bbox;
        onBBoxChanged(bbox);
        DEM.utils.toast('Bounding box applied', 'success');
        console.log('[DEM] BBox applied:', bbox);
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

    // Settings modal
    document.getElementById('btn-settings').addEventListener('click', () => {
      const key = localStorage.getItem('dem_api_key_opentopo') || '';
      document.getElementById('api-key-opentopo').value = key;
      document.getElementById('modal-settings').classList.add('visible');
    });
    document.getElementById('btn-modal-close').addEventListener('click', () => {
      document.getElementById('modal-settings').classList.remove('visible');
    });
    document.getElementById('btn-modal-save').addEventListener('click', () => {
      const key = document.getElementById('api-key-opentopo').value.trim();
      if (key) {
        localStorage.setItem('dem_api_key_opentopo', key);
        DEM.utils.toast('API key saved', 'success');
      } else {
        localStorage.removeItem('dem_api_key_opentopo');
      }
      document.getElementById('modal-settings').classList.remove('visible');
    });
    document.getElementById('modal-settings').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        e.currentTarget.classList.remove('visible');
      }
    });

    // Initial ramp preview
    updateRampPreview('viridis');
  }

  /* --- Slider binding helper --- */
  function bindSlider(sliderId, displayId, formatter, onChange) {
    const slider = document.getElementById(sliderId);
    const display = document.getElementById(displayId);
    slider.addEventListener('input', () => {
      display.textContent = formatter(parseInt(slider.value));
      if (onChange) onChange(parseInt(slider.value));
    });
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
      const demData = await DEM.dem.download(state.selectedSource, bbox);
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
  function exportRawDEM() {
    const dem = DEM.dem.getCurrent();
    if (!dem) return;
    // Export elevation data as a JSON (since we can't create GeoTIFF client-side easily)
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
    DEM.utils.downloadBlob(blob, 'dem_export.json');
    DEM.utils.toast('DEM data exported', 'success');
  }

  function exportHillshade() {
    const canvas = DEM.viz.getHillshadeCanvas();
    if (!canvas) { DEM.utils.toast('Generate hillshade first', 'error'); return; }
    canvas.toBlob(blob => {
      DEM.utils.downloadBlob(blob, 'hillshade.png');
      DEM.utils.toast('Hillshade exported', 'success');
    }, 'image/png');
  }

  function exportContour() {
    const geojson = DEM.viz.getContourGeoJSON();
    if (!geojson) { DEM.utils.toast('Generate contours first', 'error'); return; }
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
    DEM.utils.downloadBlob(blob, 'contours.geojson');
    DEM.utils.toast('Contours exported as GeoJSON', 'success');
  }

  function exportScreenshot() {
    const canvas = DEM.viz.getElevationCanvas();
    if (!canvas) { DEM.utils.toast('No elevation map to export', 'error'); return; }
    canvas.toBlob(blob => {
      DEM.utils.downloadBlob(blob, 'elevation_map.png');
      DEM.utils.toast('Screenshot exported', 'success');
    }, 'image/png');
  }

  return { init, onBBoxChanged };
})();

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  DEM.app.init();
});
