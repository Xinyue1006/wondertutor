CREATE TABLE AvailabilityException (
 id INTEGER NOT NULL AUTO_INCREMENT,
 tutorId INTEGER NOT NULL,
 date VARCHAR(10) NOT NULL,
 ranges JSON NOT NULL,
 UNIQUE INDEX AvailabilityException_tutorId_date_key (tutorId, date),
 PRIMARY KEY (id),
 CONSTRAINT AvailabilityException_tutorId_fkey FOREIGN KEY (tutorId) REFERENCES TutorProfile(id) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
