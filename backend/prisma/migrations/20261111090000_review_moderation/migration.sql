ALTER TABLE `Review`
  ADD COLUMN `isHidden` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `moderationReason` TEXT NULL,
  ADD COLUMN `moderatedAt` DATETIME(3) NULL,
  ADD COLUMN `moderatedById` INTEGER NULL;

ALTER TABLE `Complaint` ADD COLUMN `reviewId` INTEGER NULL;
CREATE UNIQUE INDEX `Complaint_filedById_reviewId_key` ON `Complaint`(`filedById`, `reviewId`);
ALTER TABLE `Complaint` ADD CONSTRAINT `Complaint_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `Review`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
