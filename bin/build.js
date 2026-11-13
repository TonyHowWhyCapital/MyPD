process.env.CHINER_NODE_ENV = 'production';
require('./node-compat');
var webpack = require('webpack');
var config = require('../config/webpack.pro.config.js');

// Each build names its bundles by content, so files of earlier builds would pile up
// and be packed into the app. Everything in the output folder is written by the build.
var fs = require('fs');
(fs.rmSync || fs.rmdirSync)(config.output.path, { recursive: true, force: true });

webpack(config).run((err, stats) => {
    if (err) {
        console.log('Failed to compile.', [err]);
        process.exit(1);
    }

    if (stats.compilation.errors.length) {
        console.log('Failed to compile.', stats.compilation.errors);
        process.exit(1);
    }

    console.log('build success');
});
