-- CreateTable
CREATE TABLE "property_view_events" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "viewer_id" TEXT,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_view_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "property_view_events_property_time_idx" ON "property_view_events"("property_id", "viewed_at");

-- AddForeignKey
ALTER TABLE "property_view_events" ADD CONSTRAINT "property_view_events_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
