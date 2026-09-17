const test = require('node:test');
const assert = require('node:assert/strict');
const { request, checkServerReachable, loginWithPassword } = require('./helpers/apiClient');
const {
    hasSuperAdminCredentials,
    SUPER_ADMIN_PHONE,
    SUPER_ADMIN_PASSWORD
} = require('./helpers/env');
const { createTestUser } = require('./helpers/fixtures');
const { connectSocket, waitForConnect, loadSocketIoClient } = require('./helpers/socketClient');

const TINY_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const TINY_GIF_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

const DELIVERY_POLL_INTERVAL_MS = 2000;
const DELIVERY_POLL_TIMEOUT_MS = 75000;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function reminderForm({ title, message, targetType, targetId, content, fileName, mimeType, mode }) {
    const form = new FormData();
    form.append('title', title);
    form.append('message', message);
    form.append('targetType', targetType);
    form.append('targetId', String(targetId));
    form.append('scheduledAt', new Date(Date.now() - 5000).toISOString());
    form.append('mode', mode);
    const blob = new Blob([content], { type: mimeType });
    form.append('file', blob, fileName);
    return form;
}

async function waitForDelivery(token, reminderId, timeoutMs = DELIVERY_POLL_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await request('GET', `/admin/bot/reminders/${reminderId}/deliveries`, { token });
        const delivery = (result.data.deliveries || [])[0];
        if (delivery) {
            return delivery;
        }
        await sleep(DELIVERY_POLL_INTERVAL_MS);
    }
    return null;
}

test('bot reminder with an image attachment is delivered into both a channel and a group', async (t) => {
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
    const owner = await createTestUser(superAdminSession.token, { role: 'employee' });

    let channel;
    let group;
    let channelReminderId;
    let groupReminderId;
    const receivedChannelMessages = [];
    const receivedGroupMessages = [];
    let ownerSocket = null;

    await t.test('setup: super_admin creates a channel and a group owned by the same user', async () => {
        const channelResult = await request('POST', '/channels', {
            token: superAdminSession.token,
            body: { title: 'کانال یادآوری با پیوست', visibility: 'public', managerId: owner.user.id }
        });
        assert.equal(channelResult.status, 201);
        channel = channelResult.data.channel;
        assert.ok(channel.id);

        const groupResult = await request('POST', '/groups', {
            token: superAdminSession.token,
            body: { title: 'گروه یادآوری با پیوست', visibility: 'public', managerId: owner.user.id }
        });
        assert.equal(groupResult.status, 201);
        group = groupResult.data.group;
        assert.ok(group.id);
    });

    await t.test('setup: owner connects a socket and joins the channel/group rooms', async () => {
        if (!loadSocketIoClient()) {
            return;
        }
        ownerSocket = connectSocket(owner.token);
        await waitForConnect(ownerSocket);
        ownerSocket.on('channel:message', (payload) => receivedChannelMessages.push(payload));
        ownerSocket.on('group:message', (payload) => receivedGroupMessages.push(payload));
    });

    await t.test('step 1: an already-due reminder with an image is created targeting the channel', async () => {
        const form = reminderForm({
            title: 'یادآوری کانال',
            message: 'این یک یادآوری آزمایشی برای کانال است',
            targetType: 'channel',
            targetId: channel.id,
            content: Buffer.from(TINY_PNG_BASE64, 'base64'),
            fileName: 'reminder-channel.png',
            mimeType: 'image/png',
            mode: 'compressed'
        });
        const result = await request('POST', '/admin/bot/reminders', {
            token: superAdminSession.token,
            formData: form
        });
        assert.equal(result.status, 201, `reminder creation should succeed: ${JSON.stringify(result.data)}`);
        const reminder = result.data.reminder;
        channelReminderId = reminder.id;
        assert.equal(reminder.target_type, 'channel');
        assert.equal(Number(reminder.target_id), channel.id);
        assert.equal(reminder.message_type, 'image');
        assert.ok(reminder.attachment_file_id);
    });

    await t.test('step 2: an already-due reminder with an image is created targeting the group', async () => {
        const form = reminderForm({
            title: 'یادآوری گروه',
            message: 'این یک یادآوری آزمایشی برای گروه است',
            targetType: 'group',
            targetId: group.id,
            content: Buffer.from(TINY_GIF_BASE64, 'base64'),
            fileName: 'reminder-group.gif',
            mimeType: 'image/gif',
            mode: 'compressed'
        });
        const result = await request('POST', '/admin/bot/reminders', {
            token: superAdminSession.token,
            formData: form
        });
        assert.equal(result.status, 201, `reminder creation should succeed: ${JSON.stringify(result.data)}`);
        const reminder = result.data.reminder;
        groupReminderId = reminder.id;
        assert.equal(reminder.target_type, 'group');
        assert.equal(Number(reminder.target_id), group.id);
        assert.equal(reminder.message_type, 'image');
        assert.ok(reminder.attachment_file_id);
    });

    await t.test('step 3: the scheduler delivers the channel reminder with its attachment', async () => {
        const delivery = await waitForDelivery(superAdminSession.token, channelReminderId);
        assert.ok(delivery, 'expected the channel reminder to be delivered before the timeout');
        assert.equal(delivery.target_type, 'channel');
        assert.equal(Number(delivery.target_id), channel.id);
        assert.ok(delivery.message_id_ref);

        const messagesResult = await request('GET', `/channels/${channel.id}/messages`, { token: owner.token });
        assert.equal(messagesResult.status, 200);
        const delivered = (messagesResult.data.messages || []).find(
            (message) => message.id === delivery.message_id_ref
        );
        assert.ok(delivered, 'expected the delivered message to be present in channel_messages');
        assert.ok(delivered.file_id, 'expected the channel message to carry a cloned file_id');
        assert.equal(delivered.file_mime_type, 'image/png');
        assert.equal(delivered.type, 'image');
        assert.match(delivered.body, /یادآوری کانال/);
    });

    await t.test('step 4: the scheduler delivers the group reminder with its attachment', async () => {
        const delivery = await waitForDelivery(superAdminSession.token, groupReminderId);
        assert.ok(delivery, 'expected the group reminder to be delivered before the timeout');
        assert.equal(delivery.target_type, 'group');
        assert.equal(Number(delivery.target_id), group.id);
        assert.ok(delivery.message_id_ref);

        const messagesResult = await request('GET', `/groups/${group.id}/messages`, { token: owner.token });
        assert.equal(messagesResult.status, 200);
        const delivered = (messagesResult.data.messages || []).find(
            (message) => message.id === delivery.message_id_ref
        );
        assert.ok(delivered, 'expected the delivered message to be present in group_messages');
        assert.ok(delivered.file_id, 'expected the group message to carry a cloned file_id');
        assert.equal(delivered.file_mime_type, 'image/gif');
        assert.equal(delivered.type, 'image');
        assert.match(delivered.body, /یادآوری گروه/);
    });

    await t.test('step 5: both deliveries were also pushed to the owner over the socket', async () => {
        if (!loadSocketIoClient()) {
            return;
        }
        const channelEvent = receivedChannelMessages.find(
            (payload) => payload.channelId === channel.id && payload.message && payload.message.file_id
        );
        const groupEvent = receivedGroupMessages.find(
            (payload) => payload.groupId === group.id && payload.message && payload.message.file_id
        );
        assert.ok(channelEvent, 'expected a channel:message socket event carrying the attached file');
        assert.ok(groupEvent, 'expected a group:message socket event carrying the attached file');
    });

    if (ownerSocket) {
        ownerSocket.disconnect();
    }
});
