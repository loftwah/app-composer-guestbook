# Contributing

Questions, documentation, design, accessibility reports and code are welcome. Start with an existing issue or describe an observed problem; no whole-system expertise is required. Read README.md and the owning App Composer issue.

Install the pinned dependencies and run `pnpm dev`. Run the short check or test command listed in package.json for your change; see README for deployment validation. Use fictional fixtures and your own resources/keys. Do not publish credentials, user data or an owner export.

UI changes need phone/desktop evidence, both themes, keyboard/focus/error paths and useful metadata. Preserve independent source, configuration and data boundaries. Keep synthetic-only restrictions and explicit disclosure in the assistant-state app. Generated artwork retains prompt provenance.

Open a small pull request explaining the problem, resulting behavior and actual checks. Maintainers review and deploy through existing tools; no GitHub Actions. See CODE_OF_CONDUCT.md, SECURITY.md and ACCESSIBILITY.md.
