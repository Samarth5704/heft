#!/usr/bin/env bash
#
# assemble-site.sh — decide, explicitly, what goes on the public internet.
#
# THE HAZARD THIS EXISTS FOR
#
# GitHub Pages serves whatever the deploy job uploads, at a public URL, with no
# index and no authentication. The obvious way to write that job is to point
# `actions/upload-pages-artifact` at `path: .` — and then the set of published
# files is "whatever happens to be in the repository", which is not a decision
# anybody made. Every file a future contributor drops in the root is published
# by default, silently, and stays published.
#
# That is not hypothetical here. A screenshot rig was left in `.audit/` during
# this project's final pass. It was a page that wrote sample data into
# localStorage. Under `path: .` it would have shipped, and anyone who loaded it
# from the live site would have had their ledger overwritten. It was caught by
# noticing, which is another word for luck.
#
# So this script inverts the default. Nothing is published unless it is named in
# PUBLISH below. And because a fail-closed allowlist fails *silently* — a new
# file simply never appears, which is safe but uninformative — every top-level
# entry must be classified as one or the other. A new file in the root fails the
# build until somebody decides which it is.
#
# Three guards, and they fail in three different directions:
#
#   PUBLISH names something missing   the app was renamed and the site would
#                                     have shipped without it
#   WITHHELD names something missing   the list is describing a repository that
#                                     no longer exists
#   the root holds something unnamed   nobody has decided whether the public
#                                     should be able to fetch it
#
# Run by both jobs in deploy.yml: `checks` runs it to gate pull requests, and
# `deploy` runs it to build the thing it uploads. One source of truth.

set -euo pipefail

# --------------------------------------------------------------- published --
# The app, and the test page. `tests.html` is deliberate rather than an
# oversight: the suite is a fair thing to let a reader run, and it is safe to
# publish because it drives the store through an in-memory `fakeStorage()` and
# never touches the real ledger.
PUBLISH="index.html css js tests.html"

# --------------------------------------------------------------- withheld --
# Present in the repository, deliberately not on the website. The reason
# matters more than the list:
#
#   docs          working documents and the reference screenshots, which are
#                 someone else's application. Public on GitHub already; there is
#                 no reason to serve them from the app's own origin too.
#   scripts       dev tooling, including a local server.
#   tests         a scratch page for eyeballing the icon registry.
#   CLAUDE.md     working rules for this repository, not documentation for it.
#   README.md     rendered by GitHub from the repo; the site does not need it.
#   .nojekyll     only meaningful on the deploy-from-a-branch path, where it is
#                 read from the branch rather than from this artifact.
WITHHELD="CLAUDE.md README.md docs scripts tests .gitignore .nojekyll"

# Infrastructure, never a candidate either way.
INFRA=".git .github .claude"

# ---------------------------------------------------------------- checks --

# Cleared before the scan, not after it. `_site` is this script's own output,
# so leaving it in place would make the second run in any working copy report
# it as an unclassified top-level entry and fail — the guard catching itself.
rm -rf _site

fail=0

missing=""
for path in $PUBLISH; do
  [ -e "$path" ] || missing="$missing $path"
done
if [ -n "$missing" ]; then
  echo "::error::Allowlisted path(s) missing from the repository:$missing"
  echo "  Something was renamed or deleted without updating PUBLISH."
  fail=1
fi

# A withhold that names a path which is no longer here is a lie about what the
# repository contains, and a comfortable one: it reads as a deliberate decision
# to keep something off the site when in fact there is nothing to keep off. The
# row for legacy.html became exactly that the moment the v1 page was deleted.
# Held to the same standard as PUBLISH — if it is named, it must exist.
stale=""
for path in $WITHHELD; do
  [ -e "$path" ] || stale="$stale $path"
done
if [ -n "$stale" ]; then
  echo "::error::Withheld path(s) that no longer exist:$stale"
  echo "  Remove them from WITHHELD. A withhold for a file that is gone claims"
  echo "  the repository still contains something it does not."
  fail=1
fi

unclassified=""
for entry in $(ls -A); do
  case " $PUBLISH $WITHHELD $INFRA " in
    *" $entry "*) ;;
    *) unclassified="$unclassified $entry" ;;
  esac
done
if [ -n "$unclassified" ]; then
  echo "::error::Top-level entries that are neither published nor withheld:$unclassified"
  echo "  Every file in the repository root is a decision about what the public"
  echo "  can fetch. Add each one to PUBLISH or WITHHELD in"
  echo "  .github/assemble-site.sh, and say in a comment why."
  fail=1
fi

[ "$fail" -eq 0 ] || exit 1

# -------------------------------------------------------------- assemble --

mkdir -p _site
cp -r $PUBLISH _site/

echo "Publishing $(find _site -type f | wc -l) files, $(du -sh _site | cut -f1):"
find _site -type f | sed 's|^_site|  |' | sort
echo
echo "Withheld from the site: $WITHHELD"
