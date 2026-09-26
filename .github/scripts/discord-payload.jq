# Builds the Discord webhook payload for one CI run of .github/workflows/ci.yml (job "notify").
# Pure: every input arrives through --arg/--argjson, so it runs the same on sample data locally.
#
#   --argjson jobs     this attempt's jobs from the Actions API, without the notify job itself
#   --argjson commits  github.event.commits (push), or [the deployed commit] for a manual run
#   --arg check / deploy       needs.<job>.result: success | failure | cancelled | skipped
#   --arg repo server branch sha event actor run_number run_attempt run_url compare site

def short: .[0:7];
def cut($n): if length > $n then .[0:$n - 1] + "…" else . end;
def duration: if . < 60 then "\(.)s" else "\(. / 60 | floor)m \(. % 60)s" end;
def seconds: if .started_at and .completed_at
  then (.completed_at | fromdateiso8601) - (.started_at | fromdateiso8601) else null end;
# Commit subjects are shown as written: no bold, italics or links someone typed into a message.
def plain: gsub("(?<c>[\\\\`*_~|\\[\\]])"; "\\\(.c)");
def icon: {success: "✅", failure: "❌", cancelled: "⏹️", skipped: "⏭️", timed_out: "⌛"}[.] // "❔";

($deploy != "skipped") as $deployed
| (if $deployed then $deploy else $check end) as $result
| ($result == "success") as $ok

# The first job that did not pass, and its first failed step: "Deploy to staging → Migrate and start".
| ($jobs | map(select(.conclusion != "success" and .conclusion != "skipped")) | first) as $bad
| (if $bad == null then null
   else ([$bad.steps[]? | select(.conclusion == "failure")] | first | .name) as $step
     | if $step then "\($bad.name) → \($step)" else $bad.name end
   end) as $where

# Before "Migrate and start" nothing running on the server has changed; from there on it may have.
| (if $ok or ($bad.name // "") != "Deploy to staging" then null
   elif $where == "Deploy to staging → Migrate and start"
   then "⚠️ Containers may have been replaced: check the server, or roll back `IMAGE_TAG` in `/opt/cms/.env`."
   else "Running containers untouched: the previous release is still live."
   end) as $server_state

| ([$jobs[] | select(.conclusion != "skipped") | .started_at, .completed_at | select(.)
    | fromdateiso8601]) as $times
| (if ($times | length) > 1 then ($times | max) - ($times | min) else null end) as $total

| ($commits // []) as $all
| ($all | length) as $n
| ([$all | reverse | .[0:5][]
    | "• [\(.id | short)](\(.url)) \(.message | split("\n")[0] | cut(100) | plain)"]) as $lines
| (if $n == 0 then null
   else ([(if $ok and $deployed then "**Deployed changes**" else "**Changes in this run**" end)
          + " (\($n) commit\(if $n == 1 then "" else "s" end))"]
         + $lines
         + (if $n > 5 then ["…and \($n - 5) more"] else [] end)
         + (if $compare != "" then ["[Compare \($compare | split("/") | last | sub("\\.\\.\\."; "…"))](\($compare))"] else [] end))
        | join("\n")
   end) as $changes

| (if $event == "workflow_dispatch" then "run manually by \($actor)" else "pushed by \($actor)" end) as $by
| ($site | sub("^https?://"; "")) as $site_host

| {
    username: "CMS CI",
    allowed_mentions: {parse: (if $ok then [] else ["everyone"] end)},
    embeds: [{
      title: (if $deployed and $ok then "✅ Staging updated · \($site_host)"
              elif $deployed then "❌ Staging deploy failed"
              elif $ok then "✅ CI passed on \($branch)"
              else "❌ CI failed on \($branch)" end),
      url: $run_url,
      color: (if $ok then 3066993 else 15158332 end),
      description: ([
          "`\($branch)` · [\($sha | short)](\($server)/\($repo)/commit/\($sha)) · \($by)"
            + (if $total then " · total \($total | duration)" else "" end),
          (if $ok then empty else "**Failed at:** \($where // "unknown step")" end),
          ($server_state // empty),
          ($changes // empty),
          (if $ok and $deployed
           then "[Open CMS](\($site)) · [View run #\($run_number)](\($run_url))"
           else "[View \(if $ok then "" else "failed " end)logs: run #\($run_number), attempt \($run_attempt)](\($run_url))" end)
        ] | join("\n\n")),
      fields: ([$jobs[] | {
          name: .name,
          value: ((.conclusion | icon) + " " + (if .conclusion == "skipped" then "skipped" else (seconds | duration) end)),
          inline: true
        }]
        + (if $ok and $deployed then [{name: "Image", value: "`cms-web:\($sha | short)`", inline: true}] else [] end)),
      footer: {text: "\($repo) · CI #\($run_number)"},
      timestamp: (now | todate)
    }]
  }
  + (if $ok then {} else {content: "@here"} end)
