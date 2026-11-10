-- CreateTable
CREATE TABLE `AvailabilityWeek` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tutorId` INTEGER NOT NULL,
    `weekStart` DATE NOT NULL,

    UNIQUE INDEX `AvailabilityWeek_tutorId_weekStart_key`(`tutorId`, `weekStart`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AvailabilityWeekSlot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `weekId` INTEGER NOT NULL,
    `dayOfWeek` INTEGER NOT NULL,
    `startTime` VARCHAR(191) NOT NULL,
    `endTime` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AvailabilityWeek` ADD CONSTRAINT `AvailabilityWeek_tutorId_fkey` FOREIGN KEY (`tutorId`) REFERENCES `TutorProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AvailabilityWeekSlot` ADD CONSTRAINT `AvailabilityWeekSlot_weekId_fkey` FOREIGN KEY (`weekId`) REFERENCES `AvailabilityWeek`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
