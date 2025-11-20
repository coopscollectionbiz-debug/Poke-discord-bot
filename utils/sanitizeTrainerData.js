// utils/sanitizeTrainerData.js
// NEW SCHEMA SANITIZER — SAFE FOR FLATTENED TRAINERS

import { getFlattenedTrainers } from "./dataLoader.js";

export async function sanitizeTrainerData(trainerData) {
  const flat = await getFlattenedTrainers();

  // Valid sprite filenames: ["lass-gen4.png", "sailor-gen3.png", "miku-fire.png", ...]
  const VALID = new Set(
  flat
    .map(t => t?.spriteFile && typeof t.spriteFile === "string"
      ? t.spriteFile.toLowerCase()
      : null
    )
    .filter(Boolean)
);


  let fixedUsers = 0;
  let removed = 0;

  for (const [userId, user] of Object.entries(trainerData)) {
    if (!Array.isArray(user.trainers)) continue;

    const before = user.trainers.length;

    // Only keep trainers the user actually owns AND exist in the new system
    const cleaned = user.trainers
      .map(s => String(s).toLowerCase())
      .filter(sprite => VALID.has(sprite));

    removed += before - cleaned.length;

    // Replace user's trainer list
    user.trainers = [...new Set(cleaned)];

    if (before !== cleaned.length) fixedUsers++;
  }

  console.log(
    `🧹 Sanitized trainerData → fixed ${fixedUsers} users, removed ${removed} invalid trainers.`
  );

  return trainerData;
}
