CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`user` text NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`user` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reactions` (
	`user` text NOT NULL,
	`lesson` text NOT NULL,
	`kind` text NOT NULL,
	PRIMARY KEY(`user`, `lesson`, `kind`)
);
