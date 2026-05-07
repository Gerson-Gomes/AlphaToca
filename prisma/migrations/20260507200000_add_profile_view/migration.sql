-- CreateTable
CREATE TABLE "profile_views" (
    "id" TEXT NOT NULL,
    "landlord_id" TEXT NOT NULL,
    "viewer_id" TEXT,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "profile_views_landlord_time_idx" ON "profile_views"("landlord_id", "viewed_at");

-- AddForeignKey
ALTER TABLE "profile_views" ADD CONSTRAINT "profile_views_landlord_id_fkey" FOREIGN KEY ("landlord_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
