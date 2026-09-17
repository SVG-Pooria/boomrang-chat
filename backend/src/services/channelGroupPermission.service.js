class PermissionError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}

const ROLES = ['owner', 'admin', 'member'];

const ACTIONS = [
    'view',
    'post',
    'send_messages',
    'edit_info',
    'delete_messages',
    'pin_messages',
    'manage_members',
    'manage_admins',
    'manage_link'
];

const OWNER_PERMISSIONS = {
    manage_members: true,
    manage_admins: true,
    post: true,
    send_messages: true,
    edit_info: true,
    delete_messages: true,
    pin_messages: true,
    manage_link: true
};

const CHANNEL_ADMIN_DEFAULT_PERMISSIONS = {
    manage_members: true,
    manage_admins: false,
    post: true,
    edit_info: false,
    delete_messages: true,
    pin_messages: true,
    manage_link: false
};

const CHANNEL_MEMBER_DEFAULT_PERMISSIONS = {};

const GROUP_ADMIN_DEFAULT_PERMISSIONS = {
    manage_members: true,
    manage_admins: false,
    send_messages: true,
    edit_info: false,
    delete_messages: true,
    pin_messages: true,
    manage_link: false
};

const GROUP_MEMBER_DEFAULT_PERMISSIONS = {
    send_messages: true
};

const BOT_CHANNEL_PERMISSIONS = {
    post: true
};

const BOT_GROUP_PERMISSIONS = {
    send_messages: true
};

function defaultPermissionsFor(kind, role) {
    if (role === 'owner') {
        return OWNER_PERMISSIONS;
    }
    if (kind === 'channel') {
        return role === 'admin' ? CHANNEL_ADMIN_DEFAULT_PERMISSIONS : CHANNEL_MEMBER_DEFAULT_PERMISSIONS;
    }
    return role === 'admin' ? GROUP_ADMIN_DEFAULT_PERMISSIONS : GROUP_MEMBER_DEFAULT_PERMISSIONS;
}

function can(membership, action) {
    if (!membership) {
        return false;
    }
    if (membership.role === 'owner') {
        return true;
    }
    if (action === 'view') {
        return true;
    }
    return Boolean(membership.permissions && membership.permissions[action]);
}

function assertIsMember(membership) {
    if (!membership) {
        throw new PermissionError('NOT_A_MEMBER');
    }
}

function assertCan(membership, action) {
    assertIsMember(membership);
    if (!can(membership, action)) {
        throw new PermissionError('ACTION_NOT_PERMITTED');
    }
}

function assertCanManageMember(actorMembership, targetMembership, { newRole, newPermissions } = {}) {
    assertIsMember(actorMembership);
    if (targetMembership && targetMembership.role === 'owner') {
        throw new PermissionError('CANNOT_MODIFY_OWNER');
    }
    if (actorMembership.role === 'owner') {
        return;
    }
    if (actorMembership.role !== 'admin') {
        throw new PermissionError('ACTION_NOT_PERMITTED');
    }
    const touchesAdminRole = (targetMembership && targetMembership.role === 'admin') || newRole === 'admin';
    if (touchesAdminRole) {
        if (!actorMembership.permissions || !actorMembership.permissions.manage_admins) {
            throw new PermissionError('ACTION_NOT_PERMITTED');
        }
    } else if (!actorMembership.permissions || !actorMembership.permissions.manage_members) {
        throw new PermissionError('ACTION_NOT_PERMITTED');
    }
    if (newPermissions) {
        const previousPermissions = (targetMembership && targetMembership.permissions) || {};
        const newlyGrantedKeys = Object.keys(newPermissions).filter(
            (key) => newPermissions[key] && !previousPermissions[key]
        );
        const hasKeyActorLacks = newlyGrantedKeys.some(
            (key) => !(actorMembership.permissions && actorMembership.permissions[key])
        );
        if (hasKeyActorLacks) {
            throw new PermissionError('CANNOT_GRANT_PERMISSION_YOU_DO_NOT_HAVE');
        }
    }
}

function assertCanRemoveMember(actorMembership, targetMembership, { isSuperAdmin = false } = {}) {
    assertIsMember(actorMembership);
    if (!targetMembership) {
        return;
    }

    if (targetMembership.role === 'owner' && !isSuperAdmin) {
        throw new PermissionError('CANNOT_REMOVE_OWNER');
    }
    if (actorMembership.role === 'owner') {
        return;
    }
    if (actorMembership.role !== 'admin') {
        throw new PermissionError('ACTION_NOT_PERMITTED');
    }
    if (targetMembership.role === 'admin') {
        throw new PermissionError('ADMIN_CANNOT_REMOVE_ADMIN');
    }
    if (!actorMembership.permissions || !actorMembership.permissions.manage_members) {
        throw new PermissionError('ACTION_NOT_PERMITTED');
    }
}

module.exports = {
    PermissionError,
    ROLES,
    ACTIONS,
    OWNER_PERMISSIONS,
    CHANNEL_ADMIN_DEFAULT_PERMISSIONS,
    CHANNEL_MEMBER_DEFAULT_PERMISSIONS,
    GROUP_ADMIN_DEFAULT_PERMISSIONS,
    GROUP_MEMBER_DEFAULT_PERMISSIONS,
    BOT_CHANNEL_PERMISSIONS,
    BOT_GROUP_PERMISSIONS,
    defaultPermissionsFor,
    can,
    assertIsMember,
    assertCan,
    assertCanManageMember,
    assertCanRemoveMember
};
