const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

function getKey() {
    const keyHex = process.env.PASSWORD_ENCRYPTION_KEY;
    if (!keyHex || keyHex.length !== 64) {
        throw new Error('PASSWORD_ENCRYPTION_KEY must be a 64 character hex string');
    }
    return Buffer.from(keyHex, 'hex');
}

function encrypt(plainText) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}

function decrypt(payload) {
    const [ivHex, authTagHex, dataHex] = payload.split(':');
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt };
