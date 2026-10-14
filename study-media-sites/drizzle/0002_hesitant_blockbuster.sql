CREATE TABLE `sm_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`created` integer NOT NULL
);
