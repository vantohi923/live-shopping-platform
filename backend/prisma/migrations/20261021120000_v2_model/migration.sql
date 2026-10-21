-- CreateEnum
CREATE TYPE "Role" AS ENUM ('VIEWER', 'STREAMER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- User.role: text -> enum, keeping existing values
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING "role"::"Role";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'VIEWER';

-- Stream: stream key is a secret, fetched from AWS when needed
ALTER TABLE "Stream" DROP COLUMN "streamKey";

-- Product.price (Float) -> priceCents (Int), converting existing prices
ALTER TABLE "Product" ADD COLUMN "priceCents" INTEGER;
UPDATE "Product" SET "priceCents" = ROUND("price" * 100);
ALTER TABLE "Product" ALTER COLUMN "priceCents" SET NOT NULL;
ALTER TABLE "Product" DROP COLUMN "price";

-- Order.price (Float) -> priceCents (Int), converting existing prices
ALTER TABLE "Order" ADD COLUMN "priceCents" INTEGER;
UPDATE "Order" SET "priceCents" = ROUND("price" * 100);
ALTER TABLE "Order" ALTER COLUMN "priceCents" SET NOT NULL;
ALTER TABLE "Order" DROP COLUMN "price";

-- Order.status: text -> enum; old COMPLETED orders were paid
ALTER TABLE "Order" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus"
  USING (CASE "status" WHEN 'COMPLETED' THEN 'PAID' ELSE "status" END)::"OrderStatus";
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- Order.stripeSessionId
ALTER TABLE "Order" ADD COLUMN "stripeSessionId" TEXT;
CREATE UNIQUE INDEX "Order_stripeSessionId_key" ON "Order"("stripeSessionId");

-- Indexes on foreign keys
CREATE INDEX "Stream_userId_idx" ON "Stream"("userId");
CREATE INDEX "Product_streamId_idx" ON "Product"("streamId");
CREATE INDEX "Order_userId_idx" ON "Order"("userId");
CREATE INDEX "Order_productId_idx" ON "Order"("productId");
