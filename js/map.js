/* ============================================================
   DEM Explorer — Map Module (Leaflet)
   ============================================================ */
window.DEM = window.DEM || {};

DEM.mapModule = (function () {
  let map = null;
  let drawnItems = null;
  let drawControl = null;
  let currentRect = null;
  let elevationOverlay = null;
  let hillshadeOverlay = null;
  let contourLayer = null;
  let uploadedBoundaryLayer = null;
  
  let satelliteOverlay = null;
  let waterMaskOverlay = null;
  let floodMaskOverlay = null;

  /* --- Initialize Map --- */
  function init() {
    map = L.map('map', {
      center: [0, 20],
      zoom: 3,
      zoomControl: true,
      attributionControl: true
    });

    // Basemap layers
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    });

    const satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '© Esri, Maxar, Earthstar',
      maxZoom: 19
    });

    const topoMap = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenTopoMap',
      maxZoom: 17
    });

    osm.addTo(map);
    L.control.layers({
      'OpenStreetMap': osm,
      'Satellite': satellite,
      'Topographic': topoMap
    }, {}, { position: 'topright' }).addTo(map);

    L.control.scale({ position: 'bottomright', imperial: false }).addTo(map);

    // Draw layer
    drawnItems = L.featureGroup().addTo(map);

    // Draw control
    drawControl = new L.Control.Draw({
      position: 'topright',
      draw: {
        rectangle: {
          shapeOptions: {
            color: '#00d4aa',
            weight: 2,
            fillOpacity: 0.1,
            dashArray: '6, 4'
          }
        },
        polygon: false,
        polyline: false,
        circle: false,
        marker: false,
        circlemarker: false
      },
      edit: { featureGroup: drawnItems, remove: true }
    });
    map.addControl(drawControl);

    // Draw events
    map.on(L.Draw.Event.CREATED, function (e) {
      clearBBox();
      currentRect = e.layer;
      drawnItems.addLayer(currentRect);
      const bounds = currentRect.getBounds();
      syncBBoxInputs(bounds);
      if (DEM.app && DEM.app.onBBoxChanged) DEM.app.onBBoxChanged(getBBox());
    });

    map.on(L.Draw.Event.EDITED, function () {
      if (currentRect) {
        const bounds = currentRect.getBounds();
        syncBBoxInputs(bounds);
        if (DEM.app && DEM.app.onBBoxChanged) DEM.app.onBBoxChanged(getBBox());
      }
    });

    map.on(L.Draw.Event.DELETED, function () {
      currentRect = null;
      clearBBoxInputs();
      if (DEM.app && DEM.app.onBBoxChanged) DEM.app.onBBoxChanged(null);
    });

    return map;
  }

  /* --- Sync bbox inputs from map drawn rectangle --- */
  function syncBBoxInputs(bounds) {
    document.getElementById('bbox-west').value = bounds.getWest().toFixed(4);
    document.getElementById('bbox-south').value = bounds.getSouth().toFixed(4);
    document.getElementById('bbox-east').value = bounds.getEast().toFixed(4);
    document.getElementById('bbox-north').value = bounds.getNorth().toFixed(4);
    updateAreaBadge();
  }

  function clearBBoxInputs() {
    document.getElementById('bbox-west').value = '';
    document.getElementById('bbox-south').value = '';
    document.getElementById('bbox-east').value = '';
    document.getElementById('bbox-north').value = '';
    document.getElementById('area-badge').style.display = 'none';
  }

  function updateAreaBadge() {
    const bbox = getBBox();
    if (!bbox) {
      document.getElementById('area-badge').style.display = 'none';
      return;
    }
    const area = DEM.utils.computeArea(bbox.west, bbox.south, bbox.east, bbox.north);
    document.getElementById('bbox-area').textContent = area;
    document.getElementById('area-badge').style.display = 'inline-flex';
  }

  /* --- Get bbox from input fields --- */
  function getBBox() {
    const w = parseFloat(document.getElementById('bbox-west').value);
    const s = parseFloat(document.getElementById('bbox-south').value);
    const e = parseFloat(document.getElementById('bbox-east').value);
    const n = parseFloat(document.getElementById('bbox-north').value);
    if (isNaN(w) || isNaN(s) || isNaN(e) || isNaN(n)) return null;
    return { west: w, south: s, east: e, north: n };
  }

  /* --- Draw bbox from manual input --- */
  function drawBBoxFromInputs() {
    const bbox = getBBox();
    console.log('[MAP] drawBBoxFromInputs, read bbox:', bbox);
    if (!bbox) { DEM.utils.toast('Enter all coordinates', 'error'); return null; }
    const err = DEM.utils.validateBBox(bbox.west, bbox.south, bbox.east, bbox.north);
    if (err) { DEM.utils.toast(err, 'error'); return null; }
    // Clear previous layers but don't clear inputs (we already read them)
    drawnItems.clearLayers();
    currentRect = null;
    removeAllOverlays();
    // Draw new rectangle
    const bounds = L.latLngBounds(
      L.latLng(bbox.south, bbox.west),
      L.latLng(bbox.north, bbox.east)
    );
    currentRect = L.rectangle(bounds, {
      color: '#00d4aa', weight: 2, fillOpacity: 0.1, dashArray: '6, 4'
    });
    drawnItems.addLayer(currentRect);
    map.fitBounds(bounds, { padding: [40, 40] });
    // Re-sync inputs to ensure they're set from the rectangle bounds
    syncBBoxInputs(bounds);
    console.log('[MAP] BBox drawn, synced inputs');
    return bbox;
  }

  /* --- Clear bbox --- */
  function clearBBox() {
    drawnItems.clearLayers();
    currentRect = null;
    if (uploadedBoundaryLayer) {
      map.removeLayer(uploadedBoundaryLayer);
      uploadedBoundaryLayer = null;
    }
    clearBBoxInputs();
    removeAllOverlays();
  }

  /* --- Draw uploaded boundary --- */
  function drawUploadedBoundary(geojson) {
    if (uploadedBoundaryLayer) { map.removeLayer(uploadedBoundaryLayer); }
    drawnItems.clearLayers();
    currentRect = null;
    removeAllOverlays();

    uploadedBoundaryLayer = L.geoJSON(geojson, {
      style: {
        color: '#f59e0b',
        weight: 2,
        fillOpacity: 0.1,
        dashArray: '4, 4'
      }
    }).addTo(map);

    const bounds = uploadedBoundaryLayer.getBounds();
    map.fitBounds(bounds, { padding: [40, 40] });
    syncBBoxInputs(bounds);
    console.log('[MAP] Uploaded boundary drawn, synced inputs');
    
    // Draw the theoretical bounding box as a faint rect around the polygon
    currentRect = L.rectangle(bounds, {
      color: '#00d4aa', weight: 1, fillOpacity: 0.0, dashArray: '2, 6'
    });
    drawnItems.addLayer(currentRect);
    
    return getBBox();
  }

  /* --- Activate draw mode --- */
  function activateDraw() {
    const drawHandler = new L.Draw.Rectangle(map, drawControl.options.draw.rectangle);
    drawHandler.enable();
  }

  /* --- Elevation Image Overlay --- */
  function setElevationOverlay(imageUrl, bounds, opacity) {
    if (elevationOverlay) { map.removeLayer(elevationOverlay); }
    elevationOverlay = L.imageOverlay(imageUrl, bounds, {
      opacity: opacity !== undefined ? opacity : 0.8,
      interactive: false
    }).addTo(map);
  }

  function setElevationOpacity(opacity) {
    if (elevationOverlay) elevationOverlay.setOpacity(opacity);
  }

  function showElevation(show) {
    if (!elevationOverlay) return;
    if (show) { if (!map.hasLayer(elevationOverlay)) map.addLayer(elevationOverlay); }
    else { map.removeLayer(elevationOverlay); }
  }

  /* --- Hillshade Image Overlay --- */
  function setHillshadeOverlay(imageUrl, bounds, opacity) {
    if (hillshadeOverlay) { map.removeLayer(hillshadeOverlay); }
    hillshadeOverlay = L.imageOverlay(imageUrl, bounds, {
      opacity: opacity !== undefined ? opacity : 0.7,
      interactive: false
    }).addTo(map);
  }

  function showHillshade(show) {
    if (!hillshadeOverlay) return;
    if (show) { if (!map.hasLayer(hillshadeOverlay)) map.addLayer(hillshadeOverlay); }
    else { map.removeLayer(hillshadeOverlay); }
  }

  /* --- Contour GeoJSON Layer --- */
  function setContourLayer(geojson, color, weight, showLabels) {
    if (contourLayer) { map.removeLayer(contourLayer); }
    contourLayer = L.geoJSON(geojson, {
      style: function (feature) {
        const elev = feature.properties.elevation;
        const interval = feature.properties.interval || 20;
        const isIndex = (elev % (interval * 5)) === 0;
        return {
          color: color || '#00d4aa',
          weight: isIndex ? (weight || 1) * 1.8 : (weight || 1),
          opacity: isIndex ? 0.9 : 0.5
        };
      },
      onEachFeature: function (feature, layer) {
        if (showLabels) {
          layer.bindTooltip(feature.properties.elevation + 'm', {
            permanent: false, direction: 'center',
            className: 'contour-tooltip'
          });
        }
      }
    }).addTo(map);
  }

  function showContours(show) {
    if (!contourLayer) return;
    if (show) { if (!map.hasLayer(contourLayer)) map.addLayer(contourLayer); }
    else { map.removeLayer(contourLayer); }
  }

  function removeAllOverlays() {
    if (elevationOverlay) { map.removeLayer(elevationOverlay); elevationOverlay = null; }
    if (hillshadeOverlay) { map.removeLayer(hillshadeOverlay); hillshadeOverlay = null; }
    if (contourLayer) { map.removeLayer(contourLayer); contourLayer = null; }
    if (satelliteOverlay) { map.removeLayer(satelliteOverlay); satelliteOverlay = null; }
    if (waterMaskOverlay) { map.removeLayer(waterMaskOverlay); waterMaskOverlay = null; }
    if (floodMaskOverlay) { map.removeLayer(floodMaskOverlay); floodMaskOverlay = null; }
  }

  /* --- Satellite & Flood Rendering --- */
  function renderSatellite(imageData, platform) {
    if (!imageData) return;
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    const outData = ctx.createImageData(canvas.width, canvas.height);
    
    if (platform === 'sentinel-2-l2a' && imageData.rgb) {
      // Find 98th percentile for stretching
      let maxR = 1, maxG = 1, maxB = 1;
      let count = imageData.width * imageData.height;
      let sample = Math.floor(count / 1000);
      let rMaxs = [], gMaxs = [], bMaxs = [];
      for(let i=0; i<count; i+=sample) {
          rMaxs.push(imageData.rgb[0][i]);
          gMaxs.push(imageData.rgb[1][i]);
          bMaxs.push(imageData.rgb[2][i]);
      }
      rMaxs.sort((a,b)=>a-b); gMaxs.sort((a,b)=>a-b); bMaxs.sort((a,b)=>a-b);
      maxR = rMaxs[Math.floor(rMaxs.length*0.98)] || 10000;
      maxG = gMaxs[Math.floor(gMaxs.length*0.98)] || 10000;
      maxB = bMaxs[Math.floor(bMaxs.length*0.98)] || 10000;

      for (let i = 0; i < count; i++) {
        let r = Math.min(255, (imageData.rgb[0][i] / maxR) * 255);
        let g = Math.min(255, (imageData.rgb[1][i] / maxG) * 255);
        let b = Math.min(255, (imageData.rgb[2][i] / maxB) * 255);
        outData.data[i*4] = r;
        outData.data[i*4+1] = g;
        outData.data[i*4+2] = b;
        outData.data[i*4+3] = 255;
      }
    } else if (platform === 'sentinel-1-grd' && imageData.vh) {
      let count = imageData.width * imageData.height;
      let sample = Math.floor(count / 1000);
      let vhMaxs = [];
      for(let i=0; i<count; i+=sample) {
        if(imageData.vh[i] > 0) vhMaxs.push(imageData.vh[i]);
      }
      vhMaxs.sort((a,b)=>a-b);
      let maxVH = vhMaxs[Math.floor(vhMaxs.length*0.95)] || 1;
      
      for (let i = 0; i < count; i++) {
        let v = 0;
        if (imageData.vh[i] > 0) {
           v = Math.min(255, (imageData.vh[i] / maxVH) * 255);
        }
        outData.data[i*4] = v;
        outData.data[i*4+1] = v;
        outData.data[i*4+2] = v;
        outData.data[i*4+3] = 255;
      }
    }
    ctx.putImageData(outData, 0, 0);
    const bounds = getLeafletBounds(imageData.bbox);
    if (satelliteOverlay) { map.removeLayer(satelliteOverlay); }
    satelliteOverlay = L.imageOverlay(canvas.toDataURL(), bounds, { opacity: 0.8, interactive: false }).addTo(map);
  }

  function renderWaterMask(mask, width, height, bbox) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const outData = ctx.createImageData(width, height);
    for(let i=0; i<mask.length; i++) {
      if(mask[i] === 1) {
        outData.data[i*4] = 0;
        outData.data[i*4+1] = 100;
        outData.data[i*4+2] = 255;
        outData.data[i*4+3] = 180;
      }
    }
    ctx.putImageData(outData, 0, 0);
    const bounds = getLeafletBounds(bbox);
    if (waterMaskOverlay) { map.removeLayer(waterMaskOverlay); }
    waterMaskOverlay = L.imageOverlay(canvas.toDataURL(), bounds, { opacity: 0.8, interactive: false }).addTo(map);
  }

  function renderFloodMask(mask, width, height, bbox) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const outData = ctx.createImageData(width, height);
    for(let i=0; i<mask.length; i++) {
      if (mask[i] === 1) {
        outData.data[i*4] = 255; // highlight flood in bright cyan/blue
        outData.data[i*4+1] = 0;
        outData.data[i*4+2] = 0;
        outData.data[i*4+3] = 150;
      }
    }
    ctx.putImageData(outData, 0, 0);
    const bounds = getLeafletBounds(bbox);
    if (floodMaskOverlay) { map.removeLayer(floodMaskOverlay); }
    floodMaskOverlay = L.imageOverlay(canvas.toDataURL(), bounds, { opacity: 0.8, interactive: false }).addTo(map);
  }

  function toggleSatelliteLayer(layerName, show) {
     let layer;
     if (layerName === 'image') layer = satelliteOverlay;
     else if (layerName === 'water') layer = waterMaskOverlay;
     else if (layerName === 'flood') layer = floodMaskOverlay;
     
     if (!layer) return;
     if (show && !map.hasLayer(layer)) map.addLayer(layer);
     else if (!show && map.hasLayer(layer)) map.removeLayer(layer);
  }

  function setSatelliteOpacity(opacity) {
     if (satelliteOverlay) satelliteOverlay.setOpacity(opacity);
     if (waterMaskOverlay) waterMaskOverlay.setOpacity(opacity);
     if (floodMaskOverlay) floodMaskOverlay.setOpacity(opacity);
  }

  function getSatelliteCanvas() {
     if (!satelliteOverlay) return null;
     const img = satelliteOverlay.getElement();
     const canvas = document.createElement('canvas');
     canvas.width = img.width; canvas.height = img.height;
     canvas.getContext('2d').drawImage(img, 0, 0);
     return canvas;
  }

  function getLeafletBounds(bbox) {
    return L.latLngBounds(
      L.latLng(bbox.south, bbox.west),
      L.latLng(bbox.north, bbox.east)
    );
  }

  return {
    init, getBBox, drawBBoxFromInputs, clearBBox, activateDraw,
    drawUploadedBoundary,
    updateAreaBadge,
    setElevationOverlay, setElevationOpacity, showElevation,
    setHillshadeOverlay, showHillshade,
    setContourLayer, showContours,
    removeAllOverlays, getLeafletBounds,
    renderSatellite, renderWaterMask, renderFloodMask, toggleSatelliteLayer, setSatelliteOpacity, getSatelliteCanvas,
    getMap: () => map
  };
})();
