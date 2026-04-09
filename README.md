# 🌍 DEM Explorer

A web-based Digital Elevation Model (DEM) viewer and processor. DEM Explorer allows users to download DEM data from multiple free sources by defining a bounding box, then process and visualize the DEM with elevation displays, hillshade rendering, and contour generation—all within the browser.

## Features

- **Interactive Map Selection**: Draw bounding boxes directly on the map or input coordinates manually.
- **Custom Boundary Clipping**: Upload **Shapefiles (.zip)** or **GeoJSON** files. The app automatically computes the bounding box and will natively clip (mask) the downloaded DEM raster to perfectly match your geometry using client-side canvas processing!
- **Multiple DEM Sources**:
  - Copernicus GLO-30 (~30m resolution, global, true cloud-optimized)
  - Copernicus GLO-90 (~90m resolution, global, cloud-optimized)
  - SRTM GL1 (~30m resolution, global ±60°)
  - ALOS AW3D30 (~30m resolution, global)
  - NASADEM (~30m resolution, global)
  - GEBCO (~500m resolution, global bathymetry)
- **Advanced In-Browser Visualization**:
  - **Elevation Map**: Apply different color ramps (Viridis, Terrain, Jet, Grayscale) with opacity controls.
  - **GPU Acceleration**: Utilizes `plotty.js` for extremely fast WebGL color scale rendering.
  - **Hillshade**: Compute dynamic hillshading with adjustable sun azimuth, altitude, z-factor, and elevation blending.
  - **Contours**: Generate contour lines at custom intervals using the marching squares algorithm, with adjustable styles and labels.
- **Statistics**: Instantly view min, max, mean, median, standard deviation, and histograms of the selected region.
- **Exports**: Direct export capability to standard **GeoTIFF (.tif)**, visually styled PNGs, and GeoJSON contour lines directly to your local file system via the local dev server.

## How It Works

This application is designed to be lightweight and serverless-friendly. All heavy geospatial processing—including Shapefile vector parsing (`shpjs`), GeoTIFF raster reading, hillshade computation, contour generation, and polygon geometric clipping—runs **entirely client-side in the browser** using JavaScript and standard canvas/WebGL technologies.

To run DEM Explorer locally, you just need Node.js installed to serve the static files and handle the proxy for overcoming CORS restrictions.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/13wejay/dem-aio.git
   cd dem-aio
   ```

2. **Start the development server:**
   ```bash
   npm start
   # or
   node dev-server.js
   ```

3. **Open your browser:**
   Navigate to `http://localhost:3000`

## Deployment

This app is architected specifically to be deployed on platforms like **Vercel** with zero configuration required. The `api/proxy.js` acts as an Edge Function to handle CORS for DEM tile downloads, while the rest are purely static files.

## Built With & Attributions

- [Leaflet](https://leafletjs.com/) - Interactive map foundation
- [geotiff.js](https://geotiffjs.github.io/) - In-browser GeoTIFF parsing
- [plotty.js](https://github.com/santilland/plotty) - GPU Raster colorization
- [shpjs](https://github.com/calvinmetcalf/shapefile-js) - Client-side vector boundary parsing
- [Lucide](https://lucide.dev/) - UI Icons

**Important:** Users generating data with this tool are subject to the attribution guidelines of the original dataset providers (NASA, ESA, JAXA, etc.). Please see the **[ATTRIBUTIONS.md](ATTRIBUTIONS.md)** file for a full list of required citations and open-source library licenses.

## Author

**Muhammad Ramadhani Wijayanto**

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
