const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const BACKEND_ENV = path.join(ROOT_DIR, 'backend', '.env');
const FRONTEND_ENV = path.join(ROOT_DIR, 'frontend', '.env');

const DEFAULT_APP_PORT = '1234';
const LEGACY_KEYS = ['VITE_API_BASE_URL', 'VITE_SOCKET_URL'];
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const WILDCARD_HOSTS = new Set(['', '0.0.0.0', '::', '[::]']);

function log(msg) {
    console.log(`  ${msg}`);
}

function readLines(file) {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [];
}

function valueOf(lines, key) {
    const line = lines.find((l) => l.startsWith(`${key}=`));
    return line === undefined ? undefined : line.slice(key.length + 1).trim();
}

function backendAddress() {
    const lines = readLines(BACKEND_ENV);
    const port = valueOf(lines, 'PORT') || DEFAULT_APP_PORT;
    const host = valueOf(lines, 'HOST') || '';
    return { host: WILDCARD_HOSTS.has(host) ? '127.0.0.1' : host, port };
}

function timestamp() {
    return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

function sync(frontendPort, backendPortArg) {
    if (!/^\d+$/.test(frontendPort || '') || (backendPortArg !== undefined && !/^\d+$/.test(backendPortArg))) {
        console.error('Usage: node ops/frontend-env.js sync <frontend_port> [backend_port]');
        process.exit(1);
    }

    const backendPort = backendPortArg || backendAddress().port;
    if (frontendPort === backendPort) {
        console.error(`  [FATAL] FRONTEND_PORT ${frontendPort} is the same as the backend PORT in backend\\.env.`);
        console.error('  The two services need different ports.');
        process.exit(1);
    }

    const existed = fs.existsSync(FRONTEND_ENV);
    let lines = readLines(FRONTEND_ENV);
    const notes = [];

    const legacy = lines.filter((l) => LEGACY_KEYS.some((key) => l.startsWith(`${key}=`)));
    if (legacy.length) {
        lines = lines.filter((l) => !legacy.includes(l));
        notes.push(`removed ${legacy.length} old VITE_API_BASE_URL/VITE_SOCKET_URL line(s) - the app always calls /api and /socket.io on its own address now`);
    }

    const origin = valueOf(lines, 'BACKEND_ORIGIN');
    if (origin) {
        let stale = false;
        try {
            const url = new URL(origin);
            stale = LOOPBACK_HOSTS.has(url.hostname) && (url.port || '80') !== backendPort;
        } catch (e) {
            stale = true;
        }
        if (stale) {
            lines = lines.map((l) => (l.startsWith('BACKEND_ORIGIN=') ? 'BACKEND_ORIGIN=' : l));
            notes.push(`cleared BACKEND_ORIGIN=${origin} - it did not point at this server's backend port ${backendPort}, so it is detected automatically again`);
        }
    } else if (origin === undefined) {
        lines.push('BACKEND_ORIGIN=');
    }

    const currentPort = valueOf(lines, 'FRONTEND_PORT');
    if (currentPort === undefined) {
        lines.unshift(`FRONTEND_PORT=${frontendPort}`);
        if (existed) notes.push(`added FRONTEND_PORT=${frontendPort}`);
    } else if (currentPort !== frontendPort) {
        lines = lines.map((l) => (l.startsWith('FRONTEND_PORT=') ? `FRONTEND_PORT=${frontendPort}` : l));
        notes.push(`FRONTEND_PORT ${currentPort} -> ${frontendPort}`);
    }

    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    const content = `${lines.join('\n')}\n`;

    if (existed && notes.length) {
        const backup = `${FRONTEND_ENV}.bak-${timestamp()}`;
        fs.copyFileSync(FRONTEND_ENV, backup);
        fs.writeFileSync(FRONTEND_ENV, content);
        notes.forEach((note) => log(`[FIXED] frontend\\.env: ${note}`));
        log(`Previous file saved as frontend\\${path.basename(backup)}`);
    } else if (!existed) {
        fs.writeFileSync(FRONTEND_ENV, content);
        log(`frontend\\.env created (FRONTEND_PORT=${frontendPort}, backend address detected automatically).`);
    } else {
        log(`OK - frontend\\.env already uses FRONTEND_PORT=${frontendPort} and has no stale address.`);
    }
}

function origin() {
    const configured = valueOf(readLines(FRONTEND_ENV), 'BACKEND_ORIGIN');
    if (configured) {
        console.log(configured.replace(/\/+$/, ''));
        return;
    }
    const { host, port } = backendAddress();
    console.log(`http://${host}:${port}`);
}

const [command, ...args] = process.argv.slice(2);

if (command === 'sync') {
    sync(args[0], args[1]);
} else if (command === 'origin') {
    origin();
} else {
    console.error('Usage: node ops/frontend-env.js sync <frontend_port> [backend_port] | origin');
    process.exit(1);
}
