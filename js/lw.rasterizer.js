// LaserWeb namespace
var lw = lw || {};

// lw.Rasterizer scope
(function () {
    'use strict';

    // Rasterizer class
    lw.Rasterizer = function(settings) {
        // Defaults properties
        this.version = '1.0.0';

        this.file       = null; // File object
        this.image      = null; // Image object
        this.ppm        = null; // Pixel Per Millimeters
        this.scaleRatio = null; // Image scale ratio
        this.imageSize  = null; // Image size (after scale)
        this.gridSize   = null; // Canvas grid size (x, y)
        this.canvas     = null; // HTML canvas element(s)
        this.time       = null; // Time taken to rasterize

        // http://stackoverflow.com/questions/6081483/maximum-size-of-a-canvas-element
        this.bufferSize = 2048; // resonable safe value ~2048 (TODO device limit detection)

        // Defaults settings
        this.settings  = {
            baseUrl  : 'js/',                // Relative url to worker with trailing slash
            ppi      : 254,                  // Pixel Per Inch (25.4 ppi == 1 ppm)
            smoothing: false,                // Smoothing the input image ?
            beamSize : 0.1,                  // Beam size in millimeters
            beamRange: { min: 0, max: 1 },   // Beam power range (Firmware value)
            beamPower: { min: 0, max: 100 }, // Beam power (S value) as percentage of beamRange
            feedRate : 1500,                 // Feed rate in mm/min (F value)
            trimLine : true,                 // Trim trailing white pixels
            joinPixel: false,                // Join consecutive pixels with same intensity
            burnWhite: true,                 // [true = G1 S0 | false = G0] on inner white pixels
            verboseG : true,                 // Output verbose GCode (print each commands)
            diagonal : false,                // Go diagonally (increase the distance between pixels)
            precision: { X: 2, Y: 2, S: 4 }, // Number of decimals for each commands
            offsets  : { X: 0, Y: 0 },       // Global coordinates offsets
            accept   : ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg'],
            onError  : null,
            onFile   : null,
            onImage  : null,
            onCanvas : null,
            onGCode  : null,
            onDone   : null
        };

        // Merge user settings
        settings = settings || {};

        for (var prop in settings) {
            this.settings[prop] = settings[prop];
        }

        // Init worker
        var self    = this;
        self.worker = new Worker(
            this.settings.baseUrl + 'lw.rasterizer.parser.js'
        );

        self.worker.onmessage = function(event) {
            // Get message data
            var message = event.data;

            // On rasterization done
            if (message.type === 'done') {
                // Elapsed time
                self.time = Date.now() - self.time;

                // Trigger "onDone" callback
                if (typeof self.settings.onDone === 'function') {
                    self.settings.onDone.call(self);
                }
            }

            // On image line parsed as gcode
            else if (message.type === 'gcode') {
                // Trigger "onGCode" callback
                if (typeof self.settings.onGCode === 'function') {
                    self.settings.onGCode.call(self, message.data);
                }
            }
        }
    };

    // -------------------------------------------------------------------------

    // Notify an error via the user defined "onError" callback
    // or throwan error if the callback is not defined (or not an Function)
    lw.Rasterizer.prototype.error = function(message) {
        if (typeof this.settings.onError !== 'function') {
            throw new Error(message);
        }

        this.settings.onError.call(this, message);
    };

    // -------------------------------------------------------------------------

    // Process loaded image
    lw.Rasterizer.prototype.processImage = function() {
        // No image loaded
        if (! this.image) {
            return this.error('No file loaded.');
        }

        // Reset canvas grid
        this.canvas = [];
        this.pixels = [];

        // Calculate grid size
        this.gridSize = {
            x: Math.ceil(this.imageSize.width / this.bufferSize),
            y: Math.ceil(this.imageSize.height / this.bufferSize)
        };

        // Create canvas grid
        var line      = null;
        var canvas    = null;
        var context   = null;
        var imageData = null;
        var smoothing = this.settings.smoothing;

        var x  = null;
        var y  = null;
        var sw = null;
        var sh = null;
        var sx = null;
        var sy = null;

        // For each line
        for (y = 0; y < this.gridSize.y; y++) {
            // Reset current line
            line = [];

            // For each column
            for (x = 0; x < this.gridSize.x; x++) {
                // Create canvas element
                canvas = document.createElement('canvas');

                // Set canvas size
                if (x === 0 || x < (this.gridSize.x - 1)) {
                    canvas.width = this.imageSize.width < this.bufferSize
                                 ? this.imageSize.width : this.bufferSize;
                }
                else {
                    // Get the rest for the last item (except the first one)
                    canvas.width = this.imageSize.width % this.bufferSize;
                }

                if (y === 0 || y < (this.gridSize.y - 1)) {
                    canvas.height = this.imageSize.height < this.bufferSize
                                  ? this.imageSize.height : this.bufferSize;
                }
                else {
                    // Get the rest for the last item (except the first one)
                    canvas.height = this.imageSize.height % this.bufferSize;
                }

                // Get canvas 2d context
                context = canvas.getContext('2d');

                if (context.imageSmoothingEnabled !== undefined) {
                    context.imageSmoothingEnabled = smoothing;
                }
                else {
                    context.mozImageSmoothingEnabled    = smoothing;
                    context.webkitImageSmoothingEnabled = smoothing;
                    context.msImageSmoothingEnabled     = smoothing;
                    context.oImageSmoothingEnabled      = smoothing;
                }

                // Fill withe background (avoid alpha chanel calculation)
                context.fillStyle = 'white';
                context.fillRect(0, 0, canvas.width, canvas.height);

                // Draw the part of image in the canvas (scale)
                sw = canvas.width / this.scaleRatio;
                sh = canvas.height / this.scaleRatio;
                sx = x * this.bufferSize / this.scaleRatio;
                sy = y * this.bufferSize / this.scaleRatio;

                context.drawImage(
                    this.image,
                    sx, sy, sw, sh,
                    0, 0, canvas.width, canvas.height
                );

                // Add the canvas to current line
                line.push(canvas);
            }

            // Add the line to canvas grid
            this.canvas.push(line);
        }

        // Trigger "onCanvas" callback
        if (typeof this.settings.onCanvas === 'function') {
            this.settings.onCanvas.call(this, this.canvas);
        }
    };

    // -------------------------------------------------------------------------

    // Load a Image object
    lw.Rasterizer.prototype.loadImage = function(image) {
        // "image" must be an instance of Image
        if (! (image instanceof Image)) {
            return this.error('Image instance required as first parameter.');
        }

        // Set image object
        this.image = image;

        // Calculate PPM/ratio/size
        this.ppm = 2540 / (this.settings.ppi * 100);
        this.ppm = parseFloat(this.ppm.toFixed(10));

        this.scaleRatio = this.ppm / this.settings.beamSize;
        this.imageSize = {
            width : Math.round(this.image.width * this.scaleRatio),
            height: Math.round(this.image.height * this.scaleRatio)
        };

        // Trigger "onImage" callback
        if (typeof this.settings.onImage === 'function') {
            this.settings.onImage.call(this, this.image);
        }

        // Process image
        this.processImage();
    };

    // -------------------------------------------------------------------------

    // Load a File object
    lw.Rasterizer.prototype.loadFile = function(file) {
        // self alias
        var self = this;

        // The file param must be an instance of File
        if (! (file instanceof File)) {
            return self.error('File instance required as first parameter.');
        }

        // Extract file extension
        var extension = '.' + file.name.split('.').pop().toLowerCase();

        // Test if the file extension is accepted
        if (self.settings.accept.indexOf(extension) === -1) {
            return self.error(
                'Unsupported file extension: ' + extension +
                ', allowed: ' + self.settings.accept.join(',')
            );
        }

        // Set file object
        self.file = file;

        // Trigger "onFile" callback
        if (typeof self.settings.onFile === 'function') {
            self.settings.onFile.call(self, self.file);
        }

        // Create Image object
        var image = new Image();

        // Register for load and error events
        image.addEventListener('load', function(event) {
            self.loadImage(image);
        }, false);

        image.addEventListener('error', function(event) {
            self.error('Unable to load the image (' + event.type + ').');
        }, false);

        // Load the image from File url
        image.src = URL.createObjectURL(self.file);
    };

    // -------------------------------------------------------------------------

    // Rasterize the loaded Image object
    lw.Rasterizer.prototype.rasterize = function() {
        // No image loaded
        if (! this.image) {
            return this.error('No file loaded.');
        }

        // Start time
        this.time = Date.now();

        // Settings
        var data = { type: 'init', data: {} };

        for (var prop in this.settings) {
            if (typeof this.settings[prop] !== 'function') {
                data.data[prop] = this.settings[prop];
            }
        }

        data.data.version    = this.version;
        data.data.ppm        = this.ppm;
        data.data.scaleRatio = this.scaleRatio;
        data.data.imageSize  = this.imageSize;
        data.data.gridSize   = this.gridSize;
        data.data.bufferSize = this.bufferSize;

        // Post init command to the worker
        this.worker.postMessage(data);

        // Init vars...
        var x, y, cell, imageData;

        // For each line
        for (y = 0; y < this.gridSize.y; y++) {
            // For each cell
            for (x = 0; x < this.gridSize.x; x++) {
                // Current cell
                cell = this.canvas[y][x];

                // Get imageData from the 2D context of the canvas
                imageData = cell.getContext('2d').getImageData(
                    0, 0, cell.width, cell.height
                );

                cell = { type: 'addCell', data: {
                    x: x, y: y, buffer: imageData.data
                }};

                // Post the image data buffer to the worker
                this.worker.postMessage(cell, [cell.data.buffer.buffer]);
            }
        }

        // Post all cell send to the worker and request parsing
        this.worker.postMessage({ type: 'parse' });
    };

})();
