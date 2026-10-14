CREATE TABLE `sm_assembly` (
	`id` text PRIMARY KEY NOT NULL,
	`author` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`subject` text NOT NULL,
	`publish_at` integer NOT NULL,
	`event_at` integer,
	`status` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sm_assembly_reads` (
	`user_id` text NOT NULL,
	`post_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `post_id`)
);
--> statement-breakpoint
CREATE TABLE `sm_assembly_teachers` (
	`user_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`reviewer` text,
	`created` integer NOT NULL
);
