export type RowCursor = { created_at: string; id: string };
export function olderFilter(cursor: RowCursor) {
  if (!/^[0-9a-f-]{36}$/i.test(cursor.id) || !/^\d{4}-\d{2}-\d{2}T[0-9:.+Z-]+$/.test(cursor.created_at)) throw new Error("Invalid history cursor.");
  return `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`;
}
export function richMessageSelect(deliveries: boolean) {
  return `*, reactions(emoji,user_id), message_reads(user_id,seen_at)${deliveries ? ", message_deliveries(user_id,delivered_at)" : ""}`;
}
