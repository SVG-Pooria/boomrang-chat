const test = require('node:test');
const assert = require('node:assert/strict');
const permissionMatrix = require('../../src/services/channelGroupPermission.service');

function membership(role, permissions = {}) {
    return { role, permissions };
}

test('can allows owner to perform any action', () => {
    const owner = membership('owner', {});
    assert.equal(permissionMatrix.can(owner, 'post'), true);
    assert.equal(permissionMatrix.can(owner, 'manage_admins'), true);
    assert.equal(permissionMatrix.can(owner, 'manage_link'), true);
});

test('can allows owner to edit_info even with an empty/missing permissions object', () => {
    const ownerNoPermissionsField = { role: 'owner' };
    const ownerEmptyPermissions = membership('owner', {});
    const ownerExplicitlyDeniedFlag = membership('owner', { edit_info: false });
    assert.equal(permissionMatrix.can(ownerNoPermissionsField, 'edit_info'), true);
    assert.equal(permissionMatrix.can(ownerEmptyPermissions, 'edit_info'), true);
    assert.equal(
        permissionMatrix.can(ownerExplicitlyDeniedFlag, 'edit_info'),
        true,
        'role alone decides for owner - a stray edit_info:false on the row must not be able to lock the owner out'
    );
});

test('assertCan never throws ACTION_NOT_PERMITTED for edit_info when the actor is owner', () => {
    const owner = membership('owner', {});
    assert.doesNotThrow(() => permissionMatrix.assertCan(owner, 'edit_info'));
});

test('can allows view for any member regardless of permissions', () => {
    const member = membership('member', {});
    assert.equal(permissionMatrix.can(member, 'view'), true);
});

test('can checks the explicit permission flag for admin and member roles', () => {
    const admin = membership('admin', { post: true, edit_info: false });
    assert.equal(permissionMatrix.can(admin, 'post'), true);
    assert.equal(permissionMatrix.can(admin, 'edit_info'), false);
    assert.equal(permissionMatrix.can(admin, 'manage_link'), false);
});

test('can returns false without a membership', () => {
    assert.equal(permissionMatrix.can(null, 'post'), false);
});

test('defaultPermissionsFor gives channel members a read-only default', () => {
    const perms = permissionMatrix.defaultPermissionsFor('channel', 'member');
    assert.equal(Boolean(perms.post), false);
});

test('defaultPermissionsFor gives group members free chat by default', () => {
    const perms = permissionMatrix.defaultPermissionsFor('group', 'member');
    assert.equal(perms.send_messages, true);
});

test('defaultPermissionsFor gives the owner role edit_info regardless of entity kind', () => {
    assert.equal(permissionMatrix.defaultPermissionsFor('channel', 'owner').edit_info, true);
    assert.equal(permissionMatrix.defaultPermissionsFor('group', 'owner').edit_info, true);
});

test('defaultPermissionsFor leaves edit_info off for a freshly-promoted admin', () => {
    assert.equal(permissionMatrix.defaultPermissionsFor('channel', 'admin').edit_info, false);
    assert.equal(permissionMatrix.defaultPermissionsFor('group', 'admin').edit_info, false);
});

test('assertCan throws NOT_A_MEMBER when there is no membership', () => {
    assert.throws(
        () => permissionMatrix.assertCan(null, 'post'),
        (err) => err instanceof permissionMatrix.PermissionError && err.code === 'NOT_A_MEMBER'
    );
});

test('assertCan throws ACTION_NOT_PERMITTED when the flag is missing', () => {
    const member = membership('member', {});
    assert.throws(
        () => permissionMatrix.assertCan(member, 'post'),
        (err) => err.code === 'ACTION_NOT_PERMITTED'
    );
});

test('assertCanManageMember lets the owner change anyone', () => {
    const owner = membership('owner', {});
    const target = membership('member', {});
    assert.doesNotThrow(() => permissionMatrix.assertCanManageMember(owner, target, { newRole: 'admin' }));
});

test('assertCanManageMember blocks modifying another owner', () => {
    const admin = membership('admin', { manage_admins: true });
    const otherOwner = membership('owner', {});
    assert.throws(
        () => permissionMatrix.assertCanManageMember(admin, otherOwner, { newRole: 'member' }),
        (err) => err.code === 'CANNOT_MODIFY_OWNER'
    );
});

test('assertCanManageMember blocks stripping edit_info from an owner via a permissions patch', () => {
    const admin = membership('admin', { manage_admins: true, manage_members: true });
    const otherOwner = membership('owner', {});
    assert.throws(
        () => permissionMatrix.assertCanManageMember(admin, otherOwner, { newPermissions: { edit_info: false } }),
        (err) => err.code === 'CANNOT_MODIFY_OWNER',
        'the owner permission set is not something any admin - however privileged - can edit; role alone grants it'
    );
});

test('assertCanManageMember requires manage_members for demoting a plain member', () => {
    const admin = membership('admin', { manage_members: false, manage_admins: true });
    const target = membership('member', {});
    assert.throws(
        () => permissionMatrix.assertCanManageMember(admin, target, {}),
        (err) => err.code === 'ACTION_NOT_PERMITTED'
    );
});

test('assertCanManageMember requires manage_admins for promoting to admin', () => {
    const admin = membership('admin', { manage_members: true, manage_admins: false });
    const target = membership('member', {});
    assert.throws(
        () => permissionMatrix.assertCanManageMember(admin, target, { newRole: 'admin' }),
        (err) => err.code === 'ACTION_NOT_PERMITTED'
    );
});

test('assertCanManageMember blocks an admin from granting a permission it lacks itself', () => {
    const admin = membership('admin', { manage_members: true, delete_messages: false });
    const target = membership('member', {});
    assert.throws(
        () => permissionMatrix.assertCanManageMember(admin, target, { newPermissions: { delete_messages: true } }),
        (err) => err.code === 'CANNOT_GRANT_PERMISSION_YOU_DO_NOT_HAVE'
    );
});

test('assertCanManageMember blocks a plain member from managing anyone', () => {
    const member = membership('member', {});
    const target = membership('member', {});
    assert.throws(
        () => permissionMatrix.assertCanManageMember(member, target, {}),
        (err) => err.code === 'ACTION_NOT_PERMITTED'
    );
});

test('assertCanRemoveMember blocks removing the owner', () => {
    const admin = membership('admin', { manage_members: true });
    const owner = membership('owner', {});
    assert.throws(
        () => permissionMatrix.assertCanRemoveMember(admin, owner),
        (err) => err.code === 'CANNOT_REMOVE_OWNER'
    );
});

test('assertCanRemoveMember allows super_admin to remove the owner', () => {
    const superAdminActing = membership('owner', permissionMatrix.OWNER_PERMISSIONS);
    const owner = membership('owner', {});
    assert.doesNotThrow(() =>
        permissionMatrix.assertCanRemoveMember(superAdminActing, owner, { isSuperAdmin: true })
    );
});

test('assertCanRemoveMember blocks an admin from removing another admin', () => {
    const admin = membership('admin', { manage_members: true, manage_admins: true });
    const otherAdmin = membership('admin', {});
    assert.throws(
        () => permissionMatrix.assertCanRemoveMember(admin, otherAdmin),
        (err) => err.code === 'ADMIN_CANNOT_REMOVE_ADMIN'
    );
});

test('assertCanRemoveMember allows an admin with manage_members to remove a plain member', () => {
    const admin = membership('admin', { manage_members: true });
    const target = membership('member', {});
    assert.doesNotThrow(() => permissionMatrix.assertCanRemoveMember(admin, target));
});

test('assertCanRemoveMember blocks a plain member from removing anyone', () => {
    const member = membership('member', {});
    const target = membership('member', {});
    assert.throws(
        () => permissionMatrix.assertCanRemoveMember(member, target),
        (err) => err.code === 'ACTION_NOT_PERMITTED'
    );
});
