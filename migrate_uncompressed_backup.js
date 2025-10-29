import fs from 'fs/promises';

// Paths
const BACKUP_PATH = './backup_trainerData.json';  // Your backup file
const LIVE_PATH = './trainerData.json';           // Your bot's current trainer data

async function migrate() {
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

  // Migrate users
  const users = backupData.users;
  let migrated = 0, skipped = 0;

  for (const [userId, oldUser] of Object.entries(users)) {
    // Only migrate if TP is present
    const tp = oldUser.tp ?? oldUser.migratedFrom ?? 0;
    if (!tp) { skipped++; continue; }
    if (!liveData[userId]) liveData[userId] = { tp: 0, cc: 0, coins: 0, pokemon: [], trainers: {}, questProgress: {} };

    // Merge fields
    liveData[userId].tp = tp;
    liveData[userId].coins = oldUser.coins ?? 0;
    if (Array.isArray(oldUser.pokemon)) liveData[userId].pokemon = oldUser.pokemon;
    if (typeof oldUser.trainer === 'string') liveData[userId].trainer = oldUser.trainer;
    if (typeof oldUser.questProgress === 'object') liveData[userId].questProgress = oldUser.questProgress;
    liveData[userId].guildId = oldUser.guildId ?? '';
    liveData[userId].lastClaim = oldUser.lastClaim ?? 0;
    migrated++;
  }

  await fs.writeFile(LIVE_PATH, JSON.stringify(liveData, null, 2));
  console.log(`✅ Migration complete. Migrated: ${migrated}. Skipped: ${skipped}.`);
}

migrate();