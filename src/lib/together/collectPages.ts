import type { RowCursor } from "@/lib/together/pagination";
export async function collectPages<T extends RowCursor>(fetchPage:(cursor:RowCursor|undefined,limit:number)=>Promise<T[]>,limit=500):Promise<T[]> {
  const all:T[]=[];
  let cursor:RowCursor|undefined;
  while (true) {
    const page=await fetchPage(cursor,limit);
    all.push(...page);
    if (page.length<limit) return all;
    const last=page[page.length-1];
    if (cursor?.id===last.id && cursor.created_at===last.created_at) throw new Error("Pagination did not advance.");
    cursor={id:last.id,created_at:last.created_at};
  }
}
