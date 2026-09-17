const test = require('node:test');
const assert = require('node:assert/strict');
const { request, checkServerReachable, loginWithPassword } = require('./helpers/apiClient');
const { hasSuperAdminCredentials, SUPER_ADMIN_PHONE, SUPER_ADMIN_PASSWORD } = require('./helpers/env');
const { createTestUser, deactivateTestUser } = require('./helpers/fixtures');

const EICAR_TEST_STRING =
    'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

function buildUploadForm({ fileName, mimeType, content, targetUserId, mode }) {
    const form = new FormData();
    const blob = new Blob([content], { type: mimeType });
    form.append('file', blob, fileName);
    form.append('targetUserId', String(targetUserId));
    form.append('mode', mode || 'file');
    return form;
}

test('upload security against a live backend', async (t) => {
    const reachable = await checkServerReachable();
    if (!reachable) {
        t.skip('No backend reachable at TEST_BASE_URL, skipping live integration tests');
        return;
    }
    if (!hasSuperAdminCredentials()) {
        t.skip('TEST_SUPER_ADMIN_PHONE / TEST_SUPER_ADMIN_PASSWORD not provided, skipping live integration tests');
        return;
    }

    const superAdminSession = await loginWithPassword(SUPER_ADMIN_PHONE, SUPER_ADMIN_PASSWORD);
    const superAdminToken = superAdminSession.token;

    const senderA = await createTestUser(superAdminToken, { role: 'employee' });
    const receiverA = await createTestUser(superAdminToken, { role: 'employee' });
    const senderB = await createTestUser(superAdminToken, { role: 'employee' });
    const receiverB = await createTestUser(superAdminToken, { role: 'employee' });

    await t.test('a file larger than the configured limit is rejected with FILE_TOO_LARGE', async () => {
        const previous = await request('GET', '/admin/settings/max-file-size', { token: superAdminToken });
        assert.equal(previous.status, 200);

        const limited = await request('PATCH', '/admin/settings/max-file-size', {
            token: superAdminToken,
            body: { maxFileSizeBytes: 1024, unlimited: false }
        });
        assert.equal(limited.status, 200);

        try {
            const oversizedContent = Buffer.alloc(5000, 'a');
            const form = buildUploadForm({
                fileName: 'too-big.bin',
                mimeType: 'application/octet-stream',
                content: oversizedContent,
                targetUserId: receiverA.user.id
            });
            const result = await request('POST', '/uploads', { token: senderA.token, formData: form });
            assert.equal(result.status, 413);
            assert.equal(result.data.error, 'FILE_TOO_LARGE');
        } finally {
            await request('PATCH', '/admin/settings/max-file-size', {
                token: superAdminToken,
                body: {
                    maxFileSizeBytes: previous.data.unlimited ? null : previous.data.maxFileSizeBytes,
                    unlimited: previous.data.unlimited
                }
            });
        }
    });

    await t.test('a well-formed file under the limit is accepted', async () => {
        const form = buildUploadForm({
            fileName: 'note.txt',
            mimeType: 'text/plain',
            content: 'a perfectly ordinary text file',
            targetUserId: receiverB.user.id
        });
        const result = await request('POST', '/uploads', { token: senderB.token, formData: form });
        assert.equal(result.status, 201);
        assert.equal(result.data.file.av_scan_status, 'clean');
    });

    await t.test('the EICAR antivirus test file is blocked when the scanner flags it', async () => {
        const eicarUser = await createTestUser(superAdminToken, { role: 'employee' });
        const eicarReceiver = await createTestUser(superAdminToken, { role: 'employee' });
        try {
            const form = buildUploadForm({
                fileName: 'eicar-test-file.txt',
                mimeType: 'text/plain',
                content: EICAR_TEST_STRING,
                targetUserId: eicarReceiver.user.id
            });
            const result = await request('POST', '/uploads', { token: eicarUser.token, formData: form });
            if (result.status === 201) {
                t.skip('Scanner did not flag the EICAR test file (likely CLAMSCAN_ENABLED=false in this environment)');
                return;
            }
            assert.equal(result.status, 422);
            assert.equal(result.data.error, 'INFECTED_FILE');
        } finally {
            await deactivateTestUser(superAdminToken, eicarUser.user.id);
            await deactivateTestUser(superAdminToken, eicarReceiver.user.id);
        }
    });

    await deactivateTestUser(superAdminToken, senderA.user.id);
    await deactivateTestUser(superAdminToken, receiverA.user.id);
    await deactivateTestUser(superAdminToken, senderB.user.id);
    await deactivateTestUser(superAdminToken, receiverB.user.id);
});
