CREATE TABLE `sm_tut_bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`student` text NOT NULL,
	`price` integer NOT NULL,
	`currency` text NOT NULL,
	`fee` integer NOT NULL,
	`status` text NOT NULL,
	`expires` integer NOT NULL,
	`reference` text,
	`turns` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sm_tut_chat` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`role` text NOT NULL,
	`body` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sm_tut_earnings` (
	`booking_id` text PRIMARY KEY NOT NULL,
	`teacher` text NOT NULL,
	`gross` integer NOT NULL,
	`fee` integer NOT NULL,
	`net` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`reference` text
);
--> statement-breakpoint
CREATE TABLE `sm_tut_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`subject` text NOT NULL,
	`description` text NOT NULL,
	`price` integer NOT NULL,
	`currency` text NOT NULL,
	`fee` integer NOT NULL,
	`terms` text NOT NULL,
	`status` text NOT NULL,
	`max_turns` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sm_tut_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`offer_id` text NOT NULL,
	`start` integer NOT NULL,
	`minutes` integer NOT NULL,
	`capacity` integer NOT NULL,
	`room_id` text NOT NULL,
	`status` text NOT NULL
);
