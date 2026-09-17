const { request, loginWithPassword } = require('./apiClient');
const { randomTestPhone } = require('./env');

const TEST_PASSWORD = 'TestPass123';

async function createTestUser(superAdminToken, { fullName, role, tagId } = {}) {
    const phone = randomTestPhone();
    const created = await request('POST', '/users', {
        token: superAdminToken,
        body: {
            fullName: fullName || `Stage10 Test ${role}`,
            phone,
            role,
            tagId: tagId || null,
            password: TEST_PASSWORD
        }
    });
    if (created.status !== 201) {
        throw new Error(`Failed to create test user (${role}): ${JSON.stringify(created.data)}`);
    }
    const session = await loginWithPassword(phone, TEST_PASSWORD);
    return { phone, password: TEST_PASSWORD, ...session };
}

async function deactivateTestUser(superAdminToken, userId) {
    await request('PATCH', `/users/${userId}/active`, {
        token: superAdminToken,
        body: { isActive: false }
    });
}

async function createDirectConversation(tokenA, targetUserId) {
    const result = await request('POST', '/conversations/direct', {
        token: tokenA,
        body: { targetUserId }
    });
    if (result.status !== 200) {
        throw new Error(`Failed to create direct conversation: ${JSON.stringify(result.data)}`);
    }
    return result.data.conversation;
}

module.exports = { TEST_PASSWORD, createTestUser, deactivateTestUser, createDirectConversation };
