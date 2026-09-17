const HIDDEN_ROLE = 'super_admin';

function isHiddenRole(role) {
    return role === HIDDEN_ROLE;
}

module.exports = { HIDDEN_ROLE, isHiddenRole };
