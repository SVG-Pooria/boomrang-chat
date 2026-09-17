const { execFile } = require('child_process');

const ENABLED = process.env.CLAMSCAN_ENABLED !== 'false';
const BINARY = process.env.CLAMSCAN_BIN || 'clamdscan';
const SCAN_TIMEOUT_MS = Number(process.env.CLAMSCAN_TIMEOUT_MS) || 30000;
const FAIL_OPEN = process.env.CLAMSCAN_FAIL_OPEN !== 'false';
const AVAILABILITY_CACHE_MS = Number(process.env.CLAMSCAN_AVAILABILITY_CACHE_MS) || 30000;

const INFRA_ERROR_PATTERN = /econnrefused|connection refused|could not connect|no response|can't connect|cannot connect|socket|not running|timed? ?out/i;

let availability = { checkedAt: 0, available: true, reason: null };

function isInfraError(error, stderr) {
    if (!error) {
        return false;
    }
    if (error.code === 'ENOENT') {
        return true;
    }
    if (error.signal || error.killed) {
        return true;
    }
    const combined = `${stderr || ''} ${error.message || ''}`;
    return INFRA_ERROR_PATTERN.test(combined);
}

function recordAvailability(available, reason) {
    availability = { checkedAt: Date.now(), available, reason };
}

function isAvailabilityCacheFresh() {
    return Date.now() - availability.checkedAt < AVAILABILITY_CACHE_MS;
}

function scanFile(filePath) {
    if (!ENABLED) {
        return Promise.resolve('clean');
    }
    if (!availability.available && isAvailabilityCacheFresh()) {
        return Promise.resolve('error');
    }
    return new Promise((resolve) => {
        execFile(BINARY, ['--no-summary', '--infected', filePath], { timeout: SCAN_TIMEOUT_MS }, (error, stdout, stderr) => {
            if (!error) {
                recordAvailability(true, null);
                return resolve('clean');
            }
            if (error.code === 1) {
                recordAvailability(true, null);
                return resolve('infected');
            }
            const infra = isInfraError(error, stderr);
            recordAvailability(!infra, infra ? (error.code === 'ENOENT' ? 'binary_not_found' : 'daemon_unreachable') : 'scan_error');
            return resolve('error');
        });
    });
}

function isEnabled() {
    return ENABLED;
}

function binaryName() {
    return BINARY;
}

function shouldFailOpen() {
    return FAIL_OPEN;
}

function getAvailability() {
    return { ...availability };
}

module.exports = { scanFile, isEnabled, binaryName, shouldFailOpen, getAvailability };
