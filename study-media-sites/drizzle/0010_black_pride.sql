CREATE TABLE `sm_reward_awards` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`user_id` text NOT NULL,
	`score` integer NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`reference` text,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sm_reward_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`prize` text NOT NULL,
	`quantity` integer NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`terms` text NOT NULL,
	`status` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sm_reward_participants` (
	`campaign_id` text NOT NULL,
	`user_id` text NOT NULL,
	`alias` text NOT NULL,
	`public` integer NOT NULL,
	`joined` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `user_id`)
);
