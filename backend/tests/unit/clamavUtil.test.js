const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { freshRequire, utilsDir } = require('../helpers/moduleMock');

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');
const SAMPLE_FILE = path.join(FIXTURES_DIR, 'sample-upload.txt');

function loadClamavWith(env) {
    const previousEnabled = process.env.CLAMSCAN_ENABLED;
    const previousBin = process.env.CLAMSCAN_BIN;
    if (env.enabled === undefined) {
        delete process.env.CLAMSCAN_ENABLED;
    } else {
        process.env.CLAMSCAN_ENABLED = env.enabled;
    }
    if (env.bin === undefined) {
        delete process.env.CLAMSCAN_BIN;
    } else {
        process.env.CLAMSCAN_BIN = env.bin;
    }
    const util = freshRequire('../utils/clamav.util', utilsDir());
    return {
        util,
        restore: () => {
            if (previousEnabled === undefined) {
                delete process.env.CLAMSCAN_ENABLED;
            } else {
                process.env.CLAMSCAN_ENABLED = previousEnabled;
            }
            if (previousBin === undefined) {
                delete process.env.CLAMSCAN_BIN;
            } else {
                process.env.CLAMSCAN_BIN = previousBin;
            }
        }
    };
}

test('scanFile reports clean for a file the scanner accepts', async () => {
    const { util, restore } = loadClamavWith({
        enabled: 'true',
        bin: path.join(FIXTURES_DIR, 'fake-scan-clean.sh')
    });
    try {
        const result = await util.scanFile(SAMPLE_FILE);
        assert.equal(result, 'clean');
    } finally {
        restore();
    }
});

test('scanFile reports infected when the scanner exits with code 1', async () => {
    const { util, restore } = loadClamavWith({
        enabled: 'true',
        bin: path.join(FIXTURES_DIR, 'fake-scan-infected.sh')
    });
    try {
        const result = await util.scanFile(SAMPLE_FILE);
        assert.equal(result, 'infected');
    } finally {
        restore();
    }
});

test('scanFile reports an error status when the scanner fails abnormally', async () => {
    const { util, restore } = loadClamavWith({
        enabled: 'true',
        bin: path.join(FIXTURES_DIR, 'fake-scan-error.sh')
    });
    try {
        const result = await util.scanFile(SAMPLE_FILE);
        assert.equal(result, 'error');
    } finally {
        restore();
    }
});

test('scanFile always reports clean when scanning is disabled', async () => {
    const { util, restore } = loadClamavWith({
        enabled: 'false',
        bin: path.join(FIXTURES_DIR, 'fake-scan-infected.sh')
    });
    try {
        const result = await util.scanFile(SAMPLE_FILE);
        assert.equal(result, 'clean');
        assert.equal(util.isEnabled(), false);
    } finally {
        restore();
    }
});
