CREATE TABLE `sm_school_classes` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`name` text NOT NULL,
	`subject` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sm_school_members` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`class_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sm_school_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`class_id` text NOT NULL,
	`author` text NOT NULL,
	`role` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`due_at` integer,
	`lesson_id` text,
	`created` integer NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sm_schools` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`country` text NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`review` text,
	`created` integer NOT NULL
);
