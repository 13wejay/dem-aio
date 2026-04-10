/* ============================================================
   DEM Explorer — Satellite Imagery & Derivation Module
   ============================================================ */
window.DEM = window.DEM || {};

DEM.satellite = (function () {
  let state = {
    results: [],
    currentScene: null,
    currentSatellite: null,
    imageData: null, // extracted arrays (RGB for S2, VH for S1)
    waterMask: null, // derived water mask
  };

  const STAC_API = 'https://planetarycomputer.microsoft.com/api/stac/v1/search';
  const SIGN_API = 'https://planetarycomputer.microsoft.com/api/sas/v1/sign?href=';

  async function search(platform, bbox, start, end, cloudCover) {
    DEM.utils.showLocalProgress('sat-progress', 'Searching STAC Catalog...');
    try {
      const payload = {
        collections: [platform],
        bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
        datetime: `${start}T00:00:00Z/${end}T23:59:59Z`,
        sortby: [{ field: "datetime", direction: "desc" }],
        limit: 20
      };

      if (platform === 'sentinel-2-l2a' && cloudCover) {
        payload.query = { "eo:cloud_cover": { "lt": cloudCover } };
      }

      const res = await fetch(STAC_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      state.results = data.features || [];
      return state.results;
    } finally {
      DEM.utils.hideLocalProgress('sat-progress');
    }
  }

  async function getSignedUrl(href) {
    const res = await fetch(SIGN_API + encodeURIComponent(href));
    const data = await res.json();
    return data.href;
  }

  async function loadScene(itemIndex, bbox) {
    const item = state.results[itemIndex];
    if (!item) return;
    state.currentScene = item;
    state.currentSatellite = item.collection;
    DEM.utils.showLocalProgress('sat-progress', 'Loading Satellite Imagery...');
    
    try {
      if (state.currentSatellite === 'sentinel-2-l2a') {
        await loadS2(item, bbox);
      } else if (state.currentSatellite === 'sentinel-1-grd') {
        await loadS1(item, bbox);
      }
      
      // Notify map to update
      if (DEM.mapModule && DEM.mapModule.renderSatellite) {
        DEM.mapModule.renderSatellite(state.imageData, state.currentSatellite);
      }
      DEM.utils.toast(`Loaded ${item.id}`, 'success');
      return true;
    } catch (e) {
      console.error(e);
      DEM.utils.toast('Failed to load scene: ' + e.message, 'error');
      return false;
    } finally {
      DEM.utils.hideLocalProgress('sat-progress');
    }
  }

  async function readBBoxFromTiff(url, targetBBox, isS1 = false, epsg = null) {
    const tiff = await GeoTIFF.fromUrl(url);
    const image = await tiff.getImage();
    const origin = image.getOrigin();
    const resolution = image.getResolution();

    let targetWest = targetBBox.west;
    let targetEast = targetBBox.east;
    let targetSouth = targetBBox.south;
    let targetNorth = targetBBox.north;

    if (epsg && window.proj4) {
      if (!proj4.defs(`EPSG:${epsg}`)) {
        if (epsg >= 32600 && epsg <= 32660) {
           const zone = epsg - 32600;
           proj4.defs(`EPSG:${epsg}`, `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`);
        } else if (epsg >= 32700 && epsg <= 32760) {
           const zone = epsg - 32700;
           proj4.defs(`EPSG:${epsg}`, `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`);
        } else if (epsg === 4326) {
           // Identity, WGS84
        }
      }
      
      try {
        if (epsg !== 4326 && proj4.defs(`EPSG:${epsg}`)) {
          // Project WGS84 bounds to native coords corners (approximated as min/max of corners)
          const c1 = proj4('EPSG:4326', `EPSG:${epsg}`, [targetBBox.west, targetBBox.south]);
          const c2 = proj4('EPSG:4326', `EPSG:${epsg}`, [targetBBox.east, targetBBox.north]);
          targetWest = Math.min(c1[0], c2[0]);
          targetEast = Math.max(c1[0], c2[0]);
          targetSouth = Math.min(c1[1], c2[1]);
          targetNorth = Math.max(c1[1], c2[1]);
        }
      } catch (e) {
        console.warn('Proj4 projection failed:', e);
      }
    }

    // Find pixel window for our target bbox
    let col0 = Math.floor((targetWest - origin[0]) / resolution[0]);
    let col1 = Math.ceil((targetEast - origin[0]) / resolution[0]);
    let row0 = Math.floor((targetNorth - origin[1]) / resolution[1]); // resolution[1] is typically negative
    let row1 = Math.ceil((targetSouth - origin[1]) / resolution[1]);

    if (resolution[1] > 0) { // Safety check if resolution[1] is positive
        row0 = Math.floor((targetSouth - origin[1]) / resolution[1]);
        row1 = Math.ceil((targetNorth - origin[1]) / resolution[1]);
    }

    // clamp
    col0 = Math.max(0, Math.min(image.getWidth(), col0));
    col1 = Math.max(0, Math.min(image.getWidth(), col1));
    row0 = Math.max(0, Math.min(image.getHeight(), row0));
    row1 = Math.max(0, Math.min(image.getHeight(), row1));

    if (col0 >= col1 || row0 >= row1) {
       throw new Error("Target bounding box does not intersect this tile appropriately.");
    }

    const windowArgs = { window: [col0, row0, col1, row1] };
    const rasters = await image.readRasters(windowArgs);
    
    // Compute actual extracted bounds in WGS84
    let actualWest = targetBBox.west;
    let actualEast = targetBBox.east;
    let actualSouth = targetBBox.south;
    let actualNorth = targetBBox.north;

    if (epsg !== null && window.proj4 && proj4.defs(`EPSG:${epsg}`) && epsg !== 4326) {
        const actualUtmWest = origin[0] + col0 * resolution[0];
        const actualUtmEast = origin[0] + col1 * resolution[0];
        const actualUtmNorth = origin[1] + row0 * resolution[1];
        const actualUtmSouth = origin[1] + row1 * resolution[1];

        // Back-project the corners
        try {
            const sw = proj4(`EPSG:${epsg}`, 'EPSG:4326', [actualUtmWest, actualUtmSouth]);
            const se = proj4(`EPSG:${epsg}`, 'EPSG:4326', [actualUtmEast, actualUtmSouth]);
            const nw = proj4(`EPSG:${epsg}`, 'EPSG:4326', [actualUtmWest, actualUtmNorth]);
            const ne = proj4(`EPSG:${epsg}`, 'EPSG:4326', [actualUtmEast, actualUtmNorth]);

            actualWest = Math.min(sw[0], nw[0]);
            actualEast = Math.max(se[0], ne[0]);
            actualSouth = Math.min(sw[1], se[1]);
            actualNorth = Math.max(nw[1], ne[1]);
        } catch (e) {
            console.warn('Reverse projection failed, using original bbox', e);
        }
    }

    return {
      data: rasters[0],
      width: col1 - col0,
      height: row1 - row0,
      nodata: image.getGDALNoData(),
      actualBbox: { west: actualWest, south: actualSouth, east: actualEast, north: actualNorth }
    };
  }

  async function loadS2(item, bbox) {
    // S2 true color (visual) is easy, but if we want NDWI we need Green (B03) and NIR (B08)
    // We will load visual/RGB directly if available, or load TCI.
    const tciHref = await getSignedUrl(item.assets.visual.href);
    const b03Href = await getSignedUrl(item.assets.B03.href);
    const b08Href = await getSignedUrl(item.assets.B08.href);
    
    DEM.utils.updateLocalProgress('sat-progress', 30, 'Reading Visual band...');
    // Visual band is often a 3-channel RGB image (red, green, blue)
    const tiff = await GeoTIFF.fromUrl(tciHref);
    const image = await tiff.getImage();
    const origin = image.getOrigin();
    const resolution = image.getResolution();
    const epsg = item.properties['proj:epsg'];
    
    let targetWest = bbox.west, targetEast = bbox.east, targetSouth = bbox.south, targetNorth = bbox.north;
    if (epsg && window.proj4) {
      if (!proj4.defs(`EPSG:${epsg}`)) {
        if (epsg >= 32600 && epsg <= 32660) {
           proj4.defs(`EPSG:${epsg}`, `+proj=utm +zone=${epsg-32600} +datum=WGS84 +units=m +no_defs`);
        } else if (epsg >= 32700 && epsg <= 32760) {
           proj4.defs(`EPSG:${epsg}`, `+proj=utm +zone=${epsg-32700} +south +datum=WGS84 +units=m +no_defs`);
        }
      }
      try {
        if (epsg !== 4326 && proj4.defs(`EPSG:${epsg}`)) {
          const c1 = proj4('EPSG:4326', `EPSG:${epsg}`, [bbox.west, bbox.south]);
          const c2 = proj4('EPSG:4326', `EPSG:${epsg}`, [bbox.east, bbox.north]);
          targetWest = Math.min(c1[0], c2[0]); targetEast = Math.max(c1[0], c2[0]);
          targetSouth = Math.min(c1[1], c2[1]); targetNorth = Math.max(c1[1], c2[1]);
        }
      } catch(e) {}
    }
    
    let col0 = Math.floor((targetWest - origin[0]) / resolution[0]);
    let col1 = Math.ceil((targetEast - origin[0]) / resolution[0]);
    let row0 = Math.floor((targetNorth - origin[1]) / resolution[1]);
    let row1 = Math.ceil((targetSouth - origin[1]) / resolution[1]);

    if (resolution[1] > 0) {
       row0 = Math.floor((targetSouth - origin[1]) / resolution[1]);
       row1 = Math.ceil((targetNorth - origin[1]) / resolution[1]);
    }

    col0 = Math.max(0, Math.min(image.getWidth(), col0));
    col1 = Math.max(0, Math.min(image.getWidth(), col1));
    row0 = Math.max(0, Math.min(image.getHeight(), row0));
    row1 = Math.max(0, Math.min(image.getHeight(), row1));

    const w = col1 - col0; const h = row1 - row0;
    const rastersRGB = await image.readRasters({ window: [col0, row0, col1, row1] });
    
    // Compute the actual WGS84 bounding box for the visual band (which dictates the bounds used for Leaflet)
    let actualVisualBbox = bbox;
    if (epsg !== null && window.proj4 && proj4.defs(`EPSG:${epsg}`) && epsg !== 4326) {
        const actualUtmWest = origin[0] + col0 * resolution[0];
        const actualUtmEast = origin[0] + col1 * resolution[0];
        const actualUtmNorth = origin[1] + row0 * resolution[1];
        const actualUtmSouth = origin[1] + row1 * resolution[1];
        try {
            const sw = proj4(`EPSG:${epsg}`, 'EPSG:4326', [actualUtmWest, actualUtmSouth]);
            const se = proj4(`EPSG:${epsg}`, 'EPSG:4326', [actualUtmEast, actualUtmSouth]);
            const nw = proj4(`EPSG:${epsg}`, 'EPSG:4326', [actualUtmWest, actualUtmNorth]);
            const ne = proj4(`EPSG:${epsg}`, 'EPSG:4326', [actualUtmEast, actualUtmNorth]);
            actualVisualBbox = { 
                west: Math.min(sw[0], nw[0]), 
                east: Math.max(se[0], ne[0]), 
                south: Math.min(sw[1], se[1]), 
                north: Math.max(nw[1], ne[1]) 
            };
        } catch (e) {}
    }

    DEM.utils.updateLocalProgress('sat-progress', 60, 'Reading Green/NIR bands...');
    const greenData = await readBBoxFromTiff(b03Href, bbox, false, epsg);
    const nirData = await readBBoxFromTiff(b08Href, bbox, false, epsg);

    state.imageData = {
      rgb: [rastersRGB[0], rastersRGB[1], rastersRGB[2]],
      green: greenData.data,
      nir: nirData.data,
      width: w,
      height: h,
      bbox: actualVisualBbox
    };
  }

  async function loadS1(item, bbox) {
    // For Sentinel 1, usually vv and vh are available
    DEM.utils.updateLocalProgress('sat-progress', 30, 'Reading SAR VH band...');
    let href = item.assets.vh?.href;
    if (!href) href = item.assets.vv?.href; // fallback
    if (!href) throw new Error("No VV/VH bands found.");

    let signedHref = await getSignedUrl(href);
    const epsg = item.properties['proj:epsg'];
    const vhRes = await readBBoxFromTiff(signedHref, bbox, true, epsg);
    
    state.imageData = {
      vh: vhRes.data,
      width: vhRes.width,
      height: vhRes.height,
      bbox: vhRes.actualBbox || bbox
    };
  }

  // --- Derivations ---
  function calculateNDWI() {
    if (!state.imageData || state.currentSatellite !== 'sentinel-2-l2a') return;
    const { green, nir, width, height } = state.imageData;
    const len = width * height;
    const mask = new Uint8Array(len);
    for (let i=0; i<len; i++) {
        const g = green[i];
        const n = nir[i];
        if (g+n === 0) { mask[i] = 0; continue; }
        const ndwi = (g - n) / (g + n);
        // NDWI > 0 is typically water
        mask[i] = ndwi > 0 ? 1 : 0;
    }
    state.waterMask = mask;
    if (DEM.mapModule && DEM.mapModule.renderWaterMask) {
      DEM.mapModule.renderWaterMask(state.waterMask, width, height, state.imageData.bbox);
    }
    DEM.utils.toast('NDWI Calculated', 'success');
  }

  function calculateS1Water() {
    if (!state.imageData || state.currentSatellite !== 'sentinel-1-grd') return;
    const { vh, width, height } = state.imageData;
    const len = width * height;
    const mask = new Uint8Array(len);
    // Sentinel-1 GRD on Planetary Computer usually ranges.
    // Let's use a very simple static threshold or ratio.
    // Without exact calibration values readily mapped, we use a basic heuristic: lowest values = water.
    // Often < 0.05 in linear scale or < -15 dB. We assume linear amplitude/intensity here.
    // Finding standard deviation and mean can also work.
    let sum = 0;
    let count = 0;
    for(let i=0; i<len; i++){
       if(vh[i] > 0) { sum+=vh[i]; count++; }
    }
    const mean = sum/count;
    // VERY rough assumption for water in SAR: much lower than mean backscatter
    const threshold = mean * 0.2; 
    
    for (let i=0; i<len; i++) {
        if (vh[i] > 0 && vh[i] < threshold) {
            mask[i] = 1;
        } else {
            mask[i] = 0;
        }
    }
    state.waterMask = mask;
    if (DEM.mapModule && DEM.mapModule.renderWaterMask) {
      DEM.mapModule.renderWaterMask(state.waterMask, width, height, state.imageData.bbox);
    }
    DEM.utils.toast('SAR Water Extracted', 'success');
  }

  return { search, loadScene, calculateNDWI, calculateS1Water, getState: () => state };
})();
