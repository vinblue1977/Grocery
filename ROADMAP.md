# Roadmap

Ideas for the Grocery app, roughly in the order to do them. Everything stays on the $0 rule in `CLAUDE.md`, except the paper-list scan (cents a month). Show a mockup and get it approved before building any visible change.

## Done

- Household sign-in once per device (no passwords), single-use 24-hour invite links, device list with remove (the last device can't be removed), paste-an-invite for the Home Screen app
- Per-store lists (Costco, Patel, Butcher by default; add, rename, delete), add, check off into "In cart", delete, Clear, who added each item
- Sync across both phones every 5 seconds while the app is open (30 seconds when idle), failed edits undone with a message
- Per-device theme: light, dark or auto (Vinod defaults to dark, Yaso to light)
- Header Settings icon instead of a bottom bar; the system back gesture returns from Settings
- Photo of a paper list: shrunk on the phone, read by Claude Haiku 4.5 on Amazon Bedrock, reviewed before anything is added, 20 scans a day
- CI like TennisTracker (checks, cdk-nag, workflow lint, dependency review, CodeQL, PR title), auto-deploy to AWS and GitHub Pages, Dependabot auto-merge

## Next

- **Frequent items (Phase 4).** Per-store quick-add chips and autocomplete from what you buy often; an item added three times is suggested automatically; pin or remove manually. The mockup shows both.
- **Offline use (Phase 5).** A service worker that caches the app and queues edits made with no signal (Costco has poor reception), then replays them. Today a failed edit is undone with a message.
- **Try the scan on a real handwritten list.** Check accuracy, store headings and quantities; tune the prompt if needed. The first call also confirms Bedrock model access.

## Soon

- **Setup key and recovery.** Today whoever calls `POST /household` first owns the household, and clearing Safari data on your only device locks you out. A setup key (or a recovery code shown once) closes both.
- **Make CodeQL a required check** on `main` once it has reported on a PR.
- **Quantity and note editing** on an item (the data supports it; only the screen is missing), and tap-to-rename.
- **Swipe to delete** and undo for a deleted item or a cleared cart.
- **QR code for invites** so Yaso can scan instead of pasting a link.
- **Show people's names, not device names.** Items say "Yaso"; separate the person from the device in Settings.
- **Move an item to another store**, and a "Done shopping" action that clears the cart.
- **Scan polish.** Move the paper-list scan to Haiku 5.5 with one setting (`-c bedrockModel=...`) once it is confirmed available; let her take several photos in a row; show what a scan cost this month.

## Later

- **Push notifications** ("Yaso added 3 items to Costco") using Web Push, which works for Home Screen apps on iOS 16.4+ and is free.
- **Faster sync.** A "changed since" check or ETags so polls read almost nothing; WebSockets only if polling ever feels slow.
- **Recurring lists** (weekly staples that come back after Clear) and a "usually buy together" suggestion.
- **Share a single list read-only** (for a friend picking things up), and more than two people per household.
- **Aisle or category order** so a list matches how you walk the store.
- **Export or backup** of the lists to a file.
- **Android and desktop polish** (install prompt, keyboard use).

## Hardening and housekeeping

- **Deploy retry.** The deploy decision looks only at the current push, so a failed deploy followed by a docs-only merge isn't retried; consider comparing against what is live.
- **Rate cap on the public function URL.** A Lambda concurrency limit would bound it, but new AWS accounts can't always reserve concurrency; the device token and the 5 RCU/WCU table are the real guard today.
- **Dependabot majors.** The pip, Actions and root npm groups still auto-merge major bumps (frontend majors are held back); add a guard if one ever bites.
- **Shared header component** for the Lists and Settings headers; one error boundary around the app.
- **minimatch alert (dev-only).** No patched release exists; dismiss it or wait for ESLint to move.
- **Remove the unneeded extra read** when adding an item (the device name lookup) by carrying the name in the session.
- **Retire a stale token** automatically for devices unused for months.
