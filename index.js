/**
 * ============================================================================
 *  GitHub Contribution Graph Filler
 * ============================================================================
 *
 *  Generate backdated commits to fill your GitHub contribution graph with
 *  natural-looking activity, or draw custom patterns (letters / shapes).
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  SETUP
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  1. Install Node.js (v18+ recommended)  →  https://nodejs.org
 *
 *  2. Install dependencies:
 *       npm install
 *
 *  3. Create a NEW, EMPTY repository on GitHub (e.g. "my-contributions").
 *     Do NOT initialise it with a README.
 *
 *  4. Configure the options in the "USER CONFIGURATION" section below.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  USAGE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  Fill the graph with random commits:
 *       node index.js
 *       node index.js --mode fill
 *
 *  Draw a pattern on the graph:
 *       node index.js --mode pattern
 *
 *  After the script finishes, push everything to GitHub:
 *       git remote add origin https://github.com/<you>/<repo>.git
 *       git branch -M main
 *       git push -u origin main
 *
 *  GitHub will pick up the commits within a few minutes and your contribution
 *  graph will update.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 *  IMPORTANT NOTES
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  • The email in your Git config MUST match one of the emails on your GitHub
 *    account, otherwise the commits won't count as yours.
 *    Set it with:  git config user.email "your-github-email@example.com"
 *
 *  • The repository MUST be public (or you must have GitHub Pro for private
 *    repo contributions to appear).
 *
 *  • GitHub's contribution graph shows the last ~52 weeks (1 year).
 *    Only commits within that window will be visible.
 *
 * ============================================================================
 */

const simpleGit = require("simple-git");
const fs = require("fs");
const path = require("path");

// ════════════════════════════════════════════════════════════════════════════
//  USER CONFIGURATION  — edit these values to suit your needs
// ════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // ── Date range for the "fill" mode ──────────────────────────────────────
  START_DATE: "2025-01-01",
  END_DATE: "2025-12-31",

  // ── Commit density ──────────────────────────────────────────────────────
  MIN_COMMITS_PER_DAY: 0, // minimum commits on any given day
  MAX_COMMITS_PER_DAY: 3, // maximum commits on any given day

  // ── File that gets modified to create diffs ─────────────────────────────
  ACTIVITY_FILE: "activity.txt",

  // ── Commit message template  ({n} = commit number, {date} = ISO date) ──
  COMMIT_MESSAGE: "Activity update #{n} on {date}",

  // ── Pattern mode start date (must be a SUNDAY so rows align) ────────────
  //    The grid is 7 rows (Sun–Sat) × N columns (weeks).
  PATTERN_START_DATE: "2025-01-05", // first Sunday of 2025

  // ── Commits per "lit" cell in pattern mode ──────────────────────────────
  PATTERN_COMMITS: 3,
};

// ════════════════════════════════════════════════════════════════════════════
//  PATTERN DEFINITIONS
// ════════════════════════════════════════════════════════════════════════════
//
//  Each pattern is a 7-row array of strings. Each character is one week:
//    "#" = commits on that day   "." = no commits
//
//  The contribution graph has 7 rows (Sunday at the top, Saturday at the
//  bottom). Columns go left-to-right as consecutive weeks.
//
//  Leave a column of dots between letters for spacing.
// ════════════════════════════════════════════════════════════════════════════

const PATTERNS = {
  // ── Individual letters (5 wide + 1 spacer) ─────────────────────────────
  H: [
    "#.#",
    "#.#",
    "#.#",
    "###",
    "#.#",
    "#.#",
    "#.#",
  ],
  I: [
    "###",
    ".#.",
    ".#.",
    ".#.",
    ".#.",
    ".#.",
    "###",
  ],
  HEART: [
    ".#.#.",
    "#####",
    "#####",
    ".###.",
    ".###.",
    "..#..",
    "..#..",
  ],
  SMILE: [
    "..##..",
    ".#..#.",
    "#.##.#",
    "#....#",
    "#.##.#",
    ".#..#.",
    "..##..",
  ],
  // Compose words by combining letters. Example: "HI" →
  HI: null, // built dynamically below
};

/**
 * Combine individual letter patterns into a word, separated by a blank column.
 * @param  {...string[]} letters - Pattern arrays to join
 * @returns {string[]} Combined 7-row pattern
 */
function combinePatterns(...letters) {
  const spacer = [".", ".", ".", ".", ".", ".", "."];
  const parts = [];
  letters.forEach((letter, i) => {
    if (i > 0) parts.push(spacer);
    parts.push(letter);
  });

  // Transpose: each row = concat of corresponding row across all parts
  return Array.from({ length: 7 }, (_, row) =>
    parts.map((p) => p[row]).join("")
  );
}

// Build compound patterns
PATTERNS.HI = combinePatterns(PATTERNS.H, PATTERNS.I);

// ════════════════════════════════════════════════════════════════════════════
//  CORE LOGIC
// ════════════════════════════════════════════════════════════════════════════

const repoDir = process.cwd();
const git = simpleGit(repoDir);

/**
 * Return a random integer between `min` and `max` (inclusive).
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Format a Date object as "YYYY-MM-DD HH:MM:SS" for the --date flag.
 * The time is randomised within working hours to look more organic.
 */
function formatGitDate(date) {
  const hour = randomInt(9, 21);
  const minute = randomInt(0, 59);
  const second = randomInt(0, 59);
  const pad = (n) => String(n).padStart(2, "0");

  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  return `${y}-${m}-${d} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

/**
 * Iterate over every day between two ISO date strings (inclusive).
 * Yields { date: Date, iso: "YYYY-MM-DD" }.
 */
function* dayRange(startISO, endISO) {
  const current = new Date(startISO + "T00:00:00");
  const end = new Date(endISO + "T00:00:00");
  while (current <= end) {
    const iso = current.toISOString().slice(0, 10);
    yield { date: new Date(current), iso };
    current.setDate(current.getDate() + 1);
  }
}

/**
 * Ensure the repository is initialised and has at least one commit.
 */
async function ensureRepo() {
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    console.log("📁  Initialising a new Git repository…");
    await git.init();
  }
}

/**
 * Make a single backdated commit.
 *
 * Both GIT_AUTHOR_DATE and GIT_COMMITTER_DATE are set via environment
 * variables so GitHub credits the commit on the correct day.
 *
 * @param {string} dateStr  - Formatted date string for --date
 * @param {string} message  - Commit message
 */
async function makeCommit(dateStr, message) {
  const filePath = path.join(repoDir, CONFIG.ACTIVITY_FILE);

  // Append a line so Git always sees a diff
  fs.appendFileSync(filePath, `${message}  |  ${dateStr}\n`);

  await git.add(CONFIG.ACTIVITY_FILE);

  // Set both author and committer dates via environment variables.
  // This is the reliable way to ensure GitHub picks the right day.
  await git.env({
    ...process.env,
    GIT_AUTHOR_DATE: dateStr,
    GIT_COMMITTER_DATE: dateStr,
  }).commit(message, [], { "--date": dateStr });
}

// ════════════════════════════════════════════════════════════════════════════
//  MODE: FILL  — random commits across a date range
// ════════════════════════════════════════════════════════════════════════════

async function runFillMode() {
  console.log("🟩  MODE: Fill the contribution graph");
  console.log(`    From ${CONFIG.START_DATE}  →  ${CONFIG.END_DATE}`);
  console.log(
    `    Commits per day: ${CONFIG.MIN_COMMITS_PER_DAY}–${CONFIG.MAX_COMMITS_PER_DAY}\n`
  );

  let totalCommits = 0;
  let totalDays = 0;

  for (const { date, iso } of dayRange(CONFIG.START_DATE, CONFIG.END_DATE)) {
    const numCommits = randomInt(
      CONFIG.MIN_COMMITS_PER_DAY,
      CONFIG.MAX_COMMITS_PER_DAY
    );

    for (let n = 1; n <= numCommits; n++) {
      const dateStr = formatGitDate(date);
      const message = CONFIG.COMMIT_MESSAGE
        .replace("{n}", String(n))
        .replace("{date}", iso);
      await makeCommit(dateStr, message);
      totalCommits++;
    }

    totalDays++;
    if (totalDays % 30 === 0) {
      console.log(`    ✔  Processed ${totalDays} days  (${totalCommits} commits so far)`);
    }
  }

  console.log(`\n✅  Done!  ${totalCommits} commits across ${totalDays} days.`);
}

// ════════════════════════════════════════════════════════════════════════════
//  MODE: PATTERN  — draw shapes / letters on the graph
// ════════════════════════════════════════════════════════════════════════════

async function runPatternMode() {
  // Determine which pattern to use.  Default → "HI"
  const patternName = (process.argv[3] || "HI").toUpperCase();
  const pattern = PATTERNS[patternName];

  if (!pattern) {
    console.error(`❌  Unknown pattern "${patternName}".`);
    console.error(`    Available: ${Object.keys(PATTERNS).join(", ")}`);
    process.exit(1);
  }

  console.log(`🎨  MODE: Draw pattern "${patternName}"`);
  console.log(`    Starting on ${CONFIG.PATTERN_START_DATE}  (must be a Sunday)`);
  console.log(`    Commits per lit cell: ${CONFIG.PATTERN_COMMITS}\n`);

  const numWeeks = pattern[0].length; // columns
  let totalCommits = 0;

  for (let week = 0; week < numWeeks; week++) {
    for (let day = 0; day < 7; day++) {
      const char = pattern[day][week];
      if (char !== "#") continue;

      // Calculate the target date: start + (week * 7) + day
      const target = new Date(CONFIG.PATTERN_START_DATE + "T00:00:00");
      target.setDate(target.getDate() + week * 7 + day);

      for (let n = 0; n < CONFIG.PATTERN_COMMITS; n++) {
        const dateStr = formatGitDate(target);
        const iso = target.toISOString().slice(0, 10);
        const message = `Pattern "${patternName}" commit #${n + 1} on ${iso}`;
        await makeCommit(dateStr, message);
        totalCommits++;
      }
    }
  }

  console.log(`\n✅  Done!  ${totalCommits} pattern commits created.`);
}

// ════════════════════════════════════════════════════════════════════════════
//  ENTRY POINT
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("═".repeat(60));
  console.log("  GitHub Contribution Graph Filler");
  console.log("═".repeat(60) + "\n");

  await ensureRepo();

  // Parse --mode argument (defaults to "fill")
  const modeFlag = process.argv.find((a) => a.startsWith("--mode"));
  const modeArg = process.argv[process.argv.indexOf("--mode") + 1];
  const mode = modeFlag ? (modeArg || "fill").toLowerCase() : "fill";

  switch (mode) {
    case "fill":
      await runFillMode();
      break;
    case "pattern":
      await runPatternMode();
      break;
    default:
      console.error(`❌  Unknown mode "${mode}". Use "fill" or "pattern".`);
      process.exit(1);
  }

  console.log("\n📌  Next steps:");
  console.log("    git remote add origin https://github.com/<you>/<repo>.git");
  console.log("    git branch -M main");
  console.log("    git push -u origin main\n");
}

main().catch((err) => {
  console.error("💥  Fatal error:", err);
  process.exit(1);
});
