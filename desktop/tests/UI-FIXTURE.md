# UI fixture checks

The management UI (`desktop/ui`) can be exercised in a plain browser against an isolated fixture. This file lists what those checks cover and how to run them. The repository does not ship recorded results, screenshots or logs: run the checks to produce your own.

## Fixture

`node desktop/tests/fixture.cjs` serves `desktop/ui` on `http://127.0.0.1:42197` (override with `SSHCC_UI_TEST_PORT`) and replaces the Tauri IPC bridge with an in-memory stub. It does not use local IPC, SSH, a real Target or production data. Its stub answers only these methods; anything else (method or native command) returns an error:

- `system.status`, `targets.list`, `targets.doctor`, `targets.update`, `fleet.health`
- `jobs.*`, `files.list`, `files.read`, `files.write`, `enrollment.export`
- pairing: `pairing.create`, `pairing.status` (list, one request, or address retry), `pairing.complete`, `pairing.cancel`
- folders and datacenters: `folders.list`, `folders.create`, `folders.rename`, `folders.delete`, `folders.assign`, `datacenters.list`, `datacenters.create`, `datacenters.assign`
- Merges and relays: `merges.list`, `merges.discover`, `merges.add`, `merges.sync`, `merges.remove`, `relays.list`, `relays.allow`, `relays.revoke`
- allowed Masters: `masters.list`, `masters.revoke`, `enrollment.accept`
- native commands: shell open, `open_json` / `save_json` (always cancelled), and `save_setup` ("save installer"; it returns a fixed path and writes nothing)

Test-only endpoints:

- `GET /calls` returns every request the page sent, which the checks inspect.
- `GET /pairing-code[?requestId=…][&master=other]` returns the Pairing code the new host would show after Approve (default: the newest request awaiting approval). `master=other` gives a code made for another Master, which `pairing.complete` refuses with `E_PAIRING_MASTER`. Any other text is refused as a damaged code.
- `POST /scenario` with `{"flags": [...]}` resets all state to that scenario and clears `/calls`.

Scenarios are comma-separated flags in `SSHCC_FIXTURE_SCENARIO` (or `POST /scenario`). With no flags the fixture has one Target, `ui-test`, and one allowed Master.

- `empty`: an empty Master: no hosts, folders, Merges, relays or allowed Masters.
- `new-host-master`: every host paired through the fixture is itself a Master, so `merges.discover` and `fleet.health` report `isMaster` and `merges.add` returns three merged hosts.

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

`desktop/tests/add-host.cjs` walks the one-column add flow ("+ Add host": address, Save installer…, paste the code) from an empty Master (plain Chromium) and fails if adding one host takes more than 2 decisions. It checks: one sidebar button with no dropdown; exactly one current step (`aria-current="step"`, acid only on its number) and focus on its main control; the empty name sent as the address and the host shown in the tree; a code from another Master and a damaged code each shown as a plain sentence in place, with no submit button and one `pairing.complete` per distinct pasted value; an unfinished request listed with Resume / Cancel; "Add host here…" on a folder pre-selecting and applying it; the `new-host-master` scenario; no motion under reduced motion; and no on-screen "target". It writes screenshots at 1180px and 820px and `add-host-results.json` under `artifacts/add-host-ui/`. Run it in the Playwright image:

    docker run --rm -v "$PWD":/src -v <node_modules with playwright>:/pw/node_modules:ro -e NODE_PATH=/pw/node_modules -w /src mcr.microsoft.com/playwright:v1.48.2-jammy node desktop/tests/add-host.cjs

## Not covered

These checks validate UI behavior only. They do not exercise the native tray, native file dialogs, the real service, SSH, installer service lifetime or idle RAM/CPU. See [docs/VALIDATION.md](../../docs/VALIDATION.md) for the other test layers and their limits.
