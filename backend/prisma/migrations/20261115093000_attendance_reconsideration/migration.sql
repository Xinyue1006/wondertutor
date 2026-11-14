ALTER TABLE `Complaint`
  ADD COLUMN `attendanceOutcome` VARCHAR(191) NULL,
  ADD COLUMN `tutorReplyPending` BOOLEAN NOT NULL DEFAULT false;

UPDATE `Complaint` SET `attendanceOutcome` = 'UNVERIFIED'
WHERE `category` = 'Missed check-in' AND `status` = 'DISMISSED';

CREATE TABLE `AttendanceReviewEntry` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `complaintId` INTEGER NOT NULL,
  `action` VARCHAR(191) NOT NULL,
  `message` TEXT NOT NULL,
  `evidenceUrl` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `AttendanceReviewEntry_complaintId_idx`(`complaintId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `AttendanceReviewEntry_complaintId_fkey` FOREIGN KEY (`complaintId`) REFERENCES `Complaint`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
