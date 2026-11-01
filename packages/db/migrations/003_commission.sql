ALTER TABLE work_unit ADD COLUMN commission_minor bigint NOT NULL DEFAULT 0 CHECK(commission_minor>=0);
ALTER TABLE refund_allocation ADD COLUMN commission_minor bigint NOT NULL DEFAULT 0 CHECK(commission_minor>=0);
