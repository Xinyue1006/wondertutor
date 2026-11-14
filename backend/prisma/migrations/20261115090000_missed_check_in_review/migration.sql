ALTER TABLE `Complaint`
    ADD COLUMN `parentAnswer` VARCHAR(191) NULL,
    ADD COLUMN `parentNote` TEXT NULL,
    ADD COLUMN `attendanceApproved` BOOLEAN NOT NULL DEFAULT false;
