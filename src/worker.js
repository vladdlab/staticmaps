import sharp from 'sharp';

const { performance } = require('perf_hooks');

module.exports = async function ({ svgLayers, width, height }) {
  console.log('Start compose SVG layer');
  const t1 = performance.now();
  const svgLayerPromise = sharp({
    limitInputPixels: false,
    create: {
      width,
      height,
      channels: 4,
      background: {
        r: 0, g: 0, b: 0, alpha: 0,
      },
    },
  }).png().composite(svgLayers).toBuffer();

  svgLayerPromise.then(() => {
    const t2 = performance.now();
    console.log(`Finish compose SVG layer. Take ${t2 - t1} ms.`);
  });
  return svgLayerPromise;
};
