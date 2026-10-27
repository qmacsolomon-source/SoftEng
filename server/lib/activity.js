/**
 * Append-only activity trail that powers the Dashboard "Recent activity" card.
 * Logging must never break the main request, so failures are swallowed.
 */
export async function logActivity(db, { actor, action, entityType, entityId = null, summary }) {
  try {
    await db.from('activity_log').insert({
      actor_id: actor?.id ?? null,
      actor_name: actor?.profile?.full_name || actor?.email || 'System',
      action,
      entity_type: entityType,
      entity_id: entityId,
      summary,
    });
  } catch {
    /* intentionally ignored */
  }
}
