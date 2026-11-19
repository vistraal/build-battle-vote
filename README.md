# Build Battle · Vote

A one-page voting site for a classroom build battle: every student adds their published site, then votes once for someone else's. Static files (hosted on Sitesfare at `buildbattle.sitesfare.app`) + Firebase for sign-in and the vote store. The rules in `firestore.rules` are what enforce the game, not the page:

- one vote per Google account (vote doc id = the voter's uid, create-only)
- no self-votes (`site != uid`, checked server-side)
- optional: only a given email domain (e.g. `mits.ac.in`) can take part
- organiser opens/closes voting; while closed, everyone sees the results

## Files

| File | What |
| --- | --- |
| `index.html`, `style.css`, `app.js` | the site |
| `firebase-config.js` | your Firebase web config (empty = "almost ready" screen) |
| `firestore.rules` | paste into Firestore → Rules |

## Setup (10 minutes, once)

1. **Firebase project** — [console.firebase.google.com](https://console.firebase.google.com) → Add project (Analytics off is fine).
2. **Authentication** → Get started → Sign-in method → **Google** → Enable → Save.
   Then Authentication → Settings → **Authorized domains** → Add `buildbattle.sitesfare.app`.
3. **Firestore Database** → Create database → production mode → a region near you (asia-south1).
   Open the **Rules** tab, replace everything with `firestore.rules`, Publish.
4. **Project settings** (gear) → Your apps → **</> Web** → register "vote" → copy the `firebaseConfig` object into `firebase-config.js`.
5. Deploy the four site files (`index.html`, `style.css`, `app.js`, `firebase-config.js`) to Sitesfare — from an AI editor with `app_put_files` + `app_deploy`, or upload a .zip on the site's Code page.
6. Open `https://buildbattle.sitesfare.app` **yourself first** and sign in: the first person in becomes the organiser. Set the title and (optionally) the allowed email domain.

## Running it

- Post the link in the class group. Students sign in → add their site (name + live URL) → open a few → Vote (tap twice: the button asks to confirm).
- Your view has **Live results** and an **Organiser** panel: *Close voting* reveals the results to everyone; *remove* drops a site (test entries, duplicates).
- Settings lets you add more organiser emails and change the domain.
- **Reset…** (Organiser panel, tap twice) deletes every site and vote and reopens voting, so the same link works for the next batch. Settings and organisers are kept.

## Notes

- Without an allowed domain, "one vote per person" means one vote per Google account. Set the college domain if you want it watertight.
- Site numbers are the order students registered; votes are stored against the student, so removing a site never shifts anyone's vote.
- No server, no build step, no secrets: the Firebase config is public by design; the rules file is the security.

## Organiser flow (v4)

Tabs for the organiser only: **Submissions · Gallery · Voting · Control · 1st · 2nd · 3rd · Winners**. Every tab except Control is a projector screen with 3–4 large elements.

1. **Control → Start submission timer** (default 45 min). The **Submissions** tab shows the live count, the countdown and the app URL. When the timer ends no more submissions are accepted (enforced in `firestore.rules`).
2. **+10 min grace** — optional, whenever you like. Submissions reopen for 10 minutes.
3. **Start voting** (default 10 min). The gallery opens for students; the **Voting** tab shows the countdown and hands raised. When it ends, voting stops and the app closes the vote and jumps to the **1st** page with confetti.
4. **2nd**, **3rd** and **Winners** (top 10) are the other reveal pages. **Close & reveal** ends the vote early.
5. **Reset…** deletes every site and hand, clears the timers and returns to Submissions.
