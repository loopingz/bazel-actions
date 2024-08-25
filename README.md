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

```
kubectl(
    name = "apply",
    ...
    tags = ["on_push"],
)
```
