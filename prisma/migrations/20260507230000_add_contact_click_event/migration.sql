-- CreateTable
CREATE TABLE "contact_click_events" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "viewer_id" TEXT,
    "clicked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_click_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_click_events_property_time_idx" ON "contact_click_events"("property_id", "clicked_at");

-- AddForeignKey
ALTER TABLE "contact_click_events" ADD CONSTRAINT "contact_click_events_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
