# Digital assets and source-file integrity

**Status:** Proposed

## Source-file date rule

The original modified date of a business source file is evidence about when the
file was created or last changed. POP systems must preserve it when scanning,
copying, moving, indexing, downloading, uploading, or processing the file.

An application's processing time belongs in separate audit fields. It must not
overwrite the source file's business date. If a platform cannot preserve the
date, the workflow must stop or report the loss loudly rather than silently
substituting the current time.

This rule applies to every application, worker, helper, import, and storage move
that handles business source files. It is not a PopDAM-only programming rule.

## Related evidence and implementation guidance

PopDAM's [project guide](https://github.com/u2giants/popdam3/blob/main/docs/PROJECT_BIBLE.md), [path guide](https://github.com/u2giants/popdam3/blob/main/docs/PATH_UTILS.md), and
[worker guide](https://github.com/u2giants/popdam3/blob/main/docs/WORKER_LOGIC.md) contain the detailed operating and implementation
requirements. Those documents must link to this rule and may explain how their
component complies, but they do not own a separate version of the business rule.

