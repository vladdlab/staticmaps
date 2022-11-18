import sharp from 'sharp';

module.exports = async function ({ svgLayers, width, height }) {
  console.log('Start compose SVG layer');
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
    console.log('Finish compose SVG layer.');
  });
  return svgLayerPromise;
};
