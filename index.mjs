import * as core from "@actions/core";
import * as github from "@actions/github";
import { execSync, spawn } from "child_process";
import prettyMilliseconds from "pretty-ms";

async function spawnPromise(command, options) {
  return new Promise((resolve, reject) => {
    let p = spawn(command, options);
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    p.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    p.on("close", (status) => {
      resolve({
        stdout,
        stderr,
        status,
      });
    });
  });
}

try {
  const tag = core.getInput("tag");
  // The build tool: bazel, or a compatible one such as blast
  const bazel = core.getInput("bazel") || "bazel";
  const buildFirst = core.getInput("build") !== "false";
  let query = core.getInput("query");
  let start = Date.now();

  if (!query && !tag) {
    throw new Error("At least one of the two query or tag needs to be defined");
  } else if (tag) {
    query = `"attr(tags, '\\b${tag}\\b', //...)"`;
  } else if (tag && query) {
    throw new Error("You need to provide either tag or query, but not both");
  }

  let octokit;
  let check;
  if (process.env["GITHUB_TOKEN"]) {
    octokit = github.getOctokit(process.env["GITHUB_TOKEN"]);
    // The Checks API may be unavailable (Forgejo/Gitea, token without checks: write):
    // run the targets anyway, without a check
    check = await octokit.rest.checks
      .create({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        name: core.getInput("checkName"),
        head_sha: github.context.sha,
        status: "in_progress",
        started_at: new Date().toISOString(),
      })
      .then((res) => res.data)
      .catch((e) => {
        core.warning(`Could not create check, continuing without it: ${e.message}`);
        return undefined;
      });
  }

  const ignoreSuccessOutput = core.getBooleanInput("ignoreSuccessOutput");
  core.startGroup(`Collecting targets for tag '${tag}'`);
  const targets = execSync(`${bazel} query ${query}`)
    .toString()
    .split("\n")
    .filter((e) => e != "");
  targets.forEach((target) => core.info(target));
  core.endGroup();
  let output = `# Bazel run on tag ${tag}\n\n`;
  // Build every target in one command: their actions run in parallel and the cache is checked once,
  // so that each `run` below only executes an up-to-date target. A failed build does not stop the
  // runs: each target then reports its own failure.
  if (buildFirst && targets.length > 0) {
    core.startGroup(`Building ${targets.length} targets`);
    const built = Date.now();
    const res = await new Promise((resolve) => {
      const p = spawn(bazel, ["build", ...targets], { stdio: "inherit" });
      p.on("close", resolve);
      p.on("error", (e) => {
        core.warning(`Could not start ${bazel} build: ${e.message}`);
        resolve(-1);
      });
    });
    core.endGroup();
    if (res !== 0) {
      core.warning(`${bazel} build exited with ${res}: running every target to report each failure`);
    }
    core.info(`Build took ${prettyMilliseconds(Date.now() - built)}`);
  }
  core.startGroup(`Running ${targets.length} targets`);
  let t = 1;
  let err = 0;
  for (let target of targets) {
    if (check) {
      await octokit.rest.checks
        .update({
          check_run_id: check.id,
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          name: core.getInput("checkName"),
          conclusion: err > 0 ? "failure" : undefined,
          output: {
            title: `Bazel run on tag ${tag}`,
            summary: `${targets.length} tasks - ${t - 1 - err} succeed - ${
              targets.length - (t - 1)
            } pending${
              err > 0 ? ` - ${err} errored` : ""
            } - ${bazel} run ${target}`,
            text: output,
          },
        })
        .catch((e) => {
          core.warning(`Could not update status: ${e.message}`);
        });
    }
    core.info(`[${t}/${targets.length}] Target: ${target}`);
    const res = await spawnPromise(`${bazel} run ${target}`, {
      shell: true,
    });
    if (res.status !== 0) {
      err++;
      // Without a check run (Forgejo, no token) the log is the only place to see why
      core.error(`${target} failed with exit code ${res.status}`);
      core.info(res.stderr.toString());
      output += `## :x: ${target}\n\n<details><summary>Details</summary>stderr\n\n\`\`\`${res.stderr.toString()}\`\`\`\n\nstdout\n\n\`\`\`${res.stdout.toString()}\`\`\`\n\n</details>\n\n`;
    } else {
      output += `## :white_check_mark: ${target}\n\n`;
      if (!ignoreSuccessOutput) {
        output += `<details><summary>Details</summary>\n\n\`\`\`${res.stdout.toString()}\`\`\`\n\n</details>\n\n`;
      }
    }
    t++;
  }
  core.endGroup();
  let took = `Took ${prettyMilliseconds(Date.now() - start)}`;
  output += `\n\n${took}\n\n`;
  if (check) {
    await octokit.rest.checks
      .update({
        check_run_id: check.id,
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        completed_at: new Date().toISOString(),
        conclusion: err > 0 ? "failure" : "success",
        name: core.getInput("checkName"),
        output: {
          title: `Bazel run on tag ${tag}`,
          summary: `${targets.length} tasks - ${t - err} succeed${
            err > 0 ? ` - ${err} errored` : ""
          }`,
          text: output,
        },
      })
      .catch((e) => {
        core.warning(`Could not update status: ${e.message}`);
      });
  }
  // Job summary: GitHub run page, Forgejo >= 17
  await core.summary
    .addRaw(output)
    .write()
    .catch((e) => {
      core.warning(`Could not write job summary: ${e.message}`);
    });
  if (err > 0) {
    core.setFailed(`${err} of ${targets.length} targets failed`);
  }
} catch (error) {
  // Handle errors and indicate failure
  core.setFailed(error.message);
}
