-- Store small personal attachments directly in D1 instead of R2.
ALTER TABLE attachments ADD COLUMN content_base64 TEXT;
