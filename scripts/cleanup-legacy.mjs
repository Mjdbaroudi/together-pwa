import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const legacyPaths = [
  ".next",
  "src/app/api/push/subscribe",
  "src/lib/supabase/admin.ts",
  "tsconfig.tsbuildinfo",
  "PUSH_AUTH_FIX_V1.5.2_AR.md",
  "PUSH_DIAGNOSTICS_V1.5.1_AR.md",
  "PUSH_FOREGROUND_FIX_V1.5.5_AR.md",
  "PUSH_FOREGROUND_FIX_V1.5.6_AR.md",
  "PUSH_ROUTE_DIAGNOSTICS_V1.5.3_AR.md",
  "PUSH_VAPID_FIX_V1.5.4_AR.md",
  "CHAT_ACTIONS_V1.9.1_AR.md",
  "CHAT_ANDROID_PERFORMANCE_V1.9.3_AR.md",
  "CHAT_ENGINE_V1.9_AR.md",
  "CHAT_KEYBOARD_V1.9.2_AR.md",
  "ENGINEERING_FIX_V1.8.1_AR.md",
  "PATCH_README_AR.md",
  "CHAT_PRO_V2_AR.md",
  "CHAT_PRO_V2.0.1_FIX_AR.md",
  "UI_V1.2_CHANGELOG_AR.md",
  "UI_V1.3_FIXES_AR.md",
  "UI_V1.4_CHAT_PRO_AR.md",
  "UI_V1.5_FUNCTIONAL_AR.md",
  "UI_V1.6_HOME_PREMIUM_AR.md",
  "UI_V1.7_SMART_HOME_AR.md",
  "UPDATE_WORKFLOW_AR.md",
  "CHAT_DELETE_REACTIONS_V2.2.5_AR.md",
  "CHAT_DELETE_REACTIONS_V2.2.6_AR.md",
  "CHAT_EXPERIENCE_V2.2_AR.md",
  "CHAT_HISTORY_V2.2.3_AR.md",
  "CHAT_PERFORMANCE_V2.1_AR.md",
  "CHAT_RELOAD_V2.2.4_AR.md",
  "CHAT_STABILITY_V2.2.1_AR.md",
  "PROFILE_PHOTOS_V2.2.7_AR.md",
];

let removed = 0;
for (const relative of legacyPaths) {
  const target = path.join(root, relative);
  if (!fs.existsSync(target)) continue;
  fs.rmSync(target, { recursive: true, force: true });
  removed += 1;
  console.log(`Removed legacy: ${relative}`);
}

console.log(removed ? `Legacy cleanup complete (${removed} item${removed === 1 ? "" : "s"} removed).` : "Legacy cleanup: nothing obsolete found.");
