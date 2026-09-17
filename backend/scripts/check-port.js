require('dotenv').config();
const net = require('net');
const { execSync } = require('child_process');

function option(name) {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? undefined : process.argv[index + 1];
}

const PORT = parseInt(option('port'), 10) || parseInt(process.env.PORT, 10) || 1234;
const APP_NAME = option('pm2') || 'boomrang-chat-backend';
const WINDOWS_SERVICE_NAME = option('service') || 'BoomrangChatBackend';
const LABEL = option('label') || 'backend';

function pm2AlreadyManagesApp() {
    try {
        const out = execSync('pm2 jlist', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        const list = JSON.parse(out);
        return list.some((p) => p.name === APP_NAME);
    } catch (e) {
        return false;
    }
}

function windowsServiceAlreadyManagesApp() {
    try {
        execSync(`sc query "${WINDOWS_SERVICE_NAME}"`, { stdio: ['ignore', 'pipe', 'ignore'] });
        return true;
    } catch (e) {
        return false;
    }
}

function findPortOwner(port) {
    try {
        const out = execSync('netstat -ano -p tcp', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        const line = out
            .split(/\r?\n/)
            .find((l) => l.includes(`:${port} `) && /LISTENING/i.test(l));
        if (!line) return null;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        let name = '(unknown)';
        try {
            const tl = execSync(`tasklist /fi "PID eq ${pid}" /fo csv /nh`, {
                stdio: ['ignore', 'pipe', 'ignore']
            }).toString();
            const first = tl.split(/\r?\n/)[0];
            const match = first.match(/^"([^"]+)"/);
            if (match) name = match[1];
        } catch (e) {

        }
        return { pid, name };
    } catch (e) {
        return null;
    }
}

function checkPort() {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(PORT, '0.0.0.0');
    });
}

(async () => {
    if (pm2AlreadyManagesApp()) {
        console.log(`Port ${PORT}: skipping check - pm2 already manages ${APP_NAME} and will free/rebind it on restart.`);
        process.exit(0);
    }

    if (windowsServiceAlreadyManagesApp()) {
        console.log(`Port ${PORT}: skipping check - Windows service ${WINDOWS_SERVICE_NAME} already owns it and will be stopped/restarted later in this script.`);
        process.exit(0);
    }

    const free = await checkPort();
    if (free) {
        console.log(`Port ${PORT} (${LABEL}) is free.`);
        process.exit(0);
    }

    console.error(`Port ${PORT} is already in use by another program (and it is not our own ${LABEL} service or pm2 process).`);
    const owner = findPortOwner(PORT);
    if (owner) {
        console.error(`Process holding it: ${owner.name} (PID ${owner.pid})`);
    }
    console.error('');
    console.error('Either close that program, or free the port, then run ops\\start.bat again.');
    console.error('The ports are fixed in ops\\start.bat and ops\\change-port.bat (APP_PORT for the');
    console.error('backend, FRONTEND_PORT for the frontend). Change them in BOTH files if you really');
    console.error('need different ones - ops\\start.bat then rewrites backend\\.env, frontend\\.env and');
    console.error('the nginx reverse-proxy config to match on its next run, so you never need to edit');
    console.error('those by hand.');
    process.exit(1);
})();
