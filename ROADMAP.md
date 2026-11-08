# Roadmap

Ideas for the Grocery app, roughly in the order to do them. Everything stays on the $0 rule in `CLAUDE.md`, except the paper-list scan (cents a month). Show a mockup and get it approved before building any visible change.

## Done

- Household sign-in once per device (no passwords), single-use 24-hour invite links, device list with remove (the last device can't be removed), paste-an-invite for the Home Screen app
- Per-store lists (Costco, Patel, Butcher by default; add, rename, delete), add, check off into "In cart", delete, Clear, who added each item
- Sync across both phones every 5 seconds while the app is open (30 seconds when idle), failed edits undone with a message
- Per-device theme: light, dark or auto (Victor defaults to dark, Yara to light)
- Header Settings icon instead of a bottom bar; the system back gesture returns from Settings
- Photo of a paper list: shrunk on the phone, read by Claude Haiku 4.5 on Amazon Bedrock, reviewed before anything is added, 20 scans a day
- CI like TennisTracker (checks, cdk-nag, workflow lint, dependency review, CodeQL, PR title), auto-deploy to AWS and GitHub Pages, Dependabot auto-merge
- Frequent items: per-store quick-add chips and suggestions from what you buy often, with pin and remove
- Offline use: a cached app shell and last list, and edits made with no signal queued and replayed in order when it returns
- Recovery code (shown once, only its hash stored) so losing every device doesn't lock the household out; a Welcome "Lost access?" mode
- A device can rename itself from Settings
- Fun touches: emojis on items, a celebration when the list is done, avatars, toasts when the other person adds items, greetings
- Settings cards for invites and the recovery code start collapsed; the Home Screen icon is dark
- Hardening: CodeQL is a required check on `main`, the public function URL is capped at 10 concurrent requests, and the repo history has no real name or email (new commits use the GitHub no-reply address)
- People, not devices: each device has a name and a person; a phone that joins or recovers asks "Who are you?"; items show the person; "You" card in Settings to change your name
- Update banner: "New version ready · Reload" when a new version has downloaded, instead of waiting for the second launch
- Swipe an item left to delete it, and Undo for a deleted item or a cleared cart (the delete is sent after six seconds, or when the app goes to the background)
- "Done shopping" (the old Clear, still undoable), and moving an item to another store from the edit sheet
- Avatar colors: each person picks one of eight in Settings (saved for the household, so both phones agree); without a pick the color stays automatic
- Recurring items: set Repeat (weekly, every 2 weeks, monthly) in the edit sheet; Done shopping rests them under "Coming back" and they return to To buy on their day (or with Add now)
- QR code for invites and partner joining: draw QR code in Settings, scan with the camera in the app
- Quantity, note, and name editing on an item via the tap-to-edit sheet
- Screen wake lock: the screen stays on while a store with items is open (still to check on a real iPhone)
- Settings cards (You, Appearance, Stores) start collapsed
- Checked on a real iPhone: offline edit and replay, and the paper-list scan on a handwritten list

## Next

- **Aisle or category order** so a list matches how you walk the store (Costco, Patel, etc.). Group items by store department (Produce, Dairy & Eggs, Meat, Pantry, Frozen, Household) using the existing emoji/keyword mappings with collapsible section headers, avoiding scrolling up and down while shopping.
- **Haptic feedback.** Subtle vibrations on item check-off, swipe-to-delete, and quick-add chips (`navigator.vibrate`) to give the PWA a native iOS feel.

## Soon

- **Offline edge cases.** A replayed edit that arrives after its item was deleted re-creates the item (needs short-lived tombstones); the "could not be saved" message under-counts if more edits are dropped while it shows (and should have `role="alert"`); a suggestion you removed can't be restored.
- **Faster sync with conditional ETags / 304.** The client sends `If-None-Match` or household version; Lambda checks only the single household metadata row (`META#HOUSEHOLD`) to return `304 Not Modified`, saving ~70–80% of DynamoDB RCUs and bandwidth during active polling.
- **Scan polish.** Move the paper-list scan to Haiku 5.5 with one setting (`-c bedrockModel=...`) once it is confirmed available; let her take several photos in a row for long lists; show scan count and month-to-date cost in Settings (`Scans this month: N (~$0.0X)`).

## Later

- **Push notifications** ("Yara added 3 items to Costco") using Web Push, which works for Home Screen apps on iOS 16.4+ and is free via VAPID keys.
- **Receipt reconciliation scan ("Done Shopping" receipt scan).** Snap the paper receipt at checkout; Bedrock Haiku compares it against "In cart" to verify everything was bought, flags anything missed, and tracks trip history.
- **"Usually buy together"** suggestions.
- **Share a single list read-only** (for a friend picking things up), and more than two people per household.
- **Export or backup** of the lists, stores, and frequent items to a JSON or CSV file from Settings.
- **Android and desktop polish** (install prompt, keyboard navigation).

## Hardening and housekeeping

- **Deploy retry.** The deploy decision looks only at the current push, so a failed deploy followed by a docs-only merge isn't retried; consider comparing against what is live.
- **Dependabot majors.** The pip, Actions and root npm groups still auto-merge major bumps (frontend majors are held back); add a guard if one ever bites.
- **Shared header component** for the Lists and Settings headers; one error boundary around the app.
- **minimatch alert (dev-only).** No patched release exists; dismiss it or wait for ESLint to move.
- **Remove the unneeded extra read** when adding an item (the device name lookup) by carrying the name in the session.
- **Retire a stale token** automatically for devices unused for months.
- **Shared OIDC provider.** The deploy role trusts the AWS account's single GitHub OIDC provider, shared with the other projects. Deleting the stack that owns it breaks every deploy until it is recreated (this happened once); keep that in mind before deleting a stack.
- **Closed PRs still show the old name and email.** GitHub keeps the pre-cleanup commits behind each closed PR in hidden refs that git can't delete. Left on purpose; GitHub Support can purge them, or recreate the repo, if it ever matters.
- **Setup key.** `POST /household` is still first come, first served on a fresh table; a setup key would close that.
