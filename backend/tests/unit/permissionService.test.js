const test = require('node:test');
const assert = require('node:assert/strict');
const permissionService = require('../../src/services/permission.service');

function makeUser(sub, role, isActive = true) {
    return { sub, role, is_active: isActive };
}

test('assertCanCreateDirect blocks any conversation involving super_admin as sender', () => {
    const admin = makeUser(1, 'super_admin');
    const employee = makeUser(2, 'employee');
    assert.throws(
        () => permissionService.assertCanCreateDirect(admin, employee),
        (err) => err instanceof permissionService.PermissionError && err.code === 'SUPER_ADMIN_NOT_REACHABLE'
    );
});

test('assertCanCreateDirect blocks any conversation involving super_admin as target', () => {
    const employee = makeUser(2, 'employee');
    const admin = makeUser(1, 'super_admin');
    assert.throws(
        () => permissionService.assertCanCreateDirect(employee, admin),
        (err) => err instanceof permissionService.PermissionError && err.code === 'SUPER_ADMIN_NOT_REACHABLE'
    );
});

test('assertCanCreateDirect blocks messaging yourself', () => {
    const employee = makeUser(2, 'employee');
    assert.throws(
        () => permissionService.assertCanCreateDirect(employee, makeUser(2, 'employee')),
        (err) => err instanceof permissionService.PermissionError && err.code === 'CANNOT_MESSAGE_SELF'
    );
});

test('assertCanCreateDirect blocks inactive sender or target', () => {
    const employee = makeUser(2, 'employee');
    const inactiveEmployee = makeUser(3, 'employee', false);
    assert.throws(
        () => permissionService.assertCanCreateDirect(inactiveEmployee, employee),
        (err) => err.code === 'SENDER_INACTIVE'
    );
    assert.throws(
        () => permissionService.assertCanCreateDirect(employee, inactiveEmployee),
        (err) => err.code === 'SENDER_INACTIVE'
    );
});

test('assertCanCreateDirect requires a ticket when an employee targets management', () => {
    const employee = makeUser(2, 'employee');
    const manager = makeUser(9, 'management');
    assert.throws(
        () => permissionService.assertCanCreateDirect(employee, manager),
        (err) => err.code === 'MANAGEMENT_TICKET_REQUIRED'
    );
});

test('assertCanCreateDirect allows management to initiate contact with an employee', () => {
    const manager = makeUser(9, 'management');
    const employee = makeUser(2, 'employee');
    assert.doesNotThrow(() => permissionService.assertCanCreateDirect(manager, employee));
});

test('assertCanPostInExistingConversation allows posting in an approved open ticket conversation', () => {
    const employee = makeUser(2, 'employee');
    const manager = makeUser(9, 'management');
    const conversation = { type: 'direct', origin: 'management_approved', closed_at: null, is_system_channel: false };
    const membership = { role_in_conv: 'member' };
    assert.doesNotThrow(() =>
        permissionService.assertCanPostInExistingConversation(employee, conversation, membership, manager)
    );
});

test('assertCanPostInExistingConversation blocks posting once the ticket conversation is closed', () => {
    const employee = makeUser(2, 'employee');
    const manager = makeUser(9, 'management');
    const conversation = { type: 'direct', origin: 'management_approved', closed_at: new Date(), is_system_channel: false };
    const membership = { role_in_conv: 'member' };
    assert.throws(
        () => permissionService.assertCanPostInExistingConversation(employee, conversation, membership, manager),
        (err) => err.code === 'MANAGEMENT_TICKET_REQUIRED'
    );
});

test('assertCanPostInExistingConversation blocks a non-member from posting', () => {
    const employee = makeUser(2, 'employee');
    const conversation = { type: 'direct', origin: 'normal', closed_at: null, is_system_channel: false };
    assert.throws(
        () => permissionService.assertCanPostInExistingConversation(employee, conversation, null, makeUser(3, 'employee')),
        (err) => err.code === 'NOT_A_MEMBER'
    );
});

test('assertCanPostInExistingConversation blocks a read-only member from posting in the announcements channel', () => {
    const employee = makeUser(2, 'employee');
    const conversation = { type: 'channel', origin: 'normal', closed_at: null, is_system_channel: true };
    const membership = { role_in_conv: 'read_only' };
    assert.throws(
        () => permissionService.assertCanPostInExistingConversation(employee, conversation, membership, null),
        (err) => err.code === 'READ_ONLY_CHANNEL'
    );
});

test('assertCanPostInExistingConversation allows super_admin to broadcast in the system channel only', () => {
    const admin = makeUser(1, 'super_admin');
    const systemChannel = { type: 'channel', origin: 'normal', closed_at: null, is_system_channel: true };
    const regularChannel = { type: 'channel', origin: 'normal', closed_at: null, is_system_channel: false };
    const membership = { role_in_conv: 'can_post' };
    assert.doesNotThrow(() =>
        permissionService.assertCanPostInExistingConversation(admin, systemChannel, membership, null)
    );
    assert.throws(
        () => permissionService.assertCanPostInExistingConversation(admin, regularChannel, membership, null),
        (err) => err.code === 'SUPER_ADMIN_NOT_REACHABLE'
    );
});

test('assertCanLeaveConversation blocks an employee from leaving the system channel', () => {
    const employee = makeUser(2, 'employee');
    const systemChannel = { is_system_channel: true };
    assert.throws(
        () => permissionService.assertCanLeaveConversation(employee, systemChannel),
        (err) => err.code === 'SYSTEM_CHANNEL_LEAVE_DISABLED'
    );
});

test('assertCanLeaveConversation allows management to leave the system channel', () => {
    const manager = makeUser(4, 'management');
    const systemChannel = { is_system_channel: true };
    assert.doesNotThrow(() => permissionService.assertCanLeaveConversation(manager, systemChannel));
});
