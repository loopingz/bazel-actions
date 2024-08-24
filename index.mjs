import * as core from "@actions/core";
import * as github from "@actions/github";
import { execSync, spawnSync } from "child_process";
import prettyMilliseconds from "pretty-ms";

try {
  const tag = core.getInput("tag");
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
    check = (
      await octokit.rest.checks.create({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        name: core.getInput("checkName"),
        head_sha: github.context.sha,
        status: "in_progress",
        started_at: new Date().toISOString(),
      })
    ).data;
  }

  const ignoreSuccessOutput = core.getBooleanInput("ignoreSuccessOutput");
  core.startGroup(`Collecting targets for tag '${tag}'`);
  const targets = execSync(`bazel query ${query}`)
    .toString()
    .split("\n")
    .filter((e) => e != "");
  targets.forEach((target) => core.info(target));
  core.endGroup();
  if (check) {
    await octokit.rest.checks.update({
      check_run_id: check.id,
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      name: core.getInput("checkName"),
      output: {
        title: `Bazel run on tag ${tag}`,
        summary: `${targets.length} tasks`,
      },
    });
  }
  let output = `# Bazel run on tag ${tag}\n\n`;
  core.startGroup(`Running ${targets.length} targets`);
  let t = 1;
  let err = 0;
  for (let target of targets) {
    core.info(`[${t++}/${targets.length}] Target: ${target}`);
    const res = spawnSync(`bazel run ${target}`, {
      shell: true,
    });
    if (res.status !== 0) {
      err++;
      output += `## :x: ${target}\n\n<details><summary>Details</summary>stderr\n\n\`\`\`${res.stderr.toString()}\`\`\`\n\nstdout\n\n\`\`\`${res.stdout.toString()}\`\`\`\n\n</details>\n\n`;
    } else {
      output += `## :white_check_mark: ${target}\n\n`;
      if (!ignoreSuccessOutput) {
        output += `<details><summary>stdout</summary>${res.stdout.toString()}</details>\n\n`;
      }
    }
    if (check) {
      octokit.rest.checks.update({
        check_run_id: check.id,
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        name: core.getInput("checkName"),
        conclusion: err > 0 ? "failure" : undefined,
        output: {
          title: `Bazel run on tag ${tag}`,
          summary: `${targets.length} tasks${
            err > 0 ? ` - ${err} errored` : ""
          }`,
          text: output,
        },
      });
    }
  }
  core.endGroup();
  let took = `Took ${prettyMilliseconds(Date.now() - start)}`;
  output += `\n\n${took}\n`;
  if (check) {
    await octokit.rest.checks.update({
      check_run_id: check.id,
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      completed_at: new Date().toISOString(),
      conclusion: err > 0 ? "failure" : "success",
      name: core.getInput("checkName"),
      output: {
        title: `Bazel run on tag ${tag}`,
        summary: `${targets.length} tasks${err > 0 ? ` - ${err} errored` : ""}`,
        text: output,
      },
    });
  }
} catch (error) {
  // Handle errors and indicate failure
  core.setFailed(error.message);
}
