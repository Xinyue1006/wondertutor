CREATE TABLE `TutorRateChange` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tutorId` INTEGER NOT NULL,
  `kind` VARCHAR(191) NOT NULL,
  `previous` DECIMAL(10,2) NULL,
  `rate` DECIMAL(10,2) NOT NULL,
  `reason` VARCHAR(191) NOT NULL,
  `changedBy` VARCHAR(191) NOT NULL,
  `adminId` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `TutorRateChange_tutorId_createdAt_idx` (`tutorId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `TutorRateChange_tutorId_fkey` FOREIGN KEY (`tutorId`) REFERENCES `TutorProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Refund` ADD COLUMN `reviewNote` VARCHAR(191) NULL,
  ADD COLUMN `issuedAt` DATETIME(3) NULL,
  ADD COLUMN `transferRef` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `Refund_transferRef_key` (`transferRef`);

UPDATE `Refund` r JOIN `Payment` p ON p.id = r.paymentId
SET r.issuedAt = COALESCE(r.reviewedAt, r.createdAt)
WHERE r.status = 'APPROVED' AND p.status IN ('REFUNDED','PARTIALLY_REFUNDED');
