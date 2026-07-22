const { readFile, writeFile } = require("node:fs/promises");
const { resolve } = require("node:path");

const STATS_FILE = resolve(__dirname, "..", "assets", "stats.svg");
const DEFAULT_USERNAME = "Rahul-Baghel01";
const PLACEHOLDER_ATTRIBUTE = "data-profile-placeholder";

function getUsername() {
  return (
    process.env.GITHUB_USERNAME ||
    process.env.GITHUB_REPOSITORY_OWNER ||
    process.env.GITHUB_REPOSITORY?.split("/")[0] ||
    DEFAULT_USERNAME
  );
}

function formatDate(date) {
  if (!date || Number.isNaN(Date.parse(date))) {
    throw new Error("GitHub did not return a valid latest update date.");
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
    return entities[character];
  });
}

function replacePlaceholders(template, values) {
  let updatedTemplate = template;

  for (const [placeholder, value] of Object.entries(values)) {
    const token = `{{${placeholder}}}`;
    const escapedValue = escapeXml(value);
    if (updatedTemplate.includes(token)) {
      updatedTemplate = updatedTemplate.replaceAll(token, escapedValue);
      continue;
    }

    const elementPattern = new RegExp(
      `(<(text|tspan)\\b[^>]*\\b${PLACEHOLDER_ATTRIBUTE}=["']${placeholder}["'][^>]*>)([\\s\\S]*?)(<\\/(text|tspan)>)`,
    );
    if (!elementPattern.test(updatedTemplate)) {
      throw new Error(
        `Missing required placeholder marker in stats.svg: ${token}`,
      );
    }

    updatedTemplate = updatedTemplate.replace(
      elementPattern,
      (_, openingTag, _elementName, _content, closingTag) =>
        `${openingTag}\n\n${escapedValue}\n\n${closingTag}`,
    );
  }

  return updatedTemplate;
}

async function fetchProfile(octokit, username) {
  const { data } = await octokit.rest.users.getByUsername({ username });
  return data;
}

async function fetchRepositories(octokit, username) {
  return octokit.paginate(octokit.rest.repos.listForUser, {
    username,
    type: "owner",
    sort: "updated",
    direction: "desc",
    per_page: 100,
  });
}

function calculateStars(repositories) {
  return repositories.reduce(
    (total, repository) => total + repository.stargazers_count,
    0,
  );
}

function getLatestUpdate(repositories, profileUpdatedAt) {
  return repositories.reduce((latest, repository) => {
    if (!repository.updated_at) return latest;
    return !latest || Date.parse(repository.updated_at) > Date.parse(latest)
      ? repository.updated_at
      : latest;
  }, profileUpdatedAt);
}

function createStats(profile, repositories) {
  return {
    PUBLIC_REPOS: profile.public_repos,
    TOTAL_STARS: calculateStars(repositories),
    FOLLOWERS: profile.followers,
    FOLLOWING: profile.following,
    LATEST_UPDATE: formatDate(getLatestUpdate(repositories, profile.updated_at)),
  };
}

async function updateStatsSvg(stats) {
  const template = await readFile(STATS_FILE, "utf8");
  const updatedSvg = replacePlaceholders(template, stats);

  if (updatedSvg !== template) {
    await writeFile(STATS_FILE, updatedSvg, "utf8");
    return true;
  }

  return false;
}

function formatError(error) {
  if (error?.status === 403 && error?.response?.headers?.["x-ratelimit-remaining"] === "0") {
    const resetAt = Number(error.response.headers["x-ratelimit-reset"]);
    const resetMessage = Number.isFinite(resetAt)
      ? ` Resets at ${new Date(resetAt * 1000).toISOString()}.`
      : "";
    return `GitHub API rate limit exceeded.${resetMessage}`;
  }

  if (error instanceof Error && error.message) return error.message;
  return `Unexpected error${error?.status ? ` (HTTP ${error.status})` : ""}`;
}

async function main() {
  const { Octokit } = await import("@octokit/rest");
  const username = getUsername();
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  const [profile, repositories] = await Promise.all([
    fetchProfile(octokit, username),
    fetchRepositories(octokit, username),
  ]);
  const stats = createStats(profile, repositories);
  const didUpdate = await updateStatsSvg(stats);

  console.log(
    `${didUpdate ? "Updated" : "No changes to"} stats.svg for ${username}: ${JSON.stringify(stats)}`,
  );
}

main().catch((error) => {
  console.error(`Profile generation failed: ${formatError(error)}`);
  process.exitCode = 1;
});
