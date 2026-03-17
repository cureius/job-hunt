#!/usr/bin/env node

/**
 * Naukri semi-automated application helper.
 *
 * Notes:
 * - Runs in visible browser (headless: false).
 * - Keeps a persistent profile so login is reused.
 * - Skips jobs without an Apply trigger.
 * - Asks for unknown answers once, then remembers them.
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const readline = require("node:readline");
const { chromium } = require("playwright");

const DELAY_SCALE = Number(process.env.DELAY_SCALE || 1);
const ELEMENT_TIMEOUT_MS = Number(process.env.ELEMENT_TIMEOUT_MS || 5000);
const NETWORKIDLE_TIMEOUT_MS = Number(process.env.NETWORKIDLE_TIMEOUT_MS || 8000);

const CONFIG = {
  startUrl:
    process.env.NAUKRI_START_URL ||
    "https://www.naukri.com/mnjuser/recommendedjobs",
  batchSize: Number(process.env.BATCH_SIZE || 5),
  maxApplicationsPerRun: Number(process.env.MAX_APPLICATIONS_PER_RUN || 10),
  phoneNumber: process.env.PHONE_NUMBER || "",
  email: process.env.EMAIL || "",
  resumeFilePath: process.env.RESUME_FILE_PATH || "",
  userDataDir: process.env.USER_DATA_DIR || ".pw-user-data-naukri",
  browserChannel: process.env.BROWSER_CHANNEL || "chrome",
  visitedJobsFilePath:
    process.env.VISITED_JOBS_FILE_PATH || "naukri-visited-jobs.json",
  answersFilePath:
    process.env.ANSWERS_FILE_PATH || "naukri-answers-memory.json",
  outputCsvPath:
    process.env.OUTPUT_CSV_PATH ||
    `naukri-prepared-applications-${new Date().toISOString().slice(0, 10)}.csv`,
  autoSubmit: process.env.AUTO_SUBMIT !== "false",
  keepBrowserOpen: process.env.KEEP_BROWSER_OPEN !== "false",
  browserSlowMo: Number(process.env.BROWSER_SLOW_MO || 250),
  stepDelayMs: Number(process.env.STEP_DELAY_MS || 300),
};

function randomBetween(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

async function randomDelay(minMs = 200, maxMs = 700) {
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

async function announceStep(message, stepDelayMs) {
  console.log(`\n[step] ${message}`);
  await randomDelay(Math.max(120, stepDelayMs), Math.max(240, stepDelayMs + 250));
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

async function readVisitedJobs(filePath) {
  const payload = await readJsonIfExists(filePath, { urls: [] });
  return new Set(Array.isArray(payload.urls) ? payload.urls : []);
}

async function writeVisitedJobs(filePath, visitedSet) {
  const payload = {
    updatedAt: new Date().toISOString(),
    urls: Array.from(visitedSet),
  };
  await writeJsonFile(filePath, payload);
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

function normalizeJobUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

function canonicalizeQuestionText(text) {
  let s = String(text || "");
  s = s.replace(/\[[^\]]*\]/g, " ");
  s = s.replace(/\(choose one:[^)]*\)/gi, " ");
  s = s.replace(/[*:]+/g, " ");
  s = s.toLowerCase();
  s = s.replace(/\bcompensation\b/g, "ctc");
  s = s.replace(/\bsalary\b/g, "ctc");
  s = s.replace(/\bpackage\b/g, "ctc");
  s = s.replace(/\bexpectation\b/g, "expected");
  s = s.replace(/\bplease\b|\bconfirm\b|\byour\b/g, " ");
  s = s.replace(/[^a-z0-9]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s.slice(0, 200);
}

function escapeRegExp(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  if (bestScore >= 0.72 && bestKey) return String(answers[bestKey] ?? "");
  return "";
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

async function getOrAskAnswer(answers, answersPath, questionLabel, defaultValue = "") {
  const key = toQuestionKey(questionLabel);
  if (!key) return defaultValue;
  if (answers[key]) return String(answers[key]);

  const fuzzy = findBestSavedAnswer(answers, key);
  if (fuzzy) {
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

async function getFirstNonEmptyText(locators) {
  for (const locator of locators) {
    try {
      if ((await locator.count()) === 0) continue;
      const text = (await locator.first().innerText()).trim();
      if (text) return text;
    } catch {
      // continue
    }
  }
  return "";
}

async function collectJobLinksFromList(page) {
  const links = await page.$$eval(
    // Naukri commonly uses URLs like /job-listings-<slug>-<id>?...
    // Avoid over-specific selectors so different page variants still work.
    'a[href*="job-listings"], a[href*="job-details"], a[href*="/jobs?jobId="], a[title][href*="naukri.com"]',
    (anchors) => {
      const seen = new Set();
      for (const a of anchors) {
        const href = a.getAttribute("href");
        if (!href) continue;
        try {
          const url = new URL(href, location.origin).toString();
          if (!/naukri\.com/i.test(url)) continue;
          if (!/job-listings|job-details|jobid=/i.test(url)) continue;
          seen.add(url);
        } catch {
          // ignore
        }
      }
      return Array.from(seen);
    }
  );
  return links.map(normalizeJobUrl);
}

async function collectJobTitleTargets(page) {
  const titles = await page.$$eval('p[title].title, [title].title', (nodes) => {
    const seen = new Set();
    for (const n of nodes) {
      const title = (n.getAttribute("title") || "").trim();
      if (!title) continue;
      if (title.length < 4) continue;
      if (/recommended jobs|jobs4u|job letter samples/i.test(title)) continue;
      seen.add(title);
    }
    return Array.from(seen);
  });
  return titles;
}

async function dismissNaukriPrompts(page) {
  const candidates = [
    page.getByText(/i already have the naukri app/i),
    page.getByRole("button", { name: /not now|skip|later|close/i }),
    page.locator('[aria-label*="close" i], .crossIcon, .close, .icon-cross').first(),
  ];

  for (const locator of candidates) {
    try {
      if ((await locator.count()) > 0 && (await locator.first().isVisible().catch(() => false))) {
        await locator.first().click({ timeout: ELEMENT_TIMEOUT_MS }).catch(() => {});
        await randomDelay(300, 800);
      }
    } catch {
      // continue
    }
  }
}

async function openJobTarget(context, page, target) {
  if (target.url) {
    await page.goto(target.url, { waitUntil: "domcontentloaded" });
    await page
      .waitForLoadState("networkidle", { timeout: NETWORKIDLE_TIMEOUT_MS })
      .catch(() => {});
    return page;
  }

  // Fallback: click a title card that may open details in-place or popup.
  const popupPromise = context.waitForEvent("page", { timeout: 3000 }).catch(() => null);
  const titleLocator = page.getByTitle(target.title, { exact: true }).first();
  await titleLocator.scrollIntoViewIfNeeded().catch(() => {});
  await titleLocator.click({ timeout: ELEMENT_TIMEOUT_MS }).catch(async () => {
    // Try a looser fallback if exact title locator failed.
    const loose = page.locator(`[title="${target.title.replaceAll('"', '\\"')}"]`).first();
    await loose.click({ timeout: ELEMENT_TIMEOUT_MS }).catch(() => {});
  });

  const popup = await popupPromise;
  if (popup) {
    await popup.bringToFront().catch(() => {});
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
    await popup.waitForLoadState("networkidle", { timeout: NETWORKIDLE_TIMEOUT_MS }).catch(() => {});
    return popup;
  }

  await page.waitForLoadState("networkidle", { timeout: NETWORKIDLE_TIMEOUT_MS }).catch(() => {});
  return page;
}

async function loadMoreJobResults(page) {
  const showMoreButtons = [
    page.getByRole("button", { name: /show more|load more|see more/i }),
    page.locator('button:has-text("Show more")'),
    page.locator('button:has-text("Load more")'),
  ];

  for (const btn of showMoreButtons) {
    try {
      if ((await btn.count()) > 0 && (await btn.first().isVisible().catch(() => false))) {
        await btn.first().click({ timeout: ELEMENT_TIMEOUT_MS }).catch(() => {});
        await randomDelay(500, 1100);
        return;
      }
    } catch {
      // next
    }
  }

  const containers = [
    page.locator(".styles_jhc__scrollable-container__5PrBI").first(),
    page.locator(".nI-gNb-list-ct").first(),
    page.locator("main").first(),
    page.locator("body").first(),
  ];
  for (const c of containers) {
    try {
      if ((await c.count()) === 0) continue;
      const visible = await c.isVisible().catch(() => false);
      if (!visible) continue;
      await c.evaluate((el) => {
        el.scrollTop = el.scrollTop + Math.floor(el.clientHeight * 0.9);
      });
      await randomDelay(700, 1400);
      return;
    } catch {
      // next
    }
  }

  await page.keyboard.press("PageDown").catch(() => {});
  await randomDelay(500, 1000);
}

async function findApplyTrigger(page) {
  const candidates = [
    // Prefer batch-apply trigger when present on recommendations page.
    page.getByRole("button", { name: /apply\s+\d+\s+jobs/i }),
    page.getByRole("button", { name: /easy apply|quick apply|apply/i }),
    page.getByRole("link", { name: /easy apply|quick apply|apply/i }),
    page.locator('button:has-text("Apply")'),
    page.locator('a:has-text("Apply")'),
  ];

  for (const locator of candidates) {
    try {
      const el = locator.first();
      await el.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT_MS });
      const text = (
        (await el.innerText().catch(() => "")) ||
        (await el.getAttribute("aria-label").catch(() => ""))
      )
        .trim()
        .toLowerCase();
      if (/login|sign in|register/.test(text)) continue;
      return el;
    } catch {
      // try next
    }
  }
  return null;
}

async function collectCheckboxCandidates(page) {
  const checkboxLocator = page.locator(".dspIB.naukicon.naukicon-ot-checkbox, .naukicon-ot-checkbox");
  const candidates = await checkboxLocator.evaluateAll((els) => {
    const out = [];
    els.forEach((el, domIndex) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return;
      // Naukri checkbox icon nodes can have tiny/zero box sizes but still be clickable.
      // Keep them as long as they are not completely off-screen.
      if (rect.bottom <= 0 || rect.top >= (window.innerHeight || document.documentElement.clientHeight)) {
        return;
      }

      const card = el.closest(
        "article, li, .srp-jobtuple-wrapper, .jobTuple, .styles_job-listing-card, .cust-job-tuple"
      );
      const titleNode =
        (card &&
          card.querySelector(
            'p.title[title], a[title].title, [title].title, p[title], a[title], [class*="title"][title]'
          )) ||
        null;
      const title = titleNode ? (titleNode.getAttribute("title") || titleNode.textContent || "").trim() : "";
      const key = `title:${(title || `idx-${domIndex}`).toLowerCase()}`;
      out.push({ domIndex, title, key });
    });
    return out;
  });
  return candidates;
}

async function clickApplyBatchButton(page) {
  const candidates = [
    page.getByRole("button", { name: /^apply\s+\d+\s+jobs$/i }).first(),
    page.getByRole("button", { name: /apply\s+\d+\s+jobs/i }).first(),
    page.locator('button:has-text("Apply")').filter({ hasText: /Jobs/i }).first(),
    page.getByText(/^apply\s+\d+\s+jobs$/i).first(),
    page.getByText(/apply\s+\d+\s+jobs/i).first(),
  ];

  for (const btn of candidates) {
    try {
      if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
        const enabled = await btn.isEnabled().catch(() => true);
        if (!enabled) continue;
        await btn.click({ timeout: ELEMENT_TIMEOUT_MS });
        return true;
      }
    } catch {
      // try next
    }
  }
  return false;
}

async function waitForThankYou(page) {
  const thankYou = page.getByText(/thank you for your response/i).first();
  const visible = await thankYou
    .waitFor({ state: "visible", timeout: 12000 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return false;

  const closeCandidates = [
    page.getByRole("button", { name: /close|done|ok/i }).first(),
    page.locator('[aria-label*="close" i], .crossIcon, .close, .icon-cross').first(),
  ];
  for (const c of closeCandidates) {
    try {
      if ((await c.count()) > 0 && (await c.isVisible().catch(() => false))) {
        await c.click({ timeout: ELEMENT_TIMEOUT_MS }).catch(() => {});
        await randomDelay(300, 700);
        break;
      }
    } catch {
      // ignore
    }
  }
  return true;
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
    // ignore
  }
  const aria = (await inputLocator.getAttribute("aria-label").catch(() => "")) || "";
  if (aria.trim()) return aria.trim();
  const placeholder =
    (await inputLocator.getAttribute("placeholder").catch(() => "")) || "";
  if (placeholder.trim()) return placeholder.trim();
  return "";
}

async function getActiveNaukriQuestion(page) {
  const qInput = page.locator('[id^="userInput__"][id$="InputBox"]').first();
  if ((await qInput.count().catch(() => 0)) === 0) return "";
  const visible = await qInput.isVisible().catch(() => false);
  if (!visible) return "";

  const questionText = await qInput
    .evaluate((el) => {
      const container =
        el.closest('[class*="question"], [class*="ssrc"], [class*="apply"], form, section') ||
        el.parentElement;
      if (!container) return "";
      const lines = String(container.innerText || "")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .filter((x) => !/^save$/i.test(x))
        .filter((x) => !/^(yes|no)$/i.test(x))
        .filter((x) => !/^required$/i.test(x));
      return lines[0] || "";
    })
    .catch(() => "");
  return String(questionText || "").trim();
}

async function autofillActiveNaukriQuestionInput(page, answers, answersPath) {
  const qInput = page.locator('[id^="userInput__"][id$="InputBox"]').first();
  if ((await qInput.count().catch(() => 0)) === 0) return;
  const visible = await qInput.isVisible().catch(() => false);
  if (!visible) return;
  const disabled = await qInput.isDisabled().catch(() => true);
  if (disabled) return;

  const current = (await qInput.inputValue().catch(() => "")).trim();
  if (current) return;

  const question = (await getActiveNaukriQuestion(page)) || "Required field";
  const lower = question.toLowerCase();
  let defaultAnswer = "";
  if (/years|experience|exp\b/.test(lower)) defaultAnswer = "4";
  if (/notice\s*period/.test(lower)) defaultAnswer = "15";
  if (/current\s*(ctc|salary)/.test(lower)) defaultAnswer = "18";
  if (/expected\s*(ctc|salary)/.test(lower)) defaultAnswer = "26";

  const answer = await getOrAskAnswer(answers, answersPath, question, defaultAnswer);
  if (!answer) return;
  await qInput.fill(answer).catch(() => {});
  await randomDelay(120, 320);
}

async function autofillChatQuestionInput(page, answers, answersPath) {
  // Some Naukri apply sidebars ask one question in a chat-like UI:
  // question bubble + "Type message here..." input + Save button.
  const chatInput = page
    .locator(
      'input[placeholder*="Type message" i], textarea[placeholder*="Type message" i]'
    )
    .first();
  if ((await chatInput.count().catch(() => 0)) === 0) return;
  const visible = await chatInput.isVisible().catch(() => false);
  if (!visible) return;
  const disabled = await chatInput.isDisabled().catch(() => true);
  if (disabled) return;

  const current = (await chatInput.inputValue().catch(() => "")).trim();
  if (current) return;

  const question = await page
    .evaluate(() => {
      // Find the latest question-like text in the right sidebar/chat area.
      const roots = Array.from(
        document.querySelectorAll(
          '[class*="chat"], [class*="drawer"], [class*="sidebar"], [class*="apply"], [role="dialog"]'
        )
      );
      const textCandidates = [];
      for (const root of roots) {
        const nodes = root.querySelectorAll("p, span, div, li");
        nodes.forEach((n) => {
          const t = String(n.textContent || "").trim();
          if (!t) return;
          if (t.length < 8 || t.length > 220) return;
          if (!/\?$/.test(t) && !/experience|salary|ctc|notice|location|current/i.test(t)) return;
          if (/type message here|save|thank you for showing interest/i.test(t.toLowerCase())) return;
          textCandidates.push(t);
        });
      }
      return textCandidates[textCandidates.length - 1] || "";
    })
    .catch(() => "");

  const lower = String(question || "").toLowerCase();
  let defaultAnswer = "";
  if (/years|experience|java|react|node|angular|python/.test(lower)) defaultAnswer = "4";
  if (/notice\s*period/.test(lower)) defaultAnswer = "15";
  if (/current\s*(ctc|salary)/.test(lower)) defaultAnswer = "18";
  if (/expected\s*(ctc|salary)/.test(lower)) defaultAnswer = "26";

  const label = question || "Chat question";
  const answer = await getOrAskAnswer(answers, answersPath, label, defaultAnswer);
  if (!answer) return;
  await chatInput.fill(answer).catch(() => {});
  await randomDelay(120, 320);
}

function looksLikePlaceholder(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return true;
  return /^(select|choose|pick|search|enter)\b/.test(t);
}

async function autofillTextInputs(page, config, answers, answersPath) {
  const scope = page.locator('[role="dialog"], form').first();
  const inputs = scope.locator(
    'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]), textarea'
  );
  const count = await inputs.count();
  for (let i = 0; i < count; i += 1) {
    const input = inputs.nth(i);
    const visible = await input.isVisible().catch(() => false);
    if (!visible) continue;
    const disabled = await input.isDisabled().catch(() => true);
    const ro = await input.getAttribute("readonly").catch(() => null);
    if (disabled || ro !== null) continue;

    const value = (await input.inputValue().catch(() => "")).trim();
    if (value) continue;

    let labelText = (await getLabelForInput(scope, input)) || "";
    if (!labelText) {
      labelText = await input
        .evaluate((el) => {
          const c =
            el.closest('[class*="question"], [class*="ques"], [id*="question"]') ||
            el.parentElement;
          if (!c) return "";
          const lines = String(c.innerText || "")
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean)
            .filter((x) => !/^save$/i.test(x))
            .filter((x) => !/^(yes|no)$/i.test(x));
          return lines[0] || "";
        })
        .catch(() => "");
    }
    labelText = labelText || "Required field";
    const lower = labelText.toLowerCase();
    if (
      /keyword|designation|companies|search jobs|search/i.test(lower) &&
      /location|designation|company|keyword/.test(lower)
    ) {
      continue;
    }
    if (lower.includes("phone") && config.phoneNumber) {
      await input.fill(config.phoneNumber).catch(() => {});
      continue;
    }
    if (lower.includes("email") && config.email) {
      await input.fill(config.email).catch(() => {});
      continue;
    }

    const defaultAnswer = /how many years|experience/.test(lower) ? "4" : "";
    const answer = await getOrAskAnswer(answers, answersPath, labelText, defaultAnswer);
    if (answer) await input.fill(answer).catch(() => {});
    await randomDelay(120, 320);
  }
}

async function autofillYesNoRadios(page, answers, answersPath) {
  const scope = page.locator('[role="dialog"], form').first();
  const groups = scope.locator("fieldset");
  const count = await groups.count();
  for (let i = 0; i < count; i += 1) {
    const fieldset = groups.nth(i);
    const visible = await fieldset.isVisible().catch(() => false);
    if (!visible) continue;
    const checked = await fieldset
      .locator('input[type="radio"]:checked')
      .count()
      .catch(() => 0);
    if (checked > 0) continue;

    const question = (
      (await fieldset.locator("legend").first().innerText().catch(() => "")) || ""
    ).trim();
    if (!question) continue;

    const yes = fieldset.getByRole("radio", { name: /^yes$/i }).first();
    const no = fieldset.getByRole("radio", { name: /^no$/i }).first();
    const hasYes = (await yes.count().catch(() => 0)) > 0;
    const hasNo = (await no.count().catch(() => 0)) > 0;
    if (!hasYes && !hasNo) continue;

    const answer = (await getOrAskAnswer(answers, answersPath, question, "yes"))
      .trim()
      .toLowerCase();
    if (answer.startsWith("n") && hasNo) {
      await no.check({ force: true }).catch(() => {});
    } else if (hasYes) {
      await yes.check({ force: true }).catch(() => {});
    } else if (hasNo) {
      await no.check({ force: true }).catch(() => {});
    }
    await randomDelay(120, 320);
  }
}

async function autofillNativeSelects(page, answers, answersPath) {
  const scope = page.locator('[role="dialog"], form').first();
  const selects = scope.locator("select");
  const count = await selects.count();
  for (let i = 0; i < count; i += 1) {
    const select = selects.nth(i);
    const visible = await select.isVisible().catch(() => false);
    if (!visible) continue;
    const disabled = await select.isDisabled().catch(() => true);
    if (disabled) continue;

    const selectedLabel = (
      (await select.locator("option:checked").first().innerText().catch(() => "")) || ""
    ).trim();
    if (selectedLabel && !looksLikePlaceholder(selectedLabel)) continue;

    const label = (await getLabelForInput(scope, select)) || `Select field ${i + 1}`;
    const options = await select.locator("option").allInnerTexts().catch(() => []);
    const cleaned = options.map((o) => String(o || "").trim()).filter(Boolean);
    const sample = cleaned.slice(0, 8).join(" | ");
    const defaultOption = cleaned.find((o) => !/select|choose/i.test(o)) || cleaned[0] || "";

    const answer = await getOrAskAnswer(
      answers,
      answersPath,
      `${label} (choose one: ${sample}${cleaned.length > 8 ? " | ..." : ""})`,
      defaultOption
    );
    if (!answer) continue;

    await select.selectOption({ label: answer }).catch(async () => {
      await select.selectOption({ value: answer }).catch(async () => {
        const match = cleaned.find((o) =>
          o.toLowerCase().includes(String(answer).toLowerCase())
        );
        if (match) await select.selectOption({ label: match }).catch(() => {});
      });
    });
    await randomDelay(120, 320);
  }
}

async function autofillActiveNaukriSingleSelect(page, answers, answersPath) {
  const groups = page.locator('[id^="ssrc__"][id$="SingleSelectRadioButton"]');
  const count = await groups.count();
  for (let i = 0; i < count; i += 1) {
    const group = groups.nth(i);
    const visible = await group.isVisible().catch(() => false);
    if (!visible) continue;

    // Skip if any option appears selected already.
    const alreadySelected = await group
      .locator('input:checked, [aria-checked="true"], .selected, [class*="selected"]')
      .count()
      .catch(() => 0);
    if (alreadySelected > 0) continue;

    const question = await group
      .evaluate((el) => {
        const container =
          el.closest('[class*="question"], [class*="ssrc"], [class*="apply"], form, section') ||
          el.parentElement;
        if (!container) return "";
        const lines = String(container.innerText || "")
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean)
          .filter((x) => !/^save$/i.test(x))
          .filter((x) => !/^(yes|no)$/i.test(x));
        return lines[0] || "";
      })
      .catch(() => "");

    const optionTexts = await group
      .evaluate((el) => {
        const out = [];
        const nodes = el.querySelectorAll("label, span, div, p, li");
        nodes.forEach((n) => {
          const t = String(n.textContent || "").trim();
          if (!t) return;
          if (t.length > 40) return;
          if (/^save$/i.test(t)) return;
          if (/^required$/i.test(t)) return;
          if (!out.includes(t)) out.push(t);
        });
        return out.slice(0, 12);
      })
      .catch(() => []);
    if (!optionTexts.length) continue;

    const defaultAnswer = optionTexts.find((o) => /^yes$/i.test(o)) || optionTexts[0];
    const prompt = `${question || "Select one"} (choose one: ${optionTexts.join(" | ")})`;
    const answer = await getOrAskAnswer(answers, answersPath, prompt, defaultAnswer);
    if (!answer) continue;

    const exact = group.getByText(new RegExp(`^${escapeRegExp(answer)}$`, "i")).first();
    if ((await exact.count().catch(() => 0)) > 0) {
      await exact.click({ timeout: ELEMENT_TIMEOUT_MS }).catch(() => {});
      await randomDelay(120, 320);
      continue;
    }
    const contains = group.getByText(new RegExp(escapeRegExp(answer), "i")).first();
    if ((await contains.count().catch(() => 0)) > 0) {
      await contains.click({ timeout: ELEMENT_TIMEOUT_MS }).catch(() => {});
      await randomDelay(120, 320);
      continue;
    }
  }
}

async function completeApplyFlow(page, config, answers, answersPath) {
  let didSubmit = false;

  for (let i = 0; i < 20; i += 1) {
    await autofillActiveNaukriQuestionInput(page, answers, answersPath);
    await autofillChatQuestionInput(page, answers, answersPath);
    await autofillTextInputs(page, config, answers, answersPath);
    await autofillYesNoRadios(page, answers, answersPath);
    await autofillNativeSelects(page, answers, answersPath);
    await autofillActiveNaukriSingleSelect(page, answers, answersPath);

    // Prefer true final submit actions first.
    // IMPORTANT: do NOT treat "Apply X Jobs" as final submit inside sidebar flow.
    const submitBtn = page
      .getByRole(
        "button",
        { name: /submit|apply now|send application|finish|done/i }
      )
      .first();
    if ((await submitBtn.count()) > 0 && (await submitBtn.isEnabled().catch(() => false))) {
      if (config.autoSubmit) {
        await announceStep("Submitting application", config.stepDelayMs);
        await submitBtn.click({ timeout: ELEMENT_TIMEOUT_MS }).catch(() => {});
        didSubmit = true;
        await randomDelay(500, 1200);
      }
      break;
    }

    // Naukri multi-apply frequently asks one question at a time and advances via "Save".
    const saveButtonRole = page.getByRole("button", { name: /^save$/i }).first();
    if (
      (await saveButtonRole.count()) > 0 &&
      (await saveButtonRole.isVisible().catch(() => false))
    ) {
      const enabled = await saveButtonRole.isEnabled().catch(() => true);
      if (enabled) {
        await announceStep("Saving answer and continuing apply flow", config.stepDelayMs);
        await saveButtonRole.click({ timeout: ELEMENT_TIMEOUT_MS }).catch(() => {});
        await randomDelay(500, 1100);
        continue;
      }
    }

    // Naukri often renders Save as text/div instead of semantic button.
    const saveText = page.getByText(/^save$/i).first();
    if ((await saveText.count()) > 0 && (await saveText.isVisible().catch(() => false))) {
      await announceStep("Saving answer and continuing apply flow", config.stepDelayMs);
      await saveText.click({ timeout: ELEMENT_TIMEOUT_MS }).catch(() => {});
      await randomDelay(500, 1100);
      continue;
    }

    const continueBtn = page
      .getByRole("button", { name: /continue|next|review|proceed/i })
      .first();
    if ((await continueBtn.count()) > 0 && (await continueBtn.isEnabled().catch(() => false))) {
      await continueBtn.click({ timeout: ELEMENT_TIMEOUT_MS }).catch(() => {});
      await randomDelay(600, 1200);
      continue;
    }

    const continueText = page.getByText(/continue|next|review|proceed/i).first();
    if ((await continueText.count()) > 0 && (await continueText.isVisible().catch(() => false))) {
      await continueText.click({ timeout: ELEMENT_TIMEOUT_MS }).catch(() => {});
      await randomDelay(600, 1200);
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

async function ensureLoggedIn(page) {
  const url = page.url();
  if (/login|signin|auth/i.test(url)) {
    console.log("\n[action] Please complete login in the opened browser.");
    await waitForEnter("Press Enter after you are logged in and the jobs page is visible...");
  }
}

async function run() {
  const cfg = CONFIG;
  const visitedPath = path.resolve(cfg.visitedJobsFilePath);
  const answersPath = path.resolve(cfg.answersFilePath);
  const outputCsvPath = path.resolve(cfg.outputCsvPath);
  const visitedUrls = await readVisitedJobs(visitedPath);
  const answers = await readJsonIfExists(answersPath, {});
  const runRows = [];

  const userDataDir = path.resolve(cfg.userDataDir);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    slowMo: cfg.browserSlowMo,
    ...(cfg.browserChannel ? { channel: cfg.browserChannel } : {}),
  });
  const page = context.pages()[0] || (await context.newPage());

  try {
    await announceStep("Opening Naukri recommended jobs", cfg.stepDelayMs);
    await page.goto(cfg.startUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: NETWORKIDLE_TIMEOUT_MS }).catch(() => {});
    await ensureLoggedIn(page);
    await dismissNaukriPrompts(page);

    let processedCount = 0;
    let listExhausted = false;
    let scrollAttempts = 0;
    let switchedToJobsTab = false;

    while (processedCount < cfg.maxApplicationsPerRun && !listExhausted) {
      let candidates = await collectCheckboxCandidates(page);
      if (candidates.length === 0) {
        // Fallback debug paths when checkbox selectors fail.
        const jobLinks = await collectJobLinksFromList(page);
        const titleTargets = await collectJobTitleTargets(page);
        if (titleTargets.length > 0) {
          console.log(`[debug] Title cards detected: ${titleTargets.length}`);
        }
        if (jobLinks.length > 0) {
          console.log(`[debug] Job links detected: ${jobLinks.length}`);
        }
        console.log(`[debug] No job links detected: ${page.url()}`);
        if (!switchedToJobsTab) {
          const jobsTab = page.getByRole("link", { name: /jobs/i }).first();
          if ((await jobsTab.count()) > 0 && (await jobsTab.isVisible().catch(() => false))) {
            await announceStep("Switching to Jobs tab", cfg.stepDelayMs);
            await jobsTab.click({ timeout: ELEMENT_TIMEOUT_MS }).catch(() => {});
            await randomDelay(1000, 1800);
            await dismissNaukriPrompts(page);
            switchedToJobsTab = true;
            continue;
          }
        }
      }

      const remaining = Math.max(0, cfg.maxApplicationsPerRun - processedCount);
      const selectable = candidates
        .filter((c) => !visitedUrls.has(c.key))
        .slice(0, Math.min(cfg.batchSize, remaining));
      console.log(
        `[debug] checkbox candidates=${candidates.length}, selectable=${selectable.length}, visited=${visitedUrls.size}`
      );

      if (selectable.length > 0) {
        await announceStep(`Selecting ${selectable.length} jobs for batch apply`, cfg.stepDelayMs);
        const checkboxLocator = page.locator(
          ".dspIB.naukicon.naukicon-ot-checkbox, .naukicon-ot-checkbox"
        );

        for (const item of selectable) {
          try {
            await checkboxLocator.nth(item.domIndex).click({ timeout: ELEMENT_TIMEOUT_MS });
            visitedUrls.add(item.key);
            await randomDelay(80, 180);
          } catch {
            // skip problematic checkbox
          }
        }

        await announceStep("Clicking Apply Jobs button", cfg.stepDelayMs);
        const openedApplyFlow = await clickApplyBatchButton(page);
        if (!openedApplyFlow) {
          console.log("[debug] Apply batch button not found after selection.");
          scrollAttempts += 1;
          continue;
        }

        await randomDelay(500, 1200);
        await announceStep("Filling batch application sidebar", cfg.stepDelayMs);
        const submitted = await completeApplyFlow(page, cfg, answers, answersPath);
        const thanked = await waitForThankYou(page);
        const status = submitted || thanked ? "submitted" : "prepared";

        for (const item of selectable) {
          const row = {
            timestamp: new Date().toISOString(),
            jobTitle: item.title || "(unknown title)",
            companyName: "",
            jobUrl: `naukri:title:${item.title || item.key}`,
            status,
          };
          runRows.push(row);
          logProcessedJob(row);
        }

        processedCount += selectable.length;
        await writeVisitedJobs(visitedPath, visitedUrls);
        scrollAttempts = 0;
      } else {
        console.log(`[debug] No new jobs found; loading more (${scrollAttempts + 1}/8)`);
        await loadMoreJobResults(page);
        scrollAttempts += 1;
        if (scrollAttempts >= 8) listExhausted = true;
      }
    }

    const preparedRows = runRows.filter(
      (r) => r.status === "prepared" || r.status === "submitted"
    );
    await writePreparedCsv(outputCsvPath, preparedRows);
    await writeVisitedJobs(visitedPath, visitedUrls);

    console.log("\nRun complete.");
    console.log(`Processed jobs: ${runRows.length}`);
    console.log(`Prepared/submitted: ${preparedRows.length}`);
    console.log(`CSV output: ${outputCsvPath}`);
    console.log(`Visited jobs store: ${visitedPath}`);
  } finally {
    if (cfg.keepBrowserOpen) {
      console.log("\nBrowser is intentionally left open. Press Enter to close.");
      await waitForEnter("Press Enter to close browser and finish...");
    }
    await context.close();
  }
}

run().catch((error) => {
  console.error(`[fatal] ${error.message}`);
  process.exitCode = 1;
});

