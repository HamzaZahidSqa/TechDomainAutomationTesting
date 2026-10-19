| Metric | Run | Samples | Errors | p50 ms | p90 ms | p95 ms | max ms |
|---|---|---|---|---|---|---|---|
| Message send to own echo (Tech Domain sender) | baseline 0 users | 278 | 14 | 180 | 293 | 318 | 386 |
| Message send to own echo (Tech Domain sender) | 300 users | 138 | 8 | 1746 | 4533 | 20016 | 20946 |
| Message send to own echo (Tech Domain sender) | 1000 users | 98 | 56 | 20001 | 20029 | 20053 | 20209 |
| Notification event at customer (socket) | baseline 0 users | 278 | 0 | 264 | 372 | 392 | 555 |
| Notification event at customer (socket) | 300 users | 138 | 0 | 5621 | 7321 | 8650 | 11916 |
| Notification event at customer (socket) | 1000 users | 42 | 0 | 1144 | 4492 | 8028 | 9983 |
| Inbox unread-count push at customer | baseline 0 users | 278 | 0 | 239 | 352 | 376 | 529 |
| Inbox unread-count push at customer | 300 users | 138 | 0 | 5112 | 7051 | 8146 | 8895 |
| Inbox unread-count push at customer | 1000 users | 42 | 0 | 975 | 4280 | 7419 | 9061 |
| New chat socket connect (TLS + upgrade) | baseline 0 users | 282 | 0 | 545 | 612 | 631 | 797 |
| New chat socket connect (TLS + upgrade) | 300 users | 138 | 0 | 1789 | 3870 | 4307 | 7042 |
| New chat socket connect (TLS + upgrade) | 1000 users | 107 | 63 | 346 | 4040 | 4146 | 5370 |
| HTTP GET /inbox | 300 users | 2916 | 0 | 3799 | 6164 | 7152 | 38683 |
| HTTP GET /inbox | 1000 users | 26617 | 23273 | 318 | 3890 | 5072 | 11016 |
| HTTP GET /notifications | 300 users | 2892 | 0 | 5604 | 8974 | 10972 | 19801 |
| HTTP GET /notifications | 1000 users | 26503 | 23402 | 307 | 4198 | 6881 | 17131 |
| HTTP GET /users/me | 300 users | 2705 | 0 | 5721 | 7888 | 9099 | 14897 |
| HTTP GET /users/me | 1000 users | 25816 | 22665 | 334 | 4298 | 7802 | 16196 |
