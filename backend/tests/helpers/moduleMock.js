const path = require('path');

function resolveFrom(request, fromDir) {
    return require.resolve(request, { paths: [fromDir] });
}

function mockModule(request, fromDir, exportsValue) {
    const resolved = resolveFrom(request, fromDir);
    const previous = require.cache[resolved];
    require.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports: exportsValue
    };
    return function restore() {
        if (previous) {
            require.cache[resolved] = previous;
        } else {
            delete require.cache[resolved];
        }
    };
}

function freshRequire(request, fromDir) {
    const resolved = resolveFrom(request, fromDir);
    delete require.cache[resolved];
    return require(resolved);
}

function servicesDir() {
    return path.join(__dirname, '..', '..', 'src', 'services');
}

function utilsDir() {
    return path.join(__dirname, '..', '..', 'src', 'utils');
}

function middlewareDir() {
    return path.join(__dirname, '..', '..', 'src', 'middleware');
}

module.exports = { mockModule, freshRequire, servicesDir, utilsDir, middlewareDir };
