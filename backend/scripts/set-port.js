const fs = require('fs');
const path = require('path');

const NEW_PORT = process.argv[2];

if (!NEW_PORT || !/^\d+$/.test(NEW_PORT)) {
    console.error('Usage: node scripts/set-port.js <new_port>');
    process.exit(1);
}

const BACKEND_DIR = path.join(__dirname, '..');
const ROOT_DIR = path.join(BACKEND_DIR, '..');
const BACKEND_ENV = path.join(BACKEND_DIR, '.env');
const FRONTEND_ENV = path.join(ROOT_DIR, 'frontend', '.env');

if (!fs.existsSync(BACKEND_ENV)) {
    console.error(`Could not find ${BACKEND_ENV} - run ops\\setup-env.bat first.`);
    process.exit(1);
}

let backendEnv = fs.readFileSync(BACKEND_ENV, 'utf8');
const portMatch = backendEnv.match(/^PORT=(\d+)\s*$/m);
if (!portMatch) {
    console.error('Could not find a "PORT=" line in backend\\.env - not touching anything.');
    process.exit(1);
}
const OLD_PORT = portMatch[1];

if (OLD_PORT === NEW_PORT) {
    console.log(`backend\\.env already uses port ${NEW_PORT} - nothing to do.`);
    process.exit(0);
}

backendEnv = backendEnv.replace(/^PORT=\d+\s*$/m, `PORT=${NEW_PORT}`);
fs.writeFileSync(BACKEND_ENV, backendEnv);
console.log(`backend\\.env: PORT ${OLD_PORT} -> ${NEW_PORT}`);

if (fs.existsSync(FRONTEND_ENV)) {
    let frontendEnv = fs.readFileSync(FRONTEND_ENV, 'utf8');
    const oldPortPattern = new RegExp(`:${OLD_PORT}(?=[/"'\\s]|$)`, 'g');
    if (oldPortPattern.test(frontendEnv)) {
        frontendEnv = frontendEnv.replace(oldPortPattern, `:${NEW_PORT}`);
        fs.writeFileSync(FRONTEND_ENV, frontendEnv);
        console.log(`frontend\\.env: replaced :${OLD_PORT} with :${NEW_PORT}`);
    } else {
        console.log(`frontend\\.env: no ":${OLD_PORT}" found (site address may not include a port) - left untouched.`);
    }
} else {
    console.log('frontend\\.env not found - skipping.');
}

console.log('');
console.log(`Done. The app now uses port ${NEW_PORT} in backend\\.env and frontend\\.env.`);
console.log('Run ops\\start.bat to rebuild the frontend with the new address, restart the');
console.log('backend, and re-sync + reload nginx (if installed) to match - it does all of');
console.log('that automatically on every run.');
