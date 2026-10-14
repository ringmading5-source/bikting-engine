import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
export const reactions = sqliteTable('reactions',{user:text('user').notNull(),lesson:text('lesson').notNull(),kind:text('kind').notNull()},t=>[primaryKey({columns:[t.user,t.lesson,t.kind]})]);
export const messages = sqliteTable('messages',{id:text('id').primaryKey(),channel:text('channel').notNull(),user:text('user').notNull(),name:text('name').notNull(),body:text('body').notNull(),created:integer('created').notNull()});
export const plans = sqliteTable('plans',{user:text('user').primaryKey(),body:text('body').notNull()});
