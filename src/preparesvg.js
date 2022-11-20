import geoutils from './helper/geo';

const { performance } = require('perf_hooks');

// const RENDER_CHUNK_SIZE = 3000;

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

function drawSVG(features, type, mapOptions) {
  if (!features.length) return false;
  console.log(`Start drawing ${type}. Array length - ${features.length}`);
  const t1 = performance.now();
  const svgFunction = getHandler(type);

  const svg = `
      <svg
        width="${mapOptions.width}px"
        height="${mapOptions.height}px"
        version="1.1"
        xmlns="http://www.w3.org/2000/svg">
        ${features.map((f) => svgFunction(f, mapOptions)).join('\n')}
      </svg>
    `;

  const t2 = performance.now();
  console.log(`Finish drawing ${type}. Take ${t2 - t1} ms`);

  return ({
    input: Buffer.from(svg), top: 0, left: 0, limitInputPixels: false,
  });
}

module.exports = drawSVG;
