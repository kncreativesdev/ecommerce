-- Phase 2C-26: company-scoped customer identity.
--
-- Drops the global UNIQUE on `users`.`email` and replaces it with
-- UNIQUE (`company_id`, `email`) plus a plain lookup index on
-- `email` (staff-identity and existence checks query by email alone
-- across companies).
--
-- DDL-only: every existing (company_id, email) pair is already
-- unique (verified pre-apply against the live database), so no data
-- rewrite, no backfill, and no account changes of any kind. NULL
-- `company_id` rows (platform identities, legacy unassigned
-- accounts) are application-guarded; MySQL treats NULLs as distinct
-- in the compound key.

-- DropIndex
DROP INDEX `users_email_key` ON `users`;

-- CreateIndex
CREATE UNIQUE INDEX `users_company_id_email_key` ON `users`(`company_id`, `email`);

-- CreateIndex
CREATE INDEX `users_email_idx` ON `users`(`email`);
