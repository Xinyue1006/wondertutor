-- AlterTable
ALTER TABLE `child` ADD COLUMN `goals` TEXT NULL,
    ADD COLUMN `gradeYear` INTEGER NULL,
    ADD COLUMN `preferredLanguage` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `AccountWarning` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `issuedById` INTEGER NOT NULL,
    `reason` TEXT NOT NULL,
    `complaintId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AccountWarning_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AccountWarning` ADD CONSTRAINT `AccountWarning_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccountWarning` ADD CONSTRAINT `AccountWarning_issuedById_fkey` FOREIGN KEY (`issuedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing children are treated as correct for the current school year, so nothing is moved up retroactively
UPDATE `Child` SET `gradeYear` = YEAR(CURDATE()) WHERE `gradeYear` IS NULL;
