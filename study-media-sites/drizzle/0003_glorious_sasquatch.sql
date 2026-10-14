CREATE TABLE `sm_courses` (
	`user_id` text PRIMARY KEY NOT NULL,
	`subjects` text NOT NULL,
	`goal` text NOT NULL,
	`daily` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sm_feedback` (
	`user_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`helpful` integer NOT NULL,
	PRIMARY KEY(`user_id`, `lesson_id`)
);
