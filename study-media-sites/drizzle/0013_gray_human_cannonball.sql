CREATE TABLE `sm_video_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`lesson_id` text NOT NULL,
	`owner` text NOT NULL,
	`prompt` text NOT NULL,
	`snapshot` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`operation` text,
	`asset` text,
	`error` text,
	`created` integer NOT NULL
);
