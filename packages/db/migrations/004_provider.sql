ALTER TABLE provider_operation ADD COLUMN parent_reference text;
ALTER TABLE provider_operation ADD COLUMN last_error text;
ALTER TABLE webhook_inbox ADD COLUMN attempts integer NOT NULL DEFAULT 0;
ALTER TABLE webhook_inbox ADD COLUMN last_error text;
