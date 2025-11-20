// ==========================================================
// 🔒 User Locks (Race-Safe v3.2)
// ==========================================================
//
// Provides per-user async locking so commands never overlap.
// Used by /daily, /resetdaily, /addinventory, etc.
//
// Usage:
//   await lockUser(userId, async () => {
//       ... safe operations here ...
//   });
//
// ==========================================================

const activeLocks = new Map();

/**
 * Acquire a lock for a user, execute the callback, then release.
 * Queues callers FIFO so only 1 operation runs per user at a time.
 */
export async function lockUser(userId, callback) {
  if (!userId) throw new Error("lockUser: missing userId");

  // Create queue entry
  let release;
  const wait = new Promise(resolve => (release = resolve));

  // Add to queue
  const prev = activeLocks.get(userId);
  activeLocks.set(userId, wait);

  // If someone is already running, wait for their release
  if (prev) await prev;

  try {
    // Execute the protected callback
    return await callback();
  } finally {
    // Release next in queue
    release();

    // Only delete if this was the last queued lock
    if (activeLocks.get(userId) === wait) {
      activeLocks.delete(userId);
    }
  }
}

export function isUserLocked(userId) {
  return activeLocks.has(userId);
}
