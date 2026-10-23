# UI fixture checks

The management UI (`desktop/ui`) can be exercised in a plain browser against an isolated fixture. This file lists what those checks cover and how to run them. The repository does not ship recorded results, screenshots or logs: run the checks to produce your own.

## Fixture

`node desktop/tests/fixture.cjs` serves `desktop/ui` on `http://127.0.0.1:42197` (override with `SSHCC_UI_TEST_PORT`) and replaces the Tauri IPC bridge with an in-memory stub. It does not use local IPC, SSH, a real Target or production data. It also serves `strings.js` and the bundled fonts. Its stub answers only these methods; anything else (method or native command) returns an error:

- `system.status`, `targets.list`, `targets.doctor`, `targets.update`, `fleet.health`
- `jobs.*`, `files.list`, `files.read`, `files.write`, `enrollment.export`
- pairing: `pairing.create` (`os: "unknown"` returns a Windows and an Ubuntu request linked by `sibling`; completing one removes the other, whose code then fails with `E_PAIRING_REPLACED`), `pairing.status` (list, one request, or address retry), `pairing.preview` (read only: host name, OS and a fake SHA-256 Host key fingerprint), `pairing.complete` (with an optional `label`), `pairing.cancel`, `pairing.check` (SSH answers only at 192.0.2.33 (Windows), 192.0.2.32 and 192.0.2.99 (Ubuntu) on port 22; 192.0.2.99 answers after 1.5 s; "already added" from the fixture's hosts and requests awaiting approval; with `requestId`, that request and its sibling are not counted)
- folders and datacenters: `folders.list`, `folders.create`, `folders.rename`, `folders.delete`, `folders.assign`, `datacenters.list`, `datacenters.create`, `datacenters.assign`
- Merges and relays: `merges.list`, `merges.discover`, `merges.add`, `merges.sync`, `merges.remove`, `relays.list`, `relays.allow`, `relays.revoke`
- allowed Masters: `masters.list`, `masters.revoke`, `enrollment.accept`
- native commands: shell open, `open_json` / `save_json` (always cancelled), `save_setup` ("save installer"; it returns a fixed path and writes nothing; for a sibling pair it returns `{folder, paths, files}` with the `.exe` and the `.deb`) and `merge_two_way` (marks the Merge two-way and adds the other Master as a relay); `targets.list` also lists each Merge's hosts as `<master>/<child>` (relayed)

Test-only endpoints:

- `GET /calls` returns every request the page sent, which the checks inspect.
- `GET /pairing-code[?requestId=…][&master=other]` returns the Pairing code the new host would show after Approve (default: the newest request awaiting approval). `master=other` gives a code made for another Master, which `pairing.preview` and `pairing.complete` refuse with `E_PAIRING_MASTER`. Any other text is refused as a damaged code.
- `POST /scenario` with `{"flags": [...]}` resets all state to that scenario and clears `/calls`.

Scenarios are comma-separated flags in `SSHCC_FIXTURE_SCENARIO` (or `POST /scenario`). With no flags the fixture has one Target, `ui-test`, and one allowed Master.

- `empty`: an empty Master: no hosts, folders, Merges, relays or allowed Masters.
- `new-host-master`: every host paired through the fixture is itself a Master, so `merges.discover` and `fleet.health` report `isMaster` and `merges.add` returns three merged hosts.
- `merge-fails`: `merges.add` / `merges.sync` fail as if the other Master did not answer.
- `needs-attention`: completing a pairing fails the connection check (`needs_attention` with one failed stage); an address retry (`pairing.status` with `routes`) then passes.
- `masters-page`: adds two hosts that are Masters (`branch-master`, already merged, and `hq-master`, not merged), an allowed Master `peer-both` that is also a relay, and a relay-only Master `peer-relay` with merging disabled.

`desktop/tests/decisions.cjs` holds the shared decision counter (each fill or choice on a field that was not pre-filled counts once) and `startFixture(flags)`, which starts the fixture on a free port for a check.

Fixture behaviors that the checks rely on:

- The first `jobs.start` records the job and then answers HTTP 504 ("simulated timeout after acceptance"). A correct client retries with the same job ID and ends up with exactly one job.
- Job stdout containing `<script>` text must render literally.
- `files.write` is rejected unless it carries the SHA-256 returned by the preceding `files.read`.
- The shell-open command answers with a session list when the Owner has several sessions, or opens directly when `SSHCC_FIXTURE_SINGLE_SESSION=1`.

## Manual checklist

[desktop/README.md](../README.md#ui-validation) lists the manual browser checks to run with Playwright CLI: job retry with the same UUID, literal rendering of script-like output, file edit with the SHA-256 precondition, the enrollment wizard mapping, and layouts at 1180px and 820px.

## Automated check

`desktop/tests/open-shell.cjs` drives the fixture with Playwright (it requires the `playwright` npm package and launches the Microsoft Edge channel; no `package.json` is shipped, so install it yourself). For a multi-session and a single-session fixture it checks that:

- the Shell button works from the fleet row and from the Target details page;
- with several Owner sessions a dialog appears, cancelling it sends no shell-open request, and the chosen session ID is sent;
- with one session no dialog appears and no session ID is sent;
- the request always carries the correct Target ID.

It writes screenshots and a results JSON under `artifacts/shell-button-ui/`, which is git-ignored.

`desktop/tests/add-host.cjs` walks the one-column add flow ("+ Add host": address, Save installer…, paste the code) from an empty Master (plain Chromium) and fails if adding one host takes more than 2 decisions. The core task is a Windows host with no SSH answer (192.0.2.31), so the OS is unknown: it checks that no OS is asked, `pairing.create` is sent with `os: "unknown"` and step 2 names both installers. It also checks: one sidebar button with no dropdown; exactly one current step (`aria-current="step"`, acid only on its number) and focus on its main control; the review card in step 4 (fingerprint shown, no `pairing.complete` and no host in the tree before Finish; a name and folder changed on the card are what get saved; "Open this host" opens the host's page); the empty name sent as the address and the host shown in the tree after Finish; the `needs-attention` path (failures listed, address-only retry, no second installer); a code from another Master and a damaged code each shown as a plain sentence in place, with no submit button, one `pairing.preview` per distinct pasted value and no `pairing.complete`; an unfinished sibling pair listed as one row with Resume / Cancel, and Cancel cancelling both requests; a detected OS (192.0.2.32) making one request and one installer; the code of the replaced sibling shown as "This installer was replaced by the other one you already used"; "Add host here…" on a folder pre-selecting and applying it; the `new-host-master` scenario (Merged with no click: "This host is a Master · n hosts merged", only the new host asked by `merges.discover`, its hosts in the tree, Two-way from the card); opened from a datacenter, a Master filed under it and a non-Master left unfiled with no message; `merge-fails` (plain failure line, host kept, Merge offered on the Masters page); no motion under reduced motion; and no on-screen "target". It writes screenshots at 1180px and 820px and `add-host-results.json` under `artifacts/add-host-ui/`. Run it in the Playwright image:

    docker run --rm -v "$PWD":/src -v <node_modules with playwright>:/pw/node_modules:ro -e NODE_PATH=/pw/node_modules -w /src mcr.microsoft.com/playwright:v1.48.2-jammy node desktop/tests/add-host.cjs

`desktop/tests/masters-page.cjs` opens the Masters page on the `masters-page` scenario (plain Chromium). It checks both sections ("Controlled from here" and "This Master is controlled by"), that the unmerged Master is listed with Merge without any search and that no `merges.discover` request is sent, that `peer-both` is one row with "Direct" and "Through merge" badges, that "Allow another Master…" sits in the incoming section, and that Merge, Disable merging, Allow again and Revoke send their requests. Screenshots at 1180px and 820px go to `artifacts/add-host-ui/`.

`desktop/tests/language.cjs` checks the language switch EN | ไทย (plain Chromium). It checks that a `th-TH` browser opens in ไทย and `en-US` in EN; that one click on ไทย (1 decision) switches the open page, survives a reload and overrides the browser default; that switching keeps the page, the selected host, the open tab and typed input (Add host address, file filter); and that every page and dialog has no untranslated English in Thai: inventory, the tree's context menus, the current Master page, host summary with a connection check, the Jobs (with the new job form), Files, Containers and Monitoring tabs, the file menu, the delete and session dialogs, Service, Masters (`masters-page`) with the two-way dialog, and every Add host step (`empty`). The scan covers visible text plus `aria-label`, `title`, `placeholder` and select options, with every `<details>` opened. It skips code, logs, monospace values and text marked `data-raw` (shown as the service sends it). Master, Tag, Merge, SSH, technical words and every word in the fixture's own data are allowed. It also checks that a code from another Master shows the Thai sentence with the Master's English underneath (`.error-detail`), that an unmapped error (`merge-fails`) shows English with no detail line, and that every EN string key has a TH key and the other way round. It writes Thai screenshots at 1180px and 820px and `language-results.json` under `artifacts/language-ui/`.

`node desktop/tests/strings-review.cjs` (no browser needed) writes `artifacts/language-ui/strings-review.html`: every string of `desktop/ui/strings.js` side by side in English and Thai, grouped by where it appears, with a box per row to write a fix and a button that copies all fixes as text. It is a translation review tool, not a check.

## Not covered

These checks validate UI behavior only. They do not exercise the native tray, native file dialogs, the real service, SSH, installer service lifetime or idle RAM/CPU. See [docs/VALIDATION.md](../../docs/VALIDATION.md) for the other test layers and their limits.
