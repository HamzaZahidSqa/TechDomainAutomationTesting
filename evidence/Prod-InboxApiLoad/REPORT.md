# Production: repeated `GET /inbox` calls (analysis 2026-10-16, 15:00 PKT)

Context: production portal (app.techdomain.com.au) reported down; the `/inbox` API is being called repeatedly. Production login page and API root answered normally from here (HTTP 200, 0.2–0.9 s), so the problem is load from logged-in clients, not a hard outage. No production credentials were available, so the frontend code of both builds was compared and the behaviour was measured on dev.

Builds: production `static/js/main.3f79de71.js` (older) vs dev `static/js/main.9c79992f.js` (newer). The inbox hook differs.

## Root cause (production bundle, inbox hook `W3e`)
```js
// socket handler in the PRODUCTION build
s.on("unreadCountUpdated", ({conversationId, unreadCount}) => {
  const cached = queryClient.getQueryData(["inbox", userId]);
  const idx = cached.data.findIndex(c => c.conversationId === conversationId);
  const c = idx === -1 ? null : cached.data[idx].unreadCount;
  (c === null || unreadCount > c)
    ? queryClient.invalidateQueries({queryKey: ["inbox", userId]})   // <-- full GET /inbox again
    : queryClient.setQueryData(...);                                 // in-place update
});
```
Consequences:
1. Every incoming message raises the receiver's unread count (`unreadCount > c`) → one full `GET /inbox?limit=20` per message, for every participant of that conversation, in every open tab.
2. If the conversation is not in the cached first 20 rows (`idx === -1`) the client refetches on EVERY event for it, even read receipts.
3. The hook is mounted on every page (header badge) and again on Messages (`enabled:t`), and both have an extra `useEffect(() => refetch())` on mount, so a page load already costs 2–3 inbox calls before any socket event.
4. The socket reconnects forever (`reconnection:true, delay 2 s`); on every `connect` the client re-subscribes and the server pushes unread updates again → bursts after any socket/server hiccup, which feeds back into the load.

`/inbox` is an expensive query (conversations + latest message + unread counts per user), so under chat traffic the backend gets N(participants) × M(messages) × tabs calls, which matches "portal down".

## Dev build (newer) already handles it differently
In dev the `unreadCountUpdated` handler updates the cached row in place (`setQueryData`, moves the conversation to the top) and only `conversationUpdated` invalidates. Measured on dev with Playwright: 1 inbox call on login, 2 on the Messages page (list + `section=direct`), 0 on window focus, 0 while another user posted 5 messages, 0 on tab switches, 0 during 60 s idle. No loop.

## Recommendation for dev
- Deploy the newer inbox hook (dev build) to production, or hot-fix production: never `invalidateQueries` from `unreadCountUpdated`; patch the cached row instead and insert a stub row when the conversation is not cached.
- Backend: debounce/coalesce `unreadCountUpdated` per user (e.g. 1 event per 2 s), and emit it only to the receiver, not to every room participant.
- Short-term relief: rate-limit `GET /inbox` per user (e.g. 1 request / 2 s, return 429) so chat traffic cannot take the API down.
- Also remove the duplicate mount refetch (`useEffect(() => enabled && refetch())`) in both builds.
