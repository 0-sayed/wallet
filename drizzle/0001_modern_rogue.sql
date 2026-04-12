CREATE TABLE "ledger_totals" (
	"type" "ledger_type" PRIMARY KEY NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "fractional_balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_fractional_balance_non_negative" CHECK ("wallets"."fractional_balance" >= 0);

-- Backfill running totals from existing ledger data
INSERT INTO ledger_totals (type, total)
SELECT type, COALESCE(SUM(amount), 0) FROM ledger GROUP BY type
ON CONFLICT (type) DO NOTHING;