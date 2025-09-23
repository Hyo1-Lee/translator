-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomCode" TEXT NOT NULL,
    "speakerId" TEXT NOT NULL,
    "speakerName" TEXT NOT NULL DEFAULT 'Speaker',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "endedAt" DATETIME
);

-- CreateTable
CREATE TABLE "room_settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "targetLanguage" TEXT NOT NULL DEFAULT 'en',
    "enableTranslation" BOOLEAN NOT NULL DEFAULT true,
    "enableAutoScroll" BOOLEAN NOT NULL DEFAULT true,
    "maxListeners" INTEGER NOT NULL DEFAULT 100,
    CONSTRAINT "room_settings_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "listeners" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "socketId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Guest',
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" DATETIME,
    CONSTRAINT "listeners_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "stt_texts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "confidence" REAL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stt_texts_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transcripts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "korean" TEXT NOT NULL,
    "english" TEXT NOT NULL,
    "batchId" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transcripts_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "rooms_roomCode_key" ON "rooms"("roomCode");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_speakerId_key" ON "rooms"("speakerId");

-- CreateIndex
CREATE INDEX "rooms_roomCode_idx" ON "rooms"("roomCode");

-- CreateIndex
CREATE INDEX "rooms_status_idx" ON "rooms"("status");

-- CreateIndex
CREATE INDEX "rooms_speakerId_idx" ON "rooms"("speakerId");

-- CreateIndex
CREATE UNIQUE INDEX "room_settings_roomId_key" ON "room_settings"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "listeners_socketId_key" ON "listeners"("socketId");

-- CreateIndex
CREATE INDEX "listeners_roomId_idx" ON "listeners"("roomId");

-- CreateIndex
CREATE INDEX "listeners_socketId_idx" ON "listeners"("socketId");

-- CreateIndex
CREATE INDEX "stt_texts_roomId_timestamp_idx" ON "stt_texts"("roomId", "timestamp");

-- CreateIndex
CREATE INDEX "transcripts_roomId_timestamp_idx" ON "transcripts"("roomId", "timestamp");

-- CreateIndex
CREATE INDEX "transcripts_batchId_idx" ON "transcripts"("batchId");
