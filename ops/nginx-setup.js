const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const BACKEND_ENV = path.join(ROOT_DIR, 'backend', '.env');
const FRONTEND_ENV = path.join(ROOT_DIR, 'frontend', '.env');
const NGINX_SRC_DIR = path.join(ROOT_DIR, 'infrastructure', 'nginx');
const TLS_TEMPLATE = path.join(NGINX_SRC_DIR, 'boomrang.lan.conf');
const HTTP_ONLY_TEMPLATE = path.join(NGINX_SRC_DIR, 'boomrang.lan.http-only.conf');
const CA_OUTPUT_DIR = path.join(ROOT_DIR, 'infrastructure', 'ca', 'output');
const CA_CERT = path.join(CA_OUTPUT_DIR, 'boomrang.lan.crt');
const CA_KEY = path.join(CA_OUTPUT_DIR, 'boomrang.lan.key');

const NGINX_DIR = process.argv[2] || 'C:\\nginx';
const NGINX_EXE = path.join(NGINX_DIR, 'nginx.exe');
const NGINX_CONF_DIR = path.join(NGINX_DIR, 'conf');
const NGINX_MAIN_CONF = path.join(NGINX_CONF_DIR, 'nginx.conf');
const NGINX_SSL_DIR = path.join(NGINX_DIR, 'ssl');
const NGINX_CRT = path.join(NGINX_SSL_DIR, 'boomrang.lan.crt');
const NGINX_KEY = path.join(NGINX_SSL_DIR, 'boomrang.lan.key');
const NGINX_SITE_CONF = path.join(NGINX_CONF_DIR, 'boomrang.lan.conf');
const SITE_CONF_NAME = 'boomrang.lan.conf';

const HOSTS_FILE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
const HOST_NAMES = ['boomrang.lan', 'boomrang'];
const HOSTS_MARKER = '# boomrang chat';

const DEFAULT_APP_PORT = '1234';
const DEFAULT_FRONTEND_PORT = '1235';

function log(msg) {
    console.log(`  ${msg}`);
}

function readPort(file, key, fallback) {
    if (!fs.existsSync(file)) return fallback;
    const match = fs.readFileSync(file, 'utf8').match(new RegExp(`^${key}=(\\d+)\\s*$`, 'm'));
    return match ? match[1] : fallback;
}

function lanAddress() {
    const candidates = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const entry of list || []) {
            if (entry.family !== 'IPv4' || entry.internal) continue;
            candidates.push(entry.address);
        }
    }
    const preferred = candidates.find((address) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address));
    return preferred || candidates[0] || null;
}

function probe(url, accept) {
    return new Promise((resolve) => {
        const request = http.get(url, { timeout: 5000 }, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => {
                if (body.length < 65536) body += chunk;
            });
            response.on('end', () => resolve(accept(response.statusCode, body)));
        });
        request.on('timeout', () => request.destroy());
        request.on('error', () => resolve(false));
    });
}

function syncHostsFile(ip) {
    if (!ip || !fs.existsSync(HOSTS_FILE)) return;
    let text;
    try {
        text = fs.readFileSync(HOSTS_FILE, 'utf8');
    } catch (e) {
        log('Could not read the Windows hosts file - skipping the local name entry.');
        return;
    }
    const line = `${ip} ${HOST_NAMES.join(' ')} ${HOSTS_MARKER}`;
    const kept = text
        .split(/\r?\n/)
        .filter((row) => !row.includes(HOSTS_MARKER))
        .join('\r\n')
        .replace(/\s+$/, '');
    const next = `${kept}\r\n${line}\r\n`;
    if (text.includes(line)) {
        log(`Hosts file already maps ${HOST_NAMES[0]} to ${ip}.`);
        return;
    }
    try {
        fs.writeFileSync(HOSTS_FILE, next);
        log(`Hosts file updated: ${line}`);
    } catch (e) {
        log('Could not write the Windows hosts file (needs Administrator) - add this line by hand:');
        log(`  ${line}`);
    }
}

if (!fs.existsSync(NGINX_EXE)) {
    log(`nginx.exe not found at ${NGINX_EXE} - nothing to configure yet.`);
    process.exit(0);
}

if (!fs.existsSync(BACKEND_ENV)) {
    console.error('  [WARNING] backend\\.env not found - cannot read PORT, skipping nginx config sync.');
    process.exit(0);
}

const APP_PORT = readPort(BACKEND_ENV, 'PORT', DEFAULT_APP_PORT);
const FRONTEND_PORT = readPort(FRONTEND_ENV, 'FRONTEND_PORT', DEFAULT_FRONTEND_PORT);
log(`Backend port from backend\\.env: ${APP_PORT}`);
log(`Frontend port from frontend\\.env: ${FRONTEND_PORT}`);

if (APP_PORT === FRONTEND_PORT) {
    console.error(`  [WARNING] backend and frontend are both set to port ${APP_PORT} - they must differ.`);
    console.error('  Fix PORT in backend\\.env or FRONTEND_PORT in frontend\\.env, then re-run ops\\start.bat.');
    process.exit(1);
}

[NGINX_CONF_DIR, NGINX_SSL_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const serverIp = lanAddress();
const serverNames = [...HOST_NAMES, 'localhost', ...(serverIp ? [serverIp] : [])].join(' ');

let template = HTTP_ONLY_TEMPLATE;
if (fs.existsSync(NGINX_CRT) && fs.existsSync(NGINX_KEY)) {
    template = TLS_TEMPLATE;
    log(`TLS certificate: already present in ${NGINX_SSL_DIR} - serving HTTPS.`);
} else if (fs.existsSync(CA_CERT) && fs.existsSync(CA_KEY)) {
    fs.copyFileSync(CA_CERT, NGINX_CRT);
    fs.copyFileSync(CA_KEY, NGINX_KEY);
    template = TLS_TEMPLATE;
    log('TLS certificate: copied from infrastructure\\ca\\output - serving HTTPS.');
} else {
    log('No certificate found - serving plain HTTP on port 80 (works on every client with no setup).');
    log('To switch to HTTPS later: run infrastructure\\ca\\generate-root-ca.bat then generate-server-cert.bat,');
    log('install infrastructure\\ca\\output\\boomrangRootCA.crt on each client, and re-run ops\\start.bat.');
}

let siteConf = fs.readFileSync(template, 'utf8');
siteConf = siteConf
    .split('__APP_PORT__').join(APP_PORT)
    .split('__FRONTEND_PORT__').join(FRONTEND_PORT)
    .split('__SERVER_NAMES__').join(serverNames);
fs.writeFileSync(NGINX_SITE_CONF, siteConf);
log(`Wrote ${NGINX_SITE_CONF} (${template === HTTP_ONLY_TEMPLATE ? 'HTTP' : 'HTTPS'})`);
log(`  server_name           ${serverNames}`);
log(`  /api/ and /socket.io/ -> backend  127.0.0.1:${APP_PORT}`);
log(`  everything else       -> frontend 127.0.0.1:${FRONTEND_PORT}`);

if (!fs.existsSync(NGINX_MAIN_CONF)) {
    console.error(`  [WARNING] ${NGINX_MAIN_CONF} not found - cannot verify the include line.`);
} else {
    let mainConf = fs.readFileSync(NGINX_MAIN_CONF, 'utf8');
    const before = mainConf;

    if (/server_name\s+localhost;/.test(mainConf)) {
        mainConf = mainConf.replace(/server_name\s+localhost;/, 'server_name  nginx-default-unused;');
        log('Parked the stock nginx welcome page on an unused name so the app answers on every address.');
    }

    if (!mainConf.includes(SITE_CONF_NAME)) {
        const lastBrace = mainConf.lastIndexOf('}');
        if (lastBrace === -1) {
            console.error(`  [WARNING] Could not find a closing "}" in ${NGINX_MAIN_CONF} - add`);
            console.error(`  "include ${SITE_CONF_NAME};" inside the http { } block by hand.`);
        } else {
            mainConf = `${mainConf.slice(0, lastBrace)}    include ${SITE_CONF_NAME};\n${mainConf.slice(lastBrace)}`;
            log(`Added "include ${SITE_CONF_NAME};" to nginx.conf.`);
        }
    } else {
        log(`nginx.conf already includes ${SITE_CONF_NAME}.`);
    }

    if (mainConf !== before) fs.writeFileSync(NGINX_MAIN_CONF, mainConf);
}

syncHostsFile(serverIp);

(async () => {
    const backendUp = await probe(`http://127.0.0.1:${APP_PORT}/api/health`, (status) => status === 200);
    if (backendUp) {
        log(`Backend upstream 127.0.0.1:${APP_PORT} answers /api/health.`);
    } else {
        console.error(`  [WARNING] Backend upstream 127.0.0.1:${APP_PORT} did not answer /api/health -`);
        console.error('  nginx will return 502 for /api and /socket.io until the backend service is up.');
    }

    const frontendUp = await probe(
        `http://127.0.0.1:${FRONTEND_PORT}/`,
        (status, body) => status === 200 && body.includes('<html')
    );
    if (frontendUp) {
        log(`Frontend upstream 127.0.0.1:${FRONTEND_PORT} renders the app page.`);
    } else {
        console.error(`  [WARNING] Frontend upstream 127.0.0.1:${FRONTEND_PORT} did not render the app page -`);
        console.error('  nginx will return 502 for every page until the frontend service is up.');
    }

    let configOk = true;
    try {
        execFileSync(NGINX_EXE, ['-t'], { cwd: NGINX_DIR, stdio: 'inherit' });
        log('nginx config test passed.');
    } catch (e) {
        console.error('  [WARNING] nginx config test failed - see the nginx output above.');
        configOk = false;
    }

    const scheme = template === HTTP_ONLY_TEMPLATE ? 'http' : 'https';
    console.log('');
    log('How everyone on the network opens the app:');
    log(`  on this server:      ${scheme}://${HOST_NAMES[0]}`);
    if (serverIp) {
        log(`  on any other PC:     ${scheme}://${serverIp}   (always works, no setup)`);
        log(`  by name on other PC: ${scheme}://${HOST_NAMES[0]}  - needs one of:`);
        log(`      - an A record "${HOST_NAMES[0]} -> ${serverIp}" on the network DNS/router, or`);
        log(`      - running infrastructure\\dns\\add-client-hosts-entry.bat ${serverIp} on that PC as admin`);
    } else {
        log('  no LAN IPv4 address was detected on this machine.');
    }

    process.exit(configOk ? 0 : 1);
})();
