const test = require('node:test');
const assert = require('node:assert/strict');
const attachmentClassifier = require('../../src/utils/attachmentClassifier');

test('isValidCategory accepts only the known attachment categories', () => {
    assert.equal(attachmentClassifier.isValidCategory('media'), true);
    assert.equal(attachmentClassifier.isValidCategory('files'), true);
    assert.equal(attachmentClassifier.isValidCategory('music'), true);
    assert.equal(attachmentClassifier.isValidCategory('gifs'), true);
    assert.equal(attachmentClassifier.isValidCategory('links'), true);
    assert.equal(attachmentClassifier.isValidCategory('stickers'), false);
    assert.equal(attachmentClassifier.isValidCategory(undefined), false);
    assert.equal(attachmentClassifier.isValidCategory(''), false);
});

test('requiresFileJoin is false only for links, true for every other category', () => {
    assert.equal(attachmentClassifier.requiresFileJoin('media'), true);
    assert.equal(attachmentClassifier.requiresFileJoin('files'), true);
    assert.equal(attachmentClassifier.requiresFileJoin('music'), true);
    assert.equal(attachmentClassifier.requiresFileJoin('gifs'), true);
    assert.equal(attachmentClassifier.requiresFileJoin('links'), false);
});

test('buildCategoryCondition for media matches compressed images and videos but excludes gifs', () => {
    const condition = attachmentClassifier.buildCategoryCondition('media', 'm', 'f');
    assert.match(condition, /f\.mode = 'compressed'/);
    assert.match(condition, /f\.mime_type <> 'image\/gif'/);
    assert.match(condition, /image\/%/);
    assert.match(condition, /video\/%/);
});

test('buildCategoryCondition for files matches file-mode attachments that are not audio', () => {
    const condition = attachmentClassifier.buildCategoryCondition('files', 'm', 'f');
    assert.match(condition, /f\.mode = 'file'/);
    assert.match(condition, /NOT LIKE 'audio\/%'/);
});

test('buildCategoryCondition for music matches file-mode audio attachments', () => {
    const condition = attachmentClassifier.buildCategoryCondition('music', 'm', 'f');
    assert.match(condition, /f\.mode = 'file'/);
    assert.match(condition, /f\.mime_type LIKE 'audio\/%'/);
});

test('buildCategoryCondition for gifs matches compressed image/gif attachments only', () => {
    const condition = attachmentClassifier.buildCategoryCondition('gifs', 'm', 'f');
    assert.match(condition, /f\.mode = 'compressed'/);
    assert.match(condition, /f\.mime_type = 'image\/gif'/);
});

test('buildCategoryCondition for links inspects the message body instead of the file table', () => {
    const condition = attachmentClassifier.buildCategoryCondition('links', 'm', 'f');
    assert.match(condition, /m\.type = 'text'/);
    assert.match(condition, /m\.body ~\*/);
    assert.doesNotMatch(condition, /f\./);
});

test('buildCategoryCondition returns null for an unknown category', () => {
    assert.equal(attachmentClassifier.buildCategoryCondition('unknown', 'm', 'f'), null);
});

test('buildCategoryCondition uses the provided table aliases consistently', () => {
    const condition = attachmentClassifier.buildCategoryCondition('music', 'gm', 'gf');
    assert.match(condition, /gf\.mode = 'file'/);
    assert.match(condition, /gf\.mime_type LIKE 'audio\/%'/);
});

test('serializeAttachmentRow maps a row with an attached file', () => {
    const row = {
        id: 42,
        type: 'file',
        body: 'یک توضیح کوتاه',
        sender_id: 7,
        sender_name: 'کاربر تست',
        created_at: '2026-05-10T10:00:00.000Z',
        file_row_id: 100,
        file_mode: 'file',
        file_mime_type: 'application/pdf',
        file_size_bytes: 2048,
        file_original_name: 'report.pdf'
    };
    const serialized = attachmentClassifier.serializeAttachmentRow(row);
    assert.equal(serialized.id, 42);
    assert.equal(serialized.type, 'file');
    assert.equal(serialized.senderId, 7);
    assert.equal(serialized.senderName, 'کاربر تست');
    assert.deepEqual(serialized.file, {
        id: 100,
        mode: 'file',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        originalName: 'report.pdf'
    });
});

test('serializeAttachmentRow returns a null file for a text-only row such as a link message', () => {
    const row = {
        id: 43,
        type: 'text',
        body: 'ببینید: https://example.com',
        sender_id: 7,
        sender_name: 'کاربر تست',
        created_at: '2026-05-10T10:05:00.000Z',
        file_row_id: null,
        file_mode: null,
        file_mime_type: null,
        file_size_bytes: null,
        file_original_name: null
    };
    const serialized = attachmentClassifier.serializeAttachmentRow(row);
    assert.equal(serialized.file, null);
});
