const test = require('node:test');
const assert = require('node:assert/strict');
const { request, checkServerReachable, loginWithPassword } = require('./helpers/apiClient');
const {
    hasSuperAdminCredentials,
    SUPER_ADMIN_PHONE,
    SUPER_ADMIN_PASSWORD
} = require('./helpers/env');
const { createTestUser } = require('./helpers/fixtures');
const channelCoreService = require('../../src/services/channelCore.service');

const FORWARD_POLL_INTERVAL_MS = 400;
const FORWARD_POLL_TIMEOUT_MS = 15000;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForForwardedMessage(token, groupId, channelMessageId, timeoutMs = FORWARD_POLL_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await request('GET', `/groups/${groupId}/messages`, { token });
        const forwarded = (result.data.messages || []).find(
            (message) => message.forwarded_from_message_id === channelMessageId
        );
        if (forwarded) {
            return forwarded;
        }
        await sleep(FORWARD_POLL_INTERVAL_MS);
    }
    return null;
}

test('end-to-end: create channel, add admin, create group, link, post, auto-forward, unlink', async (t) => {
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
    const promotedAdmin = await createTestUser(superAdminSession.token, { role: 'employee' });
    const reader = await createTestUser(superAdminSession.token, { role: 'employee' });

    let channel;
    let channelAdminMember;
    let linkedGroupId;
    let firstChannelMessage;

    await t.test('step 1: super_admin creates a channel and assigns owner as its manager', async () => {
        const result = await request('POST', '/channels', {
            token: superAdminSession.token,
            body: { title: 'کانال سناریوی کامل', visibility: 'public', managerId: owner.user.id }
        });
        assert.equal(result.status, 201);
        channel = result.data.channel;
        assert.ok(channel.id);
    });

    await t.test('step 2: a reader self-joins the public channel', async () => {
        const joinResult = await request('POST', `/channels/${channel.id}/members`, { token: reader.token });
        assert.equal(joinResult.status, 201);
    });

    await t.test('step 3: owner adds and promotes a second member to admin', async () => {
        const addResult = await request('POST', `/channels/${channel.id}/members`, {
            token: owner.token,
            body: { userId: promotedAdmin.user.id }
        });
        assert.equal(addResult.status, 201);

        const roleResult = await request('PATCH', `/channels/${channel.id}/members/${promotedAdmin.user.id}/role`, {
            token: owner.token,
            body: { role: 'admin' }
        });
        assert.equal(roleResult.status, 200);
        channelAdminMember = roleResult.data.member;
        assert.equal(channelAdminMember.role, 'admin');
    });

    await t.test('step 4: the new admin creates a group and links it to the channel', async () => {
        const linkResult = await request('POST', `/channels/${channel.id}/link`, {
            token: promotedAdmin.token,
            body: { newGroup: { title: 'گروه سناریوی کامل', visibility: 'public' } }
        });
        assert.equal(linkResult.status, 201);
        assert.equal(linkResult.data.linked, true);
        linkedGroupId = linkResult.data.group.id;
        assert.ok(linkedGroupId);
    });

    await t.test('step 5: owner posts in the channel feed', async () => {
        const postResult = await request('POST', `/channels/${channel.id}/messages`, {
            token: owner.token,
            body: { body: 'اطلاعیه‌ی رسمی برای همه‌ی اعضا' }
        });
        assert.equal(postResult.status, 201);
        firstChannelMessage = postResult.data.message;
        assert.ok(firstChannelMessage.id);
    });

    await t.test('step 6: the post is auto-forwarded into the linked group', async () => {
        const forwarded = await waitForForwardedMessage(promotedAdmin.token, linkedGroupId, firstChannelMessage.id);
        assert.ok(forwarded, 'expected the channel post to show up in the linked group before the timeout');
        assert.equal(forwarded.body, firstChannelMessage.body);
        assert.equal(forwarded.forwarded_from_channel_id, channel.id);
    });

    await t.test('step 7: owner unlinks the channel without deleting already-forwarded messages', async () => {
        const unlinkResult = await request('DELETE', `/channels/${channel.id}/link`, { token: owner.token });
        assert.equal(unlinkResult.status, 200);
        assert.equal(unlinkResult.data.unlinked, true);

        const groupMessages = await request('GET', `/groups/${linkedGroupId}/messages`, { token: promotedAdmin.token });
        const stillThere = (groupMessages.data.messages || []).some(
            (message) => message.forwarded_from_message_id === firstChannelMessage.id
        );
        assert.ok(stillThere, 'unlinking must not delete messages that were already forwarded');
    });

    await t.test('step 8: a post made after unlinking is not forwarded anywhere', async () => {
        const postResult = await request('POST', `/channels/${channel.id}/messages`, {
            token: owner.token,
            body: { body: 'پیام بعد از قطع پیوند' }
        });
        assert.equal(postResult.status, 201);
        const secondChannelMessage = postResult.data.message;

        const forwarded = await waitForForwardedMessage(promotedAdmin.token, linkedGroupId, secondChannelMessage.id, 3000);
        assert.equal(forwarded, null, 'a post made after unlinking must never appear in the formerly-linked group');
    });
});

module.exports = { waitForForwardedMessage };
