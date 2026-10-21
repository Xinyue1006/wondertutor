-- AlterTable
ALTER TABLE `user` ADD COLUMN `deletedAt` DATETIME(3) NULL,
    ADD COLUMN `emailReminders` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `privacyAcceptedAt` DATETIME(3) NULL;
