/* ============================================================
   DEM Explorer — Flood Bathtub Inundation Module
   ============================================================ */
window.DEM = window.DEM || {};

DEM.flood = (function () {
   let state = {
      floodMask: null,
      level: 0
   };

   function updateFloodLegend(floodedCount, totalValid, waterLevelElev, bbox, width, height) {
      const legendEl = document.getElementById('map-legend-flood');
      const legendsBox = document.getElementById('float-map-legends');
      if (!legendEl) return;

      if (waterLevelElev <= 0 || floodedCount === 0) {
         legendEl.style.display = 'none';
         return;
      }

      // Show the legends panel
      if (legendsBox) legendsBox.style.display = 'block';
      legendEl.style.display = 'block';

      // Estimate area in km²
      let areaKm2 = '—';
      if (bbox) {
         const degPerPixelX = (bbox.east - bbox.west) / width;
         const degPerPixelY = (bbox.north - bbox.south) / height;
         const midLat = (bbox.north + bbox.south) / 2;
         const mPerDegLat = 111320;
         const mPerDegLon = 111320 * Math.cos(midLat * Math.PI / 180);
         const cellAreaKm2 = (degPerPixelX * mPerDegLon / 1000) * (degPerPixelY * mPerDegLat / 1000);
         areaKm2 = (floodedCount * cellAreaKm2).toFixed(2);
      }

      const pct = totalValid > 0 ? ((floodedCount / totalValid) * 100) : 0;

      document.getElementById('flood-legend-level').textContent = waterLevelElev.toFixed(1) + 'm';
      document.getElementById('flood-legend-pixels').textContent = floodedCount.toLocaleString() + ' px flooded';
      document.getElementById('flood-legend-area').textContent = areaKm2 !== '—' ? areaKm2 + ' km²' : '—';
      document.getElementById('flood-legend-bar').style.width = Math.min(100, pct).toFixed(1) + '%';
      document.getElementById('flood-legend-pct').textContent = pct.toFixed(1) + '%';
   }

   function runBathtubModel(demData, waterLevelElev) {
       DEM.utils.showLocalProgress('flood-progress', 'Simulating...');
       return new Promise(resolve => {
           setTimeout(() => {
               const width = demData.width;
               const height = demData.height;
               const data = demData.data;
               const mask = new Uint8Array(width * height);
               const nodata = demData.nodata !== undefined ? demData.nodata : NaN;

               let floodedCount = 0;
               let totalValid = 0;
               for (let i = 0; i < data.length; i++) {
                   const z = data[i];
                   if (isNaN(z) || z === nodata) {
                       mask[i] = 0;
                   } else {
                       totalValid++;
                       if (z <= waterLevelElev) {
                           mask[i] = 1;
                           floodedCount++;
                       } else {
                           mask[i] = 0;
                       }
                   }
               }

               state.floodMask = mask;
               state.level = waterLevelElev;

               if (DEM.mapModule && DEM.mapModule.renderFloodMask) {
                   DEM.mapModule.renderFloodMask(mask, width, height, demData.bbox);
               }

               DEM.utils.hideLocalProgress('flood-progress');
               updateFloodLegend(floodedCount, totalValid, waterLevelElev, demData.bbox, width, height);
               resolve(mask);
           }, 50);
       });
   }

   function getMask() { return state.floodMask; }

   return { runBathtubModel, getMask };
})();
