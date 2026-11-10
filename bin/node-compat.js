// webpack 4 hashes with md4, which OpenSSL 3 (Node 17+) no longer provides.
var crypto = require('crypto');
var createHash = crypto.createHash;

try {
    createHash('md4');
} catch (e) {
    crypto.createHash = function (algorithm, options) {
        return createHash(algorithm === 'md4' ? 'sha256' : algorithm, options);
    };
}
