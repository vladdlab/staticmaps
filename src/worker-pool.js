import chunk from 'lodash.chunk';
import sharp from 'sharp';
import geoutils from './helper/geo';

const RENDER_CHUNK_SIZE = 1000;

/**
    * transform tile number to pixel on image canvas
    */
function xToPx(x, mapOptions) {
  const px = ((x - mapOptions.centerX) * mapOptions.tileSize) + (mapOptions.width / 2);
  return Number(Math.round(px));
}

/**
  * transform tile number to pixel on image canvas
  */
function yToPx(y, mapOptions) {
  const px = ((y - mapOptions.centerY) * mapOptions.tileSize) + (mapOptions.height / 2);
  return Number(Math.round(px));
}

/**
 *  Render a circle to SVG
 */
function circleToSVG(circle, mapOptions) {
  const latCenter = circle.coord[1];
  const radiusInPixel = geoutils.meterToPixel(circle.radius, mapOptions.zoom, latCenter);
  const x = xToPx(geoutils.lonToX(circle.coord[0], mapOptions.zoom), mapOptions);
  const y = yToPx(geoutils.latToY(circle.coord[1], mapOptions.zoom), mapOptions);
  return `
    <circle
      cx="${x}"
      cy="${y}"
      r="${radiusInPixel}"
      style="fill-rule: inherit;"
      stroke="${circle.color}"
      fill="${circle.fill}"
      stroke-width="${circle.width}"
      />
  `;
}

/**
 *  Render a custom to SVG
 */
function customToSVG(custom, mapOptions) {
  const x = xToPx(geoutils.lonToX(custom.coord[0], mapOptions.zoom), mapOptions)
    - Math.floor(custom.offset[0] * (mapOptions.zoom / 4));
  const y = yToPx(geoutils.latToY(custom.coord[1], mapOptions.zoom), mapOptions)
    - Math.floor(custom.offset[1] * (mapOptions.zoom / 4));

  return `
    <svg
    width="${Math.floor(custom.width * (mapOptions.zoom / 4))}"
    height="${Math.floor(custom.height * (mapOptions.zoom / 4))}"
    viewBox="0 0 500 500"
    x="${x}"
    y="${y}">
      <path
      d="${custom.path}"
      style="fill-rule: inherit;"
      stroke="${custom.color}"
      fill="${custom.fill ? custom.fill : 'none'}"
      stroke-width="${custom.strokeWidth}"/>
  </svg>
  `;
}

/**
 * Render text to SVG
 */
// function textToSVG(text, mapOptions) {
//   const mapcoords = [
//     xToPx(geoutils.lonToX(text.coord[0], mapOptions.zoom)) - text.offset[0],
//     yToPx(geoutils.latToY(text.coord[1], mapOptions.zoom)) - text.offset[1],
//   ];

//   return `
//     <text
//       x="${mapcoords[0]}"
//       y="${mapcoords[1]}"
//       style="fill-rule: inherit; font-family: ${text.font};"
//       font-size="${text.size}pt"
//       stroke="${text.color}"
//       fill="${text.fill ? text.fill : 'none'}"
//       stroke-width="${text.width}"
//       text-anchor="${text.anchor}"
//     >
//         ${text.text}
//     </text>
//   `;
// }

/**
 *  Render MultiPolygon to SVG
 */
// function multiPolygonToSVG(multipolygon, mapOptions) {
//   const shapeArrays = multipolygon.coords.map((shape) => shape.map((coord) => [
//     xToPx(geoutils.lonToX(coord[0], mapOptions.zoom)),
//     yToPx(geoutils.latToY(coord[1], mapOptions.zoom)),
//   ]));

//   const pathArrays = shapeArrays.map((points) => {
//     const startPoint = points.shift();

//     const pathParts = [
//       `M ${startPoint[0]} ${startPoint[1]}`,
//       ...points.map((p) => `L ${p[0]} ${p[1]}`),
//       'Z',
//     ];

//     return pathParts.join(' ');
//   });

//   return `<path
//     d="${pathArrays.join(' ')}"
//     style="fill-rule: inherit;"
//     stroke="${multipolygon.color}"
//     fill="${multipolygon.fill ? multipolygon.fill : 'none'}"
//     stroke-width="${multipolygon.width}"/>`;
// }

// /**
//  *  Draw markers to the basemap
//  */
// drawMarkers() {
//   console.log('Start drawing markers');
//   const t1 = performance.now();
//   const queue = [];
//   this.markers.forEach((marker) => {
//     queue.push(async () => {
//       const top = Math.round(marker.position[1]);
//       const left = Math.round(marker.position[0]);
//       if (
//         top < 0
//         || left < 0
//         || top > this.height
//         || left > this.width
//       ) return;
//       this.image.image = await sharp(this.image.image)
//         .composite([{
//           input: marker.imgData,
//           top,
//           left,
//         }])
//         .toBuffer();
//     });
//   });
//   const queuePromise = asyncQueue(queue);
//   queuePromise.then(() => {
//     const t2 = performance.now();
//     console.log(`Finish drawing markers. Took ${t2 - t1} milliseconds.`);
//   });
//   return queuePromise;
// }

/**
 *  Render Polyline to SVG
 */
function lineToSVG(line, mapOptions) {
  const points = line.coords.map((coord) => [
    xToPx(geoutils.lonToX(coord[0], mapOptions.zoom), mapOptions),
    yToPx(geoutils.latToY(coord[1], mapOptions.zoom), mapOptions),
  ]);
  return `<${(line.type === 'polyline') ? 'polyline' : 'polygon'}
            style="fill-rule: inherit;"
            points="${points.join(' ')}"
            stroke="${line.color}"
            fill="${line.fill ? line.fill : 'none'}"
            stroke-width="${line.width}"/>`;
}

function getHandler(type) {
  switch (type) {
    case 'lines':
      return lineToSVG;
    case 'circles':
      return circleToSVG;
    case 'custom':
      return customToSVG;
    default:
      return (c) => c;
  }
}

async function drawSVG(features, type, mapOptions) {
  if (!features.length) return false;
  console.log(`Start drawing ${type}. Array length - ${features.length}`);
  const t1 = performance.now();
  const svgFunction = getHandler(type);

  const layer = sharp({
    limitInputPixels: false,
    create: {
      width: mapOptions.width,
      height: mapOptions.height,
      channels: 4,
      background: {
        r: 0, g: 0, b: 0, alpha: 0,
      },
    },
  }).png();

  // Chunk for performance
  const chunks = chunk(features, RENDER_CHUNK_SIZE);

  const processedChunks = chunks.map((c) => {
    const svg = `
      <svg
        width="${mapOptions.width}px"
        height="${mapOptions.height}px"
        version="1.1"
        xmlns="http://www.w3.org/2000/svg">
        ${c.map((f) => svgFunction(f, mapOptions)).join('\n')}
      </svg>
    `;
    return {
      input: Buffer.from(svg), top: 0, left: 0, limitInputPixels: false,
    };
  });
  const layerPromise = layer.composite(processedChunks).toBuffer();
  layerPromise.then(() => {
    const t2 = performance.now();
    console.log(`Finish drawing ${type}. Took ${t2 - t1} milliseconds.`);
  });
  return layerPromise;
}

module.exports = async function (options) {
  return drawSVG(options.features, options.type, options.mapOptions);
};
