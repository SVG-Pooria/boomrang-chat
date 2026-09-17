const { BASE_URL, REQUEST_TIMEOUT_MS } = require('./env');

async function request(method, path, { token, body, formData, headers } = {}) {
    const finalHeaders = Object.assign({}, headers);
    if (token) {
        finalHeaders.Authorization = `Bearer ${token}`;
    }
    let payload;
    if (formData) {
        payload = formData;
    } else if (body !== undefined) {
        finalHeaders['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(`${BASE_URL}${path}`, {
            method,
            headers: finalHeaders,
            body: payload,
            signal: controller.signal
        });
        let data = null;
        const text = await response.text();
        if (text) {
            try {
                data = JSON.parse(text);
            } catch (err) {
                data = text;
            }
        }
        return { status: response.status, data };
    } finally {
        clearTimeout(timer);
    }
}

async function checkServerReachable() {
    try {
        const result = await request('GET', '/health');
        return result.status === 200;
    } catch (err) {
        return false;
    }
}

async function loginWithPassword(phone, password) {
    const result = await request('POST', '/auth/login', { body: { phone, password } });
    if (result.status !== 200 || !result.data || !result.data.token) {
        throw new Error(`Login failed for ${phone}: ${JSON.stringify(result.data)}`);
    }
    return result.data;
}

module.exports = { request, checkServerReachable, loginWithPassword };
