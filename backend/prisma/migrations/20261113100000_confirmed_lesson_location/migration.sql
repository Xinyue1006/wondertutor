-- Existing coordinates may be approximate matching-area centres. Do not backfill
-- them as confirmed: the parent must explicitly confirm an actual lesson point.
ALTER TABLE `Booking` ADD COLUMN `locationConfirmedAt` DATETIME(3) NULL;
