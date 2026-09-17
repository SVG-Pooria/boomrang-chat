CREATE TABLE IF NOT EXISTS tags (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL UNIQUE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('employee', 'management', 'super_admin')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    password_encrypted TEXT,
    password_set_at TIMESTAMPTZ,
    password_must_change BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS tag_id INTEGER REFERENCES tags(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_lock_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS unlocked_at TIMESTAMPTZ;
ALTER TABLE users DROP COLUMN IF EXISTS pin_hash;
ALTER TABLE users ADD COLUMN IF NOT EXISTS dnd_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS dnd_label VARCHAR(60);
ALTER TABLE users ADD COLUMN IF NOT EXISTS dnd_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_path TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_updated_at TIMESTAMPTZ;

UPDATE users SET role = 'employee' WHERE role = 'dept_manager';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('employee', 'manager', 'management', 'super_admin'));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'users_lock_requires_capability'
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_lock_requires_capability
            CHECK (NOT is_locked OR is_lock_enabled);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    type VARCHAR(20) NOT NULL CHECK (type IN ('direct', 'group', 'channel')),
    is_system_channel BOOLEAN NOT NULL DEFAULT false,
    origin VARCHAR(30) NOT NULL DEFAULT 'normal' CHECK (origin IN ('normal', 'management_approved')),
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS title VARCHAR(255);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS direct_user_a INTEGER REFERENCES users(id);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS direct_user_b INTEGER REFERENCES users(id);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS closed_by INTEGER REFERENCES users(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_direct_pair
    ON conversations (LEAST(direct_user_a, direct_user_b), GREATEST(direct_user_a, direct_user_b))
    WHERE type = 'direct';

CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_in_conv VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role_in_conv IN ('member', 'can_post', 'read_only')),
    muted BOOLEAN NOT NULL DEFAULT false,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT,
    type VARCHAR(20) NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image', 'file')),
    file_id INTEGER,
    reply_to_id INTEGER REFERENCES messages(id),
    is_edited BOOLEAN NOT NULL DEFAULT false,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS message_hidden_for_user (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hidden_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_message_hidden_for_user_user ON message_hidden_for_user(user_id);

CREATE TABLE IF NOT EXISTS message_files (
    id SERIAL PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    original_path TEXT NOT NULL,
    compressed_path TEXT,
    thumbnail_path TEXT,
    mode VARCHAR(20) NOT NULL CHECK (mode IN ('compressed', 'file')),
    mime_type VARCHAR(100),
    size_bytes BIGINT,
    av_scan_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (av_scan_status IN ('pending', 'clean', 'infected', 'error', 'unscanned')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE message_files ADD COLUMN IF NOT EXISTS original_name VARCHAR(255);

ALTER TABLE message_files DROP CONSTRAINT IF EXISTS message_files_av_scan_status_check;
ALTER TABLE message_files ADD CONSTRAINT message_files_av_scan_status_check
    CHECK (av_scan_status IN ('pending', 'clean', 'infected', 'error', 'unscanned'));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_message_file'
    ) THEN
        ALTER TABLE messages
            ADD CONSTRAINT fk_message_file
            FOREIGN KEY (file_id) REFERENCES message_files(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS management_chat_requests (
    id SERIAL PRIMARY KEY,
    requester_id INTEGER NOT NULL REFERENCES users(id),
    subject VARCHAR(255) NOT NULL,
    message TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    resulting_conversation_id INTEGER REFERENCES conversations(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE management_chat_requests ADD COLUMN IF NOT EXISTS review_note TEXT;

CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS password_view_log (
    id SERIAL PRIMARY KEY,
    viewed_by INTEGER NOT NULL REFERENCES users(id),
    target_user_id INTEGER NOT NULL REFERENCES users(id),
    action VARCHAR(10) NOT NULL CHECK (action IN ('view', 'reset')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_log (
    id SERIAL PRIMARY KEY,
    actor_id INTEGER REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    meta JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_reads (
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_message_id INTEGER REFERENCES messages(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS bot_reminders (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    conversation_id INTEGER REFERENCES conversations(id),
    scheduled_at TIMESTAMPTZ,
    repeat_daily_at VARCHAR(5),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by INTEGER REFERENCES users(id),
    last_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (scheduled_at IS NOT NULL OR repeat_daily_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_bot_reminders_active ON bot_reminders(is_active);

ALTER TABLE bot_reminders ADD COLUMN IF NOT EXISTS target_type VARCHAR(12) NOT NULL DEFAULT 'conversation';
ALTER TABLE bot_reminders DROP CONSTRAINT IF EXISTS bot_reminders_target_type_check;
ALTER TABLE bot_reminders ADD CONSTRAINT bot_reminders_target_type_check
    CHECK (target_type IN ('conversation', 'channel', 'group'));

ALTER TABLE bot_reminders ADD COLUMN IF NOT EXISTS target_id INTEGER;

UPDATE bot_reminders
    SET target_type = 'conversation', target_id = conversation_id
    WHERE target_id IS NULL AND conversation_id IS NOT NULL;

ALTER TABLE bot_reminders ADD COLUMN IF NOT EXISTS message_type VARCHAR(10) NOT NULL DEFAULT 'text';
ALTER TABLE bot_reminders DROP CONSTRAINT IF EXISTS bot_reminders_message_type_check;
ALTER TABLE bot_reminders ADD CONSTRAINT bot_reminders_message_type_check
    CHECK (message_type IN ('text', 'image', 'video', 'file'));

ALTER TABLE bot_reminders ADD COLUMN IF NOT EXISTS attachment_file_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_bot_reminders_target ON bot_reminders(target_type, target_id);

CREATE TABLE IF NOT EXISTS presence (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(10) NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE messages ALTER COLUMN sender_id DROP NOT NULL;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_sender_id_fkey;
ALTER TABLE messages ADD CONSTRAINT messages_sender_id_fkey
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_direct_user_a_fkey;
ALTER TABLE conversations ADD CONSTRAINT conversations_direct_user_a_fkey
    FOREIGN KEY (direct_user_a) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_direct_user_b_fkey;
ALTER TABLE conversations ADD CONSTRAINT conversations_direct_user_b_fkey
    FOREIGN KEY (direct_user_b) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS activity_log_actor_id_fkey;
ALTER TABLE activity_log ADD CONSTRAINT activity_log_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE management_chat_requests ALTER COLUMN requester_id DROP NOT NULL;
ALTER TABLE management_chat_requests DROP CONSTRAINT IF EXISTS management_chat_requests_requester_id_fkey;
ALTER TABLE management_chat_requests ADD CONSTRAINT management_chat_requests_requester_id_fkey
    FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE management_chat_requests DROP CONSTRAINT IF EXISTS management_chat_requests_reviewed_by_fkey;
ALTER TABLE management_chat_requests ADD CONSTRAINT management_chat_requests_reviewed_by_fkey
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE bot_reminders DROP CONSTRAINT IF EXISTS bot_reminders_created_by_fkey;
ALTER TABLE bot_reminders ADD CONSTRAINT bot_reminders_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE password_view_log ALTER COLUMN target_user_id DROP NOT NULL;
ALTER TABLE password_view_log DROP CONSTRAINT IF EXISTS password_view_log_target_user_id_fkey;
ALTER TABLE password_view_log ADD CONSTRAINT password_view_log_target_user_id_fkey
    FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE password_view_log ALTER COLUMN viewed_by DROP NOT NULL;
ALTER TABLE password_view_log DROP CONSTRAINT IF EXISTS password_view_log_viewed_by_fkey;
ALTER TABLE password_view_log ADD CONSTRAINT password_view_log_viewed_by_fkey
    FOREIGN KEY (viewed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_created_by_fkey;
ALTER TABLE conversations ADD CONSTRAINT conversations_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_closed_by_fkey;
ALTER TABLE conversations ADD CONSTRAINT conversations_closed_by_fkey
    FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS user_export_archives (
    id SERIAL PRIMARY KEY,
    target_user_id_snapshot INTEGER,
    target_full_name_snapshot VARCHAR(255) NOT NULL,
    target_phone_snapshot VARCHAR(20) NOT NULL,
    target_role_snapshot VARCHAR(20) NOT NULL,
    target_tag_snapshot VARCHAR(255),
    file_path TEXT NOT NULL,
    size_bytes BIGINT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channels (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    avatar TEXT,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    visibility VARCHAR(10) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE channels ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    avatar TEXT,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    visibility VARCHAR(10) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE groups ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS channel_members (
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(10) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(10) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS channel_messages (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body TEXT,
    type VARCHAR(20) NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image', 'file')),
    file_id INTEGER REFERENCES message_files(id) ON DELETE SET NULL,
    is_pinned BOOLEAN NOT NULL DEFAULT false,
    is_edited BOOLEAN NOT NULL DEFAULT false,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    edited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_messages (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body TEXT,
    type VARCHAR(20) NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image', 'file')),
    file_id INTEGER REFERENCES message_files(id) ON DELETE SET NULL,
    reply_to_id INTEGER REFERENCES group_messages(id) ON DELETE SET NULL,
    is_pinned BOOLEAN NOT NULL DEFAULT false,
    is_edited BOOLEAN NOT NULL DEFAULT false,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    edited_at TIMESTAMPTZ,
    forwarded_from_channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL,
    forwarded_from_message_id INTEGER REFERENCES channel_messages(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_group_links (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    linked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    unlinked_at TIMESTAMPTZ,
    unlinked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE channel_group_links ADD COLUMN IF NOT EXISTS unlinked_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_group_links_channel_active
    ON channel_group_links(channel_id) WHERE is_active = true;
CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_group_links_group_active
    ON channel_group_links(group_id) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS channel_forward_dead_letters (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
    group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
    channel_message_id INTEGER,
    payload JSONB NOT NULL,
    error_message TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    failed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channel_members_user_id ON channel_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_channel_messages_channel_created ON channel_messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_messages_group_created ON group_messages(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_messages_reply_to_id ON group_messages(reply_to_id);
CREATE INDEX IF NOT EXISTS idx_channel_group_links_channel_id ON channel_group_links(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_group_links_group_id ON channel_group_links(group_id);

DO $$
DECLARE
    name_col text;
    desc_col text;
    desc_expr text;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'departments') THEN
        SELECT column_name INTO name_col
        FROM information_schema.columns
        WHERE table_name = 'departments' AND column_name IN ('name', 'title', 'dept_name')
        ORDER BY CASE column_name WHEN 'name' THEN 1 WHEN 'title' THEN 2 ELSE 3 END
        LIMIT 1;

        SELECT column_name INTO desc_col
        FROM information_schema.columns
        WHERE table_name = 'departments' AND column_name IN ('description', 'desc', 'details')
        ORDER BY CASE column_name WHEN 'description' THEN 1 WHEN 'desc' THEN 2 ELSE 3 END
        LIMIT 1;

        desc_expr := CASE WHEN desc_col IS NOT NULL THEN format('d.%I', desc_col) ELSE 'NULL::text' END;

        IF name_col IS NOT NULL THEN
            EXECUTE format(
                'INSERT INTO channels (title, description, owner_id, visibility, created_at, updated_at)
                 SELECT d.%I, %s, NULL, ''private'', now(), now()
                 FROM departments d
                 ON CONFLICT DO NOTHING',
                name_col,
                desc_expr
            );
        ELSE
            RAISE NOTICE 'departments table has no recognizable name/title column - skipping data copy before drop.';
        END IF;

        DROP TABLE departments CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to_id ON messages(reply_to_id);
CREATE INDEX IF NOT EXISTS idx_message_reads_last_read_message_id ON message_reads(last_read_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_members_user_id ON conversation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_actor_id ON activity_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_management_chat_requests_status ON management_chat_requests(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_direct_pair ON conversations(LEAST(direct_user_a, direct_user_b), GREATEST(direct_user_a, direct_user_b)) WHERE type = 'direct';
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_single_system_channel ON conversations (is_system_channel) WHERE is_system_channel = true;

CREATE TABLE IF NOT EXISTS user_chat_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    bubble_color VARCHAR(9),
    font_size VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (font_size IN ('small', 'medium', 'large')),
    auto_image_preview BOOLEAN NOT NULL DEFAULT true,
    notification_sound VARCHAR(20) NOT NULL DEFAULT 'classic' CHECK (notification_sound IN ('classic', 'soft', 'bell', 'pulse', 'none')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_chat_preferences ADD COLUMN IF NOT EXISTS sidebar_collapsed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE group_members ADD COLUMN IF NOT EXISTS last_read_message_id INTEGER;
ALTER TABLE group_members DROP CONSTRAINT IF EXISTS group_members_last_read_message_id_fkey;
ALTER TABLE group_members ADD CONSTRAINT group_members_last_read_message_id_fkey
    FOREIGN KEY (last_read_message_id) REFERENCES group_messages(id) ON DELETE SET NULL;

ALTER TABLE channel_members ADD COLUMN IF NOT EXISTS last_read_message_id INTEGER;
ALTER TABLE channel_members DROP CONSTRAINT IF EXISTS channel_members_last_read_message_id_fkey;
ALTER TABLE channel_members ADD CONSTRAINT channel_members_last_read_message_id_fkey
    FOREIGN KEY (last_read_message_id) REFERENCES channel_messages(id) ON DELETE SET NULL;

ALTER TABLE group_members ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE channel_members ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS forward_origin_type VARCHAR(20);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS forward_origin_ref_id INTEGER;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS forward_origin_message_id INTEGER;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS forward_origin_sender_id INTEGER;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_forward_origin_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_forward_origin_type_check
    CHECK (forward_origin_type IS NULL OR forward_origin_type IN ('direct', 'group', 'channel'));

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_forward_origin_sender_id_fkey;
ALTER TABLE messages ADD CONSTRAINT messages_forward_origin_sender_id_fkey
    FOREIGN KEY (forward_origin_sender_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS forward_origin_type VARCHAR(20);
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS forward_origin_ref_id INTEGER;
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS forward_origin_message_id INTEGER;
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS forward_origin_sender_id INTEGER;

ALTER TABLE group_messages DROP CONSTRAINT IF EXISTS group_messages_forward_origin_type_check;
ALTER TABLE group_messages ADD CONSTRAINT group_messages_forward_origin_type_check
    CHECK (forward_origin_type IS NULL OR forward_origin_type IN ('direct', 'group', 'channel'));

ALTER TABLE group_messages DROP CONSTRAINT IF EXISTS group_messages_forward_origin_sender_id_fkey;
ALTER TABLE group_messages ADD CONSTRAINT group_messages_forward_origin_sender_id_fkey
    FOREIGN KEY (forward_origin_sender_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS forward_origin_type VARCHAR(20);
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS forward_origin_ref_id INTEGER;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS forward_origin_message_id INTEGER;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS forward_origin_sender_id INTEGER;

ALTER TABLE channel_messages DROP CONSTRAINT IF EXISTS channel_messages_forward_origin_type_check;
ALTER TABLE channel_messages ADD CONSTRAINT channel_messages_forward_origin_type_check
    CHECK (forward_origin_type IS NULL OR forward_origin_type IN ('direct', 'group', 'channel'));

ALTER TABLE channel_messages DROP CONSTRAINT IF EXISTS channel_messages_forward_origin_sender_id_fkey;
ALTER TABLE channel_messages ADD CONSTRAINT channel_messages_forward_origin_sender_id_fkey
    FOREIGN KEY (forward_origin_sender_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_forward_origin ON messages(forward_origin_type, forward_origin_ref_id, forward_origin_message_id);
CREATE INDEX IF NOT EXISTS idx_group_messages_forward_origin ON group_messages(forward_origin_type, forward_origin_ref_id, forward_origin_message_id);
CREATE INDEX IF NOT EXISTS idx_channel_messages_forward_origin ON channel_messages(forward_origin_type, forward_origin_ref_id, forward_origin_message_id);

ALTER TABLE message_files ALTER COLUMN message_id DROP NOT NULL;
ALTER TABLE message_files ADD COLUMN IF NOT EXISTS group_message_id INTEGER;
ALTER TABLE message_files ADD COLUMN IF NOT EXISTS channel_message_id INTEGER;

ALTER TABLE message_files DROP CONSTRAINT IF EXISTS message_files_group_message_id_fkey;
ALTER TABLE message_files ADD CONSTRAINT message_files_group_message_id_fkey
    FOREIGN KEY (group_message_id) REFERENCES group_messages(id) ON DELETE CASCADE;

ALTER TABLE message_files DROP CONSTRAINT IF EXISTS message_files_channel_message_id_fkey;
ALTER TABLE message_files ADD CONSTRAINT message_files_channel_message_id_fkey
    FOREIGN KEY (channel_message_id) REFERENCES channel_messages(id) ON DELETE CASCADE;

ALTER TABLE message_files ADD COLUMN IF NOT EXISTS reminder_id INTEGER;

ALTER TABLE message_files DROP CONSTRAINT IF EXISTS message_files_reminder_id_fkey;
ALTER TABLE message_files ADD CONSTRAINT message_files_reminder_id_fkey
    FOREIGN KEY (reminder_id) REFERENCES bot_reminders(id) ON DELETE CASCADE;

ALTER TABLE message_files DROP CONSTRAINT IF EXISTS message_files_single_owner_check;
ALTER TABLE message_files ADD CONSTRAINT message_files_single_owner_check
    CHECK (
        (message_id IS NOT NULL)::int +
        (group_message_id IS NOT NULL)::int +
        (channel_message_id IS NOT NULL)::int +
        (reminder_id IS NOT NULL)::int = 1
    );

CREATE INDEX IF NOT EXISTS idx_message_files_group_message_id ON message_files(group_message_id);
CREATE INDEX IF NOT EXISTS idx_message_files_channel_message_id ON message_files(channel_message_id);
CREATE INDEX IF NOT EXISTS idx_message_files_reminder_id ON message_files(reminder_id);

ALTER TABLE bot_reminders DROP CONSTRAINT IF EXISTS bot_reminders_attachment_file_id_fkey;
ALTER TABLE bot_reminders ADD CONSTRAINT bot_reminders_attachment_file_id_fkey
    FOREIGN KEY (attachment_file_id) REFERENCES message_files(id) ON DELETE SET NULL;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_type_check
    CHECK (type IN ('text', 'image', 'video', 'file', 'poll', 'referral'));

ALTER TABLE group_messages DROP CONSTRAINT IF EXISTS group_messages_type_check;
ALTER TABLE group_messages ADD CONSTRAINT group_messages_type_check
    CHECK (type IN ('text', 'image', 'video', 'file', 'poll'));

ALTER TABLE channel_messages DROP CONSTRAINT IF EXISTS channel_messages_type_check;
ALTER TABLE channel_messages ADD CONSTRAINT channel_messages_type_check
    CHECK (type IN ('text', 'image', 'video', 'file', 'poll'));

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id_id ON messages(conversation_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_group_messages_group_id_id ON group_messages(group_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_channel_messages_channel_id_id ON channel_messages(channel_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_message_files_mode_mime ON message_files(mode, mime_type);

CREATE TABLE IF NOT EXISTS bot_reminder_deliveries (
    id SERIAL PRIMARY KEY,
    reminder_id INTEGER NOT NULL REFERENCES bot_reminders(id) ON DELETE CASCADE,
    target_type VARCHAR(12) NOT NULL CHECK (target_type IN ('conversation', 'channel', 'group')),
    target_id INTEGER NOT NULL,
    message_id_ref INTEGER,
    delivered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_reminder_deliveries_reminder ON bot_reminder_deliveries(reminder_id, delivered_at DESC);

ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION set_users_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION set_users_updated_at();

ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_messages_conversation_pinned ON messages(conversation_id) WHERE is_pinned;

ALTER TABLE users ADD COLUMN IF NOT EXISTS unit VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_extension VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id INTEGER;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_manager_id_fkey;
ALTER TABLE users ADD CONSTRAINT users_manager_id_fkey
    FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_confidential BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS is_confidential BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS is_confidential BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS risk VARCHAR(10) NOT NULL DEFAULT 'کم'
    CHECK (risk IN ('کم', 'متوسط', 'بالا'));
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS description TEXT;
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC);

CREATE TABLE IF NOT EXISTS leave_periods (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    set_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leave_periods_user ON leave_periods(user_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS approval_requests (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL,
    amount_rials BIGINT,
    period_start DATE,
    period_end DATE,
    deadline_at TIMESTAMPTZ,
    priority VARCHAR(10) NOT NULL DEFAULT 'عادی' CHECK (priority IN ('فوری', 'بالا', 'عادی')),
    current_step INTEGER NOT NULL DEFAULT 1,
    total_steps INTEGER NOT NULL DEFAULT 2,
    status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'referred')),
    source_target_type VARCHAR(12) CHECK (source_target_type IN ('conversation', 'channel', 'group')),
    source_target_id INTEGER,
    source_message_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status, created_at DESC);

CREATE TABLE IF NOT EXISTS approval_steps (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    step_name VARCHAR(120) NOT NULL,
    approver_role VARCHAR(20) NOT NULL CHECK (approver_role IN ('employee', 'management', 'super_admin')),
    decision VARCHAR(10) CHECK (decision IN ('تأیید', 'رد', 'ارجاع')),
    decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ,
    signature VARCHAR(64),
    note TEXT,
    UNIQUE (request_id, step_number)
);
CREATE INDEX IF NOT EXISTS idx_approval_steps_request ON approval_steps(request_id, step_number);

CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    due_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'در انتظار'
        CHECK (status IN ('در انتظار', 'در حال انجام', 'بررسی', 'انجام شد')),
    priority VARCHAR(10) NOT NULL DEFAULT 'عادی' CHECK (priority IN ('فوری', 'بالا', 'عادی')),
    source_description VARCHAR(255),
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    source_target_type VARCHAR(12) CHECK (source_target_type IN ('conversation', 'channel', 'group')),
    source_target_id INTEGER,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_id);

CREATE TABLE IF NOT EXISTS meetings (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    room VARCHAR(160),
    source_target_type VARCHAR(12) CHECK (source_target_type IN ('conversation', 'channel', 'group')),
    source_target_id INTEGER,
    minutes JSONB,
    decisions_count INTEGER,
    actions_count INTEGER,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meetings_starts_at ON meetings(starts_at DESC);

CREATE TABLE IF NOT EXISTS meeting_attendees (
    meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (meeting_id, user_id)
);

CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    author_display VARCHAR(160),
    tone VARCHAR(10) NOT NULL DEFAULT 'عادی' CHECK (tone IN ('هشدار', 'رسمی', 'عادی')),
    must_ack BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements(created_at DESC);

CREATE TABLE IF NOT EXISTS announcement_reads (
    announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    acked_at TIMESTAMPTZ,
    PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS related_links (
    id SERIAL PRIMARY KEY,
    target_type VARCHAR(12) NOT NULL CHECK (target_type IN ('conversation', 'channel', 'group')),
    target_id INTEGER NOT NULL,
    title VARCHAR(160) NOT NULL,
    url TEXT NOT NULL,
    icon VARCHAR(30),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_related_links_target ON related_links(target_type, target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS polls (
    id SERIAL PRIMARY KEY,
    target_type VARCHAR(12) NOT NULL CHECK (target_type IN ('conversation', 'channel', 'group')),
    target_id INTEGER NOT NULL,
    message_id INTEGER,
    question VARCHAR(255) NOT NULL,
    is_closed BOOLEAN NOT NULL DEFAULT false,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_polls_target ON polls(target_type, target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS poll_options (
    id SERIAL PRIMARY KEY,
    poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    label VARCHAR(160) NOT NULL,
    position INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options(poll_id, position);

CREATE TABLE IF NOT EXISTS poll_votes (
    poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    voted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (poll_id, user_id)
);

CREATE TABLE IF NOT EXISTS conversation_summaries (
    id SERIAL PRIMARY KEY,
    target_type VARCHAR(12) NOT NULL CHECK (target_type IN ('conversation', 'channel', 'group')),
    target_id INTEGER NOT NULL,
    bullets JSONB NOT NULL,
    is_manual BOOLEAN NOT NULL DEFAULT true,
    published_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (target_type, target_id)
);

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_type_check
    CHECK (type IN ('text', 'image', 'video', 'file', 'poll', 'referral'));

ALTER TABLE channel_messages DROP CONSTRAINT IF EXISTS channel_messages_type_check;
ALTER TABLE channel_messages ADD CONSTRAINT channel_messages_type_check
    CHECK (type IN ('text', 'image', 'video', 'file', 'poll'));

ALTER TABLE group_messages DROP CONSTRAINT IF EXISTS group_messages_type_check;
ALTER TABLE group_messages ADD CONSTRAINT group_messages_type_check
    CHECK (type IN ('text', 'image', 'video', 'file', 'poll'));

CREATE INDEX IF NOT EXISTS idx_polls_message ON polls(target_type, target_id, message_id);

ALTER TABLE conversation_summaries ADD COLUMN IF NOT EXISTS covered_from_message_id INTEGER;
ALTER TABLE conversation_summaries ADD COLUMN IF NOT EXISTS covered_to_message_id INTEGER;
ALTER TABLE conversation_summaries ADD COLUMN IF NOT EXISTS message_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_summaries ALTER COLUMN is_manual SET DEFAULT false;

UPDATE conversation_summaries s
SET bullets = (
    SELECT COALESCE(
        jsonb_agg(jsonb_build_object('kind', 'manual', 'text', b.value, 'ref_message_id', NULL) ORDER BY b.position),
        '[]'::jsonb
    )
    FROM jsonb_array_elements_text(s.bullets) WITH ORDINALITY AS b(value, position)
)
WHERE jsonb_typeof(s.bullets) = 'array' AND jsonb_typeof(s.bullets -> 0) = 'string';

ALTER TABLE polls ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_channel_messages_channel_pinned ON channel_messages(channel_id) WHERE is_pinned;
CREATE INDEX IF NOT EXISTS idx_group_messages_group_pinned ON group_messages(group_id) WHERE is_pinned;
CREATE INDEX IF NOT EXISTS idx_tasks_source_target ON tasks(source_target_type, source_target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_approval_requests_source_target ON approval_requests(source_target_type, source_target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_meetings_source_target ON meetings(source_target_type, source_target_id, created_at);

CREATE INDEX IF NOT EXISTS idx_users_manager_id ON users(manager_id);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tag VARCHAR(40);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_tasks_owner_status ON tasks(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON tasks(completed_at) WHERE completed_at IS NOT NULL;

ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS audience VARCHAR(12) NOT NULL DEFAULT 'compliance';
ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS activity_log_audience_check;
ALTER TABLE activity_log ADD CONSTRAINT activity_log_audience_check
    CHECK (audience IN ('compliance', 'team'));
CREATE INDEX IF NOT EXISTS idx_activity_log_audience ON activity_log(audience, created_at DESC);

ALTER TABLE approval_steps ADD COLUMN IF NOT EXISTS approver_scope VARCHAR(16) NOT NULL DEFAULT 'role';
ALTER TABLE approval_steps DROP CONSTRAINT IF EXISTS approval_steps_approver_scope_check;
ALTER TABLE approval_steps ADD CONSTRAINT approval_steps_approver_scope_check
    CHECK (approver_scope IN ('role', 'direct_manager'));
UPDATE approval_steps SET approver_scope = 'direct_manager'
WHERE step_name = 'تأیید سرپرست مستقیم' AND approver_scope = 'role';
CREATE INDEX IF NOT EXISTS idx_approval_steps_decided_by ON approval_steps(decided_by, decided_at);

CREATE TABLE IF NOT EXISTS manager_space_pins (
    manager_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type VARCHAR(12) NOT NULL CHECK (target_type IN ('channel', 'group')),
    target_id INTEGER NOT NULL,
    pinned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (manager_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id SERIAL PRIMARY KEY,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_name VARCHAR(255),
    action VARCHAR(60) NOT NULL,
    target_description TEXT,
    level VARCHAR(10) NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'danger')),
    meta JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_level ON admin_audit_log(level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action ON admin_audit_log(action, created_at DESC);

CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_agent TEXT,
    ip_address VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS backups (
    id SERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    size_bytes BIGINT,
    status VARCHAR(10) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
    duration_seconds INTEGER,
    file_path TEXT,
    trigger VARCHAR(10) NOT NULL DEFAULT 'schedule' CHECK (trigger IN ('schedule', 'manual')),
    triggered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_backups_started ON backups(started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_backups_single_running ON backups ((status)) WHERE status = 'running';

ALTER TABLE user_export_archives ADD COLUMN IF NOT EXISTS file_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_export_archives ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE user_export_archives ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ;
ALTER TABLE user_export_archives ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_user_export_archives_purge ON user_export_archives(purge_after) WHERE purged_at IS NULL;

ALTER TABLE bot_reminders ADD COLUMN IF NOT EXISTS repeat_days SMALLINT[];

CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_channel_messages_created_at ON channel_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_group_messages_created_at ON group_messages(created_at);

CREATE TABLE IF NOT EXISTS user_permissions (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission VARCHAR(40) NOT NULL CHECK (permission IN ('schedule_meetings', 'assign_tasks')),
    granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, permission)
);

ALTER TABLE user_chat_preferences ADD COLUMN IF NOT EXISTS theme VARCHAR(10) NOT NULL DEFAULT 'light';
ALTER TABLE user_chat_preferences DROP CONSTRAINT IF EXISTS user_chat_preferences_theme_check;
ALTER TABLE user_chat_preferences ADD CONSTRAINT user_chat_preferences_theme_check
    CHECK (theme IN ('light', 'dark'));

DELETE FROM system_settings WHERE key IN ('open_registration', 'two_factor_required');

CREATE TABLE IF NOT EXISTS summary_reports (
    id SERIAL PRIMARY KEY,
    target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('conversation', 'channel', 'group')),
    target_id INTEGER NOT NULL,
    target_name VARCHAR(160) NOT NULL,
    sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    bullets JSONB NOT NULL DEFAULT '[]'::jsonb,
    message_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_summary_reports_created ON summary_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_summary_reports_target ON summary_reports(target_type, target_id);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_note TEXT;

CREATE TABLE IF NOT EXISTS task_reports (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body TEXT,
    kind VARCHAR(16) NOT NULL DEFAULT 'progress' CHECK (kind IN ('progress', 'review', 'system')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_reports_task ON task_reports(task_id, created_at);

ALTER TABLE message_files ADD COLUMN IF NOT EXISTS task_report_id INTEGER;
ALTER TABLE message_files DROP CONSTRAINT IF EXISTS message_files_task_report_id_fkey;
ALTER TABLE message_files ADD CONSTRAINT message_files_task_report_id_fkey
    FOREIGN KEY (task_report_id) REFERENCES task_reports(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_message_files_task_report_id ON message_files(task_report_id);

ALTER TABLE message_files DROP CONSTRAINT IF EXISTS message_files_single_owner_check;
ALTER TABLE message_files ADD CONSTRAINT message_files_single_owner_check
    CHECK (
        (message_id IS NOT NULL)::int +
        (group_message_id IS NOT NULL)::int +
        (channel_message_id IS NOT NULL)::int +
        (reminder_id IS NOT NULL)::int +
        (task_report_id IS NOT NULL)::int = 1
    );

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS location VARCHAR(200);
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ;

ALTER TABLE meeting_attendees ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE meeting_attendees ADD COLUMN IF NOT EXISTS attended_at TIMESTAMPTZ;
ALTER TABLE meeting_attendees ADD COLUMN IF NOT EXISTS invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_meeting_attendees_user ON meeting_attendees(user_id);

CREATE TABLE IF NOT EXISTS approval_request_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(60) NOT NULL UNIQUE,
    description VARCHAR(255),
    needs_amount BOOLEAN NOT NULL DEFAULT false,
    needs_period BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO approval_request_types (name, description, needs_amount, needs_period)
VALUES
    ('مرخصی', 'درخواست مرخصی روزانه', false, true),
    ('مرخصی ساعتی', 'درخواست مرخصی در ساعات کاری', false, true),
    ('مأموریت', 'اعزام به مأموریت کاری', false, true),
    ('خرید', 'درخواست خرید کالا یا خدمات', true, false),
    ('پرداخت', 'درخواست پرداخت مالی', true, false)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS approval_referrals (
    id SERIAL PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
    assignee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referred_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
    note TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'declined', 'done', 'failed')),
    responded_at TIMESTAMPTZ,
    result_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_approval_referrals_request ON approval_referrals(request_id);
CREATE INDEX IF NOT EXISTS idx_approval_referrals_assignee ON approval_referrals(assignee_id, status);

ALTER TABLE approval_steps DROP CONSTRAINT IF EXISTS approval_steps_approver_role_check;
ALTER TABLE approval_steps ADD CONSTRAINT approval_steps_approver_role_check
    CHECK (approver_role IN ('employee', 'manager', 'management', 'super_admin'));

ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS referral_id INTEGER REFERENCES approval_referrals(id) ON DELETE SET NULL;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_type_check
    CHECK (type IN ('text', 'image', 'video', 'file', 'poll', 'referral'));

CREATE TABLE IF NOT EXISTS chat_pins (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope VARCHAR(12) NOT NULL CHECK (scope IN ('all', 'direct', 'group', 'channel')),
    target_type VARCHAR(12) NOT NULL CHECK (target_type IN ('direct', 'group', 'channel')),
    target_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, scope, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_pins_user ON chat_pins(user_id, scope);
