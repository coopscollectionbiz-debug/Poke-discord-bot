import fs from 'fs/promises';

// Paths
const BACKUP_PATH = './backup_trainerData.json';  // Your backup file (with Discord user IDs as keys)
const LIVE_PATH = './trainerData.json';           // Your bot's current trainer data

async function migrateTP() {
  // Load backup data
  const backupRaw = await fs.readFile(BACKUP_PATH, 'utf8');
  const backupData = JSON.parse(backupRaw);

  // Load current trainer data
  let liveData = {};
  try {
    liveData = JSON.parse(await fs.readFile(LIVE_PATH, 'utf8'));
  } catch {
    liveData = {};
  }

  let migrated = 0, skipped = 0;

  for (const [userId, oldUser] of Object.entries(backupData)) {
    if (!oldUser || typeof oldUser !== "object") { skipped++; continue; }
    const tp = oldUser.tp ?? oldUser.migratedFrom ?? 0;
    if (!liveData[userId]) liveData[userId] = {};
    liveData[userId].tp = tp;
    migrated++;
  }

  await fs.writeFile(LIVE_PATH, JSON.stringify(liveData, null, 2));
  console.log(`✅ TP migration complete. Migrated: ${migrated}. Skipped: ${skipped}.`);
}

migrateTP();