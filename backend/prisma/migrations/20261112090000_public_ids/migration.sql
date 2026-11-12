-- Keep numeric primary/foreign keys for internal joins and existing integrations.
-- Prisma generates UUIDv4 values for new rows. The deploy backfill script fills
-- existing rows with node:crypto.randomUUID(), rather than MySQL's time-based UUID().
ALTER TABLE `Child` ADD COLUMN `publicId` CHAR(36) NULL;
ALTER TABLE `Booking` ADD COLUMN `publicId` CHAR(36) NULL;
ALTER TABLE `Payment` ADD COLUMN `publicId` CHAR(36) NULL;
ALTER TABLE `Complaint` ADD COLUMN `publicId` CHAR(36) NULL;
CREATE UNIQUE INDEX `Child_publicId_key` ON `Child`(`publicId`);
CREATE UNIQUE INDEX `Booking_publicId_key` ON `Booking`(`publicId`);
CREATE UNIQUE INDEX `Payment_publicId_key` ON `Payment`(`publicId`);
CREATE UNIQUE INDEX `Complaint_publicId_key` ON `Complaint`(`publicId`);
