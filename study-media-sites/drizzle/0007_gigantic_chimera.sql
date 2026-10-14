CREATE TABLE `sm_comment_info` (
	`comment_id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`audience` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sm_community_roles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL
);
