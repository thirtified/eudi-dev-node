# Helpers for .github/workflows/release.yml. Source it: `. scripts/release-lib.sh`

# Succeeds when <name>@<version> is published or already staged.
already_released() {
  if [ "$(npm view "$1@$2" version 2>/dev/null)" = "$2" ]; then
    echo "$1@$2 is already published, skipping"
    return 0
  fi
  # `npm stage list` may be unavailable (short-lived trusted-publishing tokens
  # can't run it). Then a duplicate stage fails loudly, which is fine.
  if npm stage list "$1" --json 2>/dev/null | grep -q "\"$2\""; then
    echo "$1@$2 is already staged, skipping. Approve it on npmjs.com or with npm stage approve."
    return 0
  fi
  return 1
}

# Records a staged version in the job summary.
staged() {
  echo "Staged $1@$2"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    echo "- Staged \`$1@$2\`. Approve it at https://www.npmjs.com/package/$1 or with \`npm stage list $1\` and \`npm stage approve <id>\`." >> "$GITHUB_STEP_SUMMARY"
  fi
}
