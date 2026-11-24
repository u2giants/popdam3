# HANDOFF — #1272 item 3: Helper Brazil/Seafile pilot on a real Mac

Issue: https://github.com/u2giants/popdam3/issues/1272 (open). Written 2026-11-24 11:21 AM EST by Claude session a2dd7ebd on hetz.

## 1. Goal
Record one real Check Out / Check In round trip with the PopDAM Helper on a Mac in Brazil (Seafile storage), plus one on-device check-out/check-in from the Photoshop UXP plugin. Then close #1272.

## 2. State right now
- Items 1 and 2 of #1272 are done and proven. Item 1: PopDAM reads production orders from the shared DB. Item 2: the hi-res tagging image is live, and the Railway worker runs d4810b7b with heartbeat sha d4810b7b at 11:17 AM EST 2026-11-24.
- Item 3 is **Blocked**: it needs a physical Mac in Brazil. There is no Mac reachable from hetz or the other AI machines.
- Server side verified 2026-11-23, see https://github.com/u2giants/popdam3/issues/1272#issuecomment-7107393259:
  - Seafile `/api2/ping` returns 200.
  - `HELPER_SEAFILE_SERVER_URL` and `HELPER_SEAFILE_LIBRARIES` are set in production.
  - The latest Helper publish workflow succeeded 2026-11-19.

## 3. What was tried / ruled out
- No remote Mac or screen-share path exists. Do not try to fake the test with a Linux client, because the Seafile settings are chosen per region and the issue requires the macOS Helper.
- Settled design (do not reopen):
  - storage provider is chosen per machine/region;
  - the library is matched by longest path prefix;
  - SeaDrive is not the sync client;
  - code signing is permanently abandoned.

  References: https://github.com/u2giants/popdam3/blob/main/docs/POPDAM_HELPER.md and https://github.com/u2giants/popdam3/blob/main/docs/SEAFILE_INTEGRATION.md

## 4. Exact next steps (on a Brazil Mac)
1. Install the latest Helper release, then sign in.
2. Check Out one file under `Decor/Character Licensed`, edit it, then Check In.
3. Confirm the checkout row reaches `complete` in the shared DB, and the file version lands in the Seafile library.
4. Load the unsigned Photoshop UXP plugin through UXP Developer Tool and repeat one checkout/check-in from inside Photoshop.
5. Post evidence (times in EST, checkout id, Seafile file history) on #1272 and close it.

## 5. How to verify
A checkout row with status `complete` plus a new Seafile file revision at the same time, for both the Helper run and the plugin run.

## 6. Who can unblock
Anyone in the Brazil office with a Mac, or a remote-control session onto one. If an AI session gains Mac access (for example, computer use on a Brazil Mac), it does every step itself.

## 7. Risks
The UXP plugin is unsigned, so the UXP Developer Tool needs developer mode. A Helper that was installed before 2026-11-19 must be updated first.

## 8. Not in scope
Item 1 and item 2 follow-ups: none remain. The copy tables were dropped by fork session PR #1306.

## 9. Retention
Delete this file once #1272 is closed with the Mac evidence.
