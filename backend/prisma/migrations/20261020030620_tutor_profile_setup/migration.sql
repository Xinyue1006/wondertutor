-- AlterTable
ALTER TABLE `qualification` ADD COLUMN `kind` ENUM('QUALIFICATION', 'IDENTITY') NOT NULL DEFAULT 'QUALIFICATION';

-- AlterTable
ALTER TABLE `tutorprofile` ADD COLUMN `verificationSubmittedAt` DATETIME(3) NULL,
    MODIFY `gender` ENUM('MALE', 'FEMALE', 'UNSPECIFIED') NULL,
    MODIFY `emergencyContactName` VARCHAR(191) NULL,
    MODIFY `emergencyContactPhone` VARCHAR(191) NULL;
