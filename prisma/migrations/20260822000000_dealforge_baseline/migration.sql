-- DealForge pre-Product-Engine baseline.
-- Existing production databases should mark this migration as already applied
-- before deploying later migrations; new databases can apply it normally.

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'user',
  "wishlist" TEXT NOT NULL DEFAULT '[]',
  "savedSearches" TEXT NOT NULL DEFAULT '[]',
  "recentlyViewed" TEXT NOT NULL DEFAULT '[]',
  "priceAlerts" TEXT NOT NULL DEFAULT '[]',
  "settings" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "Category" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "icon" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

CREATE TABLE "Product" (
  "id" TEXT NOT NULL,
  "asin" TEXT,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "brand" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "subcategory" TEXT,
  "images" TEXT NOT NULL,
  "quantity" INTEGER,
  "price" DOUBLE PRECISION NOT NULL,
  "originalPrice" DOUBLE PRECISION NOT NULL,
  "discountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reviewCount" INTEGER NOT NULL DEFAULT 0,
  "affiliateUrl" TEXT NOT NULL,
  "retailer" TEXT NOT NULL DEFAULT 'amazon',
  "availability" TEXT NOT NULL DEFAULT 'in_stock',
  "specifications" TEXT NOT NULL DEFAULT '{}',
  "trendingScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "clickCount" INTEGER NOT NULL DEFAULT 0,
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "isFeatured" BOOLEAN NOT NULL DEFAULT false,
  "isFlashDeal" BOOLEAN NOT NULL DEFAULT false,
  "flashEndsAt" TIMESTAMP(3),
  "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");
CREATE INDEX "Product_subcategory_idx" ON "Product"("subcategory");
CREATE INDEX "Product_asin_idx" ON "Product"("asin");
CREATE INDEX "Product_discountPercent_idx" ON "Product"("discountPercent");
CREATE INDEX "Product_rating_idx" ON "Product"("rating");
CREATE INDEX "Product_trendingScore_idx" ON "Product"("trendingScore");
CREATE INDEX "Product_createdAt_idx" ON "Product"("createdAt");
CREATE INDEX "Product_price_idx" ON "Product"("price");
CREATE INDEX "Product_brand_idx" ON "Product"("brand");
CREATE INDEX "Product_isFeatured_idx" ON "Product"("isFeatured");
CREATE INDEX "Product_isFlashDeal_idx" ON "Product"("isFlashDeal");

CREATE TABLE "AffiliateProvider" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "trackingId" TEXT NOT NULL DEFAULT '',
  "apiCredentials" TEXT NOT NULL DEFAULT '{}',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "lastSyncAt" TIMESTAMP(3),
  "lastSyncStatus" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AffiliateProvider_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AffiliateProvider_provider_key" ON "AffiliateProvider"("provider");

CREATE TABLE "ClickEvent" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "userId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'web',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClickEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClickEvent_productId_idx" ON "ClickEvent"("productId");
CREATE INDEX "ClickEvent_createdAt_idx" ON "ClickEvent"("createdAt");

CREATE TABLE "ImportJob" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "itemsTotal" INTEGER NOT NULL DEFAULT 0,
  "itemsSuccess" INTEGER NOT NULL DEFAULT 0,
  "itemsFailed" INTEGER NOT NULL DEFAULT 0,
  "errorLog" TEXT NOT NULL DEFAULT '[]',
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApiUsageLog" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "status" INTEGER NOT NULL,
  "latencyMs" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApiUsageLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ApiUsageLog_provider_idx" ON "ApiUsageLog"("provider");
CREATE INDEX "ApiUsageLog_createdAt_idx" ON "ApiUsageLog"("createdAt");

CREATE TABLE "SystemLog" (
  "id" TEXT NOT NULL,
  "level" TEXT NOT NULL DEFAULT 'info',
  "source" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "meta" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SystemLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SystemLog_level_idx" ON "SystemLog"("level");
CREATE INDEX "SystemLog_createdAt_idx" ON "SystemLog"("createdAt");

CREATE TABLE "CacheEntry" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CacheEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CacheEntry_key_key" ON "CacheEntry"("key");
CREATE INDEX "CacheEntry_expiresAt_idx" ON "CacheEntry"("expiresAt");

ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClickEvent" ADD CONSTRAINT "ClickEvent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClickEvent" ADD CONSTRAINT "ClickEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
