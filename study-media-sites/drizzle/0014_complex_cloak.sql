CREATE TABLE `sm_applications` (
	`opportunity_id` text NOT NULL,
	`user_id` text NOT NULL,
	`proof_id` text NOT NULL,
	`note` text NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`opportunity_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `sm_assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`concept_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`creator` text NOT NULL,
	`body` text NOT NULL,
	`revision` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sm_coop` (
	`room_id` text PRIMARY KEY NOT NULL,
	`concept_id` text NOT NULL,
	`stage` text NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sm_coop_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sm_opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`concept_id` text NOT NULL,
	`title` text NOT NULL,
	`organisation` text NOT NULL,
	`description` text NOT NULL,
	`deadline` integer NOT NULL,
	`creator` text NOT NULL,
	`status` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sm_peer_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`concept_id` text NOT NULL,
	`alias` text NOT NULL,
	`mode` text NOT NULL,
	`expires` integer NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sm_peer_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`requester` text NOT NULL,
	`target` text NOT NULL,
	`concept_id` text NOT NULL,
	`status` text NOT NULL,
	`expires` integer NOT NULL,
	`created` integer NOT NULL,
	`room_id` text
);
--> statement-breakpoint
CREATE TABLE `sm_proofs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`assessment_id` text NOT NULL,
	`title` text NOT NULL,
	`explanation` text NOT NULL,
	`answer` real,
	`auto_pass` integer,
	`status` text NOT NULL,
	`created` integer NOT NULL,
	`scores` text,
	`feedback` text,
	`reviewer` text,
	`reviewed` integer,
	`share_token` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sm_proof_share_unique` ON `sm_proofs` (`share_token`);