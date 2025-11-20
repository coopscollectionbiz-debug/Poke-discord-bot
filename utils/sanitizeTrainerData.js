// utils/sanitizeTrainerData.js
export function sanitizeTrainerData(trainerData) {
  let fixedUsers = 0;
  let removed = 0;

  for (const [userId, user] of Object.entries(trainerData)) {
    if (!user.trainers) continue;

    // ==========================================
    // NEW SCHEMA: trainers = [ "file.png", ... ]
    // ==========================================
    if (Array.isArray(user.trainers)) {
      const before = user.trainers.length;

      const cleaned = [
        ...new Set( // dedupe
          user.trainers.filter(
            (t) =>
              typeof t === "string" &&
              (t.endsWith(".png") ||
               t.endsWith(".jpg") ||
               t.endsWith(".gif"))
          )
        ),
      ];

      if (cleaned.length !== before) {
        removed += before - cleaned.length;
        fixedUsers++;
      }

      user.trainers = cleaned;
      continue;
    }

    // ==========================================
    // LEGACY SCHEMA: trainers = { "file.png": 3 }
    // → convert to array of filenames
    // ==========================================
    if (typeof user.trainers === "object") {
      const cleanedObj = {};
      let hadInvalid = false;

      for (const [key, val] of Object.entries(user.trainers)) {
        if (
          typeof key === "string" &&
          (key.endsWith(".png") ||
           key.endsWith(".jpg") ||
           key.endsWith(".gif"))
        ) {
          cleanedObj[key] = val;
        } else {
          hadInvalid = true;
          removed++;
        }
      }

      if (hadInvalid) {
        fixedUsers++;
      }

      // 🔄 Move to new schema: array of filenames
      user.trainers = Object.keys(cleanedObj);
    }
  }

  console.log(
    `🧹 Sanitized trainerData in memory → fixed ${fixedUsers} users, removed ${removed} bad entries.`
  );
  return trainerData;
}
