CREATE TABLE `sm_concept_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	`kind` text NOT NULL,
	`evidence` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sm_concepts` (
	`id` text PRIMARY KEY NOT NULL,
	`lesson_id` text NOT NULL,
	`label` text NOT NULL,
	`description` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sm_guidance` (
	`user_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`state` text NOT NULL,
	`mode` text NOT NULL,
	`reflection` text NOT NULL,
	`updated` integer NOT NULL,
	PRIMARY KEY(`user_id`, `lesson_id`)
);
--> statement-breakpoint
CREATE TABLE `sm_sync_events` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`created` integer NOT NULL
);
