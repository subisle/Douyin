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
