CREATE TABLE `sm_prep` (
	`post_id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sm_prep_done` (
	`user_id` text NOT NULL,
	`post_id` text NOT NULL,
	`completed` integer NOT NULL,
	PRIMARY KEY(`user_id`, `post_id`)
);
