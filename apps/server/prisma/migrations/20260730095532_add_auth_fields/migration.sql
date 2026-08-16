-- AlterTable
ALTER TABLE `user` 
  ADD COLUMN `avatar` VARCHAR(191) NULL,
  ADD COLUMN `password` VARCHAR(191) NOT NULL DEFAULT 'default_hash_please_change';
