const fs = require('fs');
const path = require('path');

const NEW_DIR = process.argv[2];

if (!NEW_DIR) {
    console.error('Usage: node scripts/set-backup-mirror-dir.js <files_dest_dir>');
    process.exit(1);
}

const BACKEND_DIR = path.join(__dirname, '..');
const BACKEND_ENV = path.join(BACKEND_DIR, '.env');

if (!fs.existsSync(BACKEND_ENV)) {
    console.error(`Could not find ${BACKEND_ENV} - run ops\\setup-env.bat first.`);
    process.exit(1);
}

let env = fs.readFileSync(BACKEND_ENV, 'utf8');
const lineMatch = env.match(/^BACKUP_MIRROR_FILES_DIR=.*$/m);
const desiredLine = `BACKUP_MIRROR_FILES_DIR=${NEW_DIR}`;

if (lineMatch && lineMatch[0] === desiredLine) {
    console.log(`backend\\.env: BACKUP_MIRROR_FILES_DIR already set to ${NEW_DIR} - nothing to do.`);
    process.exit(0);
}

if (lineMatch) {
    const OLD_VALUE = lineMatch[0].slice('BACKUP_MIRROR_FILES_DIR='.length);
    env = env.replace(/^BACKUP_MIRROR_FILES_DIR=.*$/m, desiredLine);
    fs.writeFileSync(BACKEND_ENV, env);
    console.log(`backend\\.env: BACKUP_MIRROR_FILES_DIR "${OLD_VALUE}" -> "${NEW_DIR}"`);
} else {
    if (env.length && !env.endsWith('\n')) env += '\n';
    env += `${desiredLine}\n`;
    fs.writeFileSync(BACKEND_ENV, env);
    console.log(`backend\\.env: added ${desiredLine}`);
}

console.log('Done. Restart/re-run ops\\start.bat is not required just for this - it');
console.log('already runs this script BEFORE the backend service starts on every run.');
