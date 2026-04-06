/* ============================================================
   DEM Explorer — DEM Download Module
   ============================================================ */
window.DEM = window.DEM || {};

DEM.dem = (function () {
  const PROXY_BASE = '/api/proxy';
  let currentDEM = null; // { data, width, height, bbox, transform, nodata, source }

  /* --- Source Definitions --- */
  const sources = {
    copernicus: {
      name: 'Copernicus GLO-30',
      resolution: '30m (~1 arcsec)',
      datum: 'EGM2008',
      projection: 'EPSG:4326',
      requiresKey: false,
      getTileUrls(west, south, east, north) {
        const tiles = [];
        const startLat = Math.floor(south);
        const endLat = Math.floor(north);
        const startLon = Math.floor(west);
        const endLon = Math.floor(east);
        for (let lat = startLat; lat <= endLat; lat++) {
          for (let lon = startLon; lon <= endLon; lon++) {
            const latP = lat >= 0 ? 'N' : 'S';
            const lonP = lon >= 0 ? 'E' : 'W';
            const latS = String(Math.abs(lat)).padStart(2, '0');
            const lonS = String(Math.abs(lon)).padStart(3, '0');
            const name = `Copernicus_DSM_COG_10_${latP}${latS}_00_${lonP}${lonS}_00_DEM`;
            tiles.push({
              name, lat, lon,
              url: `https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/${name}/${name}.tif`
            });
          }
        }
        return tiles;
      }
    },
    srtm: {
      name: 'SRTM GL1',
      resolution: '30m',
      datum: 'EGM96',
      projection: 'EPSG:4326',
      requiresKey: true,
      getApiUrl(west, south, east, north) {
        const key = localStorage.getItem('dem_api_key_opentopo') || '';
        return `https://portal.opentopography.org/API/globaldem?demtype=SRTMGL1&south=${south}&north=${north}&west=${west}&east=${east}&outputFormat=GTiff&API_Key=${key}`;
      }
    },
    alos: {
      name: 'ALOS AW3D30',
      resolution: '30m',
      datum: 'EGM96',
      projection: 'EPSG:4326',
      requiresKey: true,
      getApiUrl(west, south, east, north) {
        const key = localStorage.getItem('dem_api_key_opentopo') || '';
        return `https://portal.opentopography.org/API/globaldem?demtype=AW3D30&south=${south}&north=${north}&west=${west}&east=${east}&outputFormat=GTiff&API_Key=${key}`;
      }
    },
    copernicus90: {
      name: 'Copernicus GLO-90',
      resolution: '90m (~3 arcsec)',
      datum: 'EGM2008',
      projection: 'EPSG:4326',
      requiresKey: false,
      getTileUrls(west, south, east, north) {
        const tiles = [];
        const startLat = Math.floor(south);
        const endLat = Math.floor(north);
        const startLon = Math.floor(west);
        const endLon = Math.floor(east);
        for (let lat = startLat; lat <= endLat; lat++) {
          for (let lon = startLon; lon <= endLon; lon++) {
            const latP = lat >= 0 ? 'N' : 'S';
            const lonP = lon >= 0 ? 'E' : 'W';
            const latS = String(Math.abs(lat)).padStart(2, '0');
            const lonS = String(Math.abs(lon)).padStart(3, '0');
            const name = `Copernicus_DSM_COG_30_${latP}${latS}_00_${lonP}${lonS}_00_DEM`;
            tiles.push({
              name, lat, lon,
              url: `https://copernicus-dem-90m.s3.eu-central-1.amazonaws.com/${name}/${name}.tif`
            });
          }
        }
        return tiles;
      }
    },
    fabdem: {
      name: 'FABDEM',
      resolution: '30m',
      datum: 'EGM2008',
      projection: 'EPSG:4326',
      requiresKey: true,
      getApiUrl(west, south, east, north) {
        const key = localStorage.getItem('dem_api_key_opentopo') || '';
        return `https://portal.opentopography.org/API/globaldem?demtype=FABDEM&south=${south}&north=${north}&west=${west}&east=${east}&outputFormat=GTiff&API_Key=${key}`;
      }
    },
    merit: {
      name: 'MERIT DEM',
      resolution: '90m',
      datum: 'EGM96',
      projection: 'EPSG:4326',
      requiresKey: true,
      getApiUrl(west, south, east, north) {
        const key = localStorage.getItem('dem_api_key_opentopo') || '';
        return `https://portal.opentopography.org/API/globaldem?demtype=MERITDEM&south=${south}&north=${north}&west=${west}&east=${east}&outputFormat=GTiff&API_Key=${key}`;
      }
    },
    tandemx: {
      name: 'TanDEM-X 90m',
      resolution: '90m',
      datum: 'WGS84',
      projection: 'EPSG:4326',
      requiresKey: true,
      getApiUrl(west, south, east, north) {
        const key = localStorage.getItem('dem_api_key_opentopo') || '';
        // Note: The correct demtype for TanDEM-X 90m might vary or not be strictly available, we will try TDX90m
        return `https://portal.opentopography.org/API/globaldem?demtype=TDX90m&south=${south}&north=${north}&west=${west}&east=${east}&outputFormat=GTiff&API_Key=${key}`;
      }
    },
    nasadem: {
      name: 'NASADEM',
      resolution: '30m',
      datum: 'EGM96',
      projection: 'EPSG:4326',
      requiresKey: true,
      getApiUrl(west, south, east, north) {
        const key = localStorage.getItem('dem_api_key_opentopo') || '';
        return `https://portal.opentopography.org/API/globaldem?demtype=NASADEM&south=${south}&north=${north}&west=${west}&east=${east}&outputFormat=GTiff&API_Key=${key}`;
      }
    },
    gebco: {
      name: 'GEBCO',
      resolution: '500m',
      datum: 'WGS84',
      projection: 'EPSG:4326',
      requiresKey: true,
      getApiUrl(west, south, east, north) {
        const key = localStorage.getItem('dem_api_key_opentopo') || '';
        // We will default to GEBCOIceTopo 
        return `https://portal.opentopography.org/API/globaldem?demtype=GEBCOIceTopo&south=${south}&north=${north}&west=${west}&east=${east}&outputFormat=GTiff&API_Key=${key}`;
      }
    }
  };

  /* --- Fetch a tile via proxy or direct --- */
  async function fetchTile(url, onProgress) {
    // Try proxy first for CORS safety
    const proxyUrl = `${PROXY_BASE}?url=${encodeURIComponent(url)}`;
    let fetchUrl = proxyUrl;

    try {
      const response = await fetch(fetchUrl);
      if (!response.ok) {
        // Fallback: try direct
        const directResponse = await fetch(url);
        if (!directResponse.ok) throw new Error(`HTTP ${directResponse.status}`);
        return await directResponse.arrayBuffer();
      }
      // Read with progress tracking
      const reader = response.body.getReader();
      const contentLength = +response.headers.get('Content-Length') || 0;
      let received = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (onProgress && contentLength > 0) {
          onProgress(Math.round((received / contentLength) * 100));
        }
      }
      const allChunks = new Uint8Array(received);
      let pos = 0;
      for (const chunk of chunks) {
        allChunks.set(chunk, pos);
        pos += chunk.length;
      }

      // Save raw tile to local drive via background API call
      try {
        let filename = url.split('/').pop().split('?')[0];
        if (!filename.endsWith('.tif') && !filename.endsWith('.tiff')) filename += '.tif';
        fetch(`/api/save?filename=${encodeURIComponent(filename)}`, {
          method: 'POST',
          body: new Blob([allChunks])
        }).catch(err => console.warn('Failed to save raw tile locally:', err));
      } catch (e) {}

      return allChunks.buffer;
    } catch (err) {
      // Final fallback: try direct URL
      try {
        const directResponse = await fetch(url);
        if (!directResponse.ok) throw new Error(`HTTP ${directResponse.status}`);
        const arrBuf = await directResponse.arrayBuffer();
        
        try {
          let filename = url.split('/').pop().split('?')[0];
          if (!filename.endsWith('.tif') && !filename.endsWith('.tiff')) filename += '.tif';
          fetch(`/api/save?filename=${encodeURIComponent(filename)}`, {
            method: 'POST',
            body: new Blob([arrBuf])
          }).catch(e => {});
        } catch(e) {}
        
        return arrBuf;
      } catch (e2) {
        throw new Error(`Failed to download tile: ${err.message}`);
      }
    }
  }

  /* --- Parse a GeoTIFF from ArrayBuffer --- */
  async function parseTiff(buffer) {
    const tiff = await GeoTIFF.fromArrayBuffer(buffer);
    const image = await tiff.getImage();
    const width = image.getWidth();
    const height = image.getHeight();
    const rasters = await image.readRasters();
    const data = new Float32Array(rasters[0]);
    const origin = image.getOrigin();
    const resolution = image.getResolution();
    const geoBBox = image.getBoundingBox();
    const nodata = image.getGDALNoData();

    return {
      data, width, height,
      bbox: { west: geoBBox[0], south: geoBBox[1], east: geoBBox[2], north: geoBBox[3] },
      transform: {
        originX: origin[0], originY: origin[1],
        pixelWidth: resolution[0], pixelHeight: resolution[1]
      },
      nodata: nodata !== null ? nodata : undefined
    };
  }

  /* --- Clip raster to bbox sub-region --- */
  function clipToBBox(tileData, targetBBox) {
    const { data, width, height, transform, nodata } = tileData;
    const { originX, originY, pixelWidth, pixelHeight } = transform;

    // Compute pixel bounds for the target bbox
    let col0 = Math.floor((targetBBox.west - originX) / pixelWidth);
    let col1 = Math.ceil((targetBBox.east - originX) / pixelWidth);
    let row0 = Math.floor((targetBBox.north - originY) / pixelHeight); // pixelHeight is negative
    let row1 = Math.ceil((targetBBox.south - originY) / pixelHeight);

    col0 = Math.max(0, Math.min(width, col0));
    col1 = Math.max(0, Math.min(width, col1));
    row0 = Math.max(0, Math.min(height, row0));
    row1 = Math.max(0, Math.min(height, row1));

    const newW = col1 - col0;
    const newH = row1 - row0;
    if (newW <= 0 || newH <= 0) return null;

    const newData = new Float32Array(newW * newH);
    for (let r = 0; r < newH; r++) {
      for (let c = 0; c < newW; c++) {
        newData[r * newW + c] = data[(row0 + r) * width + (col0 + c)];
      }
    }

    return {
      data: newData, width: newW, height: newH,
      bbox: {
        west: originX + col0 * pixelWidth,
        north: originY + row0 * pixelHeight,
        east: originX + col1 * pixelWidth,
        south: originY + row1 * pixelHeight
      },
      transform: {
        originX: originX + col0 * pixelWidth,
        originY: originY + row0 * pixelHeight,
        pixelWidth, pixelHeight
      },
      nodata
    };
  }

  /* --- Download DEM for a bbox and source --- */
  async function download(sourceId, bbox, uploadedBoundary = null) {
    const source = sources[sourceId];
    if (!source) throw new Error('Unknown source: ' + sourceId);

    if (source.requiresKey) {
      const key = localStorage.getItem('dem_api_key_opentopo') || '';
      if (!key) throw new Error('API key required. Configure in Settings (⚙).');
    }

    DEM.utils.showProgress('Downloading DEM data...');

    try {
      let result;

      if (source.getApiUrl) {
        // Single API call (OpenTopography)
        const apiUrl = source.getApiUrl(bbox.west, bbox.south, bbox.east, bbox.north);
        const buffer = await fetchTile(apiUrl, (pct) => {
          DEM.utils.updateProgress(pct, `Downloading... ${pct}%`);
        });
        result = await parseTiff(buffer);
      } else if (source.getTileUrls) {
        // Tile-based download
        const tiles = source.getTileUrls(bbox.west, bbox.south, bbox.east, bbox.north);
        if (tiles.length === 0) throw new Error('No tiles found for this region');
        if (tiles.length > 25) throw new Error('Too many tiles needed. Reduce bbox size.');

        DEM.utils.updateProgress(0, `Downloading ${tiles.length} tile(s)...`);
        const tileResults = [];

        for (let i = 0; i < tiles.length; i++) {
          DEM.utils.updateProgress(
            Math.round((i / tiles.length) * 80),
            `Downloading tile ${i + 1}/${tiles.length}...`
          );
          try {
            const buffer = await fetchTile(tiles[i].url);
            const parsed = await parseTiff(buffer);
            tileResults.push(parsed);
          } catch (e) {
            console.warn(`Failed to download tile ${tiles[i].name}:`, e);
          }
        }

        if (tileResults.length === 0) throw new Error('All tile downloads failed');

        DEM.utils.updateProgress(85, 'Merging tiles...');

        if (tileResults.length === 1) {
          result = clipToBBox(tileResults[0], bbox) || tileResults[0];
        } else {
          result = mergeTiles(tileResults, bbox);
        }
      }

      DEM.utils.updateProgress(95, 'Finalizing...');

      // Replace nodata with NaN
      if (result.nodata !== undefined) {
        for (let i = 0; i < result.data.length; i++) {
          if (result.data[i] === result.nodata) result.data[i] = NaN;
        }
      }

      if (uploadedBoundary) {
        maskWithGeoJSON(result, uploadedBoundary);
      }

      result.source = source;
      currentDEM = result;

      DEM.utils.updateProgress(100, 'Complete!');
      setTimeout(() => DEM.utils.hideProgress(), 1000);

      return result;
    } catch (e) {
      DEM.utils.hideProgress();
      throw e;
    }
  }

  /* --- Merge multiple tiles --- */
  function mergeTiles(tiles, bbox) {
    // Determine the output resolution from the first tile
    const refRes = Math.abs(tiles[0].transform.pixelWidth);
    const outW = Math.round((bbox.east - bbox.west) / refRes);
    const outH = Math.round((bbox.north - bbox.south) / refRes);
    const outData = new Float32Array(outW * outH).fill(NaN);

    for (const tile of tiles) {
      const pw = tile.transform.pixelWidth;
      const ph = tile.transform.pixelHeight; // negative

      for (let r = 0; r < tile.height; r++) {
        for (let c = 0; c < tile.width; c++) {
          const lon = tile.transform.originX + c * pw;
          const lat = tile.transform.originY + r * ph;
          if (lon < bbox.west || lon >= bbox.east || lat > bbox.north || lat <= bbox.south) continue;
          const outC = Math.floor((lon - bbox.west) / refRes);
          const outR = Math.floor((bbox.north - lat) / refRes);
          if (outC >= 0 && outC < outW && outR >= 0 && outR < outH) {
            outData[outR * outW + outC] = tile.data[r * tile.width + c];
          }
        }
      }
    }

    return {
      data: outData, width: outW, height: outH,
      bbox: { west: bbox.west, south: bbox.south, east: bbox.east, north: bbox.north },
      transform: {
        originX: bbox.west, originY: bbox.north,
        pixelWidth: refRes, pixelHeight: -refRes
      },
      nodata: undefined
    };
  }

  /* --- Mask DEM using GeoJSON Polygon --- */
  function maskWithGeoJSON(demData, geojson) {
    if (!geojson) return;
    DEM.utils.updateProgress(98, 'Masking to boundary...');
    
    const canvas = document.createElement('canvas');
    canvas.width = demData.width;
    canvas.height = demData.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = '#fff';
    const drawRing = (ring) => {
      ctx.beginPath();
      for (let i = 0; i < ring.length; i++) {
        const [lon, lat] = ring[i];
        const px = (lon - demData.transform.originX) / demData.transform.pixelWidth;
        const py = (lat - demData.transform.originY) / demData.transform.pixelHeight;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };

    const features = geojson.features ? geojson.features : (geojson.type === 'Feature' ? [geojson] : [geojson]);
    for (const f of features) {
      const geom = f.geometry || f; // handle direct geometry obj
      if (!geom || !geom.type) continue;
      const t = geom.type;
      const coords = geom.coordinates;

      if (t === 'Polygon') {
        ctx.fillStyle = '#fff';
        drawRing(coords[0]); ctx.fill();
        ctx.fillStyle = '#000';
        for(let i = 1; i < coords.length; i++) { drawRing(coords[i]); ctx.fill(); }
      } else if (t === 'MultiPolygon') {
        for (const poly of coords) {
          ctx.fillStyle = '#fff';
          drawRing(poly[0]); ctx.fill();
          ctx.fillStyle = '#000';
          for(let i = 1; i < poly.length; i++) { drawRing(poly[i]); ctx.fill(); }
        }
      }
    }

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let maskedOut = 0;
    for (let i = 0; i < demData.data.length; i++) {
      if (imgData[i * 4] < 128) { // check red channel
        demData.data[i] = NaN;
        maskedOut++;
      }
    }
  }

  function getCurrent() { return currentDEM; }
  function getSources() { return sources; }

  return { download, getCurrent, getSources, fetchTile, parseTiff };
})();
