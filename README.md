# 🌍 DEM Explorer

A web-based Digital Elevation Model (DEM) viewer and processor. DEM Explorer allows users to download DEM data from multiple free sources by defining a bounding box, then process and visualize the DEM with elevation displays, hillshade rendering, and contour generation—all within the browser.

## Features

- **Interactive Map Selection**: Draw bounding boxes directly on the map or input coordinates manually.
- **Multiple DEM Sources**:
  - Copernicus GLO-30 (~30m resolution, global, no auth required)
  - SRTM GL1 (~30m resolution, global ±60°, requires OpenTopography API key)
  - ALOS AW3D30 (~30m resolution, global, requires OpenTopography API key)
  - HydroSHEDS (~90m resolution, hydrological DEM, no auth required)
- **Advanced In-Browser Visualization**:
  - **Elevation Map**: Apply different color ramps (Viridis, Terrain, Jet, Grayscale) with opacity controls.
  - **Hillshade**: Compute dynamic hillshading with adjustable sun azimuth, altitude, z-factor, and elevation blending.
  - **Contours**: Generate contour lines at custom intervals with adjustable styles and labels.
- **Statistics**: Instantly view min, max, mean, median, standard deviation, and histograms of the selected region.
- **Exports**: Export processed outputs including raw DEM data, PNG hillshades/screenshots, and GeoJSON contour lines.

## How It Works

This application is designed to be lightweight and serverless-friendly. All heavy geospatial processing (GeoTIFF parsing, hillshade computation, marching squares contour generation, and statistics calculation) runs **entirely client-side in the browser** using JavaScript and HTML5 Canvas, eliminating the need for a complex Python/GDAL backend.

## Local Development Setup

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

### API Keys Configuration (Optional)

If you want to use SRTM or ALOS DEM sources, you need a free OpenTopography API key.
1. Create a `.env` file in the project root:
   ```env
   OPENTOPO_API_KEY=your_api_key_here
   ```
2. Alternatively, you can configure the API key directly in the web app UI using the Settings (⚙) icon.

## Deployment

This app is architected specifically to be deployed on platforms like **Vercel** with zero configuration required. The `api/proxy.js` acts as an Edge Function to handle CORS for DEM tile downloads, while the rest are purely static files.

## Built With

- [Leaflet](https://leafletjs.com/) - Interactive map foundation
- [geotiff.js](https://geotiffjs.github.io/) - In-browser GeoTIFF parsing
- [plotty](https://github.com/santilland/plotty) - Raster colorization
- [Lucide](https://lucide.dev/) - UI Icons

## Author

**Muhammad Ramadhani Wijayanto**

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
