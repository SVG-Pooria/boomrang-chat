const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:1234/api';
const WS_URL = process.env.TEST_WS_URL || BASE_URL.replace(/\/api\/?$/, '');

const SUPER_ADMIN_PHONE = process.env.TEST_SUPER_ADMIN_PHONE || '';
const SUPER_ADMIN_PASSWORD = process.env.TEST_SUPER_ADMIN_PASSWORD || '';

const MANAGEMENT_PHONE = process.env.TEST_MANAGEMENT_PHONE || '';
const MANAGEMENT_PASSWORD = process.env.TEST_MANAGEMENT_PASSWORD || '';

const SECOND_SUPER_ADMIN_PHONE = process.env.TEST_SECOND_SUPER_ADMIN_PHONE || '';
const SECOND_SUPER_ADMIN_PASSWORD = process.env.TEST_SECOND_SUPER_ADMIN_PASSWORD || '';

const REQUEST_TIMEOUT_MS = Number(process.env.TEST_REQUEST_TIMEOUT_MS || 5000);

function randomTestPhone() {
    const suffix = String(Math.floor(100000000 + Math.random() * 899999999));
    return `09${suffix}`;
}

function hasSuperAdminCredentials() {
    return Boolean(SUPER_ADMIN_PHONE && SUPER_ADMIN_PASSWORD);
}

function hasManagementCredentials() {
    return Boolean(MANAGEMENT_PHONE && MANAGEMENT_PASSWORD);
}

function hasSecondSuperAdminCredentials() {
    return Boolean(SECOND_SUPER_ADMIN_PHONE && SECOND_SUPER_ADMIN_PASSWORD);
}

module.exports = {
    BASE_URL,
    WS_URL,
    SUPER_ADMIN_PHONE,
    SUPER_ADMIN_PASSWORD,
    MANAGEMENT_PHONE,
    MANAGEMENT_PASSWORD,
    SECOND_SUPER_ADMIN_PHONE,
    SECOND_SUPER_ADMIN_PASSWORD,
    REQUEST_TIMEOUT_MS,
    randomTestPhone,
    hasSuperAdminCredentials,
    hasManagementCredentials,
    hasSecondSuperAdminCredentials
};
