# bazel-actions

This action run bazel targets and output their status in checks.

Example of usage:

```
      - uses: bazelbuild/setup-bazelisk@v3
      # New version of setup-bazelisk
      # https://github.com/bazel-contrib/setup-bazel
      - uses: loopingz/bazel-actions@main
        with:
          tag: on_push
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

It will execute every target that includes the tag `on_push`

With `GITHUB_TOKEN` set, progress is reported in a check run. Where the Checks API is not
available (Forgejo/Gitea, or a token without `checks: write`), the action logs a warning and runs
the targets without a check.

```
kubectl(
    name = "apply",
    ...
    tags = ["on_push"],
)
```

You can check in your repository with:

```
bazel query "attr(tags, '\\bon_push\\b', //...)"
```
