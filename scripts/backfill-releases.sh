#!/usr/bin/env bash
# Gives a tag and a GitHub release to every version of every package that is on npm and never got
# one, oldest first:
#
#   bash scripts/backfill-releases.sh [--dry-run]
#
# The release workflow tags a version when it publishes it, but for a while it missed most of them
# (it asked npm for the new version before npm was showing it). This goes back for those. It is
# run from the workflow, by hand, with "backfill" ticked; it needs `gh` signed in and the whole
# history checked out. A version whose commit can't be found (one published by hand from somewhere
# else) is left alone and said so. Nothing here publishes anything, and the newest release stays
# the one marked latest.
set -euo pipefail
: "${GH_REPO:?set GH_REPO to owner/repository}"
dry=${1:-}
made=0
for dir in packages/*/; do
  short=$(basename "$dir")
  [ "$(node -p "require('./$dir/package.json').private === true")" = "true" ] && continue
  name=$(node -p "require('./$dir/package.json').name")
  # Every version on npm, in the order they were published.
  versions=$(npm view "$name" versions --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s||"[]");console.log([].concat(v).join("\n"))})') || continue
  for version in $versions; do
    tag="$short-v$version"
    if gh api "repos/$GH_REPO/releases/tags/$tag" > /dev/null 2>&1; then continue; fi
    # The first commit along main in which the package says it is this version.
    sha=$(git log --first-parent --reverse --format=%H -S"\"version\": \"$version\"" -- "${dir}package.json" | sed -n 1p)
    if [ -z "$sha" ] || [ "$(git show "$sha:${dir}package.json" | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).version')" != "$version" ]; then
      echo "$tag: no commit on main set $name to $version; left alone."
      continue
    fi
    echo "$tag: releasing $name $version from ${sha:0:7}."
    made=$((made + 1))
    [ "$dry" = "--dry-run" ] && continue
    gh release create "$tag" --target "$sha" --title "$name $version" --generate-notes --latest=false \
      $(case "$version" in *-*) echo --prerelease;; esac)
  done
done
echo "backfill: $made release(s)$([ "$dry" = "--dry-run" ] && echo " would be made (dry run)" || echo " made")."
