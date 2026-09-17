const REQUIRED_VARS = ['DATABASE_URL', 'JWT_SECRET', 'PASSWORD_ENCRYPTION_KEY'];

function validate() {
    const missing = REQUIRED_VARS.filter((name) => !process.env[name]);
    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
    if (process.env.PASSWORD_ENCRYPTION_KEY.length !== 64) {
        throw new Error('PASSWORD_ENCRYPTION_KEY must be a 64 character hex string');
    }
}

module.exports = { validate };
