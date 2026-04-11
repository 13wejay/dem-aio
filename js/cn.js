// Curve Number (CN) Calculator Module

const cnCalculator = {
  // LULC ESA WorldCover mapping to generic land uses
  lookupTable: {
    10: [30, 58, 71, 77], // Trees
    20: [48, 67, 77, 83], // Shrubland
    30: [39, 61, 74, 80], // Grassland
    40: [67, 78, 85, 89], // Cropland
    50: [89, 92, 94, 95], // Built-up
    60: [77, 86, 91, 94], // Bare
    70: [100, 100, 100, 100], // Snow/Ice
    80: [100, 100, 100, 100], // Water
    90: [100, 100, 100, 100], // Wetland
    95: [100, 100, 100, 100], // Mangroves
    100: [77, 86, 91, 94], // Moss/Lichen
  },

  mapSoilToHSGIndex: function(val) {
    if (val === 1 || val === 11) return 0; // A
    if (val === 2 || val === 12) return 1; // B
    if (val === 3 || val === 13) return 2; // C
    if (val === 4 || val === 14) return 3; // D
    return 3; // default to D
  },
  
  getHSGName: function(val) {
    if (val === 1) return 'A';
    if (val === 2) return 'B';
    if (val === 3) return 'C';
    if (val === 4) return 'D';
    if (val === 11) return 'A/D';
    if (val === 12) return 'B/D';
    if (val === 13) return 'C/D';
    if (val === 14) return 'D/D';
    return '-';
  },

  init: function() {
    this.btnCalculate = document.getElementById('btn-calculate-cn');
    this.progressContainer = document.getElementById('cn-progress');
    this.progressFill = document.getElementById('cn-progress-fill');
    this.progressStatus = document.getElementById('cn-progress-status');
    this.resultsContainer = document.getElementById('cn-results-container');
    this.cnTableBody = document.querySelector('#cn-table tbody');
    this.layerToggles = document.getElementById('cn-layer-toggles');
    this.exportsContainer = document.getElementById('cn-exports');
    this.rasterValuesBox = document.getElementById('raster-values-box');
    
    // UI elements for values
    this.valLulc = document.getElementById('val-lulc');
    this.valSoil = document.getElementById('val-soil');
    this.valCn = document.getElementById('val-cn');

    if (this.btnCalculate) {
      this.btnCalculate.addEventListener('click', () => this.generateCN());
    }

    // Toggle events
    document.getElementById('toggle-cn-layer')?.addEventListener('change', (e) => this.toggleLayer('cn', e.target.checked));
    document.getElementById('toggle-lulc-layer')?.addEventListener('change', (e) => this.toggleLayer('lulc', e.target.checked));
    document.getElementById('toggle-soil-layer')?.addEventListener('change', (e) => this.toggleLayer('soil', e.target.checked));

    // Opacity
    document.getElementById('cn-opacity')?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      document.getElementById('cn-opacity-val').textContent = val + '%';
      this.setOpacity(val / 100);
    });

    // Export events
    document.getElementById('btn-export-cn')?.addEventListener('click', () => this.exportRaster(this.cnRaster, 'cn_raster.tif'));
    document.getElementById('btn-export-lulc')?.addEventListener('click', () => this.exportRaster(this.lulcData, 'lulc_raster.tif'));
    document.getElementById('btn-export-soil')?.addEventListener('click', () => this.exportRaster(this.soilData, 'soil_raster.tif'));

    // Sortable JS Initialization for Layer Ordering
    const cnLayerList = document.getElementById('cn-layer-list');
    if (cnLayerList && typeof Sortable !== 'undefined') {
      new Sortable(cnLayerList, {
        handle: '.drag-handle',
        animation: 150,
        onEnd: () => this.updateLayerZIndices()
      });
    }
  },

  updateLayerZIndices: function() {
    const listItems = document.querySelectorAll('#cn-layer-list input[type="checkbox"]');
    let baseZ = 150; // Place above base layers but below hydro/menus
    listItems.forEach(input => {
      const type = input.id.replace('toggle-', '').replace('-layer', '');
      let layer = null;
      if (type === 'cn') layer = this.cnLayer;
      if (type === 'lulc') layer = this.lulcLayer;
      if (type === 'soil') layer = this.soilLayer;
      
      if (layer && layer.setZIndex) {
        layer.setZIndex(baseZ);
      }
      baseZ--;
    });
  },

  toggleLayer: function(type, show) {
    const appMap = typeof DEM !== 'undefined' ? DEM.mapModule.getMap() : window.appMap;
    if (!appMap) return;

    let layer, legendId;
    if (type === 'cn') { layer = this.cnLayer; legendId = 'map-legend-cn'; }
    if (type === 'lulc') { layer = this.lulcLayer; legendId = 'map-legend-lulc'; }
    if (type === 'soil') { layer = this.soilLayer; legendId = 'map-legend-soil'; }

    if (!layer) return;

    const legendsBox = document.getElementById('float-map-legends');
    if (legendsBox) legendsBox.style.display = 'block';

    if (show) {
      if (!appMap.hasLayer(layer)) {
        const opacity = document.getElementById('cn-opacity') ? parseInt(document.getElementById('cn-opacity').value) / 100 : 0.7;
        layer.setOpacity(opacity);
        layer.addTo(appMap);
        this.updateLayerZIndices();
      }
      document.getElementById(legendId).style.display = 'block';
    } else {
      if (appMap.hasLayer(layer)) appMap.removeLayer(layer);
      document.getElementById(legendId).style.display = 'none';
    }
  },

  setOpacity: function(opacity) {
    if (this.cnLayer) this.cnLayer.setOpacity(opacity);
    if (this.lulcLayer) this.lulcLayer.setOpacity(opacity);
    if (this.soilLayer) this.soilLayer.setOpacity(opacity);
  },

  updateProgress: function(percent, statusText) {
    this.progressContainer.style.display = 'block';
    if (percent === -1) {
      this.progressFill.classList.add('indeterminate');
      this.progressFill.style.width = '30%';
    } else {
      this.progressFill.classList.remove('indeterminate');
      this.progressFill.style.width = percent + '%';
    }
    if (statusText) this.progressStatus.textContent = statusText;
  },

  generateCN: async function() {
    const state = typeof DEM !== 'undefined' ? DEM.app.getState() : {};
    if (!state.bbox) {
      if (typeof DEM !== 'undefined') DEM.utils.toast('Please define a bounding box first.', 'error');
      else alert('Please define a bounding box first.');
      return;
    }

    try {
      this.btnCalculate.disabled = true;
      this.updateProgress(-1, 'Fetching ESA WorldCover LULC...');
      
      this.bbox = state.bbox;
      // 1. Fetch ESA WorldCover
      const lulcItem = await this.searchESAWorldCover(this.bbox);
      if (!lulcItem) throw new Error('No ESA WorldCover data found for this bounding box.');
      
      const lulcUrl = lulcItem.assets.map.href;
      // Get SAS Token via our proxy (avoids CORS on Vercel)
      let signedLulcUrl = lulcUrl;
      try {
        const sasRes = await fetch('/api/sign?href=' + encodeURIComponent(lulcUrl));
        if (sasRes.ok) {
          const ct = sasRes.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const data = await sasRes.json();
            if (data.href) signedLulcUrl = data.href;
          }
        }
      } catch (e) {
        console.warn('ESA WorldCover SAS token failed, trying unsigned URL:', e.message);
      }

      this.updateProgress(-1, 'Reading LULC Raster Data...');
      try {
        this.lulcData = await this.readGeoTiffBbox(signedLulcUrl, this.bbox, 30); // Downsample to ~30m
      } catch (err) {
        throw new Error(`Failed to read LULC data: ${err.message || err.name}. URL: ${signedLulcUrl}`);
      }

      this.updateProgress(-1, 'Reading HYSOGs250m Soil Data...');
      const hysogsUrl = window.location.origin + '/api/earthdata?url=' + encodeURIComponent('https://data.ornldaac.earthdata.nasa.gov/protected/global_soil/Global_Hydrologic_Soil_Group/data/HYSOGs250m.tif');
      try {
        this.soilData = await this.readGeoTiffBbox(hysogsUrl, this.bbox, 30, this.lulcData.width, this.lulcData.height);
      } catch (err) {
        throw new Error(`Failed to read HYSOGs data: ${err.message || err.name}. URL: ${hysogsUrl}`);
      }

      this.updateProgress(70, 'Calculating Curve Number...');
      this.cnRaster = this.calculateCNRaster(this.lulcData, this.soilData);

      this.updateProgress(90, 'Applying Sub-watershed Statistics...');
      this.calculateSubWatershedStats(this.cnRaster, this.bbox);

      this.updateProgress(100, 'Displaying Results...');
      this.displayLayersOnMap();
      this.setupMapHover();
      
      this.layerToggles.style.display = 'block';
      this.exportsContainer.style.display = 'block';
      
      // Explicitly enable export buttons since they are disabled when map unloads
      document.getElementById('btn-export-cn').disabled = false;
      document.getElementById('btn-export-lulc').disabled = false;
      document.getElementById('btn-export-soil').disabled = false;

      document.getElementById('float-map-legends').style.display = 'block';
      if (typeof lucide !== 'undefined') lucide.createIcons();

      setTimeout(() => {
        this.progressContainer.style.display = 'none';
      }, 2000);
      if (typeof DEM !== 'undefined') DEM.utils.toast('CN Calculation complete!', 'success');
      
    } catch (err) {
      console.error(err);
      if (typeof DEM !== 'undefined') DEM.utils.toast('CN Calculation failed: ' + err.message, 'error');
      this.progressContainer.style.display = 'none';
    } finally {
      this.btnCalculate.disabled = false;
    }
  },

  searchESAWorldCover: async function(bbox) {
    const searchBody = {
      collections: ["esa-worldcover"],
      bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
      sortby: [{ field: "datetime", direction: "desc" }]
    };
    const res = await fetch("https://planetarycomputer.microsoft.com/api/stac/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(searchBody)
    });
    if (!res.ok) throw new Error('ESA WorldCover STAC search failed');
    const data = await res.json();
    if (data.features && data.features.length > 0) {
      return data.features[0]; // Take the first intersecting tile
    }
    return null;
  },

  readGeoTiffBbox: async function(url, bbox, targetResMeters, forceWidth = null, forceHeight = null) {
    const tiff = await GeoTIFF.fromUrl(url);
    const image = await tiff.getImage();
    
    // Calculate reading window
    const tiepoint = image.getTiePoints()[0];
    const pixelScale = image.getFileDirectory().ModelPixelScale;
    
    // EPSG 4326 to pixels
    const minX = Math.floor((bbox.west - tiepoint.x) / pixelScale[0]);
    const maxX = Math.ceil((bbox.east - tiepoint.x) / pixelScale[0]);
    const minY = Math.floor((tiepoint.y - bbox.north) / pixelScale[1]);
    const maxY = Math.ceil((tiepoint.y - bbox.south) / pixelScale[1]);

    // Resampling
    const resDeg = targetResMeters / 111320;
    
    let targetWidth = forceWidth || Math.max(1, Math.ceil((bbox.east - bbox.west) / resDeg));
    let targetHeight = forceHeight || Math.max(1, Math.ceil((bbox.north - bbox.south) / resDeg));

    // Fallback constraints
    if (targetWidth > 4000) targetWidth = 4000;
    if (targetHeight > 4000) targetHeight = 4000;

    const pool = new GeoTIFF.Pool();
    const data = await image.readRasters({
      window: [minX, minY, maxX, maxY],
      width: targetWidth,
      height: targetHeight,
      pool: pool
    });

    return {
      data: data[0],
      width: targetWidth,
      height: targetHeight,
      noData: image.getFileDirectory().GDAL_NODATA
    };
  },

  calculateCNRaster: function(lulcData, soilData) {
    const size = lulcData.width * lulcData.height;
    const cnArray = new Float32Array(size);

    for (let i = 0; i < size; i++) {
      const lulcVal = lulcData.data[i];
      const soilVal = soilData.data[i];
      
      // Handle NoData
      if (lulcVal === lulcData.noData || soilVal === soilData.noData || lulcVal === 0 || soilVal === 0 || isNaN(lulcVal) || isNaN(soilVal)) {
        cnArray[i] = -9999;
        continue;
      }

      const hsgIndex = this.mapSoilToHSGIndex(soilVal);
      const cnVals = this.lookupTable[lulcVal];

      if (cnVals) {
        cnArray[i] = cnVals[hsgIndex];
      } else {
        cnArray[i] = -9999;
      }
    }

    return {
      data: cnArray,
      width: lulcData.width,
      height: lulcData.height
    };
  },

  calculateSubWatershedStats: function(cnRaster, bbox) {
    this.resultsContainer.style.display = 'block';
    this.cnTableBody.innerHTML = '';
    
    let features = [];
    const state = typeof DEM !== 'undefined' ? DEM.app.getState() : {};
    if (state.uploadedBoundary) {
      const geojson = state.uploadedBoundary;
      if (geojson.features && geojson.features.length > 0) {
        features = geojson.features;
      } else if (geojson.type === 'Feature') {
        features = [geojson];
      }
    }

    if (features.length === 0) {
      let sum = 0, count = 0;
      for (let i = 0; i < cnRaster.data.length; i++) {
        if (cnRaster.data[i] !== -9999) { sum += cnRaster.data[i]; count++; }
      }
      const avg = count > 0 ? (sum / count).toFixed(1) : 'N/A';
      
      this.cnTableBody.innerHTML = `<tr>
        <td>Bounding Box</td>
        <td>${document.getElementById('bbox-area').textContent}</td>
        <td><strong>${avg}</strong></td>
      </tr>`;
      return;
    }

    const dx = (bbox.east - bbox.west) / cnRaster.width;
    const dy = (bbox.north - bbox.south) / cnRaster.height;

    const canvas = document.createElement('canvas');
    canvas.width = cnRaster.width;
    canvas.height = cnRaster.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    features.forEach((feat, idx) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';

      // Draw the feature geometry as a mask
      const geom = feat.geometry || feat;
      if (geom && geom.type) {
        const drawRing = (ring) => {
          ctx.beginPath();
          for (let i = 0; i < ring.length; i++) {
            const [lon, lat] = ring[i];
            const px = (lon - bbox.west) / dx;
            const py = (bbox.north - lat) / dy;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
        };

        if (geom.type === 'Polygon') {
          ctx.fillStyle = '#fff';
          drawRing(geom.coordinates[0]); ctx.fill();
          ctx.fillStyle = '#000';
          for (let i = 1; i < geom.coordinates.length; i++) { drawRing(geom.coordinates[i]); ctx.fill(); }
        } else if (geom.type === 'MultiPolygon') {
          for (const poly of geom.coordinates) {
            ctx.fillStyle = '#fff';
            drawRing(poly[0]); ctx.fill();
            ctx.fillStyle = '#000';
            for (let i = 1; i < poly.length; i++) { drawRing(poly[i]); ctx.fill(); }
          }
        }
      }

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0, count = 0;

      for (let y = 0; y < cnRaster.height; y++) {
        for (let x = 0; x < cnRaster.width; x++) {
          const i = y * cnRaster.width + x;
          const val = cnRaster.data[i];
          if (val !== -9999 && imgData[i * 4] > 128) {
            sum += val;
            count++;
          }
        }
      }
      
      const avg = count > 0 ? (sum / count).toFixed(1) : 'N/A';
      const name = feat.properties?.name || feat.properties?.ID || feat.properties?.Id || `Basin ${idx + 1}`;
      const area = (count * dx * dy * 111 * 111 * Math.cos(bbox.south*(Math.PI/180))).toFixed(2);

      this.cnTableBody.innerHTML += `<tr>
        <td>${name}</td>
        <td>${area}</td>
        <td><strong>${avg}</strong></td>
      </tr>`;
    });
  },

  createPlottyLayer: function(rasterData, domain, colorScale) {
    const canvas = document.createElement('canvas');
    const plot = new plotty.plot({
      canvas: canvas,
      data: rasterData.data,
      width: rasterData.width,
      height: rasterData.height,
      domain: domain,
      colorScale: colorScale,
      clampLow: true,
      clampHigh: true,
      noDataValue: rasterData.noData !== undefined ? rasterData.noData : -9999
    });
    plot.render();
    return canvas.toDataURL();
  },

  displayLayersOnMap: function() {
    const appMap = typeof DEM !== 'undefined' ? DEM.mapModule.getMap() : window.appMap;
    if (!appMap || typeof plotty === 'undefined') return;

    if (this.cnLayer) appMap.removeLayer(this.cnLayer);
    if (this.lulcLayer) appMap.removeLayer(this.lulcLayer);
    if (this.soilLayer) appMap.removeLayer(this.soilLayer);

    const bounds = [[this.bbox.south, this.bbox.west], [this.bbox.north, this.bbox.east]];

    // Register ESA WorldCover Custom Colormap if not exists
    if (!plotty.colorscales['esa-lulc']) {
      plotty.addColorScale('esa-lulc', 
        ["#006400", "#ffbb22", "#ffff4c", "#f096ff", "#fa0000", "#b4b4b4", "#f0f0f0", "#0064c8", "#0096a0", "#00cf75", "#fae6a0"],
        [0, 0.1111, 0.2222, 0.3333, 0.4444, 0.5555, 0.6666, 0.7777, 0.8888, 0.9444, 1.0]
      );
    }

    // Create LULC Layer
    const lulcImg = this.createPlottyLayer(this.lulcData, [10, 100], 'esa-lulc');
    this.lulcLayer = L.imageOverlay(lulcImg, bounds, { opacity: 0.7 });

    // Create Soil Layer (values mostly 1-4, 11-14)
    const soilImg = this.createPlottyLayer(this.soilData, [1, 14], 'viridis');
    this.soilLayer = L.imageOverlay(soilImg, bounds, { opacity: 0.7 });

    // Create CN Layer
    const cnImg = this.createPlottyLayer(this.cnRaster, [30, 100], 'jet');
    const opacity = document.getElementById('cn-opacity') ? parseInt(document.getElementById('cn-opacity').value) / 100 : 0.7;
    this.cnLayer = L.imageOverlay(cnImg, bounds, { opacity: opacity });
    this.cnLayer.addTo(appMap);

    appMap.fitBounds(bounds);

    // Sync toggle inputs with map state
    document.getElementById('toggle-cn-layer').checked = true;
    document.getElementById('toggle-lulc-layer').checked = false;
    document.getElementById('toggle-soil-layer').checked = false;
    
    this.updateLayerZIndices();
  },

  setupMapHover: function() {
    const appMap = typeof DEM !== 'undefined' ? DEM.mapModule.getMap() : window.appMap;
    if (!appMap) return;

    this.rasterValuesBox.style.display = 'block';

    appMap.on('mousemove', (e) => {
      const lat = e.latlng.lat;
      const lng = e.latlng.lng;

      // Check if within bounds
      if (lng < this.bbox.west || lng > this.bbox.east || lat < this.bbox.south || lat > this.bbox.north) {
        this.valLulc.textContent = '-';
        this.valSoil.textContent = '-';
        this.valCn.textContent = '-';
        return;
      }

      // Calculate pixel index
      const dx = (this.bbox.east - this.bbox.west) / this.cnRaster.width;
      const dy = (this.bbox.north - this.bbox.south) / this.cnRaster.height;

      const px = Math.floor((lng - this.bbox.west) / dx);
      const py = Math.floor((this.bbox.north - lat) / dy);

      if (px >= 0 && px < this.cnRaster.width && py >= 0 && py < this.cnRaster.height) {
        const idx = py * this.cnRaster.width + px;

        const lVal = this.lulcData.data[idx];
        const sVal = this.soilData.data[idx];
        const cVal = this.cnRaster.data[idx];

        this.valLulc.textContent = (lVal !== this.lulcData.noData && !isNaN(lVal)) ? lVal : '-';
        this.valSoil.textContent = (sVal !== this.soilData.noData && !isNaN(sVal)) ? this.getHSGName(sVal) : '-';
        this.valCn.textContent = cVal !== -9999 ? cVal : '-';
      }
    });

    appMap.on('mouseout', () => {
      this.valLulc.textContent = '-';
      this.valSoil.textContent = '-';
      this.valCn.textContent = '-';
    });
  },

  exportRaster: async function(rasterData, filename) {
    if (!rasterData || typeof GeoTIFF === 'undefined') {
      if (typeof DEM !== 'undefined') DEM.utils.toast('Data or GeoTIFF library not available.', 'error');
      return;
    }
    
    if (typeof DEM !== 'undefined') DEM.utils.showLoading('Generating GeoTIFF...');
    
    try {
      const dx = (this.bbox.east - this.bbox.west) / rasterData.width;
      const dy = (this.bbox.north - this.bbox.south) / rasterData.height;

      const metadata = {
        width: rasterData.width,
        height: rasterData.height,
        GeographicTypeGeoKey: 4326, // WGS 84
        ModelPixelScale: [dx, Math.abs(dy), 0],
        ModelTiepoint: [0, 0, 0, this.bbox.west, this.bbox.north, 0],
        GDAL_NODATA: rasterData.noData !== undefined ? String(rasterData.noData) : "-9999"
      };

      const arrayBuffer = await GeoTIFF.writeArrayBuffer(rasterData.data, metadata);
      const blob = new Blob([arrayBuffer], { type: 'image/tiff' });
      
      if (typeof DEM !== 'undefined') {
        DEM.utils.hideLoading();
        DEM.utils.downloadBlob(blob, filename);
        DEM.utils.toast(`Exported ${filename}`, 'success');
      }
    } catch (err) {
      console.error(err);
      if (typeof DEM !== 'undefined') {
        DEM.utils.hideLoading();
        DEM.utils.toast('Export failed: ' + err.message, 'error');
      }
    }
  }
};

window.addEventListener('DOMContentLoaded', () => {
  cnCalculator.init();
});
