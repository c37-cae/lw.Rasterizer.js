// LaserWeb namespace
var lw = lw || {};

// lw.Rasterizer scope
(function () {
    'use strict';

    // Rasterizer parser class
    lw.RasterizerParser = function() {
        this.canvasGrid   = null;
        this.lastCommands = null;
        this.reverseLine  = null;
        this.beamOffset   = null;
    };

    // Init the parser
    lw.RasterizerParser.prototype.init = function(settings) {
        //console.log('init:', settings);

        // Reset parser settings and state
        this.canvasGrid   = [];
        this.lastCommands = {};
        this.reverseLine  = true;

        for (var prop in settings) {
            this[prop] = settings[prop];
        }

        // Calculate beam offset
        this.beamOffset    = this.beamSize * 1000 / 2000;

        // Calculate real beam range
        this.beamRange.min = this.beamRange.max / 100 * this.beamPower.min;
        this.beamRange.max = this.beamRange.max / 100 * this.beamPower.max;
    };

    // Add a new cell to the canvas grid
    lw.RasterizerParser.prototype.addCell = function(data) {
        //console.log('addCell:', data);

        // Canvas grid line not defined
        if (! this.canvasGrid[data.y]) {
            this.canvasGrid[data.y] = [];
        }

        // Add canvas buffer in the cell
        this.canvasGrid[data.y][data.x] = data.buffer;
    };

    // Post header GCode
    lw.RasterizerParser.prototype.postHeader = function() {
        // Base headers
        var headers = [
            '; Generated by lw.Rasterizer.js - ' + this.version,
            '; Size       : ' + (this.imageSize.width * this.beamSize) + ' x ' + (this.imageSize.height * this.beamSize) + ' mm',
            '; Resolution : ' + this.ppm + ' PPM - ' + this.ppi + ' PPI',
            '; Beam size  : ' + this.beamSize + ' mm',
            '; Beam range : ' + this.beamRange.min + ' to ' + this.beamRange.max,
            '; Beam power : ' + this.beamPower.min + ' to ' + this.beamPower.max + ' %',
            '; Feed rate  : ' + this.feedRate + ' mm/min'
        ];

        // Print activated options
        var options = ['smoothing', 'trimLine', 'joinPixel', 'burnWhite', 'verboseG', 'diagonal'];

        for (var i = options.length - 1; i >= 0; i--) {
            if (! this[options[i]]) {
                options.splice(i, 1);
            }
        }

        if (options.length) {
            headers.push('; Options    : ' + options.join(', '));
        }

        // Set feed rates
        headers.push(
            '',
            'G0 F' + this.feedRate,
            'G1 F' + this.feedRate,
            ''
        );

        // Post message to main script
        postMessage({ type: 'gcode', data: {
            text   : headers.join('\n'),
            type   : 'header',
            percent: 0
        }});
    };

    // Post done parsing message
    lw.RasterizerParser.prototype.postDone = function() {
        postMessage({ type: 'done' });
    };

    // Compute and return a command, return null if not changed
    lw.RasterizerParser.prototype.command = function(name, value) {
        // If the value argument is an object
        if (typeof value === 'object') {
            // Computed commands line
            var commands = Array.prototype.slice.call(arguments);
            var command, line = [];

            // for each command
            for (var i = 0, il = commands.length; i < il; i++) {
                command = this.command.apply(this, commands[i]);
                command && line.push(command);
            }

            // Return the line if not empty
            return line.length ? line.join(' ') : null;
        }

        // Format the value
        if (typeof value !== 'number') {
            console.error('!', typeof value, value);
        }
        value = value.toFixed(this.precision[name] || 0);

        // If the value was changed or if verbose mode on
        if (this.verboseG || value !== this.lastCommands[name]) {
            this.lastCommands[name] = value;
            return name + value;
        }

        // No change
        return null;
    }

    // Get a pixel power value from the canvas data grid
    lw.RasterizerParser.prototype.mapPixelPower = function(value) {
        return value * (this.beamRange.max - this.beamRange.min)
                     / 255 + this.beamRange.min;
    };

    // Get a pixel power value from the canvas data grid
    lw.RasterizerParser.prototype.getPixelPower = function(x, y, noMap) {
        if (x < 0 || x >= this.imageSize.width) {
            throw new Error('Out of range: x = ' + x);
        }

        if (y < 0 || y >= this.imageSize.height) {
            throw new Error('Out of range: y = ' + y);
        }

        // reverse Y value since canvas as top/left origin
        y = this.imageSize.height - y - 1;

        // Target canvas data
        var gx   = parseInt(x / this.bufferSize);
        var gy   = parseInt(y / this.bufferSize);
        var data = this.canvasGrid[gy][gx];

        // Adjuste x/y values
        gx && (x -= this.bufferSize * gx);
        gy && (y -= this.bufferSize * gy);

        // Pixel index
        var i = (y * (this.imageSize.width * 4)) + (x * 4);

        // Gray value
        // http://www.tannerhelland.com/3643/grayscale-image-algorithm-vb6/
        //s = (data[i] * 0.2989) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
        //var gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
        //
        // // Reverse value [0 = black - 255 = white] => [0 = white - 255 = black]
        // gray = 255 - gray;
        //
        // // Scale value [0 - 255] => [0 - 1]
        // gray = gray / 255;
        //
        // return gray;

        var gray = 255 - ((data[i] + data[i + 1] + data[i + 2]) / 3);

        return noMap ? gray : this.mapPixelPower(gray);
    };

    // Return the line without trailing white spaces
    lw.RasterizerParser.prototype.trimWhiteSpaces = function(line) {
        var i, il, j, x, y, start, end, done;

        for (i = 0, il = line.length, j = il - 1; i < il ; i++, j--) {
            // left --> right
            x = line[i][0];
            y = line[i][1];

            if (start === undefined && this.getPixelPower(x, y, true)) {
                start = i;
            }

            // left <-- right
            x = line[j][0];
            y = line[j][1];

            if (end === undefined && this.getPixelPower(x, y, true)) {
                end = j + 1;
            }

            // Start/End index found
            if (start !== undefined && end !== undefined) {
                done = true;
                break;
            }
        }

        if (done) {
            return line.slice(start, end);
        }

        // Empty line (white)
        return null;
    };

    // Process pixels line and return an array of GCode lines
    lw.RasterizerParser.prototype.processLine = function(line) {
        // Trim trailing white spaces ?
        if (this.trimLine) {
            // Get reduced line
            line = this.trimWhiteSpaces(line);

            // Empty line (white)
            if (! line) {
                return null;
            }
        }

        // Reverse line
        this.reverseLine = !this.reverseLine;

        if (! this.diagonal && this.reverseLine) {
            line = line.reverse();
        }

        // GCode commands array
        var i, x, y, s, lastS, gcode = [];

        // For each pixel in the line
        for (i = 0; i < line.length; i++) {
            // Current pixel
            x = line[i][0];
            y = line[i][1];

            // Pixel power (reverse Y value since canvas as top/left origin)
            s = this.getPixelPower(x, y, true);

            // Current pixel real coordinates
            x = (x * this.beamSize) + this.beamOffset;
            y = (y * this.beamSize) + this.beamOffset;

            // First pixel
            if (i === 0) {
                // Move to start of line (force S to 0)
                gcode.push(this.command(['G', 0], ['X', x], ['Y', y], ['S', 0]));
            }

            if (! this.burnWhite && s == 0) {
                // Move to pixel if not the first one
                i && gcode.push(this.command(['G', 0], ['X', x], ['Y', y], ['S', 0]));
            }
            else {
                // Map pixel power
                s = this.mapPixelPower(s);

                // Skip if next pixel has the same intensity
                // if (settings.joinPixel) {
                //     if (lastS === s) {
                //         continue;
                //     }
                //     lastS = s;
                // }

                if (this.lastCommands.G === 0) {
                    gcode.push(this.command(['G', 0], ['X', x], ['Y', y], ['S', 0]));
                }

                // Burn the pixel
                gcode.push(this.command(['G', 1], ['X', x], ['Y', y], ['S', s]));
            }
        }

        return gcode;
    };

    // Parse horizontally
    lw.RasterizerParser.prototype.parseHorizontally = function() {
        // Init loop vars
        var x, y, line, gcode;

        // For each image line
        for (y = 0; y < this.imageSize.height; y++) {
            // Reset line
            line = [];

            // For each pixel on the line
            for (x = 0; x < this.imageSize.width; x++) {
                // Add pixel to current line
                line.push([x, y]);
            }

            // Process line
            gcode = this.processLine(line);

            // Post the gcode pixel line
            gcode && postMessage({ type: 'gcode', data: {
                percent: Math.round((y / this.imageSize.height) * 100),
                text   : gcode.join('\n')
            }});
        }
    };

    // Parse diagonally
    lw.RasterizerParser.prototype.parseDiagonally = function() {
        // Number of pixels
        var pixels = (this.imageSize.width * this.imageSize.height) + 1;
        var total  = pixels;

        // Init loop vars
        var EOL = false;
        var x = 0, y = 0;
        var odd, gcode, line = [];

        // For each pixel
        while (pixels--) {
            // Odd line ?
            odd = (x + y) % 2;

            // End of line ?
            if (EOL) {
                // Process line
                gcode = this.processLine(line);

                // Post the gcode pixel line
                gcode && postMessage({ type: 'gcode', data: {
                    percent: 100 - Math.round((pixels / total) * 100),
                    text   : gcode.join('\n')
                }});

                // Reset line
                line = [];
                EOL  = false;
            }

            // Add pixel to current line
            line.push([x, y]);

            // walk southwest
            if (odd) {
                x--; y++;

                if (y == this.imageSize.height) {
                    y--; x += 2; EOL = true;
                }

                if (x < 0) {
                    x = 0; EOL = true;
                }
            }

            // walk northeast
            else {
                x++; y--;

                if (x == this.imageSize.width) {
                    x--; y += 2; EOL = true;
                }

                if (y < 0) {
                    y = 0; EOL = true;
                }
            }
        }
    };

    // Parse the canvas grid
    lw.RasterizerParser.prototype.parse = function() {
        //console.log('start parsing...', this);

        // Post GCode headers
        this.postHeader();

        // Parse type ?
        if (this.diagonal) {
            this.parseDiagonally();
        }
        else {
            this.parseHorizontally();
        }

        // Post parse done
        this.postDone();
    };

})();

// -----------------------------------------------------------------------------

// Crete RasterizerParser instance
var parser = new lw.RasterizerParser();

// WebWorker: on message received
self.onmessage = function(event) {
    // Event data as message
    var message = event.data;

    // Bind to pasrer methods
    parser[message.type].call(parser, message.data);
};
