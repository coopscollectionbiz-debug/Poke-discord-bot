// utils/sanitizeTrainerData.js
export function sanitizeTrainerData(trainerData) {
  let fixedUsers = 0;
  let removed = 0;

  for (const [userId, user] of Object.entries(trainerData)) {
    if (!user.trainers || typeof user.trainers !== "object") continue;

    const cleaned = {};
    let hadInvalid = false;

    for (const [key, val] of Object.entries(user.trainers)) {
      if (typeof key === "string" && (key.endsWith(".png") || key.endsWith(".jpg"))) {
        cleaned[key] = val;
      } else {
        hadInvalid = true;
        removed++;
      }
    }

    if (hadInvalid) {
      fixedUsers++;
      user.trainers = cleaned;
    }
  }

  console.log(`🧹 Sanitized trainerData in memory → fixed ${fixedUsers} users, removed ${removed} bad entries.`);
  return trainerData;
}
