# Douyin live monitor reverse notes

Sample room checked on 2026-07-07:

`https://live.douyin.com/786863803561?anchor_id=3959814880788154&is_vs=0&vs_ep_group_id=&vs_episode_id=&vs_episode_stage=&vs_season_id=`

Second room checked with `js-reverse` on 2026-07-07:

`https://live.douyin.com/876220278338?anchor_id=1118647337891827&is_vs=0&vs_ep_group_id=&vs_episode_id=&vs_episode_stage=&vs_season_id=`

## Field sources

### Room and anchor

Source: `GET https://live.douyin.com/webcast/room/web/enter/`

Reliable fields:

- `data.data[0].id_str` or `data.room.id_str`: room id.
- `data.data[0].title`: room title.
- `data.data[0].owner.id_str`: anchor numeric user id.
- `data.data[0].owner.sec_uid`: anchor `sec_uid`.
- `data.data[0].owner.nickname`: anchor live nickname.
- `data.data[0].room_view_stats.display_long`: online display text.
- `data.data[0].room_view_stats.display_value`: online count.
- `data.data[0].like_count`: room like count.

For the sample room, this returned:

- room id: `7659421874983553843`
- title: `龙浩天大舞台！！`
- anchor user id: `3959814880788154`
- anchor sec_uid: `MS4wLjABAAAAtxmKttp9bocZVogmLmEDWCnd56Uf4lxCUq0mjfAecDap_rIThQH5i0VZ4lkVlKmE`
- anchor nickname: `AI瑶瑶• 银河系001｜团队招优PGY`
- anchor public Douyin id from `profile/other`: `YHX001_`
- online: `6182在线观众`
- likes: `216098`

The public Douyin id (`unique_id`) is not guaranteed in `room/web/enter`. The monitor tries a follow-up profile lookup with `sec_uid` through `https://www.douyin.com/aweme/v1/web/user/profile/other/`. If Douyin blocks or omits it, the UI shows `未返回` instead of inventing a value.

For the sample room, `profile/other` with the anchor `sec_uid` returned:

- `uid`: `3959814880788154`
- `unique_id`: `YHX001_`
- `nickname`: `AI瑶瑶• 银河系001｜团队招优PGY`
- `follower_count`: `358472`

The live URL path, for example `786863803561`, is kept separately as `web_rid`. It is a useful fallback/display id, but it is not the same field as `profile/other.user.unique_id`.

For the second room, the live page and `room/web/enter` returned:

- room id: `7659464178012277523`
- title: `是少妇还是小姐姐？`
- anchor user id: `1118647337891827`
- anchor sec_uid: `MS4wLjABAAAAfe18MkSg_rL7mPOJDbXVGs2YAbBaPl7GdAeP9ROOodjbI6ZAP8qCzhQaYXUlUGxZ`
- anchor nickname: `用户Zxf222333`

The real public Douyin id was not in the live page's owner object and was not in `room/web/enter`. In the page's signed runtime, calling webpack module `351485.U2` with:

- path: `/aweme/v1/web/user/profile/other/`
- params: `COMMON_SEARCH_PARAMS + { source: CHANNEL_PC_WEB, sec_user_id }`

returned:

- `uid`: `1118647337891827`
- `unique_id`: `Zxf9216666`
- `nickname`: `用户Zxf222333`
- `follower_count`: about `9400`
- `ip_location`: `IP属地：江苏`

The direct Node `fetch` path may return an empty 200 response because it lacks the browser-generated `a_bogus`. The working path is to run the lookup inside the live page after `client-entry` has initialized `TncManager`, `proxyFetch`, and `proxyXhr` from chunk `6044`, so the page's security SDK signs the request.

### Audience and levels

Source: `GET https://live.douyin.com/webcast/ranklist/audience/`

Useful fields:

- `data.ranks[].user.nickname`: often desensitized, for example `蝴***`.
- `data.ranks[].user.pay_grade.level`: wealth/consume level.
- `data.ranks[].user.fans_club.data.level`: fans club level.
- `data.ranks[].user.fans_club.data.club_name`: fans club name.

Limitations:

- This endpoint often masks `user.id_str` as `111111`.
- `sec_uid` and `unique_id` are usually empty for rank users.
- Therefore rank users can provide levels and labels, but not reliable real Douyin ids.

### Realtime messages

Sources:

- Initial poll: `GET https://live.douyin.com/webcast/im/fetch/`
- Continuous stream: WebSocket `wss://webcast*-ws-web-lq.douyin.com/webcast/im/push/`

The response is protobuf `webcast.im.Response`; each `messages[].method` maps to a protobuf message type in `assets/live-room-watcher/proto/douyin_hack/webcast/im/`.

Important methods currently parsed:

- `WebcastChatMessage`: chat content and sender profile fields.
- `WebcastMemberMessage`: room entry events and sender profile fields.
- `WebcastRoomUserSeqMessage`: online/user sequence and contribution rows.
- `WebcastRoomStatsMessage`: online count display.
- `WebcastRoomRankMessage`: contribution rank rows.
- `WebcastGiftMessage`, `WebcastFreeCellGiftMessage`, `WebcastDoodleGiftMessage`, `WebcastFreeGiftMessage`: gift details.

### Real user id source

The `scx567888/live-room-watcher` Douyin implementation does not decrypt hidden ids. Its user id flow is equivalent to reading protobuf `webcast.data.User.id` and outputting it directly. This monitor follows the same rule:

- If protobuf `User.id/id_str` is a real value such as `1611618794`, keep it as `userId`.
- If Douyin sends the masked placeholder `111111`, treat it as missing.
- If protobuf `User.display_id/unique_id/web_rid` is present, keep it as the public Douyin id.
- If protobuf `User.sec_uid` is present, keep it and optionally use `profile/other` to enrich nickname and public id.

Gift messages are useful because Douyin may include a stronger sender identity there than it does in audience/rank rows. They are still not a guaranteed unlock: when the server sends only masked fields, the UI must show the identity as missing.

### `sec_uid` acquisition paths

Best paths, in current priority order:

0. Direct public id: if `webcast.data.User.display_id`, `unique_id`, `displayId`, `uniqueId`, or `web_rid` is already present in the protobuf/JSON user object, use it immediately as the public Douyin id. This is the only zero-roundtrip path.
1. Realtime gift sender: `webcast.im.Response.messages[].method = WebcastGiftMessage`, then decode `payload` as `GiftMessage` and read `user.sec_uid` (`webcast.data.User` field 46). If `user` is sparse, also check `common.user.sec_uid`. Do not use `to_user.sec_uid` as the sender; that is usually the gift recipient / anchor side.
2. Other realtime user events: `WebcastChatMessage.user.sec_uid`, `WebcastMemberMessage.user.sec_uid`, `WebcastFansclubMessage.user.sec_uid`, `WebcastSocialMessage.user.sec_uid`, `WebcastLikeMessage.user.sec_uid`, `WebcastContentOpenPicoLikeMessage.user.sec_uid`. For all of these, `common.user.sec_uid` is a useful fallback when the message-level `user` is incomplete.
3. Realtime rank-like messages: `WebcastRoomUserSeqMessage.ranks[].user.sec_uid`, `WebcastRoomUserSeqMessage.seats[].user.sec_uid`, and `WebcastRoomRankMessage.ranks[].user.sec_uid`. These are useful when present, but rank rows are often masked or hidden.
4. Room owner: `GET https://live.douyin.com/webcast/room/web/enter/`, then `data.data[0].owner.sec_uid` or `data.room.owner.sec_uid`. This is reliable for the anchor, not for arbitrary viewers.
5. Profile completion: once `sec_uid` is known, call `/aweme/v1/web/user/profile/other/` with `sec_user_id=<sec_uid>` to obtain `uid`, `unique_id`, `nickname`, `ip_location`, and follower count. Direct Node `fetch` may be blocked; the stronger path is executing the request inside the live page runtime through webpack module `351485.U2` so Douyin's page security layer signs the request.

Fastest practical flow:

- Use `display_id/unique_id` directly if present.
- Otherwise, as soon as any IM message exposes `sec_uid`, start a page-signed `profile/other` lookup in the background and cache the Promise by `sec_uid`.
- For gift messages, wait on that cached/signed lookup before emitting the gift row, because gift rows are the highest-value moment to show real nickname and public Douyin id.
- Prefer the signed page lookup over Node `fetch`; only fall back to Node `fetch` if the page lookup is unavailable or fails.

Lower-yield paths:

- `GET https://live.douyin.com/webcast/ranklist/audience/`: good for levels / fan club labels, but commonly returns `user.id_str = 111111` and omits `sec_uid`.
- `GET https://live.douyin.com/webcast/room/interaction/info/` and `/webcast/wish/list/`: useful room metadata, not a dependable sender `sec_uid` source.
- `to_user`, `to_user_ids`, `to_openids`, `from_user_open_id`, and related `open_id` fields identify recipients or open-platform IDs, but they are not interchangeable with `sec_uid`.

### Live mode / PK / linkmic classification

Use `room/web/enter` only as the first pass:

- No `linker_map`, no `linker_detail.linker_play_modes`, and `manual_open_ui = 0`: treat as single live.
- Any `linker_map`, `linker_play_modes`, or nonzero `manual_open_ui`: treat as linkmic until a stronger PK snapshot arrives.

Use `GET https://live.douyin.com/webcast/linkmic/list/` as the strongest current-state snapshot:

- `data.user[]`: current linked anchors / guests. More than one user means linkmic.
- `data.battle_stats.battle_settings`: PK metadata.
- `data.battle_stats.battle_scores[]`: PK score rows, keyed by `user_id_str`.
- `data.battle_stats.battle_armies[].rank_list[]`: PK contribution rows per anchor.

Active PK rule:

- `battle_stats` exists, `battle_settings.finished = 0`, and `battle_status != 3`: classify as `pk`.
- `battle_stats` exists but `finished = 1` or `battle_status = 3`: classify as `linkmic` with `battlePhase = punish/finished`, not active PK.
- No active battle but more than one linked user: classify as `linkmic`.
- No linked users / no battle: classify as `single`.

Score tracking:

- Keep the hidden live page alive after startup.
- Every 3 seconds, read the page runtime store (`__STORE__.pkStore.pkStatusData` / `pkListData`) instead of replaying an old signed `linkmic/list` URL.
- Emit `pk-score-snapshot` for every score check. The payload records `battleId`, `channelId`, `checkedAt`, optional `pkCountDown`, and `scores[]`.
- Each `scores[]` row stores `anchorId` / `userId`, nickname fields, and numeric `score`. This is the canonical time-series record for PK score history.

For `https://live.douyin.com/98051399393?...`, `linkmic/list` returned three users, `battle_settings.finished = 0`, `battle_status = 1`, `duration = 600`, and three `battle_scores`, so it is a three-anchor active PK. For `https://live.douyin.com/954085346497?...`, `battle_settings.finished = 1` and `battle_status = 3`, so it is not active PK even though a PK score snapshot remains visible.

### Room audio-wave / fan ticket

The monitor must use server cumulative fields only:

- `GiftMessage.roomFanTicketCount`
- `FreeCellGiftMessage.roomFanTicketCount`
- `DoodleGiftMessage.roomFanTicketCount`

Do not calculate room audio-wave by summing local gifts. Local summing misses earlier gifts, may double count combos, and cannot know Douyin-side bonuses. If no gift message with `roomFanTicketCount` has arrived, the UI should show that it is waiting for the server cumulative field.

In the sample room's initial `im/fetch` capture there were no gift messages, so no room audio-wave value was available from the service at that moment.

## UI rules

- Room info comes from `room/web/enter`.
- User list only includes rows with a strong identity: real `user_id`, `sec_uid`, or public Douyin id.
- Gift rows stay in the realtime log. A gift event creates/updates a user-list record only when the gift sender payload contains a strong identity.
- Any field that Douyin masks or omits is displayed as missing instead of being inferred.
