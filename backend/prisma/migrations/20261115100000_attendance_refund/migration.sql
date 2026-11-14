ALTER TABLE `Complaint` ADD COLUMN `attendanceRefundId` INTEGER NULL,
  ADD CONSTRAINT `Complaint_attendanceRefundId_fkey` FOREIGN KEY (`attendanceRefundId`) REFERENCES `Refund`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
