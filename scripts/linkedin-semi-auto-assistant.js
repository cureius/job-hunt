#!/usr/bin/env node

/**
 * LinkedIn semi-automated job application helper (human-in-the-loop).
 *
 * IMPORTANT:
 * - This script never clicks final submit.
 * - It pauses for manual review before submission.
 * - Use responsibly and follow LinkedIn Terms of Service.
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline");
const { chromium } = require("playwright");

// Speed controls (env-only, tune without code changes)
const DELAY_SCALE = Number(process.env.DELAY_SCALE || 1);
const ELEMENT_TIMEOUT_MS = Number(process.env.ELEMENT_TIMEOUT_MS || 100);
const NETWORKIDLE_TIMEOUT_MS = Number(process.env.NETWORKIDLE_TIMEOUT_MS || 1500);

const CONFIG = {
  jobTitle: process.env.JOB_TITLE || "React Native Software Developer Engineer Frontend Backend Fullstack Easy Apply",
  location: process.env.JOB_LOCATION || "pune",
  phoneNumber: process.env.PHONE_NUMBER || "",
  email: process.env.EMAIL || "",
  resumeFilePath: process.env.RESUME_FILE_PATH || "",
  maxApplicationsPerRun: Number(process.env.MAX_APPLICATIONS_PER_RUN || 10),
  authFilePath: process.env.AUTH_FILE_PATH || "auth.json",
  // Persist login across runs (log in once, reuse session).
  // Set USER_DATA_DIR="" to disable and rely on auth.json storageState only.
  userDataDir: process.env.USER_DATA_DIR ?? ".pw-user-data",
  // Use real Chrome to reduce "browser not secure" issues.
  browserChannel: process.env.BROWSER_CHANNEL || "chrome",
  visitedJobsFilePath: process.env.VISITED_JOBS_FILE_PATH || "visited-jobs.json",
  outputCsvPath:
    process.env.OUTPUT_CSV_PATH ||
    `prepared-applications-${new Date().toISOString().slice(0, 10)}.csv`,
  browserSlowMo: Number(process.env.BROWSER_SLOW_MO || 500),
  stepDelayMs: Number(process.env.STEP_DELAY_MS || 500),
  keepBrowserOpen: process.env.KEEP_BROWSER_OPEN !== "false",
  // Safety: only submit when explicitly enabled.
  autoSubmit: String(process.env.AUTO_SUBMIT || "").toLowerCase() === "true",
  easyApplyOnly: process.env.EASY_APPLY_ONLY !== "false",
  answersFilePath: process.env.ANSWERS_FILE_PATH || "answers-memory.json",
  workerId: process.env.WORKER_ID || "default-worker",
  remoteConfigUrl: process.env.REMOTE_CONFIG_URL || "",
  remoteResultsUrl: process.env.REMOTE_RESULTS_URL || "",
};

const LINKEDIN_JOBS_URL = "https://www.linkedin.com/jobs/";
const LINKEDIN_JOBS_SEARCH_URL = "https://www.linkedin.com/jobs/search/";
const LINKEDIN_RECOMMENDED_COLLECTION_URL =
  "https://www.linkedin.com/jobs/collections/recommended/";

function randomBetween(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

async function randomDelay(minMs = 100, maxMs = 1000) {
  const scale = Number.isFinite(DELAY_SCALE) && DELAY_SCALE > 0 ? DELAY_SCALE : 1;
  const scaledMin = Math.max(0, Math.floor(minMs * scale));
  const scaledMax = Math.max(scaledMin, Math.floor(maxMs * scale));
  const ms = randomBetween(scaledMin, scaledMax);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForEnter(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(promptText, () => {
      rl.close();
      resolve();
    });
  });
}

function sanitizeConfig(candidate) {
  const merged = { ...CONFIG, ...candidate };
  return {
    ...merged,
    maxApplicationsPerRun: Number(merged.maxApplicationsPerRun || 10),
    browserSlowMo: Number(merged.browserSlowMo || 500),
    stepDelayMs: Number(merged.stepDelayMs || 500),
    keepBrowserOpen: merged.keepBrowserOpen !== false,
    autoSubmit:
      merged.autoSubmit === true || String(merged.autoSubmit || "").toLowerCase() === "true",
    easyApplyOnly: merged.easyApplyOnly !== false,
    userDataDir: merged.userDataDir ?? ".pw-user-data",
    browserChannel: merged.browserChannel || "chrome",
  };
}

async function announceStep(message, stepDelayMs) {
  console.log(`\n[step] ${message}`);
  await randomDelay(Math.max(250, stepDelayMs), Math.max(350, stepDelayMs + 450));
}

async function loadRemoteConfigIfProvided(baseConfig) {
  if (!baseConfig.remoteConfigUrl) return baseConfig;

  const url = new URL(baseConfig.remoteConfigUrl);
  url.searchParams.set("workerId", baseConfig.workerId);
  console.log(`[info] Fetching remote config: ${url.toString()}`);

  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `Remote config fetch failed (${response.status} ${response.statusText})`
    );
  }

  const payload = await response.json();
  if (!payload || typeof payload !== "object" || !payload.config) {
    throw new Error("Remote config response missing `config` object");
  }
  return sanitizeConfig(payload.config);
}

async function postRunReport(config, runRows, preparedRows) {
  if (!config.remoteResultsUrl) return;

  const payload = {
    timestamp: new Date().toISOString(),
    workerId: config.workerId,
    summary: {
      processed: runRows.length,
      prepared: preparedRows.length,
      skipped: runRows.filter((r) => r.status === "skipped").length,
      errors: runRows.filter((r) => r.status === "error").length,
    },
    preparedRows,
    runRows,
  };

  try {
    const response = await fetch(config.remoteResultsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.warn(
        `[warn] Remote results POST failed (${response.status} ${response.statusText})`
      );
      return;
    }
    console.log("[info] Remote results posted successfully.");
  } catch (error) {
    console.warn(`[warn] Could not post remote results: ${error.message}`);
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath, fallbackValue) {
  if (!(await fileExists(filePath))) return fallbackValue;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (!raw.trim()) return fallbackValue;
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function canonicalizeQuestionText(text) {
  // Intentionally conservative: normalize common variations without
  // destroying technical keywords (e.g. "Typescript", "OAuth").
  let s = String(text || "");
  s = s.replace(/\[[^\]]*\]/g, " "); // drop bracketed tech tags: [Typescript]
  s = s.replace(/\(choose one:[^)]*\)/gi, " "); // drop option preview
  s = s.replace(/[*:]+/g, " "); // drop "required" markers like "*"
  s = s.replace(/[’'"]/g, " "); // normalize apostrophes/quotes
  s = s.toLowerCase();

  // Normalize common HR question synonyms.
  s = s.replace(/\bcompensation\b/g, "ctc");
  s = s.replace(/\bsalary\b/g, "ctc");
  s = s.replace(/\bpackage\b/g, "ctc");
  s = s.replace(/\bexpectation\b/g, "expected");
  s = s.replace(/\bnotice\s*period\b/g, "notice period");

  // Remove filler words that cause key churn.
  s = s.replace(/\bplease\b/g, " ");
  s = s.replace(/\bconfirm\b/g, " ");
  s = s.replace(/\byour\b/g, " ");
  s = s.replace(/\bcurrently\b/g, " ");

  s = s.replace(/[^a-z0-9]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s.slice(0, 200);
}

function toQuestionKey(text) {
  return canonicalizeQuestionText(text).slice(0, 120);
}

function tokenizeKey(key) {
  return String(key || "")
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function findBestSavedAnswer(answers, desiredKey) {
  const desiredTokens = new Set(tokenizeKey(desiredKey));
  if (desiredTokens.size === 0) return "";

  let bestKey = "";
  let bestScore = 0;

  for (const existingKey of Object.keys(answers || {})) {
    const existingTokens = new Set(tokenizeKey(existingKey));
    if (existingTokens.size === 0) continue;

    let intersection = 0;
    for (const t of desiredTokens) {
      if (existingTokens.has(t)) intersection += 1;
    }
    const union = desiredTokens.size + existingTokens.size - intersection;
    const score = union === 0 ? 0 : intersection / union;

    if (score > bestScore) {
      bestScore = score;
      bestKey = existingKey;
    }
  }

  // Threshold chosen to catch small wording changes but avoid wrong matches.
  if (bestScore >= 0.72 && bestKey) return String(answers[bestKey] ?? "");
  return "";
}

function normalizeYesNo(value, fallback = "yes") {
  const text = String(value || "").trim().toLowerCase();
  if (["y", "yes", "true", "1"].includes(text)) return "yes";
  if (["n", "no", "false", "0"].includes(text)) return "no";
  return fallback;
}

function askForTextInput(promptText, defaultValue = "") {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const suffix = defaultValue ? ` (default: ${defaultValue})` : "";
    rl.question(`${promptText}${suffix}: `, (answer) => {
      rl.close();
      const finalValue = String(answer || "").trim() || String(defaultValue || "").trim();
      resolve(finalValue);
    });
  });
}

function escapeRegExp(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getOrAskAnswer(answers, answersPath, questionLabel, defaultValue = "") {
  const key = toQuestionKey(questionLabel);
  if (!key) return defaultValue;
  if (answers[key]) return String(answers[key]);

  // Fuzzy fallback: reuse existing answers even if wording changed slightly.
  const fuzzy = findBestSavedAnswer(answers, key);
  if (fuzzy) {
    // Save alias so next time it's an exact match.
    answers[key] = fuzzy;
    await writeJsonFile(answersPath, answers);
    return String(fuzzy);
  }

  const answer = await askForTextInput(`Input needed for "${questionLabel}"`, defaultValue);
  if (answer) {
    answers[key] = answer;
    await writeJsonFile(answersPath, answers);
  }
  return answer;
}

async function getOrAskAnswerKeyed(
  answers,
  answersPath,
  keyLabel,
  promptLabel,
  defaultValue = ""
) {
  const key = toQuestionKey(keyLabel);
  if (!key) return defaultValue;
  if (answers[key]) return String(answers[key]);

  const fuzzy = findBestSavedAnswer(answers, key);
  if (fuzzy) {
    answers[key] = fuzzy;
    await writeJsonFile(answersPath, answers);
    return String(fuzzy);
  }

  const answer = await askForTextInput(`Input needed for "${promptLabel}"`, defaultValue);
  if (answer) {
    answers[key] = answer;
    await writeJsonFile(answersPath, answers);
  }
  return answer;
}

async function readVisitedJobs(filePath) {
  if (!(await fileExists(filePath))) {
    return new Set();
  }

  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (!raw.trim()) return new Set();
    const parsed = JSON.parse(raw);
    const urls = Array.isArray(parsed.urls) ? parsed.urls : [];
    return new Set(urls);
  } catch (error) {
    console.warn(
      `[warn] Could not parse ${filePath}. Starting with empty visited list. ${error.message}`
    );
    return new Set();
  }
}

async function writeVisitedJobs(filePath, visitedSet) {
  const payload = {
    updatedAt: new Date().toISOString(),
    urls: Array.from(visitedSet),
  };
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function toCsvValue(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

async function writePreparedCsv(filePath, preparedRows) {
  const headers = ["timestamp", "jobTitle", "companyName", "jobUrl", "status"];
  const lines = [headers.join(",")];

  for (const row of preparedRows) {
    lines.push(
      [
        row.timestamp,
        row.jobTitle,
        row.companyName,
        row.jobUrl,
        row.status,
      ]
        .map(toCsvValue)
        .join(",")
    );
  }

  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

function normalizeLinkedInJobUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

async function getFirstNonEmptyText(locators) {
  for (const locator of locators) {
    try {
      const count = await locator.count();
      if (count === 0) continue;
      const text = (await locator.first().innerText()).trim();
      if (text) return text;
    } catch {
      // Keep trying other locators.
    }
  }
  return "";
}

async function collectJobLinksFromList(page, easyApplyOnly = false) {
  const urls = await page.$$eval(
    'a[href*="/jobs/view/"], a[href*="currentJobId="]',
    (anchors, easyApplyOnlyInner) => {
    const unique = new Set();
    for (const a of anchors) {
      const href = a.getAttribute("href");
      if (!href) continue;
      if (easyApplyOnlyInner) {
        const container = a.closest("li") || a.closest('[data-occludable-job-id]') || a.closest("div");
        const containerText = container ? (container.innerText || "") : "";
        const hasEasyApplyText = /easy apply/i.test(containerText);
        const hasEasyApplyAria =
          container &&
          container.querySelector &&
          container.querySelector('[aria-label*="Easy Apply"], [aria-label*="easy apply"]');
        if (!hasEasyApplyText && !hasEasyApplyAria) continue;
      }
      try {
        const absolute = new URL(href, globalThis.location.origin).toString();
        if (absolute.includes("/jobs/view/")) {
          unique.add(absolute);
          continue;
        }

        // LinkedIn "recommended" collections often link like:
        // /jobs/collections/recommended/?currentJobId=123...
        const parsed = new URL(absolute);
        const currentJobId = parsed.searchParams.get("currentJobId");
        if (currentJobId && /^\d+$/.test(currentJobId)) {
          unique.add(`${parsed.origin}/jobs/view/${currentJobId}/`);
        }
      } catch {
        // ignore invalid urls
      }
    }
    return Array.from(unique);
  }
  , easyApplyOnly);

  return urls.map(normalizeLinkedInJobUrl);
}

function buildJobsSearchUrl(config) {
  const url = new URL(LINKEDIN_JOBS_SEARCH_URL);
  if (config.jobTitle) url.searchParams.set("keywords", config.jobTitle);
  if (config.location) url.searchParams.set("location", config.location);
  // LinkedIn filter: Easy Apply only.
  // This keeps the run focused on listings that can be applied to in-modal.
  if (config.easyApplyOnly) url.searchParams.set("f_AL", "true");
  return url.toString();
}

function extractLinkedInJobId(jobUrl) {
  const m = String(jobUrl || "").match(/\/jobs\/view\/(\d+)/i);
  return m ? m[1] : "";
}

async function openJobFromRecommendedList(page, jobUrl) {
  const jobId = extractLinkedInJobId(jobUrl);
  if (!jobId) {
    await page.goto(jobUrl, { waitUntil: "domcontentloaded" });
    return;
  }

  const cardCandidates = [
    page.locator(`a[href*="/jobs/view/${jobId}"]`).first(),
    page.locator(`[data-occludable-job-id="${jobId}"]`).first(),
    page.locator(`li:has(a[href*="/jobs/view/${jobId}"])`).first(),
  ];

  for (const card of cardCandidates) {
    try {
      if ((await card.count()) === 0) continue;
      await card.scrollIntoViewIfNeeded().catch(() => {});
      await card.click({ timeout: Math.max(2000, ELEMENT_TIMEOUT_MS) });
      await randomDelay(500, 1200);
      return;
    } catch {
      // try next candidate
    }
  }

  // Fallback if card click fails for this job on the current page.
  await page.goto(jobUrl, { waitUntil: "domcontentloaded" });
}

async function goToNextRecommendedPage(page) {
  const nextCandidates = [
    page.locator('button[aria-label*="Next"]').first(),
    page.getByRole("button", { name: /next/i }).first(),
    page.locator('.jobs-search-pagination button[aria-label*="Page"]').last(),
  ];

  for (const btn of nextCandidates) {
    try {
      if ((await btn.count()) === 0) continue;
      const visible = await btn.isVisible().catch(() => false);
      if (!visible) continue;
      const disabled = await btn.isDisabled().catch(() => false);
      if (disabled) continue;
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.click({ timeout: Math.max(2000, ELEMENT_TIMEOUT_MS) });
      await randomDelay(1200, 2200);
      return true;
    } catch {
      // try next candidate
    }
  }
  return false;
}

async function findEasyApplyButton(page) {
  // LinkedIn often labels the button as "Apply" while showing an "Easy Apply" badge elsewhere.
  // Strategy:
  // 1) Prefer an explicit "Easy Apply" button/aria label.
  // 1b) Sometimes it's a link: "Easy Apply to this job".
  // 2) If the page shows an "Easy Apply" badge, fall back to the primary apply button.

  const explicitEasyApplyLinkCandidates = [
    page.getByRole("link", { name: /easy apply to this job/i }),
    page.locator('a[aria-label*="Easy Apply"]'),
    page.locator('a:has-text("Easy Apply to this job")'),
  ];

  for (const locator of explicitEasyApplyLinkCandidates) {
    try {
      const link = locator.first();
      await link.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT_MS });
      return link;
    } catch {
      // try next
    }
  }

  const explicitCandidates = [
    page.getByRole("button", { name: /easy apply/i }),
    page.locator('button[aria-label*="Easy Apply"]'),
    page.locator('button.jobs-apply-button:has-text("Easy Apply")'),
    page.locator('button.jobs-apply-button[aria-label*="Easy Apply"]'),
    page.locator('button[data-control-name*="jobdetails_topcard_inapply"]'),
    page.locator('button[data-control-name*="jobdetails_topcard_apply"]'),
  ];

  for (const locator of explicitCandidates) {
    try {
      const button = locator.first();
      await button.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT_MS });
      return button;
    } catch {
      // try next
    }
  }

  const easyApplyBadgeCandidates = [
    page.locator(".jobs-unified-top-card__apply-type:has-text(/easy apply/i)"),
    page.locator('.jobs-unified-top-card__job-insight:has-text("Easy Apply")'),
    page.locator('[class*="apply-type"]:has-text("Easy Apply")'),
    page.locator('span:has-text("Easy Apply")'),
    page.locator("text=/\\bEasy Apply\\b/i"),
  ];

  let hasEasyApplyBadge = false;
  for (const locator of easyApplyBadgeCandidates) {
    try {
      if ((await locator.count()) > 0) {
        hasEasyApplyBadge = true;
        break;
      }
    } catch {
      // ignore
    }
  }

  if (!hasEasyApplyBadge) return null;

  const fallbackApplyCandidates = [
    page.locator("button.jobs-apply-button"),
    page.getByRole("button", { name: /^apply$/i }),
    page.getByRole("button", { name: /apply/i }),
  ];

  for (const locator of fallbackApplyCandidates) {
    try {
      const button = locator.first();
      await button.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT_MS });
      // Make sure it's actually clickable.
      const enabled = await button.isEnabled().catch(() => false);
      if (!enabled) continue;
      return button;
    } catch {
      // try next
    }
  }

  return null;
}

async function logApplyDiagnostics(page) {
  try {
    const url = page.url();
    const title = await page.title().catch(() => "");
    const hasJobsApply = (await page.locator("button.jobs-apply-button").count().catch(() => 0)) > 0;
    const hasEasyApplyText =
      (await page.locator("text=/\\bEasy Apply\\b/i").count().catch(() => 0)) > 0;
    console.log(
      `[debug] apply-diagnostics url=${url} title=${JSON.stringify(
        title
      )} jobsApplyButton=${hasJobsApply} easyApplyText=${hasEasyApplyText}`
    );
  } catch {
    // ignore diagnostics failures
  }
}

async function closeEasyApplyModalIfOpen(page) {
  const closeSelectors = [
    page.locator('button[aria-label="Dismiss"]'),
    page.locator('button[aria-label*="Discard"]'),
    page.getByRole("button", { name: /dismiss/i }),
    page.getByRole("button", { name: /cancel/i }),
    page.getByRole("button", { name: /close/i }),
  ];

  for (const locator of closeSelectors) {
    if ((await locator.count()) > 0) {
      try {
        await locator.first().click({ timeout: 1500 });
        await randomDelay(400, 900);
      } catch {
        // try next closer
      }
    }
  }

  const discardButtons = [
    page.getByRole("button", { name: /discard/i }),
    page.getByRole("button", { name: /exit/i }),
  ];

  for (const locator of discardButtons) {
    if ((await locator.count()) > 0) {
      try {
        await locator.first().click({ timeout: 1500 });
        await randomDelay(300, 700);
      } catch {
        // ignore
      }
    }
  }
}

async function fillCommonFieldsInEasyApplyModal(page, config) {
  const modal = page.locator('[role="dialog"]');
  if ((await modal.count()) === 0) {
    return;
  }

  if (config.phoneNumber) {
    const phoneFieldCandidates = [
      modal.getByLabel(/phone/i),
      modal.locator('input[id*="phone"], input[name*="phone"]'),
      modal.locator('input[type="tel"]'),
    ];

    for (const field of phoneFieldCandidates) {
      if ((await field.count()) === 0) continue;
      const input = field.first();
      const disabled = await input.isDisabled().catch(() => true);
      const editable = !disabled;
      if (!editable) continue;
      try {
        await input.fill(config.phoneNumber);
        await randomDelay(300, 800);
        break;
      } catch {
        // try next candidate
      }
    }
  }

  const emailFieldCandidates = [
    modal.getByLabel(/email/i),
    modal.locator('input[type="email"]'),
    modal.locator('input[id*="email"], input[name*="email"]'),
  ];

  for (const field of emailFieldCandidates) {
    if ((await field.count()) === 0) continue;
    const input = field.first();
    const disabled = await input.isDisabled().catch(() => true);
    const readOnlyAttr = await input.getAttribute("readonly");
    if (disabled || readOnlyAttr !== null) continue;

    // Email is filled only if provided and field is editable.
    const configuredEmail = config.email || "";
    if (!configuredEmail) break;

    try {
      await input.fill(configuredEmail);
      await randomDelay(300, 800);
    } catch {
      // ignore failure, continue safely
    }
    break;
  }

  if (config.resumeFilePath) {
    const absoluteResumePath = path.resolve(config.resumeFilePath);
    const exists = await fileExists(absoluteResumePath);
    if (exists) {
      const fileInput = modal.locator('input[type="file"]');
      if ((await fileInput.count()) > 0) {
        try {
          await fileInput.first().setInputFiles(absoluteResumePath);
          await randomDelay(600, 1200);
        } catch (error) {
          console.warn(
            `[warn] Resume upload failed (${absoluteResumePath}): ${error.message}`
          );
        }
      }
    } else {
      console.warn(
        `[warn] Resume path not found, skipping upload: ${absoluteResumePath}`
      );
    }
  }
}

async function getLabelForInput(modal, inputLocator) {
  try {
    const inputId = await inputLocator.getAttribute("id");
    if (inputId) {
      const label = modal.locator(`label[for="${inputId}"]`).first();
      if ((await label.count()) > 0) {
        const text = (await label.innerText()).trim();
        if (text) return text;
      }
    }
  } catch {
    // keep trying fallbacks
  }
  try {
    const ariaLabel = await inputLocator.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
  } catch {
    // ignore
  }
  return "";
}

async function getQuestionLabelForWidget(modal, widgetLocator) {
  const byLabel = (await getLabelForInput(modal, widgetLocator)) || "";
  if (byLabel) return byLabel;

  // Try closest label/fieldset/legend context.
  try {
    const closestLabel = widgetLocator.locator("xpath=ancestor::label[1]").first();
    if ((await closestLabel.count()) > 0) {
      const text = (await closestLabel.innerText().catch(() => "")).trim();
      if (text) return text;
    }
  } catch {
    // ignore
  }

  try {
    const fieldset = widgetLocator.locator("xpath=ancestor::fieldset[1]").first();
    if ((await fieldset.count()) > 0) {
      const legend = fieldset.locator("legend").first();
      const text = (await legend.innerText().catch(() => "")).trim();
      if (text) return text;
    }
  } catch {
    // ignore
  }

  // Fallbacks.
  const ariaLabel =
    (await widgetLocator.getAttribute("aria-label").catch(() => "")) || "";
  if (ariaLabel.trim()) return ariaLabel.trim();

  const placeholder =
    (await widgetLocator.getAttribute("placeholder").catch(() => "")) || "";
  if (placeholder.trim()) return placeholder.trim();

  return "";
}

function looksLikePlaceholder(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return true;
  return /^(select|choose|pick|search|enter)\b/.test(t);
}

async function autofillTextInputsInModal(page, config, answers, answersPath) {
  const modal = page.locator('[role="dialog"]');
  const inputs = modal.locator('input[type="text"], input[type="number"], textarea');
  const count = await inputs.count();
  for (let i = 0; i < count; i += 1) {
    const input = inputs.nth(i);
    const visible = await input.isVisible().catch(() => false);
    if (!visible) continue;
    const disabled = await input.isDisabled().catch(() => true);
    const readOnlyAttr = await input.getAttribute("readonly").catch(() => null);
    if (disabled || readOnlyAttr !== null) continue;

    const value = (await input.inputValue().catch(() => "")).trim();
    if (value) continue;

    const labelText = (await getLabelForInput(modal, input)) || "Required field";
    const lower = labelText.toLowerCase();
    if (lower.includes("phone")) {
      if (config.phoneNumber) await input.fill(config.phoneNumber);
      continue;
    }
    if (lower.includes("email")) {
      if (config.email) await input.fill(config.email);
      continue;
    }

    let defaultAnswer = "";
    if (lower.includes("how many years")) defaultAnswer = "4";
    const answer = await getOrAskAnswer(answers, answersPath, labelText, defaultAnswer);
    if (!answer) continue;
    await input.fill(answer);
    await randomDelay(200, 500);
  }
}

async function autofillYesNoQuestionsInModal(page, answers, answersPath) {
  const modal = page.locator('[role="dialog"]');
  const fieldsets = modal.locator("fieldset");
  const count = await fieldsets.count();
  for (let i = 0; i < count; i += 1) {
    const fieldset = fieldsets.nth(i);
    const visible = await fieldset.isVisible().catch(() => false);
    if (!visible) continue;

    const checkedCount = await fieldset
      .locator('input[type="radio"]:checked')
      .count()
      .catch(() => 0);
    if (checkedCount > 0) continue;

    const legendText = (
      (await fieldset.locator("legend").first().innerText().catch(() => "")) || ""
    ).trim();
    if (!legendText) continue;

    const yesOption = fieldset.getByRole("radio", { name: /^yes$/i }).first();
    const noOption = fieldset.getByRole("radio", { name: /^no$/i }).first();
    const hasYes = (await yesOption.count().catch(() => 0)) > 0;
    const hasNo = (await noOption.count().catch(() => 0)) > 0;
    if (!hasYes && !hasNo) continue;

    const answerRaw = await getOrAskAnswer(answers, answersPath, legendText, "yes");
    const answer = normalizeYesNo(answerRaw, "yes");
    if (answer === "no" && hasNo) {
      await noOption.check({ force: true });
    } else if (hasYes) {
      await yesOption.check({ force: true });
    } else if (hasNo) {
      await noOption.check({ force: true });
    }
    await randomDelay(200, 500);
  }
}

async function autofillSelectsInModal(page, answers, answersPath) {
  const modal = page.locator('[role="dialog"]');
  const selects = modal.locator("select");
  const count = await selects.count();
  for (let i = 0; i < count; i += 1) {
    const select = selects.nth(i);
    const visible = await select.isVisible().catch(() => false);
    if (!visible) continue;
    const disabled = await select.isDisabled().catch(() => true);
    if (disabled) continue;

    // Treat placeholder-like selections as "empty" so we prompt.
    const selectedLabel = (
      (await select.locator("option:checked").first().innerText().catch(() => "")) || ""
    ).trim();
    if (selectedLabel && !looksLikePlaceholder(selectedLabel)) continue;

    const labelText = (await getQuestionLabelForWidget(modal, select)) || "Select field";
    const options = await select
      .locator("option")
      .allInnerTexts()
      .catch(() => []);
    const cleaned = options.map((o) => String(o || "").trim()).filter(Boolean);
    const sample = cleaned.slice(0, 8).join(" | ");
    const defaultOption = cleaned.find((o) => !/select/i.test(o)) || cleaned[0] || "";

    const promptLabel = `${labelText} (choose one: ${sample}${cleaned.length > 8 ? " | ..." : ""})`;
    const answer = await getOrAskAnswerKeyed(
      answers,
      answersPath,
      labelText,
      promptLabel,
      defaultOption
    );
    if (!answer) continue;

    // Prefer selecting by label text if possible.
    try {
      await select.selectOption({ label: answer });
    } catch {
      // Fallback to selecting by exact value if user provided it.
      try {
        await select.selectOption({ value: answer });
      } catch {
        // Last resort: try partial match by label.
        const match = cleaned.find((o) => o.toLowerCase().includes(String(answer).toLowerCase()));
        if (match) {
          await select.selectOption({ label: match }).catch(() => {});
        }
      }
    }
    await randomDelay(250, 600);
  }
}

async function selectComboboxOption(page, combobox, optionText) {
  // Clicking a combobox typically opens a listbox elsewhere in the DOM.
  await combobox.click({ timeout: ELEMENT_TIMEOUT_MS });
  await randomDelay(200, 500);

  const listbox = page.locator('[role="listbox"]').first();
  const listboxVisible = await listbox
    .waitFor({ state: "visible", timeout: Math.max(1200, Math.floor(ELEMENT_TIMEOUT_MS / 2)) })
    .then(() => true)
    .catch(() => false);

  // Some LinkedIn dropdowns require typing to populate options.
  if (!listboxVisible) {
    const tag = (await combobox.evaluate((el) => el.tagName).catch(() => "")).toLowerCase();
    if (tag === "input" || tag === "textarea") {
      await combobox.fill(String(optionText));
      await randomDelay(200, 500);
    } else {
      await page.keyboard.type(String(optionText)).catch(() => {});
      await randomDelay(200, 500);
    }
  }

  await listbox.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT_MS });

  const option = listbox
    .getByRole("option", { name: new RegExp(`^${escapeRegExp(optionText)}$`, "i") })
    .first();

  if ((await option.count().catch(() => 0)) > 0) {
    await option.click({ timeout: ELEMENT_TIMEOUT_MS });
    await randomDelay(250, 600);
    return true;
  }

  // Fallback: try a contains match.
  const contains = listbox
    .getByRole("option", { name: new RegExp(escapeRegExp(optionText), "i") })
    .first();
  if ((await contains.count().catch(() => 0)) > 0) {
    await contains.click({ timeout: ELEMENT_TIMEOUT_MS });
    await randomDelay(250, 600);
    return true;
  }

  // Try to close the listbox if nothing matched.
  await page.keyboard.press("Escape").catch(() => {});
  return false;
}

async function autofillComboboxesInModal(page, answers, answersPath) {
  const modal = page.locator('[role="dialog"]');

  // LinkedIn often renders dropdowns as combobox/listbox widgets (not <select>).
  const comboboxes = modal.locator(
    '[role="combobox"], input[role="combobox"], input[aria-autocomplete="list"], [aria-haspopup="listbox"]'
  );
  const count = await comboboxes.count();

  for (let i = 0; i < count; i += 1) {
    const combo = comboboxes.nth(i);
    const visible = await combo.isVisible().catch(() => false);
    if (!visible) continue;
    const disabled = await combo.isDisabled().catch(() => true);
    if (disabled) continue;

    // Skip if already has a value.
    const tag = (await combo.evaluate((el) => el.tagName).catch(() => "")).toLowerCase();
    if (tag === "input" || tag === "textarea") {
      const currentValue = (await combo.inputValue().catch(() => "")).trim();
      const placeholder =
        (await combo.getAttribute("placeholder").catch(() => "")) ||
        (await combo.getAttribute("aria-placeholder").catch(() => "")) ||
        "";
      if (currentValue && !looksLikePlaceholder(currentValue)) continue;
      if (!currentValue && placeholder && looksLikePlaceholder(placeholder)) {
        // still empty, proceed
      }
    } else {
      const text = (await combo.innerText().catch(() => "")).trim();
      // If it looks like a chosen value (not placeholder), treat as already set.
      if (text && !looksLikePlaceholder(text)) continue;
    }

    const labelText =
      (await getQuestionLabelForWidget(modal, combo)) || `Dropdown field ${i + 1}`;
    const answer = await getOrAskAnswerKeyed(
      answers,
      answersPath,
      labelText,
      labelText,
      ""
    );
    if (!answer) continue;

    // Attempt to select the requested option from the listbox.
    const ok = await selectComboboxOption(page, combo, answer);
    if (!ok) {
      console.warn(`[warn] Could not select "${answer}" for "${labelText}"`);
    }
  }
}

async function completeEasyApplyFlow(page, config, answers, answersPath) {
  const modal = page.locator('[role="dialog"]');
  let didSubmit = false;

  for (let step = 0; step < 8; step += 1) {
    if ((await modal.count()) === 0) break;
    await fillCommonFieldsInEasyApplyModal(page, config);
    await autofillTextInputsInModal(page, config, answers, answersPath);
    await autofillYesNoQuestionsInModal(page, answers, answersPath);
    await autofillSelectsInModal(page, answers, answersPath);
    await autofillComboboxesInModal(page, answers, answersPath);

    const submitButton = modal.getByRole("button", { name: /submit application/i }).first();
    if ((await submitButton.count()) > 0) {
      const enabled = await submitButton.isEnabled().catch(() => false);
      if (enabled) {
        if (config.autoSubmit) {
          await announceStep("Submitting application", config.stepDelayMs);
          await submitButton.click();
          didSubmit = true;
          await randomDelay(1000, 1800);
          const doneButton = page.getByRole("button", { name: /^done$/i }).first();
          if ((await doneButton.count()) > 0) {
            await doneButton.click().catch(() => {});
          }
        }
        break;
      }
    }

    const reviewButton = modal.getByRole("button", { name: /review/i }).first();
    if ((await reviewButton.count()) > 0 && (await reviewButton.isEnabled().catch(() => false))) {
      await announceStep("Clicking Review", config.stepDelayMs);
      await reviewButton.click();
      await randomDelay(900, 1500);
      continue;
    }

    const continueButton = modal
      .getByRole("button", { name: /continue to next step/i })
      .first();
    if (
      (await continueButton.count()) > 0 &&
      (await continueButton.isEnabled().catch(() => false))
    ) {
      await announceStep("Clicking Continue to next step", config.stepDelayMs);
      await continueButton.click();
      await randomDelay(900, 1500);
      continue;
    }

    const nextButton = modal.getByRole("button", { name: /^next$/i }).first();
    if ((await nextButton.count()) > 0 && (await nextButton.isEnabled().catch(() => false))) {
      await announceStep("Clicking Next", config.stepDelayMs);
      await nextButton.click();
      await randomDelay(900, 1500);
      continue;
    }

    break;
  }

  return didSubmit;
}

function logProcessedJob(row) {
  const line = `[${row.status}] ${row.jobTitle || "(unknown title)"} | ${
    row.companyName || "(unknown company)"
  } | ${row.jobUrl}`;
  console.log(line);
}

async function loadMoreJobResults(page) {
  // LinkedIn jobs search uses a nested scroll container for the left results list.
  // A plain page.mouse.wheel() often scrolls the wrong element and nothing loads.
  // Strategy:
  // 1) Click any "Show more jobs" / "See more jobs" style button.
  // 2) Scroll the results list container if present.
  // 3) Fallback to PageDown and generic mouse wheel.

  const showMoreCandidates = [
    page.getByRole("button", { name: /show more jobs/i }),
    page.getByRole("button", { name: /see more jobs/i }),
    page.getByRole("button", { name: /show more results/i }),
    page.getByRole("button", { name: /more jobs/i }),
  ];

  for (const btn of showMoreCandidates) {
    try {
      if ((await btn.count()) > 0 && (await btn.first().isVisible().catch(() => false))) {
        await btn.first().click({ timeout: ELEMENT_TIMEOUT_MS }).catch(() => {});
        await randomDelay(600, 1200);
        return;
      }
    } catch {
      // try next
    }
  }

  const scrollContainers = [
    page.locator(".jobs-search-results-list").first(),
    page.locator(".jobs-search-results__list").first(),
    page.locator(".scaffold-layout__list-container").first(),
    page.locator('div[role="main"] .scaffold-layout__list').first(),
    page.locator('main [role="list"]').first(),
  ];

  for (const container of scrollContainers) {
    try {
      if ((await container.count()) === 0) continue;
      const visible = await container.isVisible().catch(() => false);
      if (!visible) continue;

      await container.evaluate((el) => {
        el.scrollTop = el.scrollTop + Math.floor(el.clientHeight * 0.9);
      });
      await randomDelay(900, 1600);
      return;
    } catch {
      // try next container
    }
  }

  // Last resort fallbacks.
  await page.keyboard.press("PageDown").catch(() => {});
  await randomDelay(600, 1200);
  await page.mouse.wheel(0, randomBetween(1800, 3200)).catch(() => {});
  await randomDelay(900, 1600);
}

async function run() {
  const effectiveConfig = await loadRemoteConfigIfProvided(CONFIG);
  const authPath = path.resolve(effectiveConfig.authFilePath);
  const usePersistentProfile = String(effectiveConfig.userDataDir || "").trim() !== "";
  if (!usePersistentProfile) {
    if (await fileExists(authPath)) {
      // Continue.
    } else {
      throw new Error(
        `Missing auth file: ${authPath}. Generate it first using Playwright storageState, or set USER_DATA_DIR to persist login.`
      );
    }
  }

  const visitedJobsPath = path.resolve(effectiveConfig.visitedJobsFilePath);
  const outputCsvPath = path.resolve(effectiveConfig.outputCsvPath);
  const answersPath = path.resolve(effectiveConfig.answersFilePath);
  const visitedUrls = await readVisitedJobs(visitedJobsPath);
  const answers = await readJsonIfExists(answersPath, {});
  const runRows = [];

  let browser = null;
  let context;
  let page;

  if (usePersistentProfile) {
    const userDataDir = path.resolve(effectiveConfig.userDataDir);
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      slowMo: effectiveConfig.browserSlowMo,
      ...(effectiveConfig.browserChannel
        ? { channel: effectiveConfig.browserChannel }
        : {}),
    });
    page = context.pages()[0] || (await context.newPage());
  } else {
    browser = await chromium.launch({
      headless: false,
      slowMo: effectiveConfig.browserSlowMo,
      ...(effectiveConfig.browserChannel
        ? { channel: effectiveConfig.browserChannel }
        : {}),
    });

    context = await browser.newContext({
      storageState: authPath,
    });
    page = await context.newPage();
  }

  try {
    await announceStep("Opening LinkedIn recommended jobs", effectiveConfig.stepDelayMs);
    await page.goto(LINKEDIN_RECOMMENDED_COLLECTION_URL, { waitUntil: "domcontentloaded" });
    await randomDelay(1400, 2400);

    // Keep a search URL as fallback if recommended page fails to load list data.
    const searchUrl = buildJobsSearchUrl(effectiveConfig);
    await announceStep(
      "Preparing jobs list",
      effectiveConfig.stepDelayMs
    );
    const initialLinks = await collectJobLinksFromList(page, false);
    if (initialLinks.length === 0) {
      await announceStep("Recommended list empty, falling back to search", effectiveConfig.stepDelayMs);
      await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
      await randomDelay(1600, 2600);
      if (effectiveConfig.easyApplyOnly) {
        await page.goto(buildJobsSearchUrl(effectiveConfig), { waitUntil: "domcontentloaded" });
        await randomDelay(1400, 2200);
      }
    }

    let preparedCount = 0;
    let listExhausted = false;
    let scrollAttempts = 0;

    while (preparedCount < effectiveConfig.maxApplicationsPerRun && !listExhausted) {
      // IMPORTANT: when we use f_AL=true in the search URL, job cards might not include
      // literal "Easy Apply" text; don't over-filter the list here.
      const jobLinks = await collectJobLinksFromList(page, false);
      if (jobLinks.length === 0) {
        console.log(
          `[debug] No job links detected on results page: ${page.url()}`
        );
      }
      let foundUnprocessed = false;

      for (const jobUrl of jobLinks) {
        if (preparedCount >= effectiveConfig.maxApplicationsPerRun) break;
        if (visitedUrls.has(jobUrl)) continue;
        foundUnprocessed = true;
        visitedUrls.add(jobUrl);

        const row = {
          timestamp: new Date().toISOString(),
          jobTitle: "",
          companyName: "",
          jobUrl,
          status: "error",
        };

        try {
          await announceStep("Opening next job from list", effectiveConfig.stepDelayMs);
          await openJobFromRecommendedList(page, jobUrl);
          // Give LinkedIn time to hydrate the SPA & render the top-card actions.
          await page
            .waitForLoadState("networkidle", { timeout: NETWORKIDLE_TIMEOUT_MS })
            .catch(() => {});
          await randomDelay(1200, 2200);

          row.jobTitle = await getFirstNonEmptyText([
            page.locator("h1"),
            page.locator(".job-details-jobs-unified-top-card__job-title"),
          ]);
          row.companyName = await getFirstNonEmptyText([
            page.locator(".job-details-jobs-unified-top-card__company-name"),
            page.locator('a[href*="/company/"]'),
          ]);

          const easyApplyButton = await findEasyApplyButton(page);
          if (!easyApplyButton) {
            await logApplyDiagnostics(page);
            row.status = "skipped";
            runRows.push(row);
            logProcessedJob(row);
            await writeVisitedJobs(visitedJobsPath, visitedUrls);
            await randomDelay(700, 1400);
            continue;
          }

          await announceStep("Clicking Easy Apply", effectiveConfig.stepDelayMs);
          await easyApplyButton.scrollIntoViewIfNeeded().catch(() => {});
          const clickTimeoutMs = Math.max(2000, ELEMENT_TIMEOUT_MS);
          const tagName = await easyApplyButton
            .evaluate((el) => el.tagName)
            .catch(() => "");

          if (String(tagName).toUpperCase() === "A") {
            // Codegen showed this is often a direct link to /apply/?openSDUIApplyFlow=true.
            // Navigating is more reliable than clicking, especially with aggressive timeouts.
            const href = await easyApplyButton.getAttribute("href").catch(() => "");
            if (href) {
              await page.goto(href, { waitUntil: "domcontentloaded" });
            } else {
              await easyApplyButton.click({ timeout: clickTimeoutMs });
            }
          } else {
            await easyApplyButton.click({ timeout: clickTimeoutMs });
          }
          await randomDelay(1000, 1800);

          await announceStep("Filling common form fields", effectiveConfig.stepDelayMs);
          const submitted = await completeEasyApplyFlow(
            page,
            effectiveConfig,
            answers,
            answersPath
          );
          row.status = submitted ? "submitted" : "prepared";
          runRows.push(row);
          preparedCount += 1;
          logProcessedJob(row);
          await writeVisitedJobs(visitedJobsPath, visitedUrls);

          await closeEasyApplyModalIfOpen(page);
          await randomDelay(700, 1300);
        } catch (error) {
          row.status = "error";
          runRows.push(row);
          logProcessedJob(row);
          console.error(`[error] ${jobUrl}: ${error.message}`);
          await writeVisitedJobs(visitedJobsPath, visitedUrls);
          await closeEasyApplyModalIfOpen(page);
        }
      }

      if (foundUnprocessed) {
        scrollAttempts = 0;
      } else {
        // No new links on current page: try pagination first, then scroll-load.
        const paged = await goToNextRecommendedPage(page);
        if (paged) {
          console.log("[debug] Moved to next jobs page.");
          scrollAttempts = 0;
          continue;
        }

        console.log(`[debug] No new jobs found; loading more (attempt ${scrollAttempts + 1}/8)`);
        await loadMoreJobResults(page);
        scrollAttempts += 1;
        if (scrollAttempts >= 8) {
          listExhausted = true;
        }
      }
    }

    const preparedRows = runRows.filter((r) => r.status === "prepared");
    await writePreparedCsv(outputCsvPath, preparedRows);
    await writeVisitedJobs(visitedJobsPath, visitedUrls);
    await postRunReport(effectiveConfig, runRows, preparedRows);

    console.log("\nRun complete.");
    console.log(`Processed jobs: ${runRows.length}`);
    console.log(`Prepared applications: ${preparedRows.length}`);
    console.log(`CSV output: ${outputCsvPath}`);
    console.log(`Visited jobs store: ${visitedJobsPath}`);
  } finally {
    if (effectiveConfig.keepBrowserOpen) {
      console.log(
        "\nBrowser is intentionally left open for inspection. Press Enter to close it."
      );
      await waitForEnter("Press Enter to close browser and finish...");
    }
    await context.close();
    if (browser) await browser.close();
  }
}

run().catch((error) => {
  console.error(`[fatal] ${error.message}`);
  process.exitCode = 1;
});
