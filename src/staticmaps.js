import got from 'got';
import sharp from 'sharp';
import path from 'path';
import { mkdirSync, existsSync } from 'fs';
import * as fsPromises from 'fs/promises';

import Image from './image';
import IconMarker from './marker';
import Polyline from './polyline';
import MultiPolygon from './multipolygon';
import Circle from './circle';
import CustomFigure from './customfigure';
import Text from './text';
import Bound from './bound';
import drawSVG from './preparesvg';

import asyncQueue from './helper/asyncQueue';
import geoutils from './helper/geo';

const Piscina = require('piscina');
const { performance } = require('perf_hooks');

class StaticMaps {
  constructor(options = {}) {
    this.options = options;

    this.width = this.options.width;
    this.height = this.options.height;
    this.paddingX = this.options.paddingX || 0;
    this.paddingY = this.options.paddingY || 0;
    this.padding = [this.paddingX, this.paddingY];
    this.tileUrl = 'tileUrl' in this.options ? this.options.tileUrl : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    this.tileSize = this.options.tileSize || 256;
    this.tileSubdomains = this.options.tileSubdomains || this.options.subdomains || [];
    this.tileRequestTimeout = this.options.tileRequestTimeout;
    this.tileRequestHeader = this.options.tileRequestHeader;
    this.tileRequestLimit = Number.isFinite(this.options.tileRequestLimit)
      ? Number(this.options.tileRequestLimit) : 2;
    this.tilesCacheDir = this.options.tilesCacheDir || path.resolve(__dirname, 'tiles');
    this.reverseY = this.options.reverseY || false;
    const zoomRange = this.options.zoomRange || {};
    this.zoomRange = {
      min: zoomRange.min || 1,
      max: this.options.maxZoom || zoomRange.max || 17, // maxZoom
    };

    // # progress
    this.progress = 0;
    this.progressFunc = this.options.progressFunc || function logProgress(progress) { console.log(`Progress: ${progress}`); };

    // # features
    this.markers = [];
    this.customfigures = [];
    this.lines = [];
    this.multipolygons = [];
    this.circles = [];
    this.text = [];
    this.bounds = [];

    // # fields that get set when map is rendered
    this.center = [];
    this.centerX = 0;
    this.centerY = 0;
    this.zoom = 0;

    if (!existsSync(this.tilesCacheDir)) {
      mkdirSync(this.tilesCacheDir, { recursive: true });
    }
    if (!existsSync(`${this.tilesCacheDir}/256`)) {
      mkdirSync(`${this.tilesCacheDir}/256`);
    }
    if (!existsSync(`${this.tilesCacheDir}/512`)) {
      mkdirSync(`${this.tilesCacheDir}/512`);
    }
    if (!existsSync(`${this.tilesCacheDir}/1024`)) {
      mkdirSync(`${this.tilesCacheDir}/1024`);
    }
  }

  addLine(options) {
    this.lines.push(new Polyline(options));
  }

  addMarker(options) {
    this.markers.push(new IconMarker(options));
  }

  addCustom(options) {
    this.customfigures.push(new CustomFigure(options));
  }

  addPolygon(options) {
    this.lines.push(new Polyline(options));
  }

  addMultiPolygon(options) {
    this.multipolygons.push(new MultiPolygon(options));
  }

  addCircle(options) {
    this.circles.push(new Circle(options));
  }

  addBound(options) {
    this.bounds.push(new Bound(options));
  }

  addText(options) {
    this.text.push(new Text(options));
  }

  /**
    * Render static map with all map features that were added to map before
    */
  async render(center, zoom) {
    if (!this.lines && !this.markers && !this.multipolygons && !(center && zoom)) {
      throw new Error('Cannot render empty map: Add  center || lines || markers || polygons.');
    }

    this.center = center;
    this.zoom = zoom || this.calculateZoom();

    const maxZoom = this.zoomRange.max;
    if (maxZoom && this.zoom > maxZoom) this.zoom = maxZoom;

    if (center && center.length === 2) {
      this.centerX = geoutils.lonToX(center[0], this.zoom);
      this.centerY = geoutils.latToY(center[1], this.zoom);
    } else {
      // # get extent of all lines
      const extent = this.determineExtent(this.zoom);

      // # calculate center point of map
      const centerLon = (extent[0] + extent[2]) / 2;
      const centerLat = (extent[1] + extent[3]) / 2;

      this.centerX = geoutils.lonToX(centerLon, this.zoom);
      this.centerY = geoutils.latToY(centerLat, this.zoom);
    }

    this.image = new Image(this.options);

    await Promise.all([
      this.drawBaselayer(),
      this.drawSvgLayer(),
    ]);
    return this.composeLayers();
  }

  /**
    * calculate common extent of all current map features
    */
  determineExtent(zoom) {
    const extents = [];

    // Add bbox to extent
    if (this.center && this.center.length >= 4) extents.push(this.center);

    // add bounds to extent
    if (this.bounds.length) {
      this.bounds.forEach((bound) => extents.push(bound.extent()));
    }

    // Add polylines and polygons to extent
    if (this.lines.length) {
      this.lines.forEach((line) => {
        extents.push(line.extent());
      });
    }
    if (this.multipolygons.length) {
      this.multipolygons.forEach((multipolygon) => {
        extents.push(multipolygon.extent());
      });
    }

    // Add circles to extent
    if (this.circles.length) {
      this.circles.forEach((circle) => {
        extents.push(circle.extent());
      });
    }

    // Add marker to extent
    for (let i = 0; i < this.markers.length; i++) {
      const marker = this.markers[i];
      const e = [marker.coord[0], marker.coord[1]];

      if (!zoom) {
        extents.push([
          marker.coord[0],
          marker.coord[1],
          marker.coord[0],
          marker.coord[1],
        ]);
        continue;
      }

      // # consider dimension of marker
      const ePx = marker.extentPx();
      const x = geoutils.lonToX(e[0], zoom);
      const y = geoutils.latToY(e[1], zoom);

      extents.push([
        geoutils.xToLon(x - parseFloat(ePx[0]) / this.tileSize, zoom),
        geoutils.yToLat(y + parseFloat(ePx[1]) / this.tileSize, zoom),
        geoutils.xToLon(x + parseFloat(ePx[2]) / this.tileSize, zoom),
        geoutils.yToLat(y - parseFloat(ePx[3]) / this.tileSize, zoom),
      ]);
    }

    return [
      Math.min(...extents.map((e) => e[0])),
      Math.min(...extents.map((e) => e[1])),
      Math.max(...extents.map((e) => e[2])),
      Math.max(...extents.map((e) => e[3])),
    ];
  }

  /**
    * calculate the best zoom level for given extent
    */
  calculateZoom() {
    for (let z = this.zoomRange.max; z >= this.zoomRange.min; z--) {
      const extent = this.determineExtent(z);
      const width = (geoutils.lonToX(extent[2], z)
        - geoutils.lonToX(extent[0], z)) * this.tileSize;
      if (width > (this.width - (this.padding[0] * 2))) continue;

      const height = (geoutils.latToY(extent[1], z)
        - geoutils.latToY(extent[3], z)) * this.tileSize;
      if (height > (this.height - (this.padding[1] * 2))) continue;

      return z;
    }
    return this.zoomRange.min;
  }

  /**
    * transform tile number to pixel on image canvas
    */
  xToPx(x) {
    const px = ((x - this.centerX) * this.tileSize) + (this.width / 2);
    return Number(Math.round(px));
  }

  /**
    * transform tile number to pixel on image canvas
    */
  yToPx(y) {
    const px = ((y - this.centerY) * this.tileSize) + (this.height / 2);
    return Number(Math.round(px));
  }

  async drawBaselayer() {
    if (!this.tileUrl) {
      // Early return if we shouldn't draw a base layer
      return this.image.draw([]);
    }
    const xMin = Math.floor(this.centerX - ((0.5 * this.width) / this.tileSize));
    const yMin = Math.floor(this.centerY - ((0.5 * this.height) / this.tileSize));
    const xMax = Math.ceil(this.centerX + ((0.5 * this.width) / this.tileSize));
    const yMax = Math.ceil(this.centerY + ((0.5 * this.height) / this.tileSize));

    const result = [];

    for (let x = xMin; x < xMax; x++) {
      for (let y = yMin; y < yMax; y++) {
        // # x and y may have crossed the date line
        const maxTile = (2 ** this.zoom);
        const tileX = (x + maxTile) % maxTile;
        let tileY = (y + maxTile) % maxTile;
        if (this.reverseY) tileY = ((1 << this.zoom) - tileY) - 1;

        let tileUrl;
        if (this.tileUrl.includes('{quadkey}')) {
          const quadKey = geoutils.tileXYToQuadKey(tileX, tileY, this.zoom);
          tileUrl = this.tileUrl.replace('{quadkey}', quadKey);
        } else {
          tileUrl = this.tileUrl.replace('{z}', this.zoom).replace('{x}', tileX).replace('{y}', tileY);
        }

        if (this.tileSubdomains.length > 0) {
          // replace subdomain with random domain from tileSubdomains array
          tileUrl = tileUrl.replace('{s}', this.tileSubdomains[Math.floor(Math.random() * this.tileSubdomains.length)]);
        }

        result.push({
          url: tileUrl,
          filename: `${this.zoom}_${x}_${y}`,
          box: [
            this.xToPx(x),
            this.yToPx(y),
            this.xToPx(x + 1),
            this.yToPx(y + 1),
          ],
        });
      }
    }

    console.log('Start downloading tiles');
    const t1 = performance.now();
    const tiles = await this.getTiles(result);
    const t2 = performance.now();
    console.log(`Finish downloading tiles. Take ${t2 - t1} ms`);
    const layerPromise = this.image.draw(tiles.filter((v) => v.success).map((v) => v.tile));
    layerPromise.then(() => {
      if (this.progress === 5) {
        this.progress = 6;
      } else {
        this.progress = 5;
      }
      this.progressFunc(this.progress);
    });
    return layerPromise;
  }

  async composeLayers() {
    console.log('Start final compose');
    const t1 = performance.now();
    this.image.image = await sharp(this.image.image, { limitInputPixels: false })
      .composite([{ input: this.svgLayer, limitInputPixels: false }])
      .toBuffer();

    const t2 = performance.now();
    console.log(`Finish final compose. Take ${t2 - t1} ms.`);
    this.progress = 7;
    this.progressFunc(this.progress);
  }

  async drawSvgLayer() {
    const layers = this.drawFeatures();

    const worker = new Piscina({
      filename: path.resolve(__dirname, 'worker.js'),
    });

    this.svgLayer = await worker.run({
      svgLayers: layers,
      width: this.width,
      height: this.height,
    });
    if (this.progress === 5) {
      this.progress = 6;
    } else {
      this.progress = 5;
    }
    this.progressFunc(this.progress);
  }

  /**
   *  Draw all features to the basemap
   */
  drawFeatures() {
    const mapOptions = {
      width: this.width,
      height: this.height,
      zoom: this.zoom,
      centerY: this.centerY,
      centerX: this.centerX,
      tileSize: this.tileSize,
    };

    const line = drawSVG(this.lines, 'lines', mapOptions);
    const circles = drawSVG(this.circles, 'circles', mapOptions);
    const custom = drawSVG(this.customfigures, 'custom', mapOptions);

    return [line, circles, custom];
  }

  /**
   *  Fetching tile from endpoint
   */
  async getTile(data) {
    const options = {
      url: data.url,
      responseType: 'buffer',
      // resolveWithFullResponse: true,
      headers: this.tileRequestHeader || {},
      timeout: this.tileRequestTimeout,
    };

    try {
      const tileFIle = await fsPromises.readFile(`${this.tilesCacheDir}/${this.tileSize}/${data.filename}.jpg`);
      return {
        success: true,
        tile: {
          url: data.url,
          box: data.box,
          body: tileFIle,
        },
      };
    } catch {
      try {
        const res = await got.get(options);
        const { body, headers } = res;

        const contentType = headers['content-type'];
        if (!contentType.startsWith('image/')) throw new Error('Tiles server response with wrong data');

        fsPromises.writeFile(`${this.tilesCacheDir}/${this.tileSize}/${data.filename}.jpg`, body);

        return {
          success: true,
          tile: {
            url: data.url,
            box: data.box,
            body,
          },
        };
      } catch (error) {
        return {
          success: false,
          error,
        };
      }
    }
  }

  /**
   *  Fetching tiles and limit concurrent connections
   */
  async getTiles(baseLayers) {
    const limit = this.tileRequestLimit;

    // Limit concurrent connections to tiles server
    // https://operations.osmfoundation.org/policies/tiles/#technical-usage-requirements
    if (Number(limit)) {
      const aQueue = [];
      const tiles = [];
      for (let i = 0, j = baseLayers.length; i < j; i += limit) {
        const chunks = baseLayers.slice(i, i + limit);
        const sQueue = [];
        aQueue.push(async () => {
          chunks.forEach((r) => {
            sQueue.push((async () => {
              const tile = await this.getTile(r);
              tiles.push(tile);
            })());
          });
          await Promise.all(sQueue);
        });
      }
      await asyncQueue(aQueue);
      return tiles;
    }

    // Do not limit concurrent connections at all
    const tilePromises = [];
    baseLayers.forEach((r) => { tilePromises.push(this.getTile(r)); });
    return Promise.all(tilePromises);
  }
}

export default StaticMaps;
module.exports = StaticMaps;
