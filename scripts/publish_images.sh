#!/usr/bin/env bash
# Publishes images/<region>/ to the `images` branch of a git remote as one orphan commit.
#
# Usage: scripts/publish_images.sh <remote> [<region>]
#   <remote>  git remote name or URL (origin, a path to a bare repo, ...)
#   <region>  region directory under images/ (default ivano-frankivsk)
#
# Steps:
#   1. Build an orphan commit from images/<region>/*.png, images/<region>/meta.json and README.md.
#      A temporary index is used, so the current checkout and index stay unchanged.
#   2. If <remote> has `images`, keep its commit as `images-YYYYMMDD-HHMM`
#      (committer date in Europe/Kyiv; -2, -3, ... if the name exists).
#   3. Push the new commit to `images` with --force-with-lease against the old sha (atomic with step 2).
#   4. Delete remote branches ^images-\d{8}-\d{4}(-\d+)?$ older than KEEP_DAYS (default 30) days.
#      The archive created in this run is never deleted. Pruning is housekeeping: a failure
#      prints a warning and does not change the exit code.
#
# Env: KEEP_DAYS (default 30). The repo slug for README links comes from meta.json sourceRepo.
# Run from the repository root. The commit identity comes from git config.

set -euo pipefail

REMOTE="${1:?usage: publish_images.sh <remote> [<region>]}"
REGION="${2:-ivano-frankivsk}"
BRANCH="images"
KEEP_DAYS="${KEEP_DAYS:-30}"
SRC_DIR="images/$REGION"
ARCHIVE_RE='^images-([0-9]{8})-([0-9]{4})(-[0-9]+)?$'
TMP_REF="refs/publish-images/old"

log() { echo "[publish] $*"; }
warn() { echo "::warning::[publish] $*"; }

[ -f "$SRC_DIR/meta.json" ] || { echo "[ERROR] $SRC_DIR/meta.json not found" >&2; exit 1; }
shopt -s nullglob
pngs=("$SRC_DIR"/*.png)
shopt -u nullglob
[ "${#pngs[@]}" -gt 0 ] || { echo "[ERROR] no PNG files in $SRC_DIR" >&2; exit 1; }

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmpdir"
  git update-ref -d "$TMP_REF" 2>/dev/null || true
}
trap cleanup EXIT

# ---- 1. Orphan commit -------------------------------------------------------
meta_field() { # <field>
  node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(m[process.argv[2]]??""))' "$SRC_DIR/meta.json" "$1"
}
schedule_update="$(meta_field scheduleUpdate)"
schedule_update="${schedule_update:-unknown}"
source_repo="$(meta_field sourceRepo)"
[ -n "$source_repo" ] || { echo "[ERROR] meta.json has no sourceRepo" >&2; exit 1; }

cat > "$tmpdir/README.md" <<EOF
# images

This branch holds the current PNG images of the Ivano-Frankivsk outage schedule and \`meta.json\`.
The CI workflow replaces it with one new orphan commit each time the schedule changes.
Previous versions stay in \`images-YYYYMMDD-HHMM\` branches for ${KEEP_DAYS} days.

Гілка містить поточні PNG-зображення графіка відключень та \`meta.json\`.
Опис, адреси файлів і правила оновлення: ${source_repo}#readme
EOF

export GIT_INDEX_FILE="$tmpdir/index"
git read-tree --empty
add_file() { # <source path> <path in tree>
  local blob
  blob="$(git hash-object -w -- "$1")"
  git update-index --add --cacheinfo "100644,$blob,$2"
}
for f in "${pngs[@]}"; do add_file "$f" "$SRC_DIR/$(basename "$f")"; done
add_file "$SRC_DIR/meta.json" "$SRC_DIR/meta.json"
add_file "$tmpdir/README.md" "README.md"
tree="$(git write-tree)"
unset GIT_INDEX_FILE
new_sha="$(git commit-tree "$tree" -m "images: schedule $schedule_update")"
log "new commit $new_sha (tree $tree, ${#pngs[@]} png)"

# ---- 2 + 3. Rotate and push -------------------------------------------------
remote_heads="$(git ls-remote --heads "$REMOTE")"
old_listed="$(awk -v r="refs/heads/$BRANCH" '$2 == r { print $1 }' <<<"$remote_heads")"

push_args=()
archive=""
if [ -n "$old_listed" ]; then
  git fetch --quiet --no-tags --depth=1 "$REMOTE" "+refs/heads/$BRANCH:$TMP_REF"
  old_sha="$(git rev-parse "$TMP_REF")"
  stamp="$(TZ=Europe/Kyiv git show -s --date=format-local:%Y%m%d-%H%M --format=%cd "$old_sha")"
  archive="images-$stamp"
  n=1
  while awk -v r="refs/heads/$archive" '$2 == r { found = 1 } END { exit !found }' <<<"$remote_heads"; do
    n=$((n + 1))
    archive="images-$stamp-$n"
  done
  log "rotate: $BRANCH ($old_sha) -> $archive"
  push_args+=("$old_sha:refs/heads/$archive")
  lease="--force-with-lease=refs/heads/$BRANCH:$old_sha"
else
  log "remote has no $BRANCH branch, create it"
  lease="--force-with-lease=refs/heads/$BRANCH:"
fi
push_args+=("$new_sha:refs/heads/$BRANCH")

git push --atomic --no-verify "$lease" "$REMOTE" "${push_args[@]}"
log "pushed $new_sha to $BRANCH"

# ---- 4. Prune old archives --------------------------------------------------
cutoff="$(node -e '
const d = new Date(Date.now() - Number(process.argv[1]) * 864e5);
const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
process.stdout.write(`${p.year}${p.month}${p.day}${p.hour}${p.minute}`);
' "$KEEP_DAYS")" || cutoff=""

to_delete=()
if [ -z "$cutoff" ]; then
  warn "prune skipped: cannot compute the cutoff date"
elif heads_now="$(git ls-remote --heads "$REMOTE")"; then
  while read -r _ ref; do
    [ -n "${ref:-}" ] || continue
    name="${ref#refs/heads/}"
    [ "$name" != "$archive" ] || continue # never delete the archive created in this run
    if [[ "$name" =~ $ARCHIVE_RE ]]; then
      ts="${BASH_REMATCH[1]}${BASH_REMATCH[2]}"
      if [[ "$ts" < "$cutoff" ]]; then to_delete+=("$name"); fi
    fi
  done <<<"$heads_now"
else
  warn "prune skipped: cannot list remote branches"
fi

if [ "${#to_delete[@]}" -gt 0 ]; then
  log "delete archives older than $KEEP_DAYS days (before $cutoff Kyiv): ${to_delete[*]}"
  if ! git push --no-verify "$REMOTE" --delete "${to_delete[@]}"; then
    warn "failed to delete old archive branches: ${to_delete[*]}"
  fi
else
  log "no archives older than $KEEP_DAYS days"
fi
