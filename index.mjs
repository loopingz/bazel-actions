import { core } from "@actions/core";
import { github } from "@actions/github";

try {
  const tag = core.getInput("tag");
  const tags = execSync(`bazel query "attr(tags, '\\b${tag}\\b', //...)"`);
  console.log(`Tags found ${tags}!`);

  // Record the time of greeting as an output
  const time = new Date().toTimeString();
  core.setOutput("time", time);
} catch (error) {
  // Handle errors and indicate failure
  core.setFailed(error.message);
}
