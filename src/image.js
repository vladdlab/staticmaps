import sharp from 'sharp';
import last from 'lodash.last';

const { performance } = require('perf_hooks');

export default class Image {
  constructor(options = {}) {
    this.options = options;
    this.width = this.options.width;
    this.height = this.options.height;
    this.quality = this.options.quality || 100;
  }

  /**
   * Prepare all tiles to fit the baselayer
   */
  prepareTileParts(data) {
    return new Promise((resolve) => {
      const tile = sharp(data.body);
      tile
        .metadata()
        .then((metadata) => {
          const x = data.box[0];
          const y = data.box[1];
          const sx = x < 0 ? 0 : x;
          const sy = y < 0 ? 0 : y;
          const dx = x < 0 ? -x : 0;
          const dy = y < 0 ? -y : 0;
          const extraWidth = x + (metadata.width - this.width);
          const extraHeight = y + (metadata.width - this.height);
          const w = metadata.width + (x < 0 ? x : 0) - (extraWidth > 0 ? extraWidth : 0);
          const h = metadata.height + (y < 0 ? y : 0) - (extraHeight > 0 ? extraHeight : 0);

          // Fixed #20 https://github.com/StephanGeorg/staticmaps/issues/20
          if (!w || !h) {
            resolve({ success: false });
            return null;
          }

          return tile
            .extract({
              left: dx,
              top: dy,
              width: w,
              height: h,
            })
            .toBuffer()
            .then((part) => {
              resolve({
                success: true,
                position: { top: Math.round(sy), left: Math.round(sx) },
                data: part,
              });
            })
            .catch(() => resolve({ success: false }));
        })
        .catch(() => resolve({ success: false }));
    });
  }

  async draw(tiles) {
    console.log(`Tiels amount - ${tiles.length}`);
    console.log('Start baselayer');
    const t1 = performance.now();
    // Generate baseimage
    const baselayer = sharp({
      limitInputPixels: false,
      create: {
        width: this.width,
        height: this.height,
        channels: 4,
        background: {
          r: 0, g: 0, b: 0, alpha: 0,
        },
      },
    });

    // Save baseImage as buffer
    let tempBuffer = await baselayer.png().toBuffer();
    if (tiles.length === 0) {
      this.image = tempBuffer;
      const t3 = performance.now();
      console.log(`Finish baselayer. Take ${t3 - t1} ms`);
      return true;
    }
    console.log('Start prepare tiles');
    // Prepare tiles for composing baselayer
    const tileParts = [];
    tiles.forEach((tile, i) => {
      tileParts.push(this.prepareTileParts(tile, i));
    });

    const preparedTiles = (await Promise.all(tileParts)).filter((v) => v.success);
    console.log('Finish prepare tiles.');

    console.log('Start compose base layer');
    // Compose all prepared tiles to the baselayer
    const preparedTilesForSharp = preparedTiles
      .filter((preparedTile) => !!preparedTile) // remove non-existing tiles
      .map((preparedTile) => {
        const { position, data } = preparedTile;
        position.top = Math.round(position.top);
        position.left = Math.round(position.left);
        return { input: data, ...position };
      });

    tempBuffer = await sharp(tempBuffer, { limitInputPixels: false })
      .composite(preparedTilesForSharp)
      .toBuffer();

    console.log('Finish compose base layer.');

    this.image = tempBuffer;
    const t2 = performance.now();
    console.log(`Finish baselayer. Take ${t2 - t1} ms`);
    return true;
  }

  /**
   * Save image to file
   */
  async save(fileName = 'output.png', outOpts = {}) {
    const format = last(fileName.split('.'));
    const outputOptions = outOpts;
    outputOptions.quality = outputOptions.quality || this.quality;
    switch (format.toLowerCase()) {
      case 'webp': await sharp(this.image, { limitInputPixels: false }).webp(outputOptions).toFile(fileName); break;
      case 'jpg':
      case 'jpeg': await sharp(this.image, { limitInputPixels: false }).jpeg(outputOptions).toFile(fileName); break;
      case 'png':
      default:
        await sharp(this.image, { limitInputPixels: false }).png(outputOptions).toFile(fileName);
    }
  }

  /**
   * Return image as buffer
   */
  async buffer(mime = 'image/png', outOpts = {}) {
    const outputOptions = outOpts;
    outputOptions.quality = outputOptions.quality || this.quality;
    switch (mime.toLowerCase()) {
      case 'image/webp': return sharp(this.image, { limitInputPixels: false }).webp(outputOptions).toBuffer();
      case 'image/jpeg':
      case 'image/jpg': return sharp(this.image, { limitInputPixels: false }).jpeg(outputOptions).toBuffer();
      case 'image/png':
      default: return sharp(this.image, { limitInputPixels: false }).png(outputOptions).toBuffer();
    }
  }
}

module.exports = Image;
