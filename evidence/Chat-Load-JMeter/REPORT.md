# Chat message & notification latency under load (JMeter) — dev, 2026-10-14

Question: with 1000 active users, how long does a chat message take and how long until the notification arrives?

## How it was measured
Plan `jmeter/tdp-chat-load.jmx`, runner `scripts/Run-ChatLoad.ps1` (WebSocket Samplers plugin 1.2.11 in JMeter 5.6.3).
- **Active users (N threads)**: each logs in through a shared token pool (access tokens expire after **60 s**, so a refresher thread calls `POST /auth/refreshToken` every 40 s), opens one socket.io connection like the web app (`subscribeUser`, `joinRoom user_<id>`) and then loops `GET /inbox`, `GET /notifications`, `GET /notifications/others`, `GET /users/me` with 3–6 s think time. Accounts: the 6 non-admin accounts in accounts.json, round-robin.
- **Chat senders (10 threads, Tech Domain user 27)**: open a socket, `joinGroupChat` room 1821 (WO #10983), emit `sendMessage` with a unique marker, wait for the server's `receiveMessage` echo. *Message time* = emit → echo.
- **Receiver (customer 638)**: one socket, online but not inside the room (the real "user elsewhere in the app" case). Every `notification` / `unreadCountUpdated` frame carrying a marker is turned into a latency sample = time since the sender emitted. *Notification time* = emit → `notification` event at the customer.
- Runs: baseline (0 active users, 10 senders × 120 s), 300 users (ramp 60 s, measure 150 s), 1000 users (ramp 120 s, measure 180 s). One earlier 1000-user run without token refresh is kept for reference (`chat-load1000-20261014-113625`).

## Results
| Load | Message send → echo (p50 / p90) | Notification at customer (p50 / p90) | Failed sends | HTTP API (p50 of successful) | Connection errors |
|---|---|---|---|---|---|
| **Baseline, 0 users** | **180 ms / 293 ms** | **264 ms / 372 ms** | 0 % (14 false timeouts, see note) | — | none |
| **300 active users** | **1.7 s / 4.5 s** | **5.6 s / 7.3 s** | 6 % (>20 s) | 3–6 s | none (0 × 401, 0 × SSL) |
| **1000 active users** | successful ones 0.2–1.6 s p50, but **57 % of sends failed** (socket closed / no echo in 20 s) | 1.1 s / 4.5 s for the 42 that arrived (up to 10 s) | 57 % | 2–7 s | **~60 % SSL handshake dropped / connection reset / NoHttpResponse**, 46 × HTTP 500, token refresh calls failed (9–17 s) |

Full per-label table: `comparison-table.md`. Per-30-second timelines: `<run>/analysis.txt`. JMeter HTML dashboards: `jmeter/results/<run>/report/index.html`.

Notes
- In the 1000-user summary the message p50 shows 20 001 ms because the 56 timed-out sends (20 s cap) dominate the sample; the per-30 s timeline in `analysis.txt` gives 227–1639 ms p50 for the sends that did get an echo.
- The 1000-user run without token refresh (`chat-load1000-…113625`) shows the same SSL drops starting at ~500 concurrent users (p50 of successful HTTP calls 4.5 s at 499 users, 5.7 s at 672 users). Because most HTTP calls then failed fast with 401, the chat path stayed at baseline speed (175 ms / 250 ms) in that run — i.e. the chat server itself is fine; it is the overall API host that saturates.
- Baseline "14 errors" were a harness artefact (read-count limit while 10 senders share one room); fixed in the plan (time-based wait) before the 300/1000 runs.

## Conclusion
- Unloaded, chat is fast: ~0.2 s message, ~0.3 s notification.
- At **300 active users** dev still accepts every connection but everything slows ~10×: messages ~2 s, notifications ~5–7 s, API calls 3–6 s.
- At **1000 active users** the dev host is beyond capacity: new TLS connections are refused/reset, HTTP 500s appear, token refresh fails, more than half of chat sends never get an echo and notifications take seconds when they arrive. The breaking point is roughly **300–500 concurrent users** on the current dev sizing.

## Side findings for developers
1. Socket.io authenticates with `{userId, role}` only — no token. Anyone can connect as any user id and receive their chat/notification events (security issue).
2. Access tokens expire after 60 s; the app silently refreshes, but any client that cannot refresh fast enough under load gets logged out (refresh took 9–17 s and failed at 1000 users).
3. Notifications are only created when the receiver is *not* inside the chat room; a user inside the room gets `receiveMessage` only.
