-- A distinct enum value keeps Google Analytics OAuth, credentials and GA4
-- properties isolated from every existing Google Ads row.
ALTER TYPE "ProviderId" ADD VALUE IF NOT EXISTS 'GOOGLE_ANALYTICS';
