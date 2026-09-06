-- Additive only: preserve historical requests and Telegram message IDs.
ALTER TYPE "TelegramDeliveryStatus" ADD VALUE IF NOT EXISTS 'UNCERTAIN';
