CREATE TABLE `posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

-- jot:down
DROP TABLE IF EXISTS `posts`;
