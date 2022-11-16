export default class CustomFigure {
  constructor(options = {}) {
    this.options = options;

    if (!(options.width && options.height)) throw new Error('Please specify width and height of the marker image.');

    this.coord = this.options.coord;

    this.color = this.options.color || '#000000BB';
    this.fill = this.options.fill || '#AA0000BB';
    this.path = this.options.path || '';
    this.strokeWidth = this.options.strokeWidth || 1;

    this.height = Number(this.options.height);
    this.width = Number(this.options.width);
    this.offsetX = Number.isFinite(this.options.offsetX)
      ? Number(this.options.offsetX) : this.width / 2;
    this.offsetY = Number.isFinite(this.options.offsetY)
      ? Number(this.options.offsetY) : this.height;
    this.offset = [this.offsetX, this.offsetY];
  }

  extent() {
    return [
      this.offset[0],
      (this.height - this.offset[1]),
      (this.width - this.offset[0]),
      this.offset[1],
    ];
  }
}
