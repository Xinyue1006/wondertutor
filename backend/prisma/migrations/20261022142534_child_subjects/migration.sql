-- AlterTable
ALTER TABLE `child` ADD COLUMN `subjects` JSON NULL;

-- Each child who already had a main subject now has it as the first (and so far only) entry of the new list
UPDATE `child` SET `subjects` = JSON_ARRAY(`subject`) WHERE `subject` IS NOT NULL AND `subjects` IS NULL;
