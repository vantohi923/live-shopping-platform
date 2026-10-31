ALTER TABLE "User" ADD COLUMN "cognitoSub" TEXT;

CREATE UNIQUE INDEX "User_cognitoSub_key" ON "User"("cognitoSub");
