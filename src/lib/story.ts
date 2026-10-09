import type { ImportantDate } from "@/lib/types";
export type StoryCoverMode = "fixed" | "memories" | "selected";
export type StoryCoverSettings = { mode: StoryCoverMode; memoryIds: string[]; paths: string[] };
export const SPECIAL_TYPES = [{id:"engagement",label:"Engagement"},{id:"wedding",label:"Wedding"},{id:"first_meeting",label:"First meeting"},{id:"birthday",label:"Birthday"},{id:"other",label:"Special memory"}] as const;
export type SpecialType = typeof SPECIAL_TYPES[number]["id"];
export const MAX_MEMORY_BATCH = 20;
export function validateMemoryFile(file: Pick<File,"name"|"size"|"type">) {
  if (!file.size) return "This file is empty.";
  if (file.size>15*1024*1024) return "Choose a file smaller than 15 MB.";
  if (!(file.type.startsWith("image/") || ["video/mp4","video/webm","video/quicktime"].includes(file.type))) return "Choose a photo or an MP4, WebM or MOV video.";
  return "";
}
export function validCalendarDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(`${value}T12:00:00Z`);return Number.isFinite(+d)&&d.toISOString().slice(0,10)===value;}
export function localCalendarDate(now=new Date()){return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;}
const epoch=(day:string)=>Date.parse(`${day}T12:00:00Z`)/86400000;
function anniversaryInYear(day:string,year:number){const [,m,d]=day.split("-").map(Number);const end=new Date(Date.UTC(year,m,0)).getUTCDate();return `${year}-${String(m).padStart(2,"0")}-${String(Math.min(d,end)).padStart(2,"0")}`;}
export function specialDateStatus(item:ImportantDate,today=localCalendarDate()){
  const day=item.localDate;if(!day||!validCalendarDate(day)||!validCalendarDate(today))return null;
  let next=day;
  if(item.repeatsYearly&&day<today){next=anniversaryInYear(day,Number(today.slice(0,4)));if(next<today)next=anniversaryInYear(day,Number(today.slice(0,4))+1);}
  return {next,days:Math.round(epoch(next)-epoch(today)),elapsedDays:Math.max(0,Math.round(epoch(today)-epoch(day))),years:Math.max(0,Number(next.slice(0,4))-Number(day.slice(0,4)))};
}
export function specialDateLabel(value:ImportantDate,today=localCalendarDate(),locale="ar") {const s=specialDateStatus(value,today);if(!s)return "";const ar=locale.startsWith("ar");return s.days===0?(ar?"اليوم ذكرى مميزة ♥":"A special day today ♥"):s.days>0?(ar?`باقي ${s.days} يوم${value.repeatsYearly&&s.years>0?` · الذكرى ${s.years}`:""}`:`${s.days} days to go${value.repeatsYearly&&s.years>0?` · Anniversary ${s.years}`:""}`):(ar?`مرّ ${s.elapsedDays} يوم على هذه الذكرى`:`${s.elapsedDays} days since this moment`);}
export function dateOnlyLabel(day:string,locale="ar"){return new Date(`${day}T12:00:00Z`).toLocaleDateString(locale,{timeZone:"UTC",year:"numeric",month:"long",day:"numeric"});}
export function orderedSpecialDates(dates:readonly ImportantDate[]) {return dates.filter(d=>d.specialType&&d.localDate&&validCalendarDate(d.localDate)).slice().sort((a,b)=>a.localDate!.localeCompare(b.localDate!)||a.id.localeCompare(b.id));}
export function validDatePhoto(file:Pick<File,"type"|"size">){return file.size>0&&file.size<=15*1024*1024&&file.type.startsWith("image/");}
