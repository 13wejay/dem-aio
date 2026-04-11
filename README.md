# 🌍 DEM Explorer

A fully client-side, browser-based GIS application for downloading, visualizing, and analyzing Digital Elevation Models — extended with hydrology, satellite imagery, flood simulation, runoff curve numbers, and more.

[![GitHub](https://img.shields.io/badge/GitHub-13wejay%2Fdem--aio-181717?logo=github)](https://github.com/13wejay/dem-aio)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## ✨ Features

### 🗺️ Bounding Box Workflow
- Draw bounding boxes directly on the interactive map, or enter coordinates manually.
- **Boundary Upload**: Upload Shapefiles (`.zip`) or GeoJSON files to auto-set the bounding box and precisely clip the DEM raster to the exact polygon geometry — all in the browser via off-screen Canvas masking.

### 🏔️ DEM Download & Sources
Download elevation data from multiple global sources via cloud-optimized tiles or API calls:

| Source | Resolution | Coverage | Auth |
|---|---|---|---|
| Copernicus GLO-30 | ~30m | Global | None |
| Copernicus GLO-90 | ~90m | Global | None |
| SRTM GL1 | ~30m | ±60° Latitude | OpenTopography API Key |
| ALOS AW3D30 | ~30m | Global | OpenTopography API Key |
| NASADEM | ~30m | Global | OpenTopography API Key |
| GEBCO | ~500m | Global (Bathymetry) | OpenTopography API Key |

### 🎨 Visualization
- **Elevation Map**: Multiple color ramps (Viridis, Terrain, Jet, Grayscale) with GPU-accelerated rendering via `plotty.js` (WebGL).
- **Hillshade**: Compute dynamic hillshading with adjustable azimuth, altitude, z-factor, and elevation blending.
- **Contours**: Generate contour lines at custom intervals using the Marching Squares algorithm, with adjustable color, weight, and labels.
- **Statistics Panel**: Instantly view min, max, mean, median, standard deviation, and an elevation histogram.

### 💧 Advanced Analysis Modules

#### Hydrology & Watershed Delineation
Driven by the downloaded DEM, compute a full hydrological model:
- **Sink Filling**: Planchon-Darboux algorithm for depression filling.
- **Flow Direction**: D8 flow routing (E, SE, S, SW, W, NW, N, NE).
- **Flow Accumulation**: Topological-sort-based accumulation.
- **Stream Network Extraction**: Threshold-based stream extraction with Strahler and Shreve stream ordering.
- **Watershed Delineation**: Upstream catchment tracing from a user-clicked pour point.
- **Export**: Flow Direction, Flow Accumulation, Streams (GeoJSON + GeoTIFF), Catchment (GeoJSON + GeoTIFF).

#### 🌊 Flood Simulation (Bathtub Model)
Simulate water inundation at a given elevation threshold using a simple bathtub model. Results include:
- Inundated area (km²) and percentage of valid terrain.
- Visual flood mask overlay on the map.

#### 📡 Satellite Imagery (via Microsoft Planetary Computer)
Search and load satellite imagery for the selected region:
- **Sentinel-2 (L2A)**: True-color RGB display + NDWI water body extraction (Green / NIR).
- **Sentinel-1 (GRD)**: SAR backscatter display + automatic water extraction.
- Searches are performed against the Microsoft Planetary Computer STAC API with auto-signed URLs.

#### 🌧️ Curve Number (CN) Calculator
Estimate area-averaged SCS Runoff Curve Numbers using:
- **ESA WorldCover 10m** — Land Use / Land Cover (via Planetary Computer STAC).
- **HYSOGs250m** — Hydrologic Soil Groups (HSG A–D) (via NASA Earthdata).
- CN lookup table based on LULC and HSG classification.
- Per-polygon/sub-basin statistics when a boundary shapefile is uploaded.
- Exportable CN, LULC, and Soil rasters as GeoTIFF.

---

## 🚀 Local Development

You only need **Node.js** to run locally. The dev server handles CORS proxy for tile downloads.

```bash
# 1. Clone the repo
git clone https://github.com/13wejay/dem-aio.git
cd dem-aio

# 2. Install dependencies (just express for the proxy)
npm install

# 3. Start the dev server
npm run dev

# 4. Open in browser
# http://localhost:3000
```

### Optional API Key (OpenTopography)
Sources including SRTM, ALOS, NASADEM, and GEBCO require a free API key from [OpenTopography](https://opentopography.org/). Add it to a `.env` file in the project root:

```env
OPENTOPO_API_KEY=your_key_here
```

---

## ☁️ Deployment (Vercel)

The application is architected to deploy on **Vercel** with zero configuration. The `api/proxy.js` Edge Function handles CORS for DEM tile fetching, while all other files are static.

---

## 🔧 Architecture

All computation is **client-side** — no Python, GDAL, or heavy backend needed.

| Component | Technology |
|---|---|
| Interactive Map | Leaflet + Leaflet.draw |
| GeoTIFF Parsing | geotiff.js |
| Raster Colorization | plotty.js (WebGL) |
| Shapefile Parsing | shpjs |
| Hillshade / Contours | Custom vanilla JS |
| Sink Fill / D8 / Flow Acc. | Custom vanilla JS |
| Bathtub Flood Model | Custom vanilla JS |
| STAC Imagery Search | Microsoft Planetary Computer API |
| CN Calculator | ESA WorldCover + HYSOGs250m |
| Local Export | Node.js dev-server `/api/save` |

---

## 📚 Built With & Attributions

- [Leaflet](https://leafletjs.com/) — Interactive map
- [geotiff.js](https://geotiffjs.github.io/) — GeoTIFF parsing
- [plotty.js](https://github.com/santilland/plotty) — WebGL raster rendering
- [shpjs](https://github.com/calvinmetcalf/shapefile-js) — Shapefile parsing
- [Lucide Icons](https://lucide.dev/) — UI Icons

> ⚠️ Users generating or publishing outputs from this tool must attribute the original dataset providers (NASA, ESA, JAXA, GEBCO, etc.). See **[ATTRIBUTIONS.md](ATTRIBUTIONS.md)** for required citations and library licenses.

---

## 👤 Author

**Muhammad Ramadhani Wijayanto**

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
