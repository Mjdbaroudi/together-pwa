import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
let failed = false;

const required = [
  "src/components/story/DatePhotoViewer.tsx",
  "src/lib/together/photoFile.ts",
  "src/app/date-photos-v365.css",
  "src/lib/push/reading.ts",
  "src/hooks/usePushReadingState.ts",
  "supabase/migrations/016_v364_chat_push_presence.sql",
  "src/lib/celebration.ts",
  "src/components/story/TodayCelebration.tsx",
  "src/app/celebration-v363.css",
  "src/components/common/StartupLoading.tsx",
  "src/app/loading-v362.css",
  "src/lib/i18n-v36.ts",
  "src/lib/together/datePhotos.ts",
  "src/components/story/DatePhoto.tsx",
  "src/app/dates-v36.css",
  "supabase/migrations/015_v36_date_photos.sql",
  "src/lib/i18n.ts",
  "src/components/i18n/LanguageProvider.tsx",
  "src/components/i18n/LanguageSwitcher.tsx",
  "src/app/language-v35.css",
  "src/components/common/Overlay.tsx",
  "src/components/memories/MemoryUploadDialog.tsx",
  "src/components/story/SpecialDatesSection.tsx",
  "src/components/story/StoryCoverDialog.tsx",
  "src/app/story-v34.css",
  "supabase/migrations/014_v34_story_and_special_dates.sql",
  "src/components/faith/FaithSection.tsx",
  "src/app/faith-v33.css",
  "src/app/api/faith/prayers/route.ts",
  "src/components/common/PresenceLabel.tsx",
  "src/lib/together/presence.ts",
  "src/app/experience-v31.css",
  "src/app/experience-v32.css",
  "src/hooks/useImageGestures.ts",
  "src/lib/together/imageGesture.ts",
  "src/components/calls/VideoCallScreen.tsx",
  "supabase/migrations/012_v31_app_presence.sql",
  "supabase/migrations/013_v311_last_seen_fix.sql",
  "src/app/(app)/home/page.tsx",
  "src/app/(app)/chat/page.tsx",
  "src/app/(app)/memories/page.tsx",
  "src/app/(app)/moments/page.tsx",
  "src/app/(app)/settings/page.tsx",
  "src/app/(app)/calls/page.tsx",
  "src/lib/calls/engine.ts",
  "src/app/api/calls/ice/route.ts",
  "src/app/api/calls/notify/route.ts",
  "supabase/migrations/010_v29_call_journal.sql",
  "src/lib/calls/journal.ts",
  "src/components/chat/CallMessageCard.tsx",
  "src/components/calls/CallDetailsDialog.tsx",
  "supabase/migrations/009_v28_voice_calls.sql",
  "src/app/login/page.tsx",
  "src/app/manifest.ts",
  "src/lib/together/mappers.ts",
  "src/lib/together/contactPreferences.ts",
  "src/components/common/ProfilePhotoViewer.tsx",
  "src/components/common/PartnerContactDialog.tsx",
  "supabase/migrations/008_v27_partner_contacts.sql",
  "src/lib/together/outbox.ts",
  "src/lib/together/media.ts",
  "src/lib/together/messageStore.ts",
  "src/lib/push/server.ts",
  "src/hooks/useAppVisualViewport.ts",
  "src/hooks/useChatAutoScroll.ts",
  "src/components/chat/TypingIndicator.tsx",
  "public/sw.js",
  "public/icons/icon-192.png",
  "public/icons/icon-512.png",
  "supabase/migrations/001_initial.sql",
  "supabase/migrations/002_v15_notifications.sql",
  "supabase/migrations/003_v16_home_story.sql",
  "supabase/migrations/004_v20_chat_pro.sql",
  "supabase/migrations/005_v22_chat_experience.sql",
  "supabase/migrations/006_v23_chat_suite.sql",
  "src/components/chat/ChatToolsPanel.tsx",
  "src/lib/together/draft.ts",
  ".env.example",
  "README.md",
  "START_HERE_AR.md",
];

const forbidden = [
  "src/lib/mock-data.ts",
  "public/app-images",
  "src/lib/supabase/admin.ts",
  "src/app/api/push/subscribe",
];

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) {
    console.error("Missing required project file:", file);
    failed = true;
  }
}
for (const file of forbidden) {
  if (fs.existsSync(path.join(root, file))) {
    console.error("Obsolete or forbidden project artifact remains:", file);
    failed = true;
  }
}

const migrations = [
  ["supabase/migrations/016_v364_chat_push_presence.sql", ["push_chat_sessions", "touch_push_chat", "get_message_push_subscriptions", "enable row level security", "20 seconds", "reload schema"]],
  ["supabase/migrations/012_v31_app_presence.sql", ["read_app_presence", "touch_app_presence", "enable row level security", "supabase_realtime", "75 seconds"]],
  ["supabase/migrations/013_v311_last_seen_fix.sql", ["read_app_presence", "case when p.last_seen is not null", "reload schema"]],
  ["supabase/migrations/011_v30_video_calls.sql", ["start_video_call", "media_kind", "start_media_call", "write_voice_call_message"]],
  ["supabase/migrations/010_v29_call_journal.sql", ["voice_call_message_sync", "call_summary", "voice_call_history", "security invoker", "messages_insert_sender"]],
  ["supabase/migrations/009_v28_voice_calls.sql", ["voice_calls", "voice_call_signals", "enable row level security", "caller_device", "callee_device", "claim_voice_call_push", "supabase_realtime"]],
  ["supabase/migrations/008_v27_partner_contacts.sql", ["partner_contact_preferences", "enable row level security", "owner_id = auth.uid()", "supabase_realtime"]],
  ["supabase/migrations/001_initial.sql", ["enable row level security", "join_couple", "set_message_pin", "is_couple_member", "couple_media_select", "push_subscriptions", "replica identity full"]],
  ["supabase/migrations/002_v15_notifications.sql", ["get_partner_push_subscriptions"]],
  ["supabase/migrations/003_v16_home_story.sql", ["cover_media_path"]],
  ["supabase/migrations/004_v20_chat_pro.sql", ["message_deliveries", "deliveries_select_pair", "replica identity full"]],
  ["supabase/migrations/005_v22_chat_experience.sql", ["message_hides", "hide_message_for_me"]],
  ["supabase/migrations/006_v23_chat_suite.sql", ["message_stars", "message_stars_select_self", "replica identity full"]],
];
for (const [file, phrases] of migrations) {
  const text = fs.readFileSync(path.join(root, file), "utf8").toLowerCase();
  for (const phrase of phrases) {
    if (!text.includes(phrase.toLowerCase())) {
      console.error(`Migration check failed: ${file} is missing ${phrase}`);
      failed = true;
    }
  }
}

const sourceFiles = [];
function walk(directory) {
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name);
    const stat = fs.statSync(file);
    if (stat.isDirectory()) walk(file);
    else if (/\.(ts|tsx|mjs)$/.test(name)) sourceFiles.push(file);
  }
}
walk(path.join(root, "src"));

const allSource = sourceFiles.map(file => fs.readFileSync(file, "utf8")).join("\n");
const secretPatterns = [
  /SUPABASE_SERVICE_ROLE_KEY\s*=\s*["'][^"']+["']/,
  /SUPABASE_SECRET_KEY\s*=\s*["'][^"']+["']/,
  /VAPID_PRIVATE_KEY\s*=\s*["'][A-Za-z0-9_-]{20,}["']/,
];
for (const pattern of secretPatterns) {
  if (pattern.test(allSource)) {
    console.error("Possible hard-coded secret detected:", pattern.toString());
    failed = true;
  }
}

if (/\bany\b/.test(allSource)) {
  console.error("Unnecessary TypeScript `any` remains in source. Use a typed shape or `unknown`.");
  failed = true;
}

for (const phrase of ["starterMessages", "starterMemories", "starterDates", "/app-images/"]) {
  if (allSource.includes(phrase)) {
    console.error("Mock/demo reference remains:", phrase);
    failed = true;
  }
}

const css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
for (const legacy of ["home-v15-", "home-v16-", "nav-heart-v162", "message-more-corner", "message-actions"]) {
  if (css.includes(legacy)) {
    console.error("Legacy CSS remains:", legacy);
    failed = true;
  }
}

const notificationSetup = fs.readFileSync(path.join(root, "scripts/setup-notifications.mjs"), "utf8");
for (const deprecated of ["--value", "--visibility"]) {
  if (notificationSetup.includes(deprecated)) {
    console.error("Deprecated Vercel CLI option remains in notifications setup:", deprecated);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`Together engineering check passed (${sourceFiles.length} typed source files checked).`);
