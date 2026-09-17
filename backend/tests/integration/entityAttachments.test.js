const test = require('node:test');
const assert = require('node:assert/strict');
const { request, checkServerReachable, loginWithPassword } = require('./helpers/apiClient');
const { hasSuperAdminCredentials, SUPER_ADMIN_PHONE, SUPER_ADMIN_PASSWORD } = require('./helpers/env');
const { createTestUser, createDirectConversation } = require('./helpers/fixtures');
const { connectSocket, waitForConnect, emitWithAck, loadSocketIoClient } = require('./helpers/socketClient');

const TINY_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const TINY_GIF_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

function uploadForm({ fileName, mimeType, content, mode, targetType, targetId, conversationId }) {
    const form = new FormData();
    const blob = new Blob([content], { type: mimeType });
    form.append('file', blob, fileName);
    form.append('mode', mode);
    form.append('targetType', targetType);
    if (targetId !== undefined) {
        form.append('targetId', String(targetId));
    }
    if (conversationId !== undefined) {
        form.append('conversationId', String(conversationId));
    }
    return form;
}

async function uploadDirectAttachment(token, conversationId, spec) {
    const form = uploadForm({ ...spec, targetType: 'direct', conversationId });
    const result = await request('POST', '/uploads', { token, formData: form });
    assert.equal(result.status, 201, `upload should succeed: ${JSON.stringify(result.data)}`);
    return result.data;
}

async function uploadGroupAttachment(token, groupId, spec) {
    const form = uploadForm({ ...spec, targetType: 'group', targetId: groupId });
    const result = await request('POST', '/uploads', { token, formData: form });
    assert.equal(result.status, 201, `upload should succeed: ${JSON.stringify(result.data)}`);
    return result.data;
}

async function uploadChannelAttachment(token, channelId, spec) {
    const form = uploadForm({ ...spec, targetType: 'channel', targetId: channelId });
    const result = await request('POST', '/uploads', { token, formData: form });
    assert.equal(result.status, 201, `upload should succeed: ${JSON.stringify(result.data)}`);
    return result.data;
}

async function sendDirectLinkMessage(token, conversationId, body) {
    if (!loadSocketIoClient()) {
        return null;
    }
    const socket = connectSocket(token);
    try {
        await waitForConnect(socket);
        const ack = await emitWithAck(socket, 'message:send', { conversationId, body, type: 'text' });
        return ack;
    } finally {
        socket.disconnect();
    }
}

function attachmentsUrl(kind, id, category, extra) {
    const base = kind === 'direct' ? `/conversations/${id}/attachments` : `/${kind}s/${id}/attachments`;
    const params = new URLSearchParams({ category, ...extra });
    return `${base}?${params.toString()}`;
}

test('entity attachments: direct conversations, groups and channels', async (t) => {
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

    const userA = await createTestUser(superAdminToken, { role: 'employee' });
    const userB = await createTestUser(superAdminToken, { role: 'employee' });
    const outsider = await createTestUser(superAdminToken, { role: 'employee' });

    await t.test('direct conversation attachments are classified into the right categories', async () => {
        const conversation = await createDirectConversation(userA.token, userB.user.id);

        await uploadDirectAttachment(userA.token, conversation.id, {
            fileName: 'photo.png',
            mimeType: 'image/png',
            content: Buffer.from(TINY_PNG_BASE64, 'base64'),
            mode: 'compressed'
        });
        await uploadDirectAttachment(userA.token, conversation.id, {
            fileName: 'animation.gif',
            mimeType: 'image/gif',
            content: Buffer.from(TINY_GIF_BASE64, 'base64'),
            mode: 'compressed'
        });
        await uploadDirectAttachment(userA.token, conversation.id, {
            fileName: 'report.pdf',
            mimeType: 'application/pdf',
            content: Buffer.from('%PDF-1.4 fake pdf content for testing'),
            mode: 'file'
        });
        await uploadDirectAttachment(userA.token, conversation.id, {
            fileName: 'song.mp3',
            mimeType: 'audio/mpeg',
            content: Buffer.from('fake mp3 bytes for testing'),
            mode: 'file'
        });
        await sendDirectLinkMessage(userA.token, conversation.id, 'ببینید: https://example.com/report');

        const media = await request('GET', attachmentsUrl('direct', conversation.id, 'media'), { token: userB.token });
        assert.equal(media.status, 200);
        assert.equal(media.data.items.length, 1);
        assert.equal(media.data.items[0].file.mimeType, 'image/png');

        const gifs = await request('GET', attachmentsUrl('direct', conversation.id, 'gifs'), { token: userB.token });
        assert.equal(gifs.status, 200);
        assert.equal(gifs.data.items.length, 1);
        assert.equal(gifs.data.items[0].file.mimeType, 'image/gif');

        const files = await request('GET', attachmentsUrl('direct', conversation.id, 'files'), { token: userB.token });
        assert.equal(files.status, 200);
        assert.equal(files.data.items.length, 1);
        assert.equal(files.data.items[0].file.originalName, 'report.pdf');

        const music = await request('GET', attachmentsUrl('direct', conversation.id, 'music'), { token: userB.token });
        assert.equal(music.status, 200);
        assert.equal(music.data.items.length, 1);
        assert.equal(music.data.items[0].file.mimeType, 'audio/mpeg');

        if (loadSocketIoClient()) {
            const links = await request('GET', attachmentsUrl('direct', conversation.id, 'links'), { token: userB.token });
            assert.equal(links.status, 200);
            assert.equal(links.data.items.length, 1);
            assert.match(links.data.items[0].body, /example\.com/);
        }
    });

    await t.test('attachments are paginated with a keyset cursor, newest first', async () => {
        const conversation = await createDirectConversation(userA.token, userB.user.id);
        for (let i = 0; i < 3; i += 1) {
            await uploadDirectAttachment(userA.token, conversation.id, {
                fileName: `doc-${i}.pdf`,
                mimeType: 'application/pdf',
                content: Buffer.from(`fake pdf number ${i}`),
                mode: 'file'
            });
        }

        const firstPage = await request(
            'GET',
            attachmentsUrl('direct', conversation.id, 'files', { limit: '1' }),
            { token: userA.token }
        );
        assert.equal(firstPage.status, 200);
        assert.equal(firstPage.data.items.length, 1);
        assert.equal(firstPage.data.hasMore, true);
        assert.equal(firstPage.data.items[0].file.originalName, 'doc-2.pdf');

        const secondPage = await request(
            'GET',
            attachmentsUrl('direct', conversation.id, 'files', { limit: '1', cursor: firstPage.data.nextCursor }),
            { token: userA.token }
        );
        assert.equal(secondPage.status, 200);
        assert.equal(secondPage.data.items.length, 1);
        assert.equal(secondPage.data.items[0].file.originalName, 'doc-1.pdf');
        assert.notEqual(secondPage.data.items[0].id, firstPage.data.items[0].id);
    });

    await t.test('a user who is not part of the direct conversation cannot fetch its attachments', async () => {
        const conversation = await createDirectConversation(userA.token, userB.user.id);
        const result = await request('GET', attachmentsUrl('direct', conversation.id, 'files'), {
            token: outsider.token
        });
        assert.equal(result.status, 403);
        assert.equal(result.data.error, 'NOT_A_MEMBER');
    });

    let publicGroupId;
    let groupMember;

    await t.test('group attachments are classified per category for members', async () => {
        const owner = await createTestUser(superAdminToken, { role: 'employee' });
        groupMember = owner;
        const createResult = await request('POST', '/groups', {
            token: superAdminToken,
            body: { title: 'گروه تست پیوست‌ها', visibility: 'public', managerId: owner.user.id }
        });
        assert.equal(createResult.status, 201);
        publicGroupId = createResult.data.group.id;

        await uploadGroupAttachment(owner.token, publicGroupId, {
            fileName: 'photo.png',
            mimeType: 'image/png',
            content: Buffer.from(TINY_PNG_BASE64, 'base64'),
            mode: 'compressed'
        });
        await uploadGroupAttachment(owner.token, publicGroupId, {
            fileName: 'notes.pdf',
            mimeType: 'application/pdf',
            content: Buffer.from('fake pdf for group'),
            mode: 'file'
        });
        const linkPost = await request('POST', `/groups/${publicGroupId}/messages`, {
            token: owner.token,
            body: { body: 'مستندات اینجاست: https://example.com/group-doc' }
        });
        assert.equal(linkPost.status, 201);

        const media = await request('GET', attachmentsUrl('group', publicGroupId, 'media'), { token: owner.token });
        assert.equal(media.status, 200);
        assert.equal(media.data.items.length, 1);

        const files = await request('GET', attachmentsUrl('group', publicGroupId, 'files'), { token: owner.token });
        assert.equal(files.status, 200);
        assert.equal(files.data.items.length, 1);
        assert.equal(files.data.items[0].file.originalName, 'notes.pdf');

        const links = await request('GET', attachmentsUrl('group', publicGroupId, 'links'), { token: owner.token });
        assert.equal(links.status, 200);
        assert.equal(links.data.items.length, 1);
        assert.match(links.data.items[0].body, /example\.com\/group-doc/);
    });

    await t.test('a non-member cannot fetch a public group\'s attachments even with the correct id', async () => {
        const result = await request('GET', attachmentsUrl('group', publicGroupId, 'files'), {
            token: outsider.token
        });
        assert.equal(result.status, 403);
        assert.equal(result.data.error, 'NOT_A_MEMBER');
    });

    let publicChannelId;

    await t.test('channel attachments are classified per category for members', async () => {
        const owner = await createTestUser(superAdminToken, { role: 'employee' });
        const createResult = await request('POST', '/channels', {
            token: superAdminToken,
            body: { title: 'کانال تست پیوست‌ها', visibility: 'public', managerId: owner.user.id }
        });
        assert.equal(createResult.status, 201);
        publicChannelId = createResult.data.channel.id;

        await uploadChannelAttachment(owner.token, publicChannelId, {
            fileName: 'song.mp3',
            mimeType: 'audio/mpeg',
            content: Buffer.from('fake mp3 bytes for channel'),
            mode: 'file'
        });
        await uploadChannelAttachment(owner.token, publicChannelId, {
            fileName: 'animation.gif',
            mimeType: 'image/gif',
            content: Buffer.from(TINY_GIF_BASE64, 'base64'),
            mode: 'compressed'
        });

        const music = await request('GET', attachmentsUrl('channel', publicChannelId, 'music'), { token: owner.token });
        assert.equal(music.status, 200);
        assert.equal(music.data.items.length, 1);

        const gifs = await request('GET', attachmentsUrl('channel', publicChannelId, 'gifs'), { token: owner.token });
        assert.equal(gifs.status, 200);
        assert.equal(gifs.data.items.length, 1);
    });

    await t.test('a non-member cannot fetch a public channel\'s attachments even with the correct id', async () => {
        const result = await request('GET', attachmentsUrl('channel', publicChannelId, 'music'), {
            token: outsider.token
        });
        assert.equal(result.status, 403);
        assert.equal(result.data.error, 'NOT_A_MEMBER');
    });

    await t.test('an infected (non-clean) file is never returned by the attachments endpoint', async () => {
        let db;
        try {
            db = require('../../src/config/database');
        } catch (err) {
            t.skip('could not load the database module directly, skipping the av_scan_status filter check');
            return;
        }

        const conversation = await createDirectConversation(userA.token, userB.user.id);
        const cleanUpload = await uploadDirectAttachment(userA.token, conversation.id, {
            fileName: 'clean.pdf',
            mimeType: 'application/pdf',
            content: Buffer.from('a perfectly clean fake pdf'),
            mode: 'file'
        });
        const suspiciousUpload = await uploadDirectAttachment(userA.token, conversation.id, {
            fileName: 'suspicious.pdf',
            mimeType: 'application/pdf',
            content: Buffer.from('a fake pdf we will mark as infected after upload'),
            mode: 'file'
        });

        try {
            await db.query("UPDATE message_files SET av_scan_status = 'infected' WHERE id = $1", [
                suspiciousUpload.file.id
            ]);
        } catch (err) {
            t.skip('could not reach the database directly from the test process, skipping the av_scan_status filter check');
            return;
        }

        const files = await request('GET', attachmentsUrl('direct', conversation.id, 'files'), { token: userA.token });
        assert.equal(files.status, 200);
        const fileIds = files.data.items.map((item) => item.file.id);
        assert.ok(fileIds.includes(cleanUpload.file.id), 'the clean file should still be listed');
        assert.ok(!fileIds.includes(suspiciousUpload.file.id), 'a file whose av_scan_status is not clean must never be listed');
    });
});
